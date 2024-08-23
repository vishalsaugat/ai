import { jsonSchema } from '@ai-sdk/ui-utils';
import assert from 'node:assert';
import { z } from 'zod';
import { setTestTracer } from '../telemetry/get-tracer';
import { MockLanguageModelV1 } from '../test/mock-language-model-v1';
import { MockTracer } from '../test/mock-tracer';
import { generateText } from './generate-text';
import { GenerateTextResult } from './generate-text-result';

const dummyResponseValues = {
  rawCall: { rawPrompt: 'prompt', rawSettings: {} },
  finishReason: 'stop' as const,
  usage: { promptTokens: 10, completionTokens: 20 },
};

describe('result.text', () => {
  it('should generate text', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({ prompt, mode }) => {
          assert.deepStrictEqual(mode, {
            type: 'regular',
            tools: undefined,
            toolChoice: undefined,
          });
          assert.deepStrictEqual(prompt, [
            { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
          ]);

          return {
            ...dummyResponseValues,
            text: `Hello, world!`,
          };
        },
      }),
      prompt: 'prompt',
    });

    assert.deepStrictEqual(result.text, 'Hello, world!');
  });
});

describe('result.toolCalls', () => {
  it('should contain tool calls', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({ prompt, mode }) => {
          assert.deepStrictEqual(mode, {
            type: 'regular',
            toolChoice: { type: 'required' },
            tools: [
              {
                type: 'function',
                name: 'tool1',
                description: undefined,
                parameters: {
                  $schema: 'http://json-schema.org/draft-07/schema#',
                  additionalProperties: false,
                  properties: { value: { type: 'string' } },
                  required: ['value'],
                  type: 'object',
                },
              },
              {
                type: 'function',
                name: 'tool2',
                description: undefined,
                parameters: {
                  $schema: 'http://json-schema.org/draft-07/schema#',
                  additionalProperties: false,
                  properties: { somethingElse: { type: 'string' } },
                  required: ['somethingElse'],
                  type: 'object',
                },
              },
            ],
          });
          assert.deepStrictEqual(prompt, [
            { role: 'user', content: [{ type: 'text', text: 'test-input' }] },
          ]);

          return {
            ...dummyResponseValues,
            toolCalls: [
              {
                toolCallType: 'function',
                toolCallId: 'call-1',
                toolName: 'tool1',
                args: `{ "value": "value" }`,
              },
            ],
          };
        },
      }),
      tools: {
        tool1: {
          parameters: z.object({ value: z.string() }),
        },
        // 2nd tool to show typing:
        tool2: {
          parameters: z.object({ somethingElse: z.string() }),
        },
      },
      toolChoice: 'required',
      prompt: 'test-input',
    });

    // test type inference
    if (result.toolCalls[0].toolName === 'tool1') {
      assertType<string>(result.toolCalls[0].args.value);
    }

    assert.deepStrictEqual(result.toolCalls, [
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'tool1',
        args: { value: 'value' },
      },
    ]);
  });
});

describe('result.toolResults', () => {
  it('should contain tool results', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({ prompt, mode }) => {
          assert.deepStrictEqual(mode, {
            type: 'regular',
            toolChoice: { type: 'auto' },
            tools: [
              {
                type: 'function',
                name: 'tool1',
                description: undefined,
                parameters: {
                  $schema: 'http://json-schema.org/draft-07/schema#',
                  additionalProperties: false,
                  properties: { value: { type: 'string' } },
                  required: ['value'],
                  type: 'object',
                },
              },
            ],
          });
          assert.deepStrictEqual(prompt, [
            { role: 'user', content: [{ type: 'text', text: 'test-input' }] },
          ]);

          return {
            ...dummyResponseValues,
            toolCalls: [
              {
                toolCallType: 'function',
                toolCallId: 'call-1',
                toolName: 'tool1',
                args: `{ "value": "value" }`,
              },
            ],
          };
        },
      }),
      tools: {
        tool1: {
          parameters: z.object({ value: z.string() }),
          execute: async args => {
            assert.deepStrictEqual(args, { value: 'value' });
            return 'result1';
          },
        },
      },
      prompt: 'test-input',
    });

    // test type inference
    if (result.toolResults[0].toolName === 'tool1') {
      assertType<string>(result.toolResults[0].result);
    }

    assert.deepStrictEqual(result.toolResults, [
      {
        toolCallId: 'call-1',
        toolName: 'tool1',
        args: { value: 'value' },
        result: 'result1',
      },
    ]);
  });
});

describe('result.providerMetadata', () => {
  it('should contain provider metadata', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async () => ({
          ...dummyResponseValues,
          providerMetadata: {
            anthropic: {
              cacheCreationInputTokens: 10,
              cacheReadInputTokens: 20,
            },
          },
        }),
      }),
      prompt: 'test-input',
    });

    assert.deepStrictEqual(result.experimental_providerMetadata, {
      anthropic: {
        cacheCreationInputTokens: 10,
        cacheReadInputTokens: 20,
      },
    });
  });
});

describe('result.responseMessages', () => {
  it('should contain assistant response message when there are no tool calls', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({}) => ({
          ...dummyResponseValues,
          text: 'Hello, world!',
        }),
      }),
      prompt: 'test-input',
    });

    assert.deepStrictEqual(result.responseMessages, [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello, world!' }],
      },
    ]);
  });

  it('should contain assistant response message and tool message when there are tool calls with results', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({}) => ({
          ...dummyResponseValues,
          text: 'Hello, world!',
          toolCalls: [
            {
              toolCallType: 'function',
              toolCallId: 'call-1',
              toolName: 'tool1',
              args: `{ "value": "value" }`,
            },
          ],
          toolResults: [
            {
              toolCallId: 'call-1',
              toolName: 'tool1',
              args: { value: 'value' },
              result: 'result1',
            },
          ],
        }),
      }),
      tools: {
        tool1: {
          parameters: z.object({ value: z.string() }),
          execute: async args => {
            assert.deepStrictEqual(args, { value: 'value' });
            return 'result1';
          },
        },
      },
      prompt: 'test-input',
    });

    assert.deepStrictEqual(result.responseMessages, [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hello, world!' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'tool1',
            args: { value: 'value' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'tool1',
            result: 'result1',
          },
        ],
      },
    ]);
  });

  describe('options.maxToolRoundtrips', () => {
    it('should contain assistant response message and tool message from all roundtrips', async () => {
      let responseCount = 0;
      const result = await generateText({
        model: new MockLanguageModelV1({
          doGenerate: async ({}) => {
            switch (responseCount++) {
              case 0:
                return {
                  ...dummyResponseValues,
                  toolCalls: [
                    {
                      toolCallType: 'function',
                      toolCallId: 'call-1',
                      toolName: 'tool1',
                      args: `{ "value": "value" }`,
                    },
                  ],
                  toolResults: [
                    {
                      toolCallId: 'call-1',
                      toolName: 'tool1',
                      args: { value: 'value' },
                      result: 'result1',
                    },
                  ],
                };
              case 1:
                return {
                  ...dummyResponseValues,
                  text: 'Hello, world!',
                };
              default:
                throw new Error(`Unexpected response count: ${responseCount}`);
            }
          },
        }),
        tools: {
          tool1: {
            parameters: z.object({ value: z.string() }),
            execute: async args => {
              assert.deepStrictEqual(args, { value: 'value' });
              return 'result1';
            },
          },
        },
        prompt: 'test-input',
        maxToolRoundtrips: 2,
      });

      assert.deepStrictEqual(result.responseMessages, [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '' },
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'tool1',
              args: { value: 'value' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'tool1',
              result: 'result1',
            },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello, world!' }],
        },
      ]);
    });
  });

  describe('single roundtrip', () => {
    let result: GenerateTextResult<any>;

    beforeEach(async () => {
      let responseCount = 0;
      result = await generateText({
        model: new MockLanguageModelV1({
          doGenerate: async ({ prompt, mode }) => {
            switch (responseCount++) {
              case 0:
                assert.deepStrictEqual(mode, {
                  type: 'regular',
                  toolChoice: { type: 'auto' },
                  tools: [
                    {
                      type: 'function',
                      name: 'tool1',
                      description: undefined,
                      parameters: {
                        $schema: 'http://json-schema.org/draft-07/schema#',
                        additionalProperties: false,
                        properties: { value: { type: 'string' } },
                        required: ['value'],
                        type: 'object',
                      },
                    },
                  ],
                });
                assert.deepStrictEqual(prompt, [
                  {
                    role: 'user',
                    content: [{ type: 'text', text: 'test-input' }],
                  },
                ]);

                return {
                  ...dummyResponseValues,
                  toolCalls: [
                    {
                      toolCallType: 'function',
                      toolCallId: 'call-1',
                      toolName: 'tool1',
                      args: `{ "value": "value" }`,
                    },
                  ],
                  toolResults: [
                    {
                      toolCallId: 'call-1',
                      toolName: 'tool1',
                      args: { value: 'value' },
                      result: 'result1',
                    },
                  ],
                  finishReason: 'tool-calls',
                  usage: {
                    completionTokens: 5,
                    promptTokens: 10,
                    totalTokens: 15,
                  },
                };
              case 1:
                assert.deepStrictEqual(mode, {
                  type: 'regular',
                  toolChoice: { type: 'auto' },
                  tools: [
                    {
                      type: 'function',
                      name: 'tool1',
                      description: undefined,
                      parameters: {
                        $schema: 'http://json-schema.org/draft-07/schema#',
                        additionalProperties: false,
                        properties: { value: { type: 'string' } },
                        required: ['value'],
                        type: 'object',
                      },
                    },
                  ],
                });
                assert.deepStrictEqual(prompt, [
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text: 'test-input',
                      },
                    ],
                  },
                  {
                    role: 'assistant',
                    content: [
                      {
                        type: 'tool-call',
                        toolCallId: 'call-1',
                        toolName: 'tool1',
                        args: { value: 'value' },
                      },
                    ],
                    providerMetadata: undefined,
                  },
                  {
                    role: 'tool',
                    content: [
                      {
                        type: 'tool-result',
                        toolCallId: 'call-1',
                        toolName: 'tool1',
                        result: 'result1',
                        providerMetadata: undefined,
                      },
                    ],
                    providerMetadata: undefined,
                  },
                ]);
                return {
                  ...dummyResponseValues,
                  text: 'Hello, world!',
                };
              default:
                throw new Error(`Unexpected response count: ${responseCount}`);
            }
          },
        }),
        tools: {
          tool1: {
            parameters: z.object({ value: z.string() }),
            execute: async (args: any) => {
              assert.deepStrictEqual(args, { value: 'value' });
              return 'result1';
            },
          },
        },
        prompt: 'test-input',
        maxToolRoundtrips: 2,
      });
    });

    it('should return text from last roundtrip', async () => {
      assert.deepStrictEqual(result.text, 'Hello, world!');
    });

    it('should return empty tool calls from last roundtrip', async () => {
      assert.deepStrictEqual(result.toolCalls, []);
    });

    it('should return empty tool results from last roundtrip', async () => {
      assert.deepStrictEqual(result.toolResults, []);
    });

    it('should sum token usage', () => {
      assert.deepStrictEqual(result.usage, {
        completionTokens: 25,
        promptTokens: 20,
        totalTokens: 45,
      });
    });

    it('should return information about all roundtrips', () => {
      assert.deepStrictEqual(result.roundtrips, [
        {
          finishReason: 'tool-calls',
          logprobs: undefined,
          text: '',
          toolCalls: [
            {
              args: {
                value: 'value',
              },
              toolCallId: 'call-1',
              toolName: 'tool1',
              type: 'tool-call',
            },
          ],
          toolResults: [
            {
              args: {
                value: 'value',
              },
              result: 'result1',
              toolCallId: 'call-1',
              toolName: 'tool1',
            },
          ],
          usage: {
            completionTokens: 5,
            promptTokens: 10,
            totalTokens: 15,
          },
          warnings: undefined,
        },
        {
          finishReason: 'stop',
          logprobs: undefined,
          text: 'Hello, world!',
          toolCalls: [],
          toolResults: [],
          usage: {
            completionTokens: 20,
            promptTokens: 10,
            totalTokens: 30,
          },
          warnings: undefined,
        },
      ]);
    });
  });
});

describe('options.headers', () => {
  it('should pass headers to model', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({ headers }) => {
          assert.deepStrictEqual(headers, {
            'custom-request-header': 'request-header-value',
          });

          return {
            ...dummyResponseValues,
            text: 'Hello, world!',
          };
        },
      }),
      prompt: 'test-input',
      headers: { 'custom-request-header': 'request-header-value' },
    });

    assert.deepStrictEqual(result.text, 'Hello, world!');
  });
});

describe('telemetry', () => {
  let tracer: MockTracer;

  beforeEach(() => {
    tracer = new MockTracer();
    setTestTracer(tracer);
  });

  afterEach(() => {
    setTestTracer(undefined);
  });

  it('should not record any telemetry data when not explicitly enabled', async () => {
    await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({}) => ({
          ...dummyResponseValues,
          text: `Hello, world!`,
        }),
      }),
      prompt: 'prompt',
    });

    assert.deepStrictEqual(tracer.jsonSpans, []);
  });

  it('should record telemetry data when enabled', async () => {
    await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({}) => ({
          ...dummyResponseValues,
          text: `Hello, world!`,
        }),
      }),
      prompt: 'prompt',
      headers: {
        header1: 'value1',
        header2: 'value2',
      },
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'test-function-id',
        metadata: {
          test1: 'value1',
          test2: false,
        },
      },
    });

    expect(tracer.jsonSpans).toStrictEqual([
      {
        name: 'ai.generateText',
        attributes: {
          'operation.name': 'ai.generateText test-function-id',
          'resource.name': 'test-function-id',
          'ai.operationId': 'ai.generateText',
          'ai.model.id': 'mock-model-id',
          'ai.model.provider': 'mock-provider',
          'ai.prompt': '{"prompt":"prompt"}',
          'ai.settings.maxToolRoundtrips': 0,
          'ai.telemetry.functionId': 'test-function-id',
          'ai.telemetry.metadata.test1': 'value1',
          'ai.telemetry.metadata.test2': false,
          'ai.finishReason': 'stop',
          'ai.result.text': 'Hello, world!',
          'ai.usage.completionTokens': 20,
          'ai.usage.promptTokens': 10,
          'ai.request.headers.header1': 'value1',
          'ai.request.headers.header2': 'value2',
        },
        events: [],
      },
      {
        name: 'ai.generateText.doGenerate',
        attributes: {
          'operation.name': 'ai.generateText.doGenerate test-function-id',
          'resource.name': 'test-function-id',
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'mock-model-id',
          'ai.model.provider': 'mock-provider',
          'ai.prompt.format': 'prompt',
          'ai.prompt.messages':
            '[{"role":"user","content":[{"type":"text","text":"prompt"}]}]',
          'ai.telemetry.functionId': 'test-function-id',
          'ai.telemetry.metadata.test1': 'value1',
          'ai.telemetry.metadata.test2': false,
          'ai.finishReason': 'stop',
          'ai.result.text': 'Hello, world!',
          'ai.usage.completionTokens': 20,
          'ai.usage.promptTokens': 10,
          'ai.request.headers.header1': 'value1',
          'ai.request.headers.header2': 'value2',
          'gen_ai.request.model': 'mock-model-id',
          'gen_ai.response.finish_reasons': ['stop'],
          'gen_ai.system': 'mock-provider',
          'gen_ai.usage.completion_tokens': 20,
          'gen_ai.usage.prompt_tokens': 10,
        },
        events: [],
      },
    ]);
  });

  it('should record successful tool call', async () => {
    await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({}) => ({
          ...dummyResponseValues,
          toolCalls: [
            {
              toolCallType: 'function',
              toolCallId: 'call-1',
              toolName: 'tool1',
              args: `{ "value": "value" }`,
            },
          ],
        }),
      }),
      tools: {
        tool1: {
          parameters: z.object({ value: z.string() }),
          execute: async () => 'result1',
        },
      },
      prompt: 'test-input',
      experimental_telemetry: {
        isEnabled: true,
      },
    });

    expect(tracer.jsonSpans).toStrictEqual([
      {
        name: 'ai.generateText',
        attributes: {
          'operation.name': 'ai.generateText',
          'ai.operationId': 'ai.generateText',
          'ai.model.id': 'mock-model-id',
          'ai.model.provider': 'mock-provider',
          'ai.prompt': '{"prompt":"test-input"}',
          'ai.settings.maxToolRoundtrips': 0,
          'ai.finishReason': 'stop',
          'ai.result.toolCalls':
            '[{"toolCallType":"function","toolCallId":"call-1","toolName":"tool1","args":"{ \\"value\\": \\"value\\" }"}]',
          'ai.usage.completionTokens': 20,
          'ai.usage.promptTokens': 10,
        },
        events: [],
      },
      {
        name: 'ai.generateText.doGenerate',
        attributes: {
          'operation.name': 'ai.generateText.doGenerate',
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'mock-model-id',
          'ai.model.provider': 'mock-provider',
          'ai.prompt.format': 'prompt',
          'ai.prompt.messages':
            '[{"role":"user","content":[{"type":"text","text":"test-input"}]}]',
          'ai.finishReason': 'stop',
          'ai.result.toolCalls':
            '[{"toolCallType":"function","toolCallId":"call-1","toolName":"tool1","args":"{ \\"value\\": \\"value\\" }"}]',
          'ai.usage.completionTokens': 20,
          'ai.usage.promptTokens': 10,
          'gen_ai.request.model': 'mock-model-id',
          'gen_ai.response.finish_reasons': ['stop'],
          'gen_ai.system': 'mock-provider',
          'gen_ai.usage.completion_tokens': 20,
          'gen_ai.usage.prompt_tokens': 10,
        },
        events: [],
      },
      {
        name: 'ai.toolCall',
        attributes: {
          'operation.name': 'ai.toolCall',
          'ai.operationId': 'ai.toolCall',
          'ai.toolCall.name': 'tool1',
          'ai.toolCall.id': 'call-1',
          'ai.toolCall.args': '{"value":"value"}',
          'ai.toolCall.result': '"result1"',
        },
        events: [],
      },
    ]);
  });

  it('should not record telemetry inputs / outputs when disabled', async () => {
    await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({}) => ({
          ...dummyResponseValues,
          toolCalls: [
            {
              toolCallType: 'function',
              toolCallId: 'call-1',
              toolName: 'tool1',
              args: `{ "value": "value" }`,
            },
          ],
        }),
      }),
      tools: {
        tool1: {
          parameters: z.object({ value: z.string() }),
          execute: async () => 'result1',
        },
      },
      prompt: 'test-input',
      experimental_telemetry: {
        isEnabled: true,
        recordInputs: false,
        recordOutputs: false,
      },
    });

    expect(tracer.jsonSpans).toStrictEqual([
      {
        name: 'ai.generateText',
        attributes: {
          'operation.name': 'ai.generateText',
          'ai.operationId': 'ai.generateText',
          'ai.model.id': 'mock-model-id',
          'ai.model.provider': 'mock-provider',
          'ai.settings.maxToolRoundtrips': 0,
          'ai.finishReason': 'stop',
          'ai.usage.completionTokens': 20,
          'ai.usage.promptTokens': 10,
        },
        events: [],
      },
      {
        name: 'ai.generateText.doGenerate',
        attributes: {
          'operation.name': 'ai.generateText.doGenerate',
          'ai.operationId': 'ai.generateText.doGenerate',
          'ai.model.id': 'mock-model-id',
          'ai.model.provider': 'mock-provider',
          'ai.finishReason': 'stop',
          'ai.usage.completionTokens': 20,
          'ai.usage.promptTokens': 10,
          'gen_ai.request.model': 'mock-model-id',
          'gen_ai.response.finish_reasons': ['stop'],
          'gen_ai.system': 'mock-provider',
          'gen_ai.usage.completion_tokens': 20,
          'gen_ai.usage.prompt_tokens': 10,
        },
        events: [],
      },
      {
        name: 'ai.toolCall',
        attributes: {
          'operation.name': 'ai.toolCall',
          'ai.operationId': 'ai.toolCall',
          'ai.toolCall.name': 'tool1',
          'ai.toolCall.id': 'call-1',
        },
        events: [],
      },
    ]);
  });
});

describe('tools with custom schema', () => {
  it('should contain tool calls', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({ prompt, mode }) => {
          assert.deepStrictEqual(mode, {
            type: 'regular',
            toolChoice: { type: 'required' },
            tools: [
              {
                type: 'function',
                name: 'tool1',
                description: undefined,
                parameters: {
                  additionalProperties: false,
                  properties: { value: { type: 'string' } },
                  required: ['value'],
                  type: 'object',
                },
              },
              {
                type: 'function',
                name: 'tool2',
                description: undefined,
                parameters: {
                  additionalProperties: false,
                  properties: { somethingElse: { type: 'string' } },
                  required: ['somethingElse'],
                  type: 'object',
                },
              },
            ],
          });
          assert.deepStrictEqual(prompt, [
            { role: 'user', content: [{ type: 'text', text: 'test-input' }] },
          ]);

          return {
            ...dummyResponseValues,
            toolCalls: [
              {
                toolCallType: 'function',
                toolCallId: 'call-1',
                toolName: 'tool1',
                args: `{ "value": "value" }`,
              },
            ],
          };
        },
      }),
      tools: {
        tool1: {
          parameters: jsonSchema<{ value: string }>({
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          }),
        },
        // 2nd tool to show typing:
        tool2: {
          parameters: jsonSchema<{ somethingElse: string }>({
            type: 'object',
            properties: { somethingElse: { type: 'string' } },
            required: ['somethingElse'],
            additionalProperties: false,
          }),
        },
      },
      toolChoice: 'required',
      prompt: 'test-input',
    });

    // test type inference
    if (result.toolCalls[0].toolName === 'tool1') {
      assertType<string>(result.toolCalls[0].args.value);
    }

    assert.deepStrictEqual(result.toolCalls, [
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'tool1',
        args: { value: 'value' },
      },
    ]);
  });
});
