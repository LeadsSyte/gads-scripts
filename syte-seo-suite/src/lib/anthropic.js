import { getStoredApiKey } from './auth.js';
import { fetchWithTimeout } from './http.js';

export const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const API_URL = 'https://api.anthropic.com/v1/messages';

// Non-streaming generation (Alice email, microsite JSON, QA) can legitimately
// take a while, but a stalled connection must not hang the report pipeline.
// Cap each call so a dead socket rejects instead of freezing on "Working…".
const COMPLETE_TIMEOUT_MS = 90000;

function headers() {
  const key = getStoredApiKey();
  if (!key) throw new Error('API key not unlocked. Refresh and enter password.');
  return {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
    'x-api-key': key
  };
}

// Non-streaming single-shot call. Returns plain text.
export async function claudeComplete({ system, messages, max_tokens = 4096, temperature = 0.7, model = CLAUDE_MODEL }) {
  const res = await fetchWithTimeout(API_URL, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ model, max_tokens, temperature, system, messages })
  }, COMPLETE_TIMEOUT_MS);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('Claude API error: ' + res.status + ' ' + txt);
  }
  const data = await res.json();
  return (data.content || []).map(b => b.text || '').join('');
}

// Streaming. Calls onDelta(text) for each token chunk. Returns full text.
export async function claudeStream({ system, messages, max_tokens = 4096, temperature = 0.7, model = CLAUDE_MODEL, onDelta }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ model, max_tokens, temperature, system, messages, stream: true })
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    throw new Error('Claude stream error: ' + res.status + ' ' + txt);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
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
          onDelta?.(evt.delta.text);
        }
      } catch {}
    }
  }
  return full;
}

// Try to extract JSON from model output (tolerates code fences).
export function extractJSON(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
