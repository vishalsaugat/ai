import { ImageModelV1, NoSuchModelError, ProviderV1 } from '@ai-sdk/provider';
import {
  FetchFunction,
  loadApiKey,
  withoutTrailingSlash,
} from '@ai-sdk/provider-utils';
import { FluxImageModelId, FluxImageSettings } from './flux-image-settings';
import { FluxImageModel } from './flux-image-model';

export interface FluxProvider extends ProviderV1 {
  /**
Creates a model for image generation.
  */
  image(modelId: FluxImageModelId, settings?: FluxImageSettings): ImageModelV1;

  /**
Creates a model for image generation.
   */
  imageModel(
    modelId: FluxImageModelId,
    settings?: FluxImageSettings,
  ): ImageModelV1;
}

export interface FluxProviderSettings {
  /**
Flux API key. Default value is taken from the `Flux_API_KEY` environment
variable.
  */
  apiKey?: string;
  /**
Base URL for the API calls.
  */
  baseURL?: string;
  /**
Custom headers to include in the requests.
  */
  headers?: Record<string, string>;
  /**
Custom fetch implementation. You can use it as a middleware to intercept requests,
or to provide a custom fetch implementation for e.g. testing.
  */
  fetch?: FetchFunction;
}

const defaultBaseURL = 'https://flux-model.survo.co/predict';

export function createFlux(options: FluxProviderSettings = {}): FluxProvider {
  const baseURL = withoutTrailingSlash(options.baseURL ?? defaultBaseURL);
  const getHeaders = () => ({
    ...options.headers,
  });

  const createImageModel = (
    modelId: FluxImageModelId,
    settings: FluxImageSettings = {},
  ) =>
    new FluxImageModel(modelId, settings, {
      provider: 'Flux.image',
      baseURL: baseURL ?? defaultBaseURL,
      headers: getHeaders,
      fetch: options.fetch,
    });

  return {
    image: createImageModel,
    imageModel: createImageModel,
    languageModel: () => {
      throw new NoSuchModelError({
        modelId: 'languageModel',
        modelType: 'languageModel',
      });
    },
    textEmbeddingModel: () => {
      throw new NoSuchModelError({
        modelId: 'textEmbeddingModel',
        modelType: 'textEmbeddingModel',
      });
    },
  };
}

export const flux = createFlux();
