import { AISDKError } from './ai-sdk-error';

const name = 'AI_TooManyEmbeddingValuesForCallError';
const marker = `vercel.ai.error.${name}`;
const symbol = Symbol.for(marker);

export class TooManyEmbeddingValuesForCallError extends AISDKError {
  private readonly [symbol] = true; // used in isInstance

  readonly provider: string;
  readonly modelId: string;
  readonly maxEmbeddingsPerCall: number;
  readonly values: Array<unknown>;

  constructor(options: {
    provider: string;
    modelId: string;
    maxEmbeddingsPerCall: number;
    values: Array<unknown>;
  }) {
    super({
      name,
      message:
        `Too many values for a single embedding call. ` +
        `The ${options.provider} model "${options.modelId}" can only embed up to ` +
        `${options.maxEmbeddingsPerCall} values per call, but ${options.values.length} values were provided.`,
    });

    this.provider = options.provider;
    this.modelId = options.modelId;
    this.maxEmbeddingsPerCall = options.maxEmbeddingsPerCall;
    this.values = options.values;
  }

  static isInstance(
    error: unknown,
  ): error is TooManyEmbeddingValuesForCallError {
    return AISDKError.hasMarker(error, marker);
  }

  /**
   * @deprecated use `isInstance` instead
   */
  static isTooManyEmbeddingValuesForCallError(
    error: unknown,
  ): error is TooManyEmbeddingValuesForCallError {
    return (
      error instanceof Error &&
      error.name === name &&
      'provider' in error &&
      typeof error.provider === 'string' &&
      'modelId' in error &&
      typeof error.modelId === 'string' &&
      'maxEmbeddingsPerCall' in error &&
      typeof error.maxEmbeddingsPerCall === 'number' &&
      'values' in error &&
      Array.isArray(error.values)
    );
  }

  /**
   * @deprecated Do not use this method. It will be removed in the next major version.
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      stack: this.stack,

      provider: this.provider,
      modelId: this.modelId,
      maxEmbeddingsPerCall: this.maxEmbeddingsPerCall,
      values: this.values,
    };
  }
}
