import { InvalidPromptError } from '@ai-sdk/provider';
import { CoreMessage } from './message';
import { Prompt } from './prompt';

export type ValidatedPrompt =
  | {
      type: 'prompt';
      prompt: string;
      messages: undefined;
      system?: string;
    }
  | {
      type: 'messages';
      prompt: undefined;
      messages: CoreMessage[];
      system?: string;
    };

export function getValidatedPrompt(prompt: Prompt): ValidatedPrompt {
  if (prompt.prompt == null && prompt.messages == null) {
    throw new InvalidPromptError({
      prompt,
      message: 'prompt or messages must be defined',
    });
  }

  if (prompt.prompt != null && prompt.messages != null) {
    throw new InvalidPromptError({
      prompt,
      message: 'prompt and messages cannot be defined at the same time',
    });
  }

  if (prompt.messages != null) {
    for (const message of prompt.messages) {
      if (message.role === 'system' && typeof message.content !== 'string') {
        throw new InvalidPromptError({
          prompt,
          message: 'system message content must be a string',
        });
      }
    }
  }

  return prompt.prompt != null
    ? {
        type: 'prompt',
        prompt: prompt.prompt,
        messages: undefined,
        system: prompt.system,
      }
    : {
        type: 'messages',
        prompt: undefined,
        messages: prompt.messages!, // only possible case bc of checks above
        system: prompt.system,
      };
}
