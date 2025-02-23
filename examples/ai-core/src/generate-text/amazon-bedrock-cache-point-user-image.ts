import { bedrock } from '@ai-sdk/amazon-bedrock';
import { generateText } from 'ai';
import 'dotenv/config';
import fs from 'node:fs';

async function main() {
  const result = await generateText({
    model: bedrock('anthropic.claude-3-5-sonnet-20241022-v2:0'),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', image: fs.readFileSync('./data/comic-cat.png') },
          {
            type: 'text',
            text: 'What is in this image?',
          },
        ],
        providerOptions: { bedrock: { cachePoint: { type: 'default' } } },
      },
    ],
  });

  console.log(result.text);
  console.log();
  console.log('Token usage:', result.usage);
  // TODO: no cache token usage for some reason
  // https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
  // the only delta is some of the lead-in to passing the message bytes, and
  // perhaps the size of the image.
  console.log('Cache token usage:', result.providerMetadata?.bedrock?.usage);
  console.log('Finish reason:', result.finishReason);
  console.log('Response headers:', result.response.headers);
}

main().catch(console.error);
