import { ToolCall as CoreToolCall } from './duplicated/tool-call';
import { ToolResult as CoreToolResult } from './duplicated/tool-result';
import { formatStreamPart, parseStreamPart } from './stream-parts';

describe('stream-parts', () => {
  describe('formatStreamPart', () => {
    it('should escape newlines in text', () => {
      expect(formatStreamPart('text', 'value\nvalue')).toEqual(
        '0:"value\\nvalue"\n',
      );
    });

    it('should escape newlines in data objects', () => {
      expect(formatStreamPart('data', [{ test: 'value\nvalue' }])).toEqual(
        '2:[{"test":"value\\nvalue"}]\n',
      );
    });
  });

  describe('parseStreamPart', () => {
    it('should parse a text line', () => {
      const input = '0:"Hello, world!"';

      expect(parseStreamPart(input)).toEqual({
        type: 'text',
        value: 'Hello, world!',
      });
    });

    it('should parse a function call line', () => {
      const input =
        '1:{"function_call": {"name":"get_current_weather","arguments":"{\\"location\\": \\"Charlottesville, Virginia\\",\\"format\\": \\"celsius\\"}"}}';

      expect(parseStreamPart(input)).toEqual({
        type: 'function_call',
        value: {
          function_call: {
            name: 'get_current_weather',
            arguments:
              '{"location": "Charlottesville, Virginia","format": "celsius"}',
          },
        },
      });
    });

    it('should parse a tool call line', () => {
      const input =
        '7:{"tool_calls": [{"type": "function", "id": "tool_0", "function": {"name":"get_current_weather","arguments":"{\\"location\\": \\"Charlottesville, Virginia\\",\\"format\\": \\"celsius\\"}"}}]}';

      expect(parseStreamPart(input)).toEqual({
        type: 'tool_calls',
        value: {
          tool_calls: [
            {
              type: 'function',
              id: 'tool_0',
              function: {
                name: 'get_current_weather',
                arguments:
                  '{"location": "Charlottesville, Virginia","format": "celsius"}',
              },
            },
          ],
        },
      });
    });

    it('should parse a data line', () => {
      const input = '2:[{"test":"value"}]';
      const expectedOutput = { type: 'data', value: [{ test: 'value' }] };
      expect(parseStreamPart(input)).toEqual(expectedOutput);
    });

    it('should parse a message data line', () => {
      const input = '8:[{"test":"value"}]';
      const expectedOutput = {
        type: 'message_annotations',
        value: [{ test: 'value' }],
      };
      expect(parseStreamPart(input)).toEqual(expectedOutput);
    });

    it('should throw an error if the input does not contain a colon separator', () => {
      const input = 'invalid stream string';
      expect(() => parseStreamPart(input)).toThrow();
    });

    it('should throw an error if the input contains an invalid type', () => {
      const input = '55:test';
      expect(() => parseStreamPart(input)).toThrow();
    });

    it("should throw error if the input's JSON is invalid", () => {
      const input = '0:{"test":"value"';
      expect(() => parseStreamPart(input)).toThrow();
    });
  });
});

describe('tool_call stream part', () => {
  it('should format a tool_call stream part', () => {
    const toolCall: CoreToolCall<string, any> = {
      toolCallId: 'tc_0',
      toolName: 'example_tool',
      args: { test: 'value' },
    };

    expect(formatStreamPart('tool_call', toolCall)).toEqual(
      `9:${JSON.stringify(toolCall)}\n`,
    );
  });

  it('should parse a tool_call stream part', () => {
    const toolCall: CoreToolCall<string, any> = {
      toolCallId: 'tc_0',
      toolName: 'example_tool',
      args: { test: 'value' },
    };

    const input = `9:${JSON.stringify(toolCall)}`;

    expect(parseStreamPart(input)).toEqual({
      type: 'tool_call',
      value: toolCall,
    });
  });
});

describe('tool_result stream part', () => {
  it('should format a tool_result stream part', () => {
    const toolResult: Omit<
      CoreToolResult<string, any, any>,
      'args' | 'toolName'
    > = {
      toolCallId: 'tc_0',
      result: 'result',
    };

    expect(formatStreamPart('tool_result', toolResult)).toEqual(
      `a:${JSON.stringify(toolResult)}\n`,
    );
  });

  it('should parse a tool_result stream part', () => {
    const toolResult = {
      toolCallId: 'tc_0',
      result: 'result',
    };

    const input = `a:${JSON.stringify(toolResult)}`;

    expect(parseStreamPart(input)).toEqual({
      type: 'tool_result',
      value: toolResult,
    });
  });
});

describe('tool_call_streaming_start stream part', () => {
  it('should format a tool_call_streaming_start stream part', () => {
    expect(
      formatStreamPart('tool_call_streaming_start', {
        toolCallId: 'tc_0',
        toolName: 'example_tool',
      }),
    ).toEqual(`b:{"toolCallId":"tc_0","toolName":"example_tool"}\n`);
  });

  it('should parse a tool_call_streaming_start stream part', () => {
    const input = `b:{"toolCallId":"tc_0","toolName":"example_tool"}`;

    expect(parseStreamPart(input)).toEqual({
      type: 'tool_call_streaming_start',
      value: { toolCallId: 'tc_0', toolName: 'example_tool' },
    });
  });
});

describe('tool_call_delta stream part', () => {
  it('should format a tool_call_delta stream part', () => {
    expect(
      formatStreamPart('tool_call_delta', {
        toolCallId: 'tc_0',
        argsTextDelta: 'delta',
      }),
    ).toEqual(`c:{"toolCallId":"tc_0","argsTextDelta":"delta"}\n`);
  });

  it('should parse a tool_call_delta stream part', () => {
    const input = `c:{"toolCallId":"tc_0","argsTextDelta":"delta"}`;
    expect(parseStreamPart(input)).toEqual({
      type: 'tool_call_delta',
      value: { toolCallId: 'tc_0', argsTextDelta: 'delta' },
    });
  });
});

describe('finish_message stream part', () => {
  it('should format a finish_message stream part', () => {
    expect(
      formatStreamPart('finish_message', {
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20 },
      }),
    ).toEqual(
      `d:{"finishReason":"stop","usage":{"promptTokens":10,"completionTokens":20}}\n`,
    );
  });

  it('should parse a finish_message stream part', () => {
    const input = `d:{"finishReason":"stop","usage":{"promptTokens":10,"completionTokens":20}}`;
    expect(parseStreamPart(input)).toEqual({
      type: 'finish_message',
      value: {
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20 },
      },
    });
  });

  it('should parse a finish_message with null completion and prompt tokens', () => {
    const input = `d:{"finishReason":"stop","usage":{"promptTokens":null,"completionTokens":null}}`;
    expect(parseStreamPart(input)).toEqual({
      type: 'finish_message',
      value: {
        finishReason: 'stop',
        usage: { promptTokens: NaN, completionTokens: NaN },
      },
    });
  });
});
