import { bedrock } from '@ai-sdk/amazon-bedrock';
import { generateText } from 'ai';
import 'dotenv/config';
import fs from 'node:fs';

const errorMessage = fs.readFileSync('data/error-message.txt', 'utf8');

async function main() {
  const result = await generateText({
    model: bedrock('anthropic.claude-3-5-sonnet-20241022-v2:0'),
    messages: [
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'You are a JavaScript expert.',
          },
          {
            type: 'text',
            text: `Error message: ${errorMessage}`,
          },
        ],
        providerOptions: { bedrock: { cachePoint: { type: 'default' } } },
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Explain the error message.',
          },
        ],
      },
    ],
  });

  console.log(result.text);
  console.log();
  console.log('Token usage:', result.usage);
  console.log('Cache token usage:', result.providerMetadata?.bedrock?.usage);
  console.log('Finish reason:', result.finishReason);
  console.log('Response headers:', result.response.headers);
}

main().catch(console.error);
