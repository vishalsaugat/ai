import { LanguageModelV1FinishReason } from '@ai-sdk/provider';
import { FinishReason } from '@google-cloud/vertexai';

export function mapGoogleVertexFinishReason({
  finishReason,
  hasToolCalls,
}: {
  finishReason: FinishReason | undefined;
  hasToolCalls: boolean;
}): LanguageModelV1FinishReason {
  switch (finishReason) {
    case 'STOP':
      return hasToolCalls ? 'tool-calls' : 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
    case 'RECITATION':
    case 'SAFETY':
      return 'content-filter';
    case 'FINISH_REASON_UNSPECIFIED':
    case 'OTHER':
      return 'other';
    default:
      return 'unknown';
  }
}
