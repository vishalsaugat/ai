// https://Flux.ai/models?type=image
export type FluxImageModelId = 'photon-1' | 'photon-flash-1' | (string & {});

/**
Configuration settings for Flux image generation.

Since the Flux API processes images through an asynchronous queue system, these
settings allow you to tune the polling behavior when waiting for image
generation to complete.
 */
export interface FluxImageSettings {
  /**
Override the maximum number of images per call (default 1)
   */
  maxImagesPerCall?: number;

  /**
Override the polling interval in milliseconds (default 500). This controls how
frequently the API is checked for completed images while they are being
processed in Flux's queue.
   */
  pollIntervalMillis?: number;

  /**
Override the maximum number of polling attempts (default 120). Since image
generation is queued and processed asynchronously, this limits how long to wait
for results before timing out.
   */
  maxPollAttempts?: number;
}
