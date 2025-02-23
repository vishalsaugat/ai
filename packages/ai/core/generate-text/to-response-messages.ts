import { ToolResultPart } from '../prompt';
import { ResponseMessage } from './step-result';
import { ToolCallArray } from './tool-call';
import { ToolResultArray } from './tool-result';
import { ToolSet } from './tool-set';

/**
Converts the result of a `generateText` call to a list of response messages.
 */
export function toResponseMessages<TOOLS extends ToolSet>({
  text = '',
  tools,
  toolCalls,
  toolResults,
  messageId,
  generateMessageId,
}: {
  text: string | undefined;
  tools: TOOLS;
  toolCalls: ToolCallArray<TOOLS>;
  toolResults: ToolResultArray<TOOLS>;
  messageId: string;
  generateMessageId: () => string;
}): Array<ResponseMessage> {
  const responseMessages: Array<ResponseMessage> = [];

  responseMessages.push({
    role: 'assistant',
    content: [{ type: 'text', text }, ...toolCalls],
    id: messageId,
  });

  if (toolResults.length > 0) {
    responseMessages.push({
      role: 'tool',
      id: generateMessageId(),
      content: toolResults.map((toolResult): ToolResultPart => {
        const tool = tools[toolResult.toolName];
        return tool?.experimental_toToolResultContent != null
          ? {
              type: 'tool-result',
              toolCallId: toolResult.toolCallId,
              toolName: toolResult.toolName,
              result: tool.experimental_toToolResultContent(toolResult.result),
              experimental_content: tool.experimental_toToolResultContent(
                toolResult.result,
              ),
            }
          : {
              type: 'tool-result',
              toolCallId: toolResult.toolCallId,
              toolName: toolResult.toolName,
              result: toolResult.result,
            };
      }),
    });
  }

  return responseMessages;
}
