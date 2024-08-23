import { LanguageModelV1Prompt } from '@ai-sdk/provider';
import { convertReadableStreamToArray } from '@ai-sdk/provider-utils/test';
import {
  FinishReason,
  GenerateContentResponse,
  GenerativeModel,
  Part,
} from '@google-cloud/vertexai';
import { createVertex } from './google-vertex-provider';
import { MockVertexAI } from './mock-vertex-ai';
import { GoogleVertexSettings } from './google-vertex-settings';

const TEST_PROMPT: LanguageModelV1Prompt = [
  { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
];

function createModel(options: {
  generateContent?: GenerativeModel['generateContent'];
  generateContentStream?: () => AsyncGenerator<GenerateContentResponse>;
  modelId?: string;
  settings?: GoogleVertexSettings;
}) {
  const mock = new MockVertexAI(options);

  const provider = createVertex({
    location: 'test-location',
    project: 'test-project',
    generateId: () => 'test-id',
    createVertexAI: ({ project, location }) =>
      mock.createVertexAI({ project, location }),
  });

  return {
    model: provider(options.modelId ?? 'gemini-1.0-pro-002', options.settings),
    mockVertexAI: mock,
  };
}

describe('doGenerate', () => {
  function prepareResponse({
    text = '',
    finishReason = 'STOP' as FinishReason,
    usageMetadata = {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
    },
    parts,
  }: {
    text?: string;
    finishReason?: FinishReason;
    usageMetadata?: {
      promptTokenCount: number;
      candidatesTokenCount: number;
      totalTokenCount: number;
    };
    parts?: Part[];
  }) {
    return async () => ({
      response: {
        candidates: [
          {
            content: {
              parts: parts ?? [{ text }],
              role: 'model',
            },
            index: 0,
            finishReason,
          },
        ],
        usageMetadata,
      },
    });
  }

  it('should extract text response', async () => {
    const { model } = createModel({
      generateContent: prepareResponse({
        text: 'Hello, World!',
      }),
    });

    const { text } = await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: TEST_PROMPT,
    });

    expect(text).toStrictEqual('Hello, World!');
  });

  it('should extract usage', async () => {
    const { model } = createModel({
      generateContent: prepareResponse({
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 40,
          totalTokenCount: 52,
        },
      }),
    });

    const { usage } = await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: TEST_PROMPT,
    });

    expect(usage).toStrictEqual({
      promptTokens: 10,
      completionTokens: 40,
    });
  });

  it('should extract tool calls', async () => {
    const { model, mockVertexAI } = createModel({
      generateContent: prepareResponse({
        parts: [
          {
            functionCall: {
              name: 'test-tool',
              args: { value: 'example value' },
            },
          },
        ],
      }),
    });

    const { toolCalls, finishReason, text } = await model.doGenerate({
      inputFormat: 'prompt',
      mode: {
        type: 'regular',
        tools: [
          {
            type: 'function',
            name: 'test-tool',
            parameters: {
              type: 'object',
              properties: { value: { type: 'string' } },
              required: ['value'],
              additionalProperties: false,
              $schema: 'http://json-schema.org/draft-07/schema#',
            },
          },
        ],
      },
      prompt: TEST_PROMPT,
    });

    expect(mockVertexAI.lastModelParams).toStrictEqual({
      model: 'gemini-1.0-pro-002',
      generationConfig: {
        maxOutputTokens: undefined,
        responseMimeType: undefined,
        temperature: undefined,
        topK: undefined,
        topP: undefined,
        stopSequences: undefined,
      },
      tools: [
        {
          functionDeclarations: [
            {
              description: '',
              name: 'test-tool',
              parameters: {
                description: undefined,
                properties: {
                  value: {
                    description: undefined,
                    required: undefined,
                    type: 'STRING',
                  },
                },
                required: ['value'],
                type: 'OBJECT',
              },
            },
          ],
        },
      ],
      safetySettings: undefined,
    });

    expect(toolCalls).toStrictEqual([
      {
        toolCallId: 'test-id',
        toolCallType: 'function',
        toolName: 'test-tool',
        args: '{"value":"example value"}',
      },
    ]);
    expect(text).toStrictEqual(undefined);
    expect(finishReason).toStrictEqual('tool-calls');
  });

  it('should extract finish reason', async () => {
    const { model } = createModel({
      generateContent: prepareResponse({
        finishReason: 'MAX_TOKENS' as FinishReason,
      }),
    });

    const { finishReason } = await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: TEST_PROMPT,
    });

    expect(finishReason).toStrictEqual('length');
  });

  it('should send model id and settings', async () => {
    const { model, mockVertexAI } = createModel({
      modelId: 'test-model',
      settings: {
        topK: 0.1,
      },
      generateContent: prepareResponse({}),
    });

    await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: TEST_PROMPT,
      temperature: 0.5,
      maxTokens: 100,
      topP: 0.9,
      stopSequences: ['abc', 'def'],
    });

    expect(mockVertexAI.lastModelParams).toStrictEqual({
      model: 'test-model',
      generationConfig: {
        maxOutputTokens: 100,
        responseMimeType: undefined,
        temperature: 0.5,
        topK: 0.1,
        topP: 0.9,
        stopSequences: ['abc', 'def'],
      },
      tools: undefined,
      safetySettings: undefined,
    });
  });

  it('should send search grounding tool', async () => {
    const { model, mockVertexAI } = createModel({
      modelId: 'test-model',
      settings: {
        useSearchGrounding: true,
      },
      generateContent: prepareResponse({}),
    });

    await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: TEST_PROMPT,
    });

    expect(mockVertexAI.lastModelParams).toStrictEqual({
      model: 'test-model',
      generationConfig: {
        maxOutputTokens: undefined,
        responseMimeType: undefined,
        stopSequences: undefined,
        temperature: undefined,
        topK: undefined,
        topP: undefined,
      },
      tools: [{ googleSearchRetrieval: {} }],
      safetySettings: undefined,
    });
  });

  it('should send the messages', async () => {
    const { model } = createModel({
      generateContent: async request => {
        expect(request).toStrictEqual({
          contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
          systemInstruction: {
            role: 'system',
            parts: [{ text: 'test system instruction' }],
          },
        });

        return {
          response: {
            candidates: [
              {
                content: {
                  parts: [{ text: 'Hello, World!' }],
                  role: 'model',
                },
                index: 0,
                finishReason: 'STOP' as FinishReason,
              },
            ],
            usageMetadata: {
              promptTokenCount: 0,
              candidatesTokenCount: 0,
              totalTokenCount: 0,
            },
          },
        };
      },
    });

    await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [
        { role: 'system', content: 'test system instruction' },
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ],
    });
  });

  it('should set name & description in object-json mode', async () => {
    const { model, mockVertexAI } = createModel({
      modelId: 'test-model',
      generateContent: prepareResponse({
        parts: [{ text: '{"value":"Spark"}' }],
      }),
    });

    const response = await model.doGenerate({
      inputFormat: 'prompt',
      mode: {
        type: 'object-json',
        name: 'test-name',
        description: 'test description',
        schema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
          $schema: 'http://json-schema.org/draft-07/schema#',
        },
      },
      prompt: TEST_PROMPT,
    });

    expect(mockVertexAI.lastModelParams).toStrictEqual({
      model: 'test-model',
      generationConfig: {
        maxOutputTokens: undefined,
        responseMimeType: 'application/json',
        stopSequences: undefined,
        temperature: undefined,
        topK: undefined,
        topP: undefined,
      },
      safetySettings: undefined,
    });

    expect(response.text).toStrictEqual('{"value":"Spark"}');
  });
});

describe('doStream', () => {
  it('should stream text deltas', async () => {
    const { model } = createModel({
      generateContentStream: async function* () {
        yield {
          candidates: [
            {
              content: { parts: [{ text: 'Hello, ' }], role: 'model' },
              index: 0,
            },
          ],
        };
        yield {
          candidates: [
            {
              content: { parts: [{ text: 'World!' }], role: 'model' },
              index: 0,
            },
          ],
        };
        yield {
          candidates: [
            {
              content: { parts: [{ text: '' }], role: 'model' },
              finishReason: 'STOP' as FinishReason,
              index: 0,
            },
          ],
          usageMetadata: {
            promptTokenCount: 9,
            candidatesTokenCount: 403,
            totalTokenCount: 412,
          },
        };
      },
    });

    const { stream } = await model.doStream({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: TEST_PROMPT,
    });

    expect(await convertReadableStreamToArray(stream)).toStrictEqual([
      { type: 'text-delta', textDelta: 'Hello, ' },
      { type: 'text-delta', textDelta: 'World!' },
      { type: 'text-delta', textDelta: '' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { promptTokens: 9, completionTokens: 403 },
      },
    ]);
  });
});
