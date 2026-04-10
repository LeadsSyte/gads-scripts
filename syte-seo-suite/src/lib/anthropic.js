// Direct browser calls to the Anthropic API.
// The API key is pulled from sessionStorage (set by the LockScreen).

import { getStoredApiKey } from './auth.js';

export const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const API_URL = 'https://api.anthropic.com/v1/messages';

function buildHeaders() {
  const key = getStoredApiKey();
  if (!key) throw new Error('API key not unlocked');
  return {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

/**
 * Single-shot (non-streaming) completion.
 */
export async function claudeComplete({
  system,
  messages,
  max_tokens = 4096,
  temperature = 0.7,
  model = CLAUDE_MODEL,
}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      model,
      max_tokens,
      temperature,
      system,
      messages,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Claude API error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const text = data.content?.map((c) => c.text || '').join('') || '';
  return { text, raw: data };
}

/**
 * Streaming completion via SSE. Calls onDelta(chunk) as text arrives,
 * and resolves with the full concatenated text.
 */
export async function claudeStream({
  system,
  messages,
  max_tokens = 4096,
  temperature = 0.7,
  model = CLAUDE_MODEL,
  onDelta = () => {},
}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      model,
      max_tokens,
      temperature,
      system,
      messages,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Claude stream error ${res.status}: ${txt}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === 'content_block_delta' && evt.delta?.text) {
          full += evt.delta.text;
          onDelta(evt.delta.text);
        }
      } catch {
        /* ignore */
      }
    }
  }
  return full;
}
