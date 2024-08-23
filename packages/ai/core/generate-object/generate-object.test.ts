import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import { jsonSchema } from '@ai-sdk/ui-utils';
import assert from 'node:assert';
import { z } from 'zod';
import { setTestTracer } from '../telemetry/get-tracer';
import { MockLanguageModelV1 } from '../test/mock-language-model-v1';
import { MockTracer } from '../test/mock-tracer';
import { generateObject } from './generate-object';

const dummyResponseValues = {
  rawCall: { rawPrompt: 'prompt', rawSettings: {} },
  finishReason: 'stop' as const,
  usage: { promptTokens: 10, completionTokens: 20 },
};

describe('output = "object"', () => {
  describe('result.object', () => {
    it('should generate object with json mode', async () => {
      const result = await generateObject({
        model: new MockLanguageModelV1({
          doGenerate: async ({ prompt, mode }) => {
            assert.deepStrictEqual(mode, {
              type: 'object-json',
              name: undefined,
              description: undefined,
              schema: {
                $schema: 'http://json-schema.org/draft-07/schema#',
                additionalProperties: false,
                properties: { content: { type: 'string' } },
                required: ['content'],
                type: 'object',
              },
            });

            assert.deepStrictEqual(prompt, [
              {
                role: 'system',
                content:
                  'JSON schema:\n' +
                  '{"type":"object","properties":{"content":{"type":"string"}},"required":["content"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}\n' +
                  'You MUST answer with a JSON object that matches the JSON schema above.',
              },
              { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
            ]);

            return {
              ...dummyResponseValues,
              text: `{ "content": "Hello, world!" }`,
            };
          },
        }),
        schema: z.object({ content: z.string() }),
        mode: 'json',
        prompt: 'prompt',
      });

      assert.deepStrictEqual(result.object, { content: 'Hello, world!' });
    });

    it('should generate object with json mode when structured outputs are enabled', async () => {
      const result = await generateObject({
        model: new MockLanguageModelV1({
          supportsStructuredOutputs: true,
          doGenerate: async ({ prompt, mode }) => {
            assert.deepStrictEqual(mode, {
              type: 'object-json',
              name: undefined,
              description: undefined,
              schema: {
                $schema: 'http://json-schema.org/draft-07/schema#',
                additionalProperties: false,
                properties: { content: { type: 'string' } },
                required: ['content'],
                type: 'object',
              },
            });

            assert.deepStrictEqual(prompt, [
              { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
            ]);

            return {
              ...dummyResponseValues,
              text: `{ "content": "Hello, world!" }`,
            };
          },
        }),
        schema: z.object({ content: z.string() }),
        mode: 'json',
        prompt: 'prompt',
      });

      assert.deepStrictEqual(result.object, { content: 'Hello, world!' });
    });

    it('should use name and description with json mode when structured outputs are enabled', async () => {
      const result = await generateObject({
        model: new MockLanguageModelV1({
          supportsStructuredOutputs: true,
          doGenerate: async ({ prompt, mode }) => {
            assert.deepStrictEqual(mode, {
              type: 'object-json',
              name: 'test-name',
              description: 'test description',
              schema: {
                $schema: 'http://json-schema.org/draft-07/schema#',
                additionalProperties: false,
                properties: { content: { type: 'string' } },
                required: ['content'],
                type: 'object',
              },
            });

            assert.deepStrictEqual(prompt, [
              { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
            ]);

            return {
              ...dummyResponseValues,
              text: `{ "content": "Hello, world!" }`,
            };
          },
        }),
        schema: z.object({ content: z.string() }),
        schemaName: 'test-name',
        schemaDescription: 'test description',
        mode: 'json',
        prompt: 'prompt',
      });

      assert.deepStrictEqual(result.object, { content: 'Hello, world!' });
    });

    it('should generate object with tool mode', async () => {
      const result = await generateObject({
        model: new MockLanguageModelV1({
          doGenerate: async ({ prompt, mode }) => {
            assert.deepStrictEqual(mode, {
              type: 'object-tool',
              tool: {
                type: 'function',
                name: 'json',
                description: 'Respond with a JSON object.',
                parameters: {
                  $schema: 'http://json-schema.org/draft-07/schema#',
                  additionalProperties: false,
                  properties: { content: { type: 'string' } },
                  required: ['content'],
                  type: 'object',
                },
              },
            });
            assert.deepStrictEqual(prompt, [
              { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
            ]);

            return {
              ...dummyResponseValues,
              toolCalls: [
                {
                  toolCallType: 'function',
                  toolCallId: 'tool-call-1',
                  toolName: 'json',
                  args: `{ "content": "Hello, world!" }`,
                },
              ],
            };
          },
        }),
        schema: z.object({ content: z.string() }),
        mode: 'tool',
        prompt: 'prompt',
      });

      assert.deepStrictEqual(result.object, { content: 'Hello, world!' });
    });

    it('should use name and description with tool mode', async () => {
      const result = await generateObject({
        model: new MockLanguageModelV1({
          doGenerate: async ({ prompt, mode }) => {
            assert.deepStrictEqual(mode, {
              type: 'object-tool',
              tool: {
                type: 'function',
                name: 'test-name',
                description: 'test description',
                parameters: {
                  $schema: 'http://json-schema.org/draft-07/schema#',
                  additionalProperties: false,
                  properties: { content: { type: 'string' } },
                  required: ['content'],
                  type: 'object',
                },
              },
            });
            assert.deepStrictEqual(prompt, [
              { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
            ]);

            return {
              ...dummyResponseValues,
              toolCalls: [
                {
                  toolCallType: 'function',
                  toolCallId: 'tool-call-1',
                  toolName: 'json',
                  args: `{ "content": "Hello, world!" }`,
                },
              ],
            };
          },
        }),
        schema: z.object({ content: z.string() }),
        schemaName: 'test-name',
        schemaDescription: 'test description',
        mode: 'tool',
        prompt: 'prompt',
      });

      assert.deepStrictEqual(result.object, { content: 'Hello, world!' });
    });
  });

  describe('zod schema', () => {
    it('should generate object when using zod transform', async () => {
      const result = await generateObject({
        model: new MockLanguageModelV1({
          doGenerate: async ({ prompt, mode }) => {
            assert.deepStrictEqual(mode, {
              type: 'object-json',
              name: undefined,
              description: undefined,
              schema: {
                $schema: 'http://json-schema.org/draft-07/schema#',
                additionalProperties: false,
                properties: { content: { type: 'string' } },
                required: ['content'],
                type: 'object',
              },
            });
            assert.deepStrictEqual(prompt, [
              {
                role: 'system',
                content:
                  'JSON schema:\n' +
                  '{"type":"object","properties":{"content":{"type":"string"}},"required":["content"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}\n' +
                  'You MUST answer with a JSON object that matches the JSON schema above.',
              },
              { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
            ]);

            return {
              ...dummyResponseValues,
              text: `{ "content": "Hello, world!" }`,
            };
          },
        }),
        schema: z.object({
          content: z.string().transform(value => value.length),
        }),
        mode: 'json',
        prompt: 'prompt',
      });

      assert.deepStrictEqual(result.object, { content: 13 });
    });

    it('should generate object with tool mode when using zod prePreprocess', async () => {
      const result = await generateObject({
        model: new MockLanguageModelV1({
          doGenerate: async ({ prompt, mode }) => {
            assert.deepStrictEqual(mode, {
              type: 'object-json',
              name: undefined,
              description: undefined,
              schema: {
                $schema: 'http://json-schema.org/draft-07/schema#',
                additionalProperties: false,
                properties: { content: { type: 'string' } },
                required: ['content'],
                type: 'object',
              },
            });
            assert.deepStrictEqual(prompt, [
              {
                role: 'system',
                content:
                  'JSON schema:\n' +
                  '{"type":"object","properties":{"content":{"type":"string"}},"required":["content"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}\n' +
                  'You MUST answer with a JSON object that matches the JSON schema above.',
              },
              { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
            ]);

            return {
              ...dummyResponseValues,
              text: `{ "content": "Hello, world!" }`,
            };
          },
        }),
        schema: z.object({
          content: z.preprocess(
            val => (typeof val === 'number' ? String(val) : val),
            z.string(),
          ),
        }),
        mode: 'json',
        prompt: 'prompt',
      });

      assert.deepStrictEqual(result.object, { content: 'Hello, world!' });
    });
  });

  describe('custom schema', () => {
    it('should generate object with json mode', async () => {
      const result = await generateObject({
        model: new MockLanguageModelV1({
          doGenerate: async ({ prompt, mode }) => {
            assert.deepStrictEqual(mode, {
              type: 'object-json',
              name: undefined,
              description: undefined,
              schema: {
                type: 'object',
                properties: { content: { type: 'string' } },
                required: ['content'],
                additionalProperties: false,
              },
            });
            assert.deepStrictEqual(prompt, [
              {
                role: 'system',
                content:
                  'JSON schema:\n' +
                  '{"type":"object","properties":{"content":{"type":"string"}},"required":["content"],"additionalProperties":false}\n' +
                  'You MUST answer with a JSON object that matches the JSON schema above.',
              },
              { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
            ]);

            return {
              ...dummyResponseValues,
              text: `{ "content": "Hello, world!" }`,
            };
          },
        }),
        schema: jsonSchema({
          type: 'object',
          properties: { content: { type: 'string' } },
          required: ['content'],
          additionalProperties: false,
        }),
        mode: 'json',
        prompt: 'prompt',
      });

      assert.deepStrictEqual(result.object, { content: 'Hello, world!' });
    });
  });

  describe('result.toJsonResponse', () => {
    it('should return JSON response', async () => {
      const result = await generateObject({
        model: new MockLanguageModelV1({
          doGenerate: async ({}) => ({
            ...dummyResponseValues,
            text: `{ "content": "Hello, world!" }`,
          }),
        }),
        schema: z.object({ content: z.string() }),
        mode: 'json',
        prompt: 'prompt',
      });

      const response = result.toJsonResponse();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        response.headers.get('Content-Type'),
        'application/json; charset=utf-8',
      );

      assert.deepStrictEqual(
        await convertReadableStreamToArray(
          response.body!.pipeThrough(new TextDecoderStream()),
        ),
        ['{"content":"Hello, world!"}'],
      );
    });
  });

  describe('result.providerMetadata', () => {
    it('should contain provider metadata', async () => {
      const result = await generateObject({
        model: new MockLanguageModelV1({
          doGenerate: async ({}) => ({
            ...dummyResponseValues,
            text: `{ "content": "Hello, world!" }`,
            providerMetadata: {
              anthropic: {
                cacheCreationInputTokens: 10,
                cacheReadInputTokens: 20,
              },
            },
          }),
        }),
        schema: z.object({ content: z.string() }),
        mode: 'json',
        prompt: 'prompt',
      });

      assert.deepStrictEqual(result.experimental_providerMetadata, {
        anthropic: {
          cacheCreationInputTokens: 10,
          cacheReadInputTokens: 20,
        },
      });
    });
  });

  describe('options.headers', () => {
    it('should set headers', async () => {
      const result = await generateObject({
        model: new MockLanguageModelV1({
          doGenerate: async ({ headers }) => {
            assert.deepStrictEqual(headers, {
              'custom-request-header': 'request-header-value',
            });

            return {
              ...dummyResponseValues,
              text: `{ "content": "Hello, world!" }`,
            };
          },
        }),
        schema: z.object({ content: z.string() }),
        mode: 'json',
        prompt: 'prompt',
        headers: { 'custom-request-header': 'request-header-value' },
      });

      assert.deepStrictEqual(result.object, { content: 'Hello, world!' });
    });
  });
});

describe('output = "array"', () => {
  it('should generate an array with 3 elements', async () => {
    const result = await generateObject({
      model: new MockLanguageModelV1({
        doGenerate: async ({ prompt, mode }) => {
          assert.deepStrictEqual(mode, {
            type: 'object-json',
            name: undefined,
            description: undefined,
            schema: {
              $schema: 'http://json-schema.org/draft-07/schema#',
              additionalProperties: false,
              properties: {
                elements: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { content: { type: 'string' } },
                    required: ['content'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['elements'],
              type: 'object',
            },
          });

          assert.deepStrictEqual(prompt, [
            {
              role: 'system',
              content:
                'JSON schema:\n' +
                `{\"$schema\":\"http://json-schema.org/draft-07/schema#\",\"type\":\"object\",\"properties\":{\"elements\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"content\":{\"type\":\"string\"}},\"required\":[\"content\"],\"additionalProperties\":false}}},\"required\":[\"elements\"],\"additionalProperties\":false}` +
                `\n` +
                'You MUST answer with a JSON object that matches the JSON schema above.',
            },
            { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
          ]);

          return {
            ...dummyResponseValues,
            text: JSON.stringify({
              elements: [
                { content: 'element 1' },
                { content: 'element 2' },
                { content: 'element 3' },
              ],
            }),
          };
        },
      }),
      schema: z.object({ content: z.string() }),
      output: 'array',
      mode: 'json',
      prompt: 'prompt',
    });

    assert.deepStrictEqual(result.object, [
      { content: 'element 1' },
      { content: 'element 2' },
      { content: 'element 3' },
    ]);
  });
});

describe('output = "no-schema"', () => {
  it('should generate object', async () => {
    const result = await generateObject({
      model: new MockLanguageModelV1({
        doGenerate: async ({ prompt, mode }) => {
          assert.deepStrictEqual(mode, {
            type: 'object-json',
            name: undefined,
            description: undefined,
            schema: undefined,
          });

          assert.deepStrictEqual(prompt, [
            { role: 'system', content: 'You MUST answer with JSON.' },
            { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
          ]);

          return {
            ...dummyResponseValues,
            text: `{ "content": "Hello, world!" }`,
          };
        },
      }),
      output: 'no-schema',
      prompt: 'prompt',
    });

    assert.deepStrictEqual(result.object, { content: 'Hello, world!' });
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
    await generateObject({
      model: new MockLanguageModelV1({
        doGenerate: async () => ({
          ...dummyResponseValues,
          text: `{ "content": "Hello, world!" }`,
        }),
      }),
      schema: z.object({ content: z.string() }),
      mode: 'json',
      prompt: 'prompt',
    });

    assert.deepStrictEqual(tracer.jsonSpans, []);
  });

  it('should record telemetry data when enabled with mode "json"', async () => {
    await generateObject({
      model: new MockLanguageModelV1({
        doGenerate: async () => ({
          ...dummyResponseValues,
          text: `{ "content": "Hello, world!" }`,
        }),
      }),
      schema: z.object({ content: z.string() }),
      schemaName: 'test-name',
      schemaDescription: 'test description',
      mode: 'json',
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

    assert.deepStrictEqual(tracer.jsonSpans, [
      {
        name: 'ai.generateObject',
        attributes: {
          'operation.name': 'ai.generateObject test-function-id',
          'resource.name': 'test-function-id',
          'ai.operationId': 'ai.generateObject',
          'ai.finishReason': 'stop',
          'ai.model.id': 'mock-model-id',
          'ai.model.provider': 'mock-provider',
          'ai.prompt': '{"prompt":"prompt"}',
          'ai.result.object': '{"content":"Hello, world!"}',
          'ai.schema':
            '{"type":"object","properties":{"content":{"type":"string"}},"required":["content"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}',
          'ai.schema.name': 'test-name',
          'ai.schema.description': 'test description',
          'ai.settings.mode': 'json',
          'ai.settings.output': 'object',
          'ai.telemetry.functionId': 'test-function-id',
          'ai.telemetry.metadata.test1': 'value1',
          'ai.telemetry.metadata.test2': false,
          'ai.request.headers.header1': 'value1',
          'ai.request.headers.header2': 'value2',
          'ai.usage.completionTokens': 20,
          'ai.usage.promptTokens': 10,
        },
        events: [],
      },
      {
        name: 'ai.generateObject.doGenerate',
        attributes: {
          'operation.name': 'ai.generateObject.doGenerate test-function-id',
          'resource.name': 'test-function-id',
          'ai.operationId': 'ai.generateObject.doGenerate',
          'ai.settings.mode': 'json',
          'ai.finishReason': 'stop',
          'ai.model.id': 'mock-model-id',
          'ai.model.provider': 'mock-provider',
          'ai.prompt.format': 'prompt',
          'ai.prompt.messages':
            '[{"role":"system","content":"JSON schema:\\n{\\"type\\":\\"object\\",' +
            '\\"properties\\":{\\"content\\":{\\"type\\":\\"string\\"}},\\"required\\":' +
            '[\\"content\\"],\\"additionalProperties\\":false,\\"$schema\\":\\"http://json-schema.org/draft-07/schema#\\"}' +
            '\\nYou MUST answer with a JSON object that matches the JSON schema above."},' +
            '{"role":"user","content":[{"type":"text","text":"prompt"}]}]',
          'ai.result.object': '{ "content": "Hello, world!" }',
          'ai.telemetry.functionId': 'test-function-id',
          'ai.telemetry.metadata.test1': 'value1',
          'ai.telemetry.metadata.test2': false,
          'ai.request.headers.header1': 'value1',
          'ai.request.headers.header2': 'value2',
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
    ]);
  });

  it('should record telemetry data when enabled with mode "tool"', async () => {
    await generateObject({
      model: new MockLanguageModelV1({
        doGenerate: async ({}) => ({
          ...dummyResponseValues,
          toolCalls: [
            {
              toolCallType: 'function',
              toolCallId: 'tool-call-1',
              toolName: 'json',
              args: `{ "content": "Hello, world!" }`,
            },
          ],
        }),
      }),
      schema: z.object({ content: z.string() }),
      schemaName: 'test-name',
      schemaDescription: 'test description',
      mode: 'tool',
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
        name: 'ai.generateObject',
        attributes: {
          'operation.name': 'ai.generateObject test-function-id',
          'resource.name': 'test-function-id',
          'ai.operationId': 'ai.generateObject',
          'ai.finishReason': 'stop',
          'ai.model.id': 'mock-model-id',
          'ai.model.provider': 'mock-provider',
          'ai.prompt': '{"prompt":"prompt"}',
          'ai.result.object': '{"content":"Hello, world!"}',
          'ai.schema':
            '{"type":"object","properties":{"content":{"type":"string"}},"required":["content"],"additionalProperties":false,"$schema":"http://json-schema.org/draft-07/schema#"}',
          'ai.schema.name': 'test-name',
          'ai.schema.description': 'test description',
          'ai.settings.mode': 'tool',
          'ai.settings.output': 'object',
          'ai.telemetry.functionId': 'test-function-id',
          'ai.telemetry.metadata.test1': 'value1',
          'ai.telemetry.metadata.test2': false,
          'ai.usage.completionTokens': 20,
          'ai.usage.promptTokens': 10,
          'ai.request.headers.header1': 'value1',
          'ai.request.headers.header2': 'value2',
        },
        events: [],
      },
      {
        name: 'ai.generateObject.doGenerate',
        attributes: {
          'operation.name': 'ai.generateObject.doGenerate test-function-id',
          'resource.name': 'test-function-id',
          'ai.operationId': 'ai.generateObject.doGenerate',
          'ai.finishReason': 'stop',
          'ai.model.id': 'mock-model-id',
          'ai.model.provider': 'mock-provider',
          'ai.prompt.format': 'prompt',
          'ai.prompt.messages':
            '[{"role":"user","content":[{"type":"text","text":"prompt"}]}]',
          'ai.result.object': '{ "content": "Hello, world!" }',
          'ai.settings.mode': 'tool',
          'ai.telemetry.functionId': 'test-function-id',
          'ai.telemetry.metadata.test1': 'value1',
          'ai.telemetry.metadata.test2': false,
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

  it('should not record telemetry inputs / outputs when disabled with mode "json"', async () => {
    await generateObject({
      model: new MockLanguageModelV1({
        doGenerate: async () => ({
          ...dummyResponseValues,
          text: `{ "content": "Hello, world!" }`,
        }),
      }),
      schema: z.object({ content: z.string() }),
      mode: 'json',
      prompt: 'prompt',
      experimental_telemetry: {
        isEnabled: true,
        recordInputs: false,
        recordOutputs: false,
      },
    });

    expect(tracer.jsonSpans).toStrictEqual([
      {
        name: 'ai.generateObject',
        attributes: {
          'operation.name': 'ai.generateObject',
          'ai.operationId': 'ai.generateObject',
          'ai.finishReason': 'stop',
          'ai.model.id': 'mock-model-id',
          'ai.model.provider': 'mock-provider',
          'ai.settings.mode': 'json',
          'ai.settings.output': 'object',
          'ai.usage.completionTokens': 20,
          'ai.usage.promptTokens': 10,
        },
        events: [],
      },
      {
        name: 'ai.generateObject.doGenerate',
        attributes: {
          'operation.name': 'ai.generateObject.doGenerate',
          'ai.operationId': 'ai.generateObject.doGenerate',
          'ai.settings.mode': 'json',
          'ai.finishReason': 'stop',
          'ai.model.id': 'mock-model-id',
          'ai.model.provider': 'mock-provider',
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
    ]);
  });

  it('should not record telemetry inputs / outputs when disabled with mode "tool"', async () => {
    await generateObject({
      model: new MockLanguageModelV1({
        doGenerate: async ({}) => ({
          ...dummyResponseValues,
          toolCalls: [
            {
              toolCallType: 'function',
              toolCallId: 'tool-call-1',
              toolName: 'json',
              args: `{ "content": "Hello, world!" }`,
            },
          ],
        }),
      }),
      schema: z.object({ content: z.string() }),
      mode: 'tool',
      prompt: 'prompt',
      experimental_telemetry: {
        isEnabled: true,
        recordInputs: false,
        recordOutputs: false,
      },
    });

    expect(tracer.jsonSpans).toStrictEqual([
      {
        name: 'ai.generateObject',
        attributes: {
          'operation.name': 'ai.generateObject',
          'ai.operationId': 'ai.generateObject',
          'ai.finishReason': 'stop',
          'ai.model.id': 'mock-model-id',
          'ai.model.provider': 'mock-provider',
          'ai.settings.mode': 'tool',
          'ai.settings.output': 'object',
          'ai.usage.completionTokens': 20,
          'ai.usage.promptTokens': 10,
        },
        events: [],
      },
      {
        name: 'ai.generateObject.doGenerate',
        attributes: {
          'operation.name': 'ai.generateObject.doGenerate',
          'ai.operationId': 'ai.generateObject.doGenerate',
          'ai.finishReason': 'stop',
          'ai.model.id': 'mock-model-id',
          'ai.model.provider': 'mock-provider',
          'ai.settings.mode': 'tool',
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
    ]);
  });
});
