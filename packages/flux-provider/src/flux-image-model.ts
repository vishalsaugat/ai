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
// @ts-ignore-next-line
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

    return {
      warnings: [],
      response: {
        modelId: this.modelId,
        timestamp: currentDate,
        headers: {},
      },
      images: urls.map((url: string) => url.replace('storage.googleapis.com/survo-chat-images', 'images.survo.co')),
    };
  }

  private getFluxGenerationsUrl(generationId?: string) {
    return `${this.config.baseURL}`;
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
