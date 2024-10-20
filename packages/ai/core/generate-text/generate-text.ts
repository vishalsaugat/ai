import { createIdGenerator } from '@ai-sdk/provider-utils';
import { Tracer } from '@opentelemetry/api';
import { InvalidArgumentError } from '../../errors';
import { retryWithExponentialBackoff } from '../../util/retry-with-exponential-backoff';
import { CoreAssistantMessage, CoreToolMessage } from '../prompt';
import { CallSettings } from '../prompt/call-settings';
import {
  convertToLanguageModelMessage,
  convertToLanguageModelPrompt,
} from '../prompt/convert-to-language-model-prompt';
import { prepareCallSettings } from '../prompt/prepare-call-settings';
import { prepareToolsAndToolChoice } from '../prompt/prepare-tools-and-tool-choice';
import { Prompt } from '../prompt/prompt';
import { validatePrompt } from '../prompt/validate-prompt';
import { assembleOperationName } from '../telemetry/assemble-operation-name';
import { getBaseTelemetryAttributes } from '../telemetry/get-base-telemetry-attributes';
import { getTracer } from '../telemetry/get-tracer';
import { recordSpan } from '../telemetry/record-span';
import { selectTelemetryAttributes } from '../telemetry/select-telemetry-attributes';
import { TelemetrySettings } from '../telemetry/telemetry-settings';
import { CoreTool } from '../tool/tool';
import { CoreToolChoice, LanguageModel, ProviderMetadata } from '../types';
import {
  LanguageModelUsage,
  calculateLanguageModelUsage,
} from '../types/usage';
import { removeTextAfterLastWhitespace } from '../util/remove-text-after-last-whitespace';
import { GenerateTextResult } from './generate-text-result';
import { parseToolCall } from './parse-tool-call';
import { StepResult } from './step-result';
import { toResponseMessages } from './to-response-messages';
import { ToolCallArray } from './tool-call';
import { ToolResultArray } from './tool-result';

const originalGenerateId = createIdGenerator({ prefix: 'aitxt-', size: 24 });

/**
Generate a text and call tools for a given prompt using a language model.

This function does not stream the output. If you want to stream the output, use `streamText` instead.

@param model - The language model to use.

@param tools - Tools that are accessible to and can be called by the model. The model needs to support calling tools.
@param toolChoice - The tool choice strategy. Default: 'auto'.

@param system - A system message that will be part of the prompt.
@param prompt - A simple text prompt. You can either use `prompt` or `messages` but not both.
@param messages - A list of messages. You can either use `prompt` or `messages` but not both.

@param maxTokens - Maximum number of tokens to generate.
@param temperature - Temperature setting.
The value is passed through to the provider. The range depends on the provider and model.
It is recommended to set either `temperature` or `topP`, but not both.
@param topP - Nucleus sampling.
The value is passed through to the provider. The range depends on the provider and model.
It is recommended to set either `temperature` or `topP`, but not both.
@param topK - Only sample from the top K options for each subsequent token.
Used to remove "long tail" low probability responses.
Recommended for advanced use cases only. You usually only need to use temperature.
@param presencePenalty - Presence penalty setting.
It affects the likelihood of the model to repeat information that is already in the prompt.
The value is passed through to the provider. The range depends on the provider and model.
@param frequencyPenalty - Frequency penalty setting.
It affects the likelihood of the model to repeatedly use the same words or phrases.
The value is passed through to the provider. The range depends on the provider and model.
@param stopSequences - Stop sequences.
If set, the model will stop generating text when one of the stop sequences is generated.
@param seed - The seed (integer) to use for random sampling.
If set and supported by the model, calls will generate deterministic results.

@param maxRetries - Maximum number of retries. Set to 0 to disable retries. Default: 2.
@param abortSignal - An optional abort signal that can be used to cancel the call.
@param headers - Additional HTTP headers to be sent with the request. Only applicable for HTTP-based providers.

@param maxSteps - Maximum number of sequential LLM calls (steps), e.g. when you use tool calls.

@param onStepFinish - Callback that is called when each step (LLM call) is finished, including intermediate steps.

@returns
A result object that contains the generated text, the results of the tool calls, and additional information.
 */
export async function generateText<TOOLS extends Record<string, CoreTool>>({
  model,
  tools,
  toolChoice,
  system,
  prompt,
  messages,
  maxRetries,
  abortSignal,
  headers,
  maxAutomaticRoundtrips = 0,
  maxToolRoundtrips = maxAutomaticRoundtrips,
  maxSteps = maxToolRoundtrips != null ? maxToolRoundtrips + 1 : 1,
  experimental_continuationSteps,
  experimental_continueSteps: continueSteps = experimental_continuationSteps ??
    false,
  experimental_telemetry: telemetry,
  experimental_providerMetadata: providerMetadata,
  experimental_activeTools: activeTools,
  _internal: {
    generateId = originalGenerateId,
    currentDate = () => new Date(),
  } = {},
  onStepFinish,
  ...settings
}: CallSettings &
  Prompt & {
    /**
The language model to use.
     */
    model: LanguageModel;

    /**
The tools that the model can call. The model needs to support calling tools.
*/
    tools?: TOOLS;

    /**
The tool choice strategy. Default: 'auto'.
     */
    toolChoice?: CoreToolChoice<TOOLS>;

    /**
@deprecated Use `maxToolRoundtrips` instead.
     */
    maxAutomaticRoundtrips?: number;

    /**
Maximum number of automatic roundtrips for tool calls.

An automatic tool call roundtrip is another LLM call with the
tool call results when all tool calls of the last assistant
message have results.

A maximum number is required to prevent infinite loops in the
case of misconfigured tools.

By default, it's set to 0, which will disable the feature.

@deprecated Use `maxSteps` instead (which is `maxToolRoundtrips` + 1).
     */
    maxToolRoundtrips?: number;

    /**
Maximum number of sequential LLM calls (steps), e.g. when you use tool calls. Must be at least 1.

A maximum number is required to prevent infinite loops in the case of misconfigured tools.

By default, it's set to 1, which means that only a single LLM call is made.
     */
    maxSteps?: number;

    /**
@deprecated Use `experimental_continueSteps` instead.
     */
    experimental_continuationSteps?: boolean;

    /**
When enabled, the model will perform additional steps if the finish reason is "length" (experimental).

By default, it's set to false.
     */
    experimental_continueSteps?: boolean;

    /**
Optional telemetry configuration (experimental).
     */
    experimental_telemetry?: TelemetrySettings;

    /**
Additional provider-specific metadata. They are passed through
to the provider from the AI SDK and enable provider-specific
functionality that can be fully encapsulated in the provider.
 */
    experimental_providerMetadata?: ProviderMetadata;

    /**
Limits the tools that are available for the model to call without
changing the tool call and result types in the result.
     */
    experimental_activeTools?: Array<keyof TOOLS>;

    /**
    Callback that is called when each step (LLM call) is finished, including intermediate steps.
    */
    onStepFinish?: (event: StepResult<TOOLS>) => Promise<void> | void;

    /**
     * Internal. For test use only. May change without notice.
     */
    _internal?: {
      generateId?: () => string;
      currentDate?: () => Date;
    };
  }): Promise<GenerateTextResult<TOOLS>> {
  if (maxSteps < 1) {
    throw new InvalidArgumentError({
      parameter: 'maxSteps',
      value: maxSteps,
      message: 'maxSteps must be at least 1',
    });
  }

  const baseTelemetryAttributes = getBaseTelemetryAttributes({
    model,
    telemetry,
    headers,
    settings: { ...settings, maxRetries },
  });

  const tracer = getTracer(telemetry);

  return recordSpan({
    name: 'ai.generateText',
    attributes: selectTelemetryAttributes({
      telemetry,
      attributes: {
        ...assembleOperationName({
          operationId: 'ai.generateText',
          telemetry,
        }),
        ...baseTelemetryAttributes,
        // specific settings that only make sense on the outer level:
        'ai.prompt': {
          input: () => JSON.stringify({ system, prompt, messages }),
        },
        'ai.settings.maxSteps': maxSteps,
      },
    }),
    tracer,
    fn: async span => {
      const retry = retryWithExponentialBackoff({ maxRetries });
      const validatedPrompt = validatePrompt({
        system,
        prompt,
        messages,
      });

      const mode = {
        type: 'regular' as const,
        ...prepareToolsAndToolChoice({ tools, toolChoice, activeTools }),
      };
      const callSettings = prepareCallSettings(settings);
      const promptMessages = await convertToLanguageModelPrompt({
        prompt: validatedPrompt,
        modelSupportsImageUrls: model.supportsImageUrls,
      });

      let currentModelResponse: Awaited<
        ReturnType<LanguageModel['doGenerate']>
      > & { response: { id: string; timestamp: Date; modelId: string } };
      let currentToolCalls: ToolCallArray<TOOLS> = [];
      let currentToolResults: ToolResultArray<TOOLS> = [];
      let stepCount = 0;
      const responseMessages: Array<CoreAssistantMessage | CoreToolMessage> =
        [];
      let text = '';
      const steps: GenerateTextResult<TOOLS>['steps'] = [];
      const usage: LanguageModelUsage = {
        completionTokens: 0,
        promptTokens: 0,
        totalTokens: 0,
      };

      let stepType: 'initial' | 'tool-result' | 'continue' | 'done' = 'initial';

      do {
        // once we have a 2nd step, we need to switch to messages format:
        const currentInputFormat =
          stepCount === 0 ? validatedPrompt.type : 'messages';

        currentModelResponse = await retry(() =>
          recordSpan({
            name: 'ai.generateText.doGenerate',
            attributes: selectTelemetryAttributes({
              telemetry,
              attributes: {
                ...assembleOperationName({
                  operationId: 'ai.generateText.doGenerate',
                  telemetry,
                }),
                ...baseTelemetryAttributes,
                'ai.prompt.format': { input: () => currentInputFormat },
                'ai.prompt.messages': {
                  input: () => JSON.stringify(promptMessages),
                },

                // standardized gen-ai llm span attributes:
                'gen_ai.system': model.provider,
                'gen_ai.request.model': model.modelId,
                'gen_ai.request.frequency_penalty': settings.frequencyPenalty,
                'gen_ai.request.max_tokens': settings.maxTokens,
                'gen_ai.request.presence_penalty': settings.presencePenalty,
                'gen_ai.request.stop_sequences': settings.stopSequences,
                'gen_ai.request.temperature': settings.temperature,
                'gen_ai.request.top_k': settings.topK,
                'gen_ai.request.top_p': settings.topP,
              },
            }),
            tracer,
            fn: async span => {
              const result = await model.doGenerate({
                mode,
                ...callSettings,
                inputFormat: currentInputFormat,
                prompt: promptMessages,
                providerMetadata,
                abortSignal,
                headers,
              });

              // Fill in default values:
              const responseData = {
                id: result.response?.id ?? generateId(),
                timestamp: result.response?.timestamp ?? currentDate(),
                modelId: result.response?.modelId ?? model.modelId,
              };

              // Add response information to the span:
              span.setAttributes(
                selectTelemetryAttributes({
                  telemetry,
                  attributes: {
                    'ai.response.finishReason': result.finishReason,
                    'ai.response.text': {
                      output: () => result.text,
                    },
                    'ai.response.toolCalls': {
                      output: () => JSON.stringify(result.toolCalls),
                    },
                    'ai.response.id': responseData.id,
                    'ai.response.model': responseData.modelId,
                    'ai.response.timestamp':
                      responseData.timestamp.toISOString(),

                    'ai.usage.promptTokens': result.usage.promptTokens,
                    'ai.usage.completionTokens': result.usage.completionTokens,

                    // deprecated:
                    'ai.finishReason': result.finishReason,
                    'ai.result.text': {
                      output: () => result.text,
                    },
                    'ai.result.toolCalls': {
                      output: () => JSON.stringify(result.toolCalls),
                    },

                    // standardized gen-ai llm span attributes:
                    'gen_ai.response.finish_reasons': [result.finishReason],
                    'gen_ai.response.id': responseData.id,
                    'gen_ai.response.model': responseData.modelId,
                    'gen_ai.usage.input_tokens': result.usage.promptTokens,
                    'gen_ai.usage.output_tokens': result.usage.completionTokens,
                  },
                }),
              );

              return { ...result, response: responseData };
            },
          }),
        );

        // parse tool calls:
        currentToolCalls = (currentModelResponse.toolCalls ?? []).map(
          modelToolCall => parseToolCall({ toolCall: modelToolCall, tools }),
        );

        // execute tools:
        currentToolResults =
          tools == null
            ? []
            : await executeTools({
                toolCalls: currentToolCalls,
                tools,
                tracer,
                telemetry,
                abortSignal,
              });

        // token usage:
        const currentUsage = calculateLanguageModelUsage(
          currentModelResponse.usage,
        );
        usage.completionTokens += currentUsage.completionTokens;
        usage.promptTokens += currentUsage.promptTokens;
        usage.totalTokens += currentUsage.totalTokens;

        // check if another step is needed:
        let nextStepType: 'done' | 'continue' | 'tool-result' = 'done';
        if (++stepCount < maxSteps) {
          if (
            continueSteps &&
            currentModelResponse.finishReason === 'length' &&
            // only use continue when there are no tool calls:
            currentToolCalls.length === 0
          ) {
            nextStepType = 'continue';
          } else if (
            // there are tool calls:
            currentToolCalls.length > 0 &&
            // all current tool calls have results:
            currentToolResults.length === currentToolCalls.length
          ) {
            nextStepType = 'tool-result';
          }
        }

        // text:
        const stepText =
          nextStepType === 'continue'
            ? removeTextAfterLastWhitespace(currentModelResponse.text ?? '')
            : currentModelResponse.text ?? '';

        // text updates
        text =
          nextStepType === 'continue' || stepType === 'continue'
            ? text + stepText
            : stepText;

        // Add step information:
        const currentStep: StepResult<TOOLS> = {
          stepType,
          text: stepText,
          toolCalls: currentToolCalls,
          toolResults: currentToolResults,
          finishReason: currentModelResponse.finishReason,
          usage: currentUsage,
          warnings: currentModelResponse.warnings,
          logprobs: currentModelResponse.logprobs,
          response: {
            ...currentModelResponse.response,
            headers: currentModelResponse.rawResponse?.headers,
          },
          experimental_providerMetadata: currentModelResponse.providerMetadata,
          isContinued: nextStepType === 'continue',
        };
        steps.push(currentStep);
        await onStepFinish?.(currentStep);

        // append to messages for potential next step:
        if (stepType === 'continue') {
          // continue step: update the last assistant message
          // continue is only possible when there are no tool calls,
          // so we can assume that there is a single last assistant message:
          const lastResponseMessage =
            responseMessages.pop() as CoreAssistantMessage;
          promptMessages.pop();
          if (typeof lastResponseMessage.content === 'string') {
            lastResponseMessage.content = text;
          } else {
            lastResponseMessage.content.push({
              text: stepText,
              type: 'text',
            });
          }
          responseMessages.push(lastResponseMessage);
          promptMessages.push(
            convertToLanguageModelMessage(lastResponseMessage, null),
          );
        } else if (nextStepType === 'continue') {
          const newResponseMessages = toResponseMessages({
            text,
            toolCalls: currentToolCalls,
            toolResults: currentToolResults,
          });

          responseMessages.push(...newResponseMessages);
          promptMessages.push(
            ...newResponseMessages.map(message =>
              convertToLanguageModelMessage(message, null),
            ),
          );
        } else {
          // next step is either done or tool-result:
          const newResponseMessages = toResponseMessages({
            text: currentModelResponse.text,
            toolCalls: currentToolCalls,
            toolResults: currentToolResults,
          });

          responseMessages.push(...newResponseMessages);
          promptMessages.push(
            ...newResponseMessages.map(message =>
              convertToLanguageModelMessage(message, null),
            ),
          );
        }

        stepType = nextStepType;
      } while (stepType !== 'done');

      // Add response information to the span:
      span.setAttributes(
        selectTelemetryAttributes({
          telemetry,
          attributes: {
            'ai.response.finishReason': currentModelResponse.finishReason,
            'ai.response.text': {
              output: () => currentModelResponse.text,
            },
            'ai.response.toolCalls': {
              output: () => JSON.stringify(currentModelResponse.toolCalls),
            },

            'ai.usage.promptTokens': currentModelResponse.usage.promptTokens,
            'ai.usage.completionTokens':
              currentModelResponse.usage.completionTokens,

            // deprecated:
            'ai.finishReason': currentModelResponse.finishReason,
            'ai.result.text': {
              output: () => currentModelResponse.text,
            },
            'ai.result.toolCalls': {
              output: () => JSON.stringify(currentModelResponse.toolCalls),
            },
          },
        }),
      );

      return new DefaultGenerateTextResult({
        text,
        toolCalls: currentToolCalls,
        toolResults: currentToolResults,
        finishReason: currentModelResponse.finishReason,
        usage,
        warnings: currentModelResponse.warnings,
        response: {
          ...currentModelResponse.response,
          headers: currentModelResponse.rawResponse?.headers,
        },
        logprobs: currentModelResponse.logprobs,
        responseMessages,
        steps,
        providerMetadata: currentModelResponse.providerMetadata,
      });
    },
  });
}

async function executeTools<TOOLS extends Record<string, CoreTool>>({
  toolCalls,
  tools,
  tracer,
  telemetry,
  abortSignal,
}: {
  toolCalls: ToolCallArray<TOOLS>;
  tools: TOOLS;
  tracer: Tracer;
  telemetry: TelemetrySettings | undefined;
  abortSignal: AbortSignal | undefined;
}): Promise<ToolResultArray<TOOLS>> {
  const toolResults = await Promise.all(
    toolCalls.map(async toolCall => {
      const tool = tools[toolCall.toolName];

      if (tool?.execute == null) {
        return undefined;
      }

      const result = await recordSpan({
        name: 'ai.toolCall',
        attributes: selectTelemetryAttributes({
          telemetry,
          attributes: {
            ...assembleOperationName({
              operationId: 'ai.toolCall',
              telemetry,
            }),
            'ai.toolCall.name': toolCall.toolName,
            'ai.toolCall.id': toolCall.toolCallId,
            'ai.toolCall.args': {
              output: () => JSON.stringify(toolCall.args),
            },
          },
        }),
        tracer,
        fn: async span => {
          const result = await tool.execute!(toolCall.args, { abortSignal });

          try {
            span.setAttributes(
              selectTelemetryAttributes({
                telemetry,
                attributes: {
                  'ai.toolCall.result': {
                    output: () => JSON.stringify(result),
                  },
                },
              }),
            );
          } catch (ignored) {
            // JSON stringify might fail if the result is not serializable,
            // in which case we just ignore it. In the future we might want to
            // add an optional serialize method to the tool interface and warn
            // if the result is not serializable.
          }

          return result;
        },
      });

      return {
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        args: toolCall.args,
        result,
      } as ToolResultArray<TOOLS>[number];
    }),
  );

  return toolResults.filter(
    (result): result is NonNullable<typeof result> => result != null,
  );
}

class DefaultGenerateTextResult<TOOLS extends Record<string, CoreTool>>
  implements GenerateTextResult<TOOLS>
{
  readonly text: GenerateTextResult<TOOLS>['text'];
  readonly toolCalls: GenerateTextResult<TOOLS>['toolCalls'];
  readonly toolResults: GenerateTextResult<TOOLS>['toolResults'];
  readonly finishReason: GenerateTextResult<TOOLS>['finishReason'];
  readonly usage: GenerateTextResult<TOOLS>['usage'];
  readonly warnings: GenerateTextResult<TOOLS>['warnings'];
  readonly responseMessages: GenerateTextResult<TOOLS>['responseMessages'];
  readonly roundtrips: GenerateTextResult<TOOLS>['roundtrips'];
  readonly steps: GenerateTextResult<TOOLS>['steps'];
  readonly rawResponse: GenerateTextResult<TOOLS>['rawResponse'];
  readonly logprobs: GenerateTextResult<TOOLS>['logprobs'];
  readonly experimental_providerMetadata: GenerateTextResult<TOOLS>['experimental_providerMetadata'];
  readonly response: GenerateTextResult<TOOLS>['response'];

  constructor(options: {
    text: GenerateTextResult<TOOLS>['text'];
    toolCalls: GenerateTextResult<TOOLS>['toolCalls'];
    toolResults: GenerateTextResult<TOOLS>['toolResults'];
    finishReason: GenerateTextResult<TOOLS>['finishReason'];
    usage: GenerateTextResult<TOOLS>['usage'];
    warnings: GenerateTextResult<TOOLS>['warnings'];
    logprobs: GenerateTextResult<TOOLS>['logprobs'];
    responseMessages: GenerateTextResult<TOOLS>['responseMessages'];
    steps: GenerateTextResult<TOOLS>['steps'];
    providerMetadata: GenerateTextResult<TOOLS>['experimental_providerMetadata'];
    response: GenerateTextResult<TOOLS>['response'];
  }) {
    this.text = options.text;
    this.toolCalls = options.toolCalls;
    this.toolResults = options.toolResults;
    this.finishReason = options.finishReason;
    this.usage = options.usage;
    this.warnings = options.warnings;
    this.response = options.response;
    this.responseMessages = options.responseMessages;
    this.roundtrips = options.steps;
    this.steps = options.steps;
    this.experimental_providerMetadata = options.providerMetadata;

    // deprecated:
    this.rawResponse = {
      headers: options.response.headers,
    };
    this.logprobs = options.logprobs;
  }
}

/**
 * @deprecated Use `generateText` instead.
 */
export const experimental_generateText = generateText;
