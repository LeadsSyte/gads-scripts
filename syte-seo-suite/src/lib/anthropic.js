import { claudeRequest } from './claudeTransport.js';

export const CLAUDE_MODEL = 'claude-sonnet-4-6';

// Generation calls (Alice email, microsite JSON, QA, census extraction) can
// legitimately take a while, but a stalled connection must not hang the
// report pipeline. The limit is on silence, not on total time: the request
// is aborted when no bytes have arrived for this long.
const IDLE_TIMEOUT_MS = 90000;

// Requests go through the suite's anthropic-proxy (claudeTransport.js), so
// the provider key stays on the server.
//
// Every call streams, including claudeComplete. Netlify cuts a function
// response that sends nothing for ~30s ("504 Inactivity Timeout"), and a
// non-streamed answer sends nothing until the model has finished — so a big
// payload (Cuddledown's AEO report: 351 probes) failed on the microsite JSON
// step. Streaming keeps bytes flowing, so the length of the answer no longer
// matters to the proxy.

// Overloaded / rate-limited / gateway failures before any text arrived are
// worth one more go; anything else (bad request, auth) is not.
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
const RETRY_DELAY_MS = 4000;

// Turn an error body into one readable line: Anthropic's JSON message when
// there is one, otherwise the HTML/text stripped of tags (Netlify's timeout
// page used to land in the UI as raw <HTML><HEAD>…).
export function describeError(status, txt) {
  const raw = String(txt || '');
  try {
    const j = JSON.parse(raw);
    const msg = j?.error?.message || (typeof j?.error === 'string' ? j.error : '') || j?.message;
    if (msg) return status + ' ' + msg;
  } catch {}
  if (/inactivity timeout/i.test(raw)) {
    return status + ' the request timed out at the proxy (no data for too long). Try again; if it keeps happening the payload is too large.';
  }
  const plain = raw.replace(/<title>[\s\S]*?<\/title>/i, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return status + (plain ? ' ' + plain.slice(0, 300) : '');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// One streamed request. Calls onDelta(text) per chunk; returns the full text.
// Throws an Error with .status and .retryable set.
async function streamOnce({ body, onDelta, idleMs, label }) {
  const controller = new AbortController();
  let timer;
  let timedOut = false;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, idleMs);
  };
  const fetchImpl = (url, init) => fetch(url, { ...init, signal: controller.signal });
  let full = '';
  try {
    arm();
    const res = await claudeRequest({ ...body, stream: true }, fetchImpl);
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '');
      const err = new Error(label + ': ' + describeError(res.status, txt));
      err.status = res.status;
      err.retryable = RETRYABLE.has(res.status);
      throw err;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      arm();
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }
        if (evt.type === 'content_block_delta' && evt.delta?.text) {
          full += evt.delta.text;
          onDelta?.(evt.delta.text);
        } else if (evt.type === 'error') {
          // Mid-stream failure (e.g. overloaded_error). Retry only if
          // nothing has been emitted yet, so a caller never sees text twice.
          const err = new Error(label + ': ' + (evt.error?.type || 'error') + ' ' + (evt.error?.message || ''));
          err.retryable = !full && /overloaded|rate_limit|api_error/.test(String(evt.error?.type || ''));
          throw err;
        }
      }
    }
    return full;
  } catch (e) {
    if (timedOut || e.name === 'AbortError') {
      const err = new Error(label + ': no data from Claude for ' + Math.round(idleMs / 1000) + 's — the request was abandoned.');
      err.retryable = !full;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function streamWithRetry(opts) {
  try {
    return await streamOnce(opts);
  } catch (e) {
    if (!e.retryable) throw e;
    console.warn('[Claude] ' + e.message + ' — retrying once.');
    await sleep(RETRY_DELAY_MS);
    return streamOnce(opts);
  }
}

// Single-shot call. Returns plain text. (Streams under the hood — see above.)
export async function claudeComplete({ system, messages, max_tokens = 4096, temperature = 0.7, model = CLAUDE_MODEL }) {
  return streamWithRetry({
    body: { model, max_tokens, temperature, system, messages },
    idleMs: IDLE_TIMEOUT_MS, label: 'Claude API error'
  });
}

// Streaming. Calls onDelta(text) for each token chunk. Returns full text.
export async function claudeStream({ system, messages, max_tokens = 4096, temperature = 0.7, model = CLAUDE_MODEL, onDelta }) {
  return streamWithRetry({
    body: { model, max_tokens, temperature, system, messages },
    onDelta, idleMs: IDLE_TIMEOUT_MS, label: 'Claude stream error'
  });
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
