import {
  JSONValue,
  LanguageModelV1CallOptions,
  LanguageModelV1FinishReason,
  LanguageModelV1StreamPart,
} from '@ai-sdk/provider';
import { createIdGenerator } from '@ai-sdk/provider-utils';
import {
  DeepPartial,
  Schema,
  isDeepEqualData,
  parsePartialJson,
} from '@ai-sdk/ui-utils';
import { Span } from '@opentelemetry/api';
import { ServerResponse } from 'http';
import { z } from 'zod';
import { createResolvablePromise } from '../../util/create-resolvable-promise';
import { DelayedPromise } from '../../util/delayed-promise';
import { retryWithExponentialBackoff } from '../../util/retry-with-exponential-backoff';
import { CallSettings } from '../prompt/call-settings';
import { convertToLanguageModelPrompt } from '../prompt/convert-to-language-model-prompt';
import { prepareCallSettings } from '../prompt/prepare-call-settings';
import { Prompt } from '../prompt/prompt';
import { standardizePrompt } from '../prompt/standardize-prompt';
import { assembleOperationName } from '../telemetry/assemble-operation-name';
import { getBaseTelemetryAttributes } from '../telemetry/get-base-telemetry-attributes';
import { getTracer } from '../telemetry/get-tracer';
import { recordSpan } from '../telemetry/record-span';
import { selectTelemetryAttributes } from '../telemetry/select-telemetry-attributes';
import { TelemetrySettings } from '../telemetry/telemetry-settings';
import {
  CallWarning,
  FinishReason,
  LanguageModel,
  LanguageModelResponseMetadata,
  LogProbs,
  ProviderMetadata,
} from '../types';
import {
  LanguageModelUsage,
  calculateLanguageModelUsage,
} from '../types/usage';
import {
  AsyncIterableStream,
  createAsyncIterableStream,
} from '../util/async-iterable-stream';
import { now as originalNow } from '../util/now';
import { prepareOutgoingHttpHeaders } from '../util/prepare-outgoing-http-headers';
import { prepareResponseHeaders } from '../util/prepare-response-headers';
import { writeToServerResponse } from '../util/write-to-server-response';
import { injectJsonInstruction } from './inject-json-instruction';
import { OutputStrategy, getOutputStrategy } from './output-strategy';
import { ObjectStreamPart, StreamObjectResult } from './stream-object-result';
import { validateObjectGenerationInput } from './validate-object-generation-input';

const originalGenerateId = createIdGenerator({ prefix: 'aiobj', size: 24 });

type OnFinishCallback<RESULT> = (event: {
  /**
The token usage of the generated response.
*/
  usage: LanguageModelUsage;

  /**
The generated object. Can be undefined if the final object does not match the schema.
*/
  object: RESULT | undefined;

  /**
Optional error object. This is e.g. a TypeValidationError when the final object does not match the schema.
*/
  error: unknown | undefined;

  /**
Optional raw response data.

@deprecated Use `response` instead.
       */
  rawResponse?: {
    /**
Response headers.
   */
    headers?: Record<string, string>;
  };

  /**
Response metadata.
 */
  response: LanguageModelResponseMetadata;

  /**
Warnings from the model provider (e.g. unsupported settings).
*/
  warnings?: CallWarning[];

  /**
Additional provider-specific metadata. They are passed through
from the provider to the AI SDK and enable provider-specific
results that can be fully encapsulated in the provider.
*/
  experimental_providerMetadata: ProviderMetadata | undefined;
}) => Promise<void> | void;

/**
Generate a structured, typed object for a given prompt and schema using a language model.

This function streams the output. If you do not want to stream the output, use `generateObject` instead.

@return
A result object for accessing the partial object stream and additional information.
 */
export async function streamObject<OBJECT>(
  options: Omit<CallSettings, 'stopSequences'> &
    Prompt & {
      output?: 'object' | undefined;

      /**
The language model to use.
     */
      model: LanguageModel;

      /**
The schema of the object that the model should generate.
 */
      schema: z.Schema<OBJECT, z.ZodTypeDef, any> | Schema<OBJECT>;

      /**
Optional name of the output that should be generated.
Used by some providers for additional LLM guidance, e.g.
via tool or schema name.
     */
      schemaName?: string;

      /**
Optional description of the output that should be generated.
Used by some providers for additional LLM guidance, e.g.
via tool or schema description.
 */
      schemaDescription?: string;

      /**
The mode to use for object generation.

The schema is converted into a JSON schema and used in one of the following ways

- 'auto': The provider will choose the best mode for the model.
- 'tool': A tool with the JSON schema as parameters is provided and the provider is instructed to use it.
- 'json': The JSON schema and an instruction are injected into the prompt. If the provider supports JSON mode, it is enabled. If the provider supports JSON grammars, the grammar is used.

Please note that most providers do not support all modes.

Default and recommended: 'auto' (best mode for the model).
     */
      mode?: 'auto' | 'json' | 'tool';

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
Callback that is called when the LLM response and the final object validation are finished.
     */
      onFinish?: OnFinishCallback<OBJECT>;

      /**
       * Internal. For test use only. May change without notice.
       */
      _internal?: {
        generateId?: () => string;
        currentDate?: () => Date;
        now?: () => number;
      };
    },
): Promise<StreamObjectResult<DeepPartial<OBJECT>, OBJECT, never>>;
/**
Generate an array with structured, typed elements for a given prompt and element schema using a language model.

This function streams the output. If you do not want to stream the output, use `generateObject` instead.

@return
A result object for accessing the partial object stream and additional information.
 */
export async function streamObject<ELEMENT>(
  options: Omit<CallSettings, 'stopSequences'> &
    Prompt & {
      output: 'array';

      /**
The language model to use.
     */
      model: LanguageModel;

      /**
The element schema of the array that the model should generate.
 */
      schema: z.Schema<ELEMENT, z.ZodTypeDef, any> | Schema<ELEMENT>;

      /**
Optional name of the array that should be generated.
Used by some providers for additional LLM guidance, e.g.
via tool or schema name.
     */
      schemaName?: string;

      /**
Optional description of the array that should be generated.
Used by some providers for additional LLM guidance, e.g.
via tool or schema description.
 */
      schemaDescription?: string;

      /**
The mode to use for object generation.

The schema is converted into a JSON schema and used in one of the following ways

- 'auto': The provider will choose the best mode for the model.
- 'tool': A tool with the JSON schema as parameters is provided and the provider is instructed to use it.
- 'json': The JSON schema and an instruction are injected into the prompt. If the provider supports JSON mode, it is enabled. If the provider supports JSON grammars, the grammar is used.

Please note that most providers do not support all modes.

Default and recommended: 'auto' (best mode for the model).
     */
      mode?: 'auto' | 'json' | 'tool';

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
Callback that is called when the LLM response and the final object validation are finished.
     */
      onFinish?: OnFinishCallback<Array<ELEMENT>>;

      /**
       * Internal. For test use only. May change without notice.
       */
      _internal?: {
        generateId?: () => string;
        currentDate?: () => Date;
        now?: () => number;
      };
    },
): Promise<
  StreamObjectResult<
    Array<ELEMENT>,
    Array<ELEMENT>,
    AsyncIterableStream<ELEMENT>
  >
>;
/**
Generate JSON with any schema for a given prompt using a language model.

This function streams the output. If you do not want to stream the output, use `generateObject` instead.

@return
A result object for accessing the partial object stream and additional information.
 */
export async function streamObject(
  options: Omit<CallSettings, 'stopSequences'> &
    Prompt & {
      output: 'no-schema';

      /**
The language model to use.
     */
      model: LanguageModel;

      /**
The mode to use for object generation. Must be "json" for no-schema output.
     */
      mode?: 'json';

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
Callback that is called when the LLM response and the final object validation are finished.
     */
      onFinish?: OnFinishCallback<JSONValue>;

      /**
       * Internal. For test use only. May change without notice.
       */
      _internal?: {
        generateId?: () => string;
        currentDate?: () => Date;
        now?: () => number;
      };
    },
): Promise<StreamObjectResult<JSONValue, JSONValue, never>>;
export async function streamObject<SCHEMA, PARTIAL, RESULT, ELEMENT_STREAM>({
  model,
  schema: inputSchema,
  schemaName,
  schemaDescription,
  mode,
  output = 'object',
  system,
  prompt,
  messages,
  maxRetries,
  abortSignal,
  headers,
  experimental_telemetry: telemetry,
  experimental_providerMetadata: providerMetadata,
  onFinish,
  _internal: {
    generateId = originalGenerateId,
    currentDate = () => new Date(),
    now = originalNow,
  } = {},
  ...settings
}: Omit<CallSettings, 'stopSequences'> &
  Prompt & {
    /**
     * The expected structure of the output.
     *
     * - 'object': Generate a single object that conforms to the schema.
     * - 'array': Generate an array of objects that conform to the schema.
     * - 'no-schema': Generate any JSON object. No schema is specified.
     *
     * Default is 'object' if not specified.
     */
    output?: 'object' | 'array' | 'no-schema';

    model: LanguageModel;
    schema?: z.Schema<SCHEMA, z.ZodTypeDef, any> | Schema<SCHEMA>;
    schemaName?: string;
    schemaDescription?: string;
    mode?: 'auto' | 'json' | 'tool';
    experimental_telemetry?: TelemetrySettings;
    experimental_providerMetadata?: ProviderMetadata;
    onFinish?: OnFinishCallback<RESULT>;
    _internal?: {
      generateId?: () => string;
      currentDate?: () => Date;
      now?: () => number;
    };
  }): Promise<StreamObjectResult<PARTIAL, RESULT, ELEMENT_STREAM>> {
  validateObjectGenerationInput({
    output,
    mode,
    schema: inputSchema,
    schemaName,
    schemaDescription,
  });

  const outputStrategy = getOutputStrategy({ output, schema: inputSchema });

  // automatically set mode to 'json' for no-schema output
  if (outputStrategy.type === 'no-schema' && mode === undefined) {
    mode = 'json';
  }

  const baseTelemetryAttributes = getBaseTelemetryAttributes({
    model,
    telemetry,
    headers,
    settings: { ...settings, maxRetries },
  });

  const tracer = getTracer(telemetry);

  const retry = retryWithExponentialBackoff({ maxRetries });

  return recordSpan({
    name: 'ai.streamObject',
    attributes: selectTelemetryAttributes({
      telemetry,
      attributes: {
        ...assembleOperationName({
          operationId: 'ai.streamObject',
          telemetry,
        }),
        ...baseTelemetryAttributes,
        // specific settings that only make sense on the outer level:
        'ai.prompt': {
          input: () => JSON.stringify({ system, prompt, messages }),
        },
        'ai.schema':
          outputStrategy.jsonSchema != null
            ? { input: () => JSON.stringify(outputStrategy.jsonSchema) }
            : undefined,
        'ai.schema.name': schemaName,
        'ai.schema.description': schemaDescription,
        'ai.settings.output': outputStrategy.type,
        'ai.settings.mode': mode,
      },
    }),
    tracer,
    endWhenDone: false,
    fn: async rootSpan => {
      // use the default provider mode when the mode is set to 'auto' or unspecified
      if (mode === 'auto' || mode == null) {
        mode = model.defaultObjectGenerationMode;
      }

      let callOptions: LanguageModelV1CallOptions;
      let transformer: Transformer<
        LanguageModelV1StreamPart,
        string | Omit<LanguageModelV1StreamPart, 'text-delta'>
      >;

      switch (mode) {
        case 'json': {
          const standardPrompt = standardizePrompt({
            system:
              outputStrategy.jsonSchema == null
                ? injectJsonInstruction({ prompt: system })
                : model.supportsStructuredOutputs
                ? system
                : injectJsonInstruction({
                    prompt: system,
                    schema: outputStrategy.jsonSchema,
                  }),
            prompt,
            messages,
          });

          callOptions = {
            mode: {
              type: 'object-json',
              schema: outputStrategy.jsonSchema,
              name: schemaName,
              description: schemaDescription,
            },
            ...prepareCallSettings(settings),
            inputFormat: standardPrompt.type,
            prompt: await convertToLanguageModelPrompt({
              prompt: standardPrompt,
              modelSupportsImageUrls: model.supportsImageUrls,
              modelSupportsUrl: model.supportsUrl,
            }),
            providerMetadata,
            abortSignal,
            headers,
          };

          transformer = {
            transform: (chunk, controller) => {
              switch (chunk.type) {
                case 'text-delta':
                  controller.enqueue(chunk.textDelta);
                  break;
                case 'response-metadata':
                case 'finish':
                case 'error':
                  controller.enqueue(chunk);
                  break;
              }
            },
          };

          break;
        }

        case 'tool': {
          const validatedPrompt = standardizePrompt({
            system,
            prompt,
            messages,
          });

          callOptions = {
            mode: {
              type: 'object-tool',
              tool: {
                type: 'function',
                name: schemaName ?? 'json',
                description: schemaDescription ?? 'Respond with a JSON object.',
                parameters: outputStrategy.jsonSchema!,
              },
            },
            ...prepareCallSettings(settings),
            inputFormat: validatedPrompt.type,
            prompt: await convertToLanguageModelPrompt({
              prompt: validatedPrompt,
              modelSupportsImageUrls: model.supportsImageUrls,
              modelSupportsUrl: model.supportsUrl,
            }),
            providerMetadata,
            abortSignal,
            headers,
          };

          transformer = {
            transform(chunk, controller) {
              switch (chunk.type) {
                case 'tool-call-delta':
                  controller.enqueue(chunk.argsTextDelta);
                  break;
                case 'response-metadata':
                case 'finish':
                case 'error':
                  controller.enqueue(chunk);
                  break;
              }
            },
          };

          break;
        }

        case undefined: {
          throw new Error(
            'Model does not have a default object generation mode.',
          );
        }

        default: {
          const _exhaustiveCheck: never = mode;
          throw new Error(`Unsupported mode: ${_exhaustiveCheck}`);
        }
      }

      const {
        result: { stream, warnings, rawResponse, request },
        doStreamSpan,
        startTimestampMs,
      } = await retry(() =>
        recordSpan({
          name: 'ai.streamObject.doStream',
          attributes: selectTelemetryAttributes({
            telemetry,
            attributes: {
              ...assembleOperationName({
                operationId: 'ai.streamObject.doStream',
                telemetry,
              }),
              ...baseTelemetryAttributes,
              'ai.prompt.format': {
                input: () => callOptions.inputFormat,
              },
              'ai.prompt.messages': {
                input: () => JSON.stringify(callOptions.prompt),
              },
              'ai.settings.mode': mode,

              // standardized gen-ai llm span attributes:
              'gen_ai.system': model.provider,
              'gen_ai.request.model': model.modelId,
              'gen_ai.request.frequency_penalty': settings.frequencyPenalty,
              'gen_ai.request.max_tokens': settings.maxTokens,
              'gen_ai.request.presence_penalty': settings.presencePenalty,
              'gen_ai.request.temperature': settings.temperature,
              'gen_ai.request.top_k': settings.topK,
              'gen_ai.request.top_p': settings.topP,
            },
          }),
          tracer,
          endWhenDone: false,
          fn: async doStreamSpan => ({
            startTimestampMs: now(),
            doStreamSpan,
            result: await model.doStream(callOptions),
          }),
        }),
      );

      return new DefaultStreamObjectResult<PARTIAL, RESULT, ELEMENT_STREAM>({
        outputStrategy,
        stream: stream.pipeThrough(new TransformStream(transformer)),
        warnings,
        rawResponse,
        request: request ?? {},
        onFinish,
        rootSpan,
        doStreamSpan,
        telemetry,
        startTimestampMs,
        modelId: model.modelId,
        now,
        currentDate,
        generateId,
      });
    },
  });
}

class DefaultStreamObjectResult<PARTIAL, RESULT, ELEMENT_STREAM>
  implements StreamObjectResult<PARTIAL, RESULT, ELEMENT_STREAM>
{
  private readonly originalStream: ReadableStream<ObjectStreamPart<PARTIAL>>;
  private readonly objectPromise: DelayedPromise<RESULT>;

  readonly request: StreamObjectResult<
    PARTIAL,
    RESULT,
    ELEMENT_STREAM
  >['request'];

  readonly warnings: StreamObjectResult<
    PARTIAL,
    RESULT,
    ELEMENT_STREAM
  >['warnings'];
  readonly usage: StreamObjectResult<PARTIAL, RESULT, ELEMENT_STREAM>['usage'];
  readonly experimental_providerMetadata: StreamObjectResult<
    PARTIAL,
    RESULT,
    ELEMENT_STREAM
  >['experimental_providerMetadata'];
  readonly rawResponse: StreamObjectResult<
    PARTIAL,
    RESULT,
    ELEMENT_STREAM
  >['rawResponse'];
  readonly outputStrategy: OutputStrategy<PARTIAL, RESULT, ELEMENT_STREAM>;
  readonly response: StreamObjectResult<
    PARTIAL,
    RESULT,
    ELEMENT_STREAM
  >['response'];

  constructor({
    stream,
    warnings,
    rawResponse,
    request,
    outputStrategy,
    onFinish,
    rootSpan,
    doStreamSpan,
    telemetry,
    startTimestampMs,
    modelId,
    now,
    currentDate,
    generateId,
  }: {
    stream: ReadableStream<
      string | Omit<LanguageModelV1StreamPart, 'text-delta'>
    >;
    warnings: StreamObjectResult<PARTIAL, RESULT, ELEMENT_STREAM>['warnings'];
    rawResponse: StreamObjectResult<
      PARTIAL,
      RESULT,
      ELEMENT_STREAM
    >['rawResponse'];
    request: Awaited<
      StreamObjectResult<PARTIAL, RESULT, ELEMENT_STREAM>['request']
    >;
    outputStrategy: OutputStrategy<PARTIAL, RESULT, ELEMENT_STREAM>;
    onFinish: OnFinishCallback<RESULT> | undefined;
    rootSpan: Span;
    doStreamSpan: Span;
    telemetry: TelemetrySettings | undefined;
    startTimestampMs: number;
    modelId: string;
    now: () => number;
    currentDate: () => Date;
    generateId: () => string;
  }) {
    this.warnings = warnings;
    this.rawResponse = rawResponse;
    this.outputStrategy = outputStrategy;
    this.request = Promise.resolve(request);

    // initialize object promise
    this.objectPromise = new DelayedPromise<RESULT>();

    // initialize usage promise
    const { resolve: resolveUsage, promise: usagePromise } =
      createResolvablePromise<LanguageModelUsage>();
    this.usage = usagePromise;

    // initialize response promise
    const { resolve: resolveResponse, promise: responsePromise } =
      createResolvablePromise<LanguageModelResponseMetadata>();
    this.response = responsePromise;

    // initialize experimental_providerMetadata promise
    const {
      resolve: resolveProviderMetadata,
      promise: providerMetadataPromise,
    } = createResolvablePromise<ProviderMetadata | undefined>();
    this.experimental_providerMetadata = providerMetadataPromise;

    // store information for onFinish callback:
    let usage: LanguageModelUsage | undefined;
    let finishReason: LanguageModelV1FinishReason | undefined;
    let providerMetadata: ProviderMetadata | undefined;
    let object: RESULT | undefined;
    let error: unknown | undefined;

    // pipe chunks through a transformation stream that extracts metadata:
    let accumulatedText = '';
    let textDelta = '';
    let response: {
      id: string;
      timestamp: Date;
      modelId: string;
    } = {
      id: generateId(),
      timestamp: currentDate(),
      modelId,
    };

    // Keep track of raw parse result before type validation, since e.g. Zod might
    // change the object by mapping properties.
    let latestObjectJson: JSONValue | undefined = undefined;
    let latestObject: PARTIAL | undefined = undefined;
    let isFirstChunk = true;
    let isFirstDelta = true;

    const self = this;
    this.originalStream = stream.pipeThrough(
      new TransformStream<
        string | ObjectStreamInputPart,
        ObjectStreamPart<PARTIAL>
      >({
        async transform(chunk, controller): Promise<void> {
          // Telemetry event for first chunk:
          if (isFirstChunk) {
            const msToFirstChunk = now() - startTimestampMs;

            isFirstChunk = false;

            doStreamSpan.addEvent('ai.stream.firstChunk', {
              'ai.stream.msToFirstChunk': msToFirstChunk,
            });

            doStreamSpan.setAttributes({
              'ai.stream.msToFirstChunk': msToFirstChunk,
            });
          }

          // process partial text chunks
          if (typeof chunk === 'string') {
            accumulatedText += chunk;
            textDelta += chunk;

            const { value: currentObjectJson, state: parseState } =
              parsePartialJson(accumulatedText);

            if (
              currentObjectJson !== undefined &&
              !isDeepEqualData(latestObjectJson, currentObjectJson)
            ) {
              const validationResult = outputStrategy.validatePartialResult({
                value: currentObjectJson,
                textDelta,
                latestObject,
                isFirstDelta,
                isFinalDelta: parseState === 'successful-parse',
              });

              if (
                validationResult.success &&
                !isDeepEqualData(latestObject, validationResult.value.partial)
              ) {
                // inside inner check to correctly parse the final element in array mode:
                latestObjectJson = currentObjectJson;
                latestObject = validationResult.value.partial;

                controller.enqueue({
                  type: 'object',
                  object: latestObject,
                });

                controller.enqueue({
                  type: 'text-delta',
                  textDelta: validationResult.value.textDelta,
                });

                textDelta = '';
                isFirstDelta = false;
              }
            }

            return;
          }

          switch (chunk.type) {
            case 'response-metadata': {
              response = {
                id: chunk.id ?? response.id,
                timestamp: chunk.timestamp ?? response.timestamp,
                modelId: chunk.modelId ?? response.modelId,
              };
              break;
            }

            case 'finish': {
              // send final text delta:
              if (textDelta !== '') {
                controller.enqueue({ type: 'text-delta', textDelta });
              }

              // store finish reason for telemetry:
              finishReason = chunk.finishReason;

              // store usage and metadata for promises and onFinish callback:
              usage = calculateLanguageModelUsage(chunk.usage);
              providerMetadata = chunk.providerMetadata;

              controller.enqueue({ ...chunk, usage, response });

              // resolve promises that can be resolved now:
              resolveUsage(usage);
              resolveProviderMetadata(providerMetadata);
              resolveResponse({
                ...response,
                headers: rawResponse?.headers,
              });

              // resolve the object promise with the latest object:
              const validationResult =
                outputStrategy.validateFinalResult(latestObjectJson);

              if (validationResult.success) {
                object = validationResult.value;
                self.objectPromise.resolve(object);
              } else {
                error = validationResult.error;
                self.objectPromise.reject(error);
              }

              break;
            }

            default: {
              controller.enqueue(chunk);
              break;
            }
          }
        },

        // invoke onFinish callback and resolve toolResults promise when the stream is about to close:
        async flush(controller) {
          try {
            const finalUsage = usage ?? {
              promptTokens: NaN,
              completionTokens: NaN,
              totalTokens: NaN,
            };

            doStreamSpan.setAttributes(
              selectTelemetryAttributes({
                telemetry,
                attributes: {
                  'ai.response.finishReason': finishReason,
                  'ai.response.object': {
                    output: () => JSON.stringify(object),
                  },
                  'ai.response.id': response.id,
                  'ai.response.model': response.modelId,
                  'ai.response.timestamp': response.timestamp.toISOString(),

                  'ai.usage.promptTokens': finalUsage.promptTokens,
                  'ai.usage.completionTokens': finalUsage.completionTokens,

                  // deprecated
                  'ai.finishReason': finishReason,
                  'ai.result.object': { output: () => JSON.stringify(object) },

                  // standardized gen-ai llm span attributes:
                  'gen_ai.response.finish_reasons': [finishReason],
                  'gen_ai.response.id': response.id,
                  'gen_ai.response.model': response.modelId,
                  'gen_ai.usage.input_tokens': finalUsage.promptTokens,
                  'gen_ai.usage.output_tokens': finalUsage.completionTokens,
                },
              }),
            );

            // finish doStreamSpan before other operations for correct timing:
            doStreamSpan.end();

            // Add response information to the root span:
            rootSpan.setAttributes(
              selectTelemetryAttributes({
                telemetry,
                attributes: {
                  'ai.usage.promptTokens': finalUsage.promptTokens,
                  'ai.usage.completionTokens': finalUsage.completionTokens,
                  'ai.response.object': {
                    output: () => JSON.stringify(object),
                  },

                  // deprecated
                  'ai.result.object': { output: () => JSON.stringify(object) },
                },
              }),
            );

            // call onFinish callback:
            await onFinish?.({
              usage: finalUsage,
              object,
              error,
              rawResponse,
              response: {
                ...response,
                headers: rawResponse?.headers,
              },
              warnings,
              experimental_providerMetadata: providerMetadata,
            });
          } catch (error) {
            controller.error(error);
          } finally {
            rootSpan.end();
          }
        },
      }),
    );
  }

  get object(): Promise<RESULT> {
    return this.objectPromise.value;
  }

  get partialObjectStream(): AsyncIterableStream<PARTIAL> {
    return createAsyncIterableStream(this.originalStream, {
      transform(chunk, controller) {
        switch (chunk.type) {
          case 'object':
            controller.enqueue(chunk.object);
            break;

          case 'text-delta':
          case 'finish':
            break;

          case 'error':
            controller.error(chunk.error);
            break;

          default: {
            const _exhaustiveCheck: never = chunk;
            throw new Error(`Unsupported chunk type: ${_exhaustiveCheck}`);
          }
        }
      },
    });
  }

  get elementStream(): ELEMENT_STREAM {
    return this.outputStrategy.createElementStream(this.originalStream);
  }

  get textStream(): AsyncIterableStream<string> {
    return createAsyncIterableStream(this.originalStream, {
      transform(chunk, controller) {
        switch (chunk.type) {
          case 'text-delta':
            controller.enqueue(chunk.textDelta);
            break;

          case 'object':
          case 'finish':
            break;

          case 'error':
            controller.error(chunk.error);
            break;

          default: {
            const _exhaustiveCheck: never = chunk;
            throw new Error(`Unsupported chunk type: ${_exhaustiveCheck}`);
          }
        }
      },
    });
  }

  get fullStream(): AsyncIterableStream<ObjectStreamPart<PARTIAL>> {
    return createAsyncIterableStream(this.originalStream, {
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
    });
  }

  pipeTextStreamToResponse(response: ServerResponse, init?: ResponseInit) {
    writeToServerResponse({
      response,
      status: init?.status,
      statusText: init?.statusText,
      headers: prepareOutgoingHttpHeaders(init, {
        contentType: 'text/plain; charset=utf-8',
      }),
      stream: this.textStream.pipeThrough(new TextEncoderStream()),
    });
  }

  toTextStreamResponse(init?: ResponseInit): Response {
    return new Response(this.textStream.pipeThrough(new TextEncoderStream()), {
      status: init?.status ?? 200,
      headers: prepareResponseHeaders(init, {
        contentType: 'text/plain; charset=utf-8',
      }),
    });
  }
}

/**
 * @deprecated Use `streamObject` instead.
 */
export const experimental_streamObject = streamObject;

export type ObjectStreamInputPart =
  | {
      type: 'error';
      error: unknown;
    }
  | {
      type: 'response-metadata';
      id?: string;
      timestamp?: Date;
      modelId?: string;
    }
  | {
      type: 'finish';
      finishReason: FinishReason;
      logprobs?: LogProbs;
      usage: LanguageModelUsage;
      providerMetadata?: ProviderMetadata;
    };