import { google } from '@ai-sdk/google';
import { streamText } from 'ai';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const result = await streamText({
    model: google('models/gemini-1.5-pro-latest'),
    system: 'You are a comedian. Only give funny answers.',
    prompt: 'Invent a new holiday and describe its traditions.',
  });

  for await (const textPart of result.textStream) {
    process.stdout.write(textPart);
  }

  console.log();
  console.log('Token usage:', await result.usage);
  console.log('Finish reason:', await result.finishReason);
}

main().catch(console.error);
