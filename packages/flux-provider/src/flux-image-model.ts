import {
  ImageModelV1,
  ImageModelV1CallWarning,
  InvalidResponseDataError,
} from '@ai-sdk/provider';
import {
  FetchFunction,
  combineHeaders,
  createBinaryResponseHandler,
  createJsonResponseHandler,
  createJsonErrorResponseHandler,
  createStatusCodeErrorResponseHandler,
  delay,
  getFromApi,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { FluxImageSettings } from './flux-image-settings';
import { z } from 'zod';
import jwt from 'jsonwebtoken';

const DEFAULT_POLL_INTERVAL_MILLIS = 500;
const DEFAULT_MAX_POLL_ATTEMPTS = 60000 / DEFAULT_POLL_INTERVAL_MILLIS;

interface FluxImageModelConfig {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: FetchFunction;
  _internal?: {
    currentDate?: () => Date;
  };
}

export class FluxImageModel implements ImageModelV1 {
  readonly specificationVersion = 'v1';

  private readonly pollIntervalMillis: number;
  private readonly maxPollAttempts: number;

  get provider(): string {
    return this.config.provider;
  }

  get maxImagesPerCall(): number {
    return this.settings.maxImagesPerCall ?? 1;
  }

  constructor(
    readonly modelId: string,
    private readonly settings: FluxImageSettings,
    private readonly config: FluxImageModelConfig,
  ) {
    this.pollIntervalMillis =
      settings.pollIntervalMillis ?? DEFAULT_POLL_INTERVAL_MILLIS;
    this.maxPollAttempts =
      settings.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  }

  async doGenerate({
    prompt,
    n,
    size,
    aspectRatio,
    seed,
    providerOptions,
    headers,
    abortSignal,
  }: Parameters<ImageModelV1['doGenerate']>[0]): Promise<
    Awaited<ReturnType<ImageModelV1['doGenerate']>>
  > {
    const warnings: Array<ImageModelV1CallWarning> = [];

    if (seed != null) {
      warnings.push({
        type: 'unsupported-setting',
        setting: 'seed',
        details: 'This model does not support the `seed` option.',
      });
    }

    if (size != null) {
      warnings.push({
        type: 'unsupported-setting',
        setting: 'size',
        details:
          'This model does not support the `size` option. Use `aspectRatio` instead.',
      });
    }

    const currentDate = this.config._internal?.currentDate?.() ?? new Date();
    const fullHeaders = combineHeaders(this.config.headers(), headers);
  const token = jwt.sign({ project: '' }, process.env.FLUX_SECRET!, { expiresIn: '1h' });

  const [height, width] = size ? size.split("x") : ['1024', '1024'];
  const data = {
    prompt,
    num_inference_steps: 25,
    guidance_scale: 0,
    auth_token: token,
    height: parseInt(height),
    width: parseInt(width),
  };
  const response = await fetch(this.getFluxGenerationsUrl(), {
    method: "POST",
    body: JSON.stringify(data),
  });
  const result = await response.json();
  const { urls, ...rest } = result // Adjust this based on the actual response structure
  if (!urls) {
    throw new Error("No image URLs returned");
  }

  console.log(urls, '---=---=')

  return {
    warnings: [],
    response: {
      modelId: this.modelId,
      timestamp: currentDate,
      headers: {},
    },
    images: urls.map((url: string) => url.replace('storage.googleapis.com/survo-chat-images', 'images.survo.co')),
  };
    // const { value: generationResponse, responseHeaders } = await postJsonToApi({
    //   url: this.getFluxGenerationsUrl(),
    //   headers: fullHeaders,
    //   body: {
    //     prompt,
    //     auth_token: token,
    //     ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    //     model: this.modelId,
    //     ...(providerOptions.Flux ?? {}),
    //   },
    //   abortSignal,
    //   fetch: this.config.fetch,
    //   failedResponseHandler: this.createFluxErrorHandler(),
    //   successfulResponseHandler: createJsonResponseHandler(
    //     FluxGenerationResponseSchema,
    //   ),
    // });

    // const imageUrl = await this.pollForImageUrl(
    //   generationResponse.id,
    //   fullHeaders,
    //   abortSignal,
    // );

    // const downloadedImage = await this.downloadImage(imageUrl, abortSignal);

    // return {
    //   images: [downloadedImage],
    //   warnings,
    //   response: {
    //     modelId: this.modelId,
    //     timestamp: currentDate,
    //     headers: responseHeaders,
    //   },
    // };
  }

  private async pollForImageUrl(
    generationId: string,
    headers: Record<string, string | undefined>,
    abortSignal: AbortSignal | undefined,
  ): Promise<string> {
    let attemptCount = 0;
    const url = this.getFluxGenerationsUrl(generationId);
    for (let i = 0; i < this.maxPollAttempts; i++) {
      const { value: statusResponse } = await getFromApi({
        url,
        headers,
        abortSignal,
        fetch: this.config.fetch,
        failedResponseHandler: this.createFluxErrorHandler(),
        successfulResponseHandler: createJsonResponseHandler(
          FluxGenerationResponseSchema,
        ),
      });

      switch (statusResponse.state) {
        case 'completed':
          if (!statusResponse.assets?.image) {
            throw new InvalidResponseDataError({
              data: statusResponse,
              message: `Image generation completed but no image was found.`,
            });
          }
          return statusResponse.assets.image;
        case 'failed':
          throw new InvalidResponseDataError({
            data: statusResponse,
            message: `Image generation failed.`,
          });
      }
      await delay(this.pollIntervalMillis);
    }

    throw new Error(
      `Image generation timed out after ${this.maxPollAttempts} attempts.`,
    );
  }

  private createFluxErrorHandler() {
    return createJsonErrorResponseHandler({
      errorSchema: FluxErrorSchema,
      errorToMessage: (error: FluxErrorData) =>
        error.detail[0].msg ?? 'Unknown error',
    });
  }

  private getFluxGenerationsUrl(generationId?: string) {
    return `${this.config.baseURL}`;
  }

  private async downloadImage(
    url: string,
    abortSignal: AbortSignal | undefined,
  ): Promise<Uint8Array> {
    const { value: response } = await getFromApi({
      url,
      // No specific headers should be needed for this request as it's a
      // generated image provided by Flux.
      abortSignal,
      failedResponseHandler: createStatusCodeErrorResponseHandler(),
      successfulResponseHandler: createBinaryResponseHandler(),
      fetch: this.config.fetch,
    });
    return response;
  }
}

// limited version of the schema, focussed on what is needed for the implementation
// this approach limits breakages when the API changes and increases efficiency
const FluxGenerationResponseSchema = z.object({
  id: z.string(),
  state: z.enum(['queued', 'dreaming', 'completed', 'failed']),
  failure_reason: z.string().nullish(),
  assets: z
    .object({
      image: z.string(), // URL of the generated image
    })
    .nullish(),
});

const FluxErrorSchema = z.object({
  detail: z.array(
    z.object({
      type: z.string(),
      loc: z.array(z.string()),
      msg: z.string(),
      input: z.string(),
      ctx: z
        .object({
          expected: z.string(),
        })
        .nullish(),
    }),
  ),
});

export type FluxErrorData = z.infer<typeof FluxErrorSchema>;
