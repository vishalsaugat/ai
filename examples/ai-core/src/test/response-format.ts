import { openai } from '@ai-sdk/openai';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const result = await openai('gpt-4-turbo').doStream({
    mode: { type: 'regular' },
    inputFormat: 'prompt',
    responseFormat: {
      type: 'json',
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
    },
    temperature: 0,
    prompt: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Invent a new holiday and describe its traditions. Output as JSON object.',
          },
        ],
      },
    ],
  });

  const reader = result.stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (value.type === 'text-delta') {
      process.stdout.write(value.textDelta);
    }
  }
}

main().catch(console.error);
