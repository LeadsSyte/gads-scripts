import { getStoredApiKey } from './auth.js';
import { fetchWithTimeout } from './http.js';

export const CLAUDE_MODEL = 'claude-sonnet-4-6';
const API_URL = 'https://api.anthropic.com/v1/messages';

// Non-streaming generation (Alice email, microsite JSON, QA) can legitimately
// take a while, but a stalled connection must not hang the report pipeline.
// Cap each call so a dead socket rejects instead of freezing on "Working…".
const COMPLETE_TIMEOUT_MS = 90000;

// Transient API conditions worth retrying. 529 = Anthropic "Overloaded"
// (their servers are momentarily saturated); 429 = rate limit; 5xx = gateway
// blips. These clear on their own, so we back off and try again rather than
// aborting the whole report. A 4xx that isn't 429 is a real client error and
// is surfaced immediately.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

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

// Non-streaming single-shot call. Returns plain text. Retries transient
// overload/rate-limit/gateway errors with exponential backoff so a brief
// "Overloaded" (529) doesn't kill report generation.
export async function claudeComplete({ system, messages, max_tokens = 4096, temperature = 0.7, model = CLAUDE_MODEL, onRetry }) {
  const body = JSON.stringify({ model, max_tokens, temperature, system, messages });
  let lastErr = '';

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(API_URL, { method: 'POST', headers: headers(), body }, COMPLETE_TIMEOUT_MS);
    } catch (e) {
      // Network error or timeout — treat as transient and retry.
      lastErr = e.message;
      if (attempt < RETRY_DELAYS_MS.length) {
        onRetry?.({ attempt: attempt + 1, status: null, error: lastErr });
        await wait(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw e;
    }

    if (res.ok) {
      const data = await res.json();
      return (data.content || []).map(b => b.text || '').join('');
    }

    const txt = await res.text().catch(() => '');
    lastErr = 'Claude API error: ' + res.status + ' ' + txt;
    if (RETRYABLE_STATUS.has(res.status) && attempt < RETRY_DELAYS_MS.length) {
      onRetry?.({ attempt: attempt + 1, status: res.status, error: lastErr });
      await wait(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    throw new Error(lastErr);
  }

  throw new Error(lastErr || 'Claude API: retries exhausted');
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
// Lenient JSON extractor — tries to recover from common things Claude
// does despite "JSON-only" instructions: code fences, prose preamble,
// trailing commas, smart quotes, and truncated-mid-object output (when
// max_tokens runs out). Returns null only if nothing salvageable.
export function extractJSON(text) {
  if (!text) return null;

  // Strategy 1: pull out a fenced ```json block if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let candidate = fence ? fence[1] : text;

  // Strategy 2: trim to the outermost {...}. Use lastIndexOf('}') so a
  // truncated object missing its closing brace falls through to repair.
  const start = candidate.indexOf('{');
  let end = candidate.lastIndexOf('}');
  if (start === -1) return null;
  if (end > start) candidate = candidate.slice(start, end + 1);
  else candidate = candidate.slice(start); // truncated, no closing brace

  // Strategy 3: try plain JSON.parse first (the happy path).
  const parsed = tryParse(candidate);
  if (parsed) return parsed;

  // Strategy 4: clean up common Claude foibles and try again.
  let repaired = candidate
    // Smart quotes from prose-mode → straight quotes.
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // Trailing commas before } or ] (common in hand-written JSON).
    .replace(/,(\s*[}\]])/g, '$1');
  const re = tryParse(repaired);
  if (re) return re;

  // Strategy 5: truncated output. Walk back to the last valid balance
  // point — drop incomplete trailing fields and close open braces.
  // We try this even when the string ends with } because the truncation
  // could be inside a nested array/object (so the outer brace closed
  // but an inner one didn't).
  const balanced = balanceJson(repaired);
  const re2 = tryParse(balanced);
  if (re2) return re2;

  return null;
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// Best-effort recovery of a truncated JSON object. Walks the string,
// tracks depth + which characters mark the END of a complete value
// (`}` `]` close-quote close-number-or-bool). Trims back to the last
// such position, then closes any still-open braces/brackets so the
// result parses.
function balanceJson(s) {
  // Pass 1: find the last position in the string AT WHICH we had just
  // finished a complete value AND were therefore at a clean boundary
  // (no field key half-typed, no string mid-flight). We snapshot the
  // depth + brackDepth at that point so pass 2 can close them out.
  let depth = 0, brackDepth = 0, inStr = false, esc = false;
  let safeIdx = -1, safeDepth = 0, safeBrack = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') {
      inStr = !inStr;
      // If we just CLOSED a string, that's a clean value boundary
      // (only inside objects/arrays — bare strings handled by happy
      // path).
      if (!inStr && (depth > 0 || brackDepth > 0)) {
        safeIdx = i; safeDepth = depth; safeBrack = brackDepth;
      }
      continue;
    }
    if (inStr) continue;
    if (c === '{') { depth++; }
    else if (c === '}') {
      depth--;
      safeIdx = i; safeDepth = depth; safeBrack = brackDepth;
    } else if (c === '[') { brackDepth++; }
    else if (c === ']') {
      brackDepth--;
      safeIdx = i; safeDepth = depth; safeBrack = brackDepth;
    } else if (/[0-9truefalsn]/.test(c) && (depth > 0 || brackDepth > 0)) {
      // crude: mark numbers/true/false/null endings as potential safe
      // boundaries; if the next non-space char is `,` `}` `]` we'll
      // snap there too.
      const next = s[i + 1];
      if (next === ',' || next === '}' || next === ']' || next === ' ' || next === '\n') {
        safeIdx = i; safeDepth = depth; safeBrack = brackDepth;
      }
    }
  }
  if (safeIdx === -1) return s;

  // Pass 2: take the prefix up to and including the safe boundary,
  // then close out the still-open brackets/braces (outermost last).
  let trimmed = s.slice(0, safeIdx + 1);
  while (safeBrack-- > 0) trimmed += ']';
  while (safeDepth-- > 0) trimmed += '}';
  return trimmed;
}
