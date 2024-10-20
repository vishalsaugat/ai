// https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models
export type GoogleVertexModelId =
  // Stable version
  | 'gemini-1.5-flash-001'
  | 'gemini-1.5-flash-002'
  | 'gemini-1.5-pro-001'
  | 'gemini-1.5-pro-002'
  | 'gemini-1.0-pro-001'
  | 'gemini-1.0-pro-vision-001'
  // Auto-updated alias
  | 'gemini-1.5-flash'
  | 'gemini-1.5-pro'
  | 'gemini-1.0-pro'
  | 'gemini-1.0-pro-vision'
  | (string & {});

export interface GoogleVertexSettings {
  /**
Optional. The maximum number of tokens to consider when sampling.

Models use nucleus sampling or combined Top-k and nucleus sampling.
Top-k sampling considers the set of topK most probable tokens.
Models running with nucleus sampling don't allow topK setting.

@deprecated use the topK setting on the request instead.
   */
  topK?: number;

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
      | 'HARM_CATEGORY_UNSPECIFIED'
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

  /**
Optional. When enabled, the model will use Google search to ground the response.

@see https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/overview
   */
  useSearchGrounding?: boolean;
}
