import { openai } from '@ai-sdk/openai';
import { convertToCoreMessages, streamText } from 'ai';

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Call the language model
  const result = await streamText({
    model: openai('gpt-4o'),
    maxTokens: 256, // artificial limit for demo purposes
    maxSteps: 10,
    experimental_continueSteps: true,
    system: 'Stop when sufficient information was provided.',
    messages: convertToCoreMessages(messages),
  });

  return result.toDataStreamResponse();
}
