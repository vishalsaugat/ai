import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils';
import { GoogleAuthOptions } from 'google-auth-library';
import { AnthropicMessagesLanguageModel } from './anthropic-messages-language-model';
import {
  AnthropicMessagesModelId,
  AnthropicMessagesSettings,
} from './anthropic-messages-settings';

export interface AnthropicProvider {
  /**
Creates a model for text generation.
*/
  (
    modelId: AnthropicMessagesModelId,
    settings?: AnthropicMessagesSettings,
  ): AnthropicMessagesLanguageModel;

  /**
Creates a model for text generation.
*/
  chat(
    modelId: AnthropicMessagesModelId,
    settings?: AnthropicMessagesSettings,
  ): AnthropicMessagesLanguageModel;

  /**
   * @deprecated Use `chat()` instead.
   */
  messages(
    modelId: AnthropicMessagesModelId,
    settings?: AnthropicMessagesSettings,
  ): AnthropicMessagesLanguageModel;
}

export interface AnthropicProviderSettings {
  /**
Use a different URL prefix for API calls, e.g. to use proxy servers.
The default prefix is `https://api.anthropic.com/v1`.
   */
  baseURL?: string;

  /**
@deprecated Use `baseURL` instead.
   */
  baseUrl?: string;

  /**
API key that is being send using the `x-api-key` header.
It defaults to the `ANTHROPIC_API_KEY` environment variable.
   */
  apiKey?: string;

  /**
  * Optional. The Authentication options provided by google-auth-library.
  * Complete list of authentication options is documented in the
  * GoogleAuthOptions interface:
  * https://github.com/googleapis/google-auth-library-nodejs/blob/main/src/auth/googleauth.ts.
   */
  googleAuthOptions?: GoogleAuthOptions;

  /**
Custom headers to include in the requests.
     */
  headers?: Record<string, string>;

  generateId?: () => string;
}

/**
Create an Anthropic provider instance.
 */
export function createAnthropic(
  options: AnthropicProviderSettings = {},
): AnthropicProvider {
  const baseURL =
    withoutTrailingSlash(options.baseURL ?? options.baseUrl) ??
    'https://api.anthropic.com/v1';

  const getHeaders = () => ({
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'tools-2024-05-16',
    'x-api-key': loadApiKey({
      apiKey: options.apiKey,
      environmentVariableName: 'ANTHROPIC_API_KEY',
      description: 'Anthropic',
    }),
    googleAuthOptions: options.googleAuthOptions,
    ...options.headers,
  });

  const createChatModel = (
    modelId: AnthropicMessagesModelId,
    settings: AnthropicMessagesSettings = {},
  ) =>
    new AnthropicMessagesLanguageModel(modelId, settings, {
      provider: 'anthropic.messages',
      baseURL,
      headers: getHeaders,
    });

  const provider = function (
    modelId: AnthropicMessagesModelId,
    settings?: AnthropicMessagesSettings,
  ) {
    if (new.target) {
      throw new Error(
        'The Anthropic model function cannot be called with the new keyword.',
      );
    }

    return createChatModel(modelId, settings);
  };

  provider.chat = createChatModel;
  provider.messages = createChatModel;

  return provider as AnthropicProvider;
}

/**
Default Anthropic provider instance.
 */
export const anthropic = createAnthropic();
