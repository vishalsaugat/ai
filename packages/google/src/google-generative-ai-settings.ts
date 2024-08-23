// https://ai.google.dev/models/gemini
export type GoogleGenerativeAIModelId =
  | 'gemini-1.5-flash-latest'
  | 'gemini-1.5-flash'
  | 'gemini-1.5-pro-latest'
  | 'gemini-1.5-pro'
  | 'gemini-1.0-pro'
  | 'gemini-pro'
  | (string & {});

export interface GoogleGenerativeAISettings {
  /**
Optional. The maximum number of tokens to consider when sampling.

Models use nucleus sampling or combined Top-k and nucleus sampling.
Top-k sampling considers the set of topK most probable tokens.
Models running with nucleus sampling don't allow topK setting.

@deprecated use the topK setting on the request instead.
   */
  topK?: number;

  /**
Optional.
The name of the cached content used as context to serve the prediction.
Format: cachedContents/{cachedContent}
   */
  cachedContent?: string;

  /**
   * Optional. Enable structured output. Default is true.
   *
   * This is useful when the JSON Schema contains elements that are
   * not supported by the OpenAPI schema version that
   * Google Generative AI uses. You can use this to disable
   * structured outputs if you need to.
   */
  structuredOutputs?: boolean;

  /**
Optional. A list of unique safety settings for blocking unsafe content.
   */
  safetySettings?: Array<{
    category:
      | 'HARM_CATEGORY_HATE_SPEECH'
      | 'HARM_CATEGORY_DANGEROUS_CONTENT'
      | 'HARM_CATEGORY_HARASSMENT'
      | 'HARM_CATEGORY_SEXUALLY_EXPLICIT';

    threshold:
      | 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
      | 'BLOCK_LOW_AND_ABOVE'
      | 'BLOCK_MEDIUM_AND_ABOVE'
      | 'BLOCK_ONLY_HIGH'
      | 'BLOCK_NONE';
  }>;
}
