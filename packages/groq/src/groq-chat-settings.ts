// https://console.groq.com/docs/models
export type GroqChatModelId =
  | 'gemma2-9b-it'
  | 'gemma-7b-it'
  | 'llama3-groq-70b-8192-tool-use-preview'
  | 'llama3-groq-8b-8192-tool-use-preview'
  | 'llama-3.1-70b-versatile'
  | 'llama-3.1-8b-instant'
  | 'llama-3.2-1b-preview'
  | 'llama-3.2-3b-preview'
  | 'llama-3.2-11b-vision-preview'
  | 'llama-guard-3-8b'
  | 'llava-v1.5-7b-4096-preview'
  | 'llama3-70b-8192'
  | 'llama3-8b-8192'
  | 'mixtral-8x7b-32768'
  | (string & {});

export interface GroqChatSettings {
  /**
Whether to enable parallel function calling during tool use. Default to true.
   */
  parallelToolCalls?: boolean;

  /**
A unique identifier representing your end-user, which can help OpenAI to
monitor and detect abuse. Learn more.
*/
  user?: string;

  /**
Automatically download images and pass the image as data to the model.
Groq supports image URLs for public models, so this is only needed for
private models or when the images are not publicly accessible.

Defaults to `false`.
   */
  downloadImages?: boolean;
}
