import { createOpenAI } from '@ai-sdk/openai';
import { StreamData, streamText } from 'ai';

import { env } from '$env/dynamic/private';
// You may want to replace the above with a static private env variable
// for dead-code elimination and build-time type-checking:
// import { OPENAI_API_KEY } from '$env/static/private'

import type { RequestHandler } from './$types';

// Create an OpenAI Provider instance
const openai = createOpenAI({
  apiKey: env.OPENAI_API_KEY ?? '',
});

export const POST = (async ({ request }) => {
  // Extract the `prompt` from the body of the request
  const { prompt } = await request.json();

  // optional: use stream data
  const data = new StreamData();
  data.append({ test: 'value' });

  // Ask OpenAI for a streaming chat completion given the prompt
  const result = await streamText({
    model: openai('gpt-4-turbo-preview'),
    prompt,
    onFinish() {
      data.close();
    },
  });

  // Respond with the stream
  return result.toDataStreamResponse({ data });
}) satisfies RequestHandler;
