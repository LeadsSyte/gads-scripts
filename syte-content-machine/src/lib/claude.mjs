import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-20250514';

/**
 * Create an Anthropic client with the given API key.
 */
function getClient(apiKey) {
  return new Anthropic({ apiKey });
}

/**
 * Call Claude API for topic discovery. Returns parsed JSON array of topics.
 */
export async function discoverTopics(apiKey, prompt) {
  const client = getClient(apiKey);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  // Parse JSON from the response — handle possible markdown fences
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  try {
    const topics = JSON.parse(cleaned);
    if (!Array.isArray(topics)) throw new Error('Expected array');
    return topics;
  } catch (err) {
    throw new Error(`Failed to parse topics JSON: ${err.message}\nRaw response: ${text.slice(0, 500)}`);
  }
}

/**
 * Call Claude API to write a single article. Returns the full article text.
 * Uses streaming for real-time progress.
 */
export async function writeArticle(apiKey, systemPrompt, articlePrompt, onChunk) {
  const client = getClient(apiKey);

  let fullText = '';

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: articlePrompt }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      fullText += event.delta.text;
      if (onChunk) onChunk(event.delta.text);
    }
  }

  return fullText;
}

/**
 * Non-streaming article write (for background functions).
 */
export async function writeArticleSync(apiKey, systemPrompt, articlePrompt) {
  const client = getClient(apiKey);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: articlePrompt }],
  });

  return response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
}
