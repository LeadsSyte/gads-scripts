// Anthropic client contract tests. Pins:
//   • non-streaming claudeComplete returns concatenated text from content blocks
//   • non-streaming surfaces HTTP errors with status + body
//   • missing API key throws an actionable error before fetch is called
//   • streaming claudeStream yields onDelta calls + final text
//   • extractJSON tolerates code fences, plain JSON, and surrounding prose
//
// Run: npm test  (from syte-seo-suite/)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/lib/anthropic.js'), 'utf8');

// Patch the auth import — anthropic.js calls getStoredApiKey() inside
// headers(). We control it via a global so tests can swap it.
globalThis.__mockApiKey = null;
const PATCHED = SRC
  .replace(
    "import { getStoredApiKey } from './auth.js';",
    "const getStoredApiKey = () => globalThis.__mockApiKey;"
  );

const tmp = path.join(os.tmpdir(), 'anthropic-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let fetchCalls = [];
let fetchHandler = () => { throw new Error('fetch not configured'); };
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  return fetchHandler(String(url), init);
};

let pass = 0, fail = 0;
async function t(name, fn) {
  fetchCalls = [];
  globalThis.__mockApiKey = 'sk-test';
  fetchHandler = () => { throw new Error('fetch not configured for ' + name); };
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function match(s, re, label) {
  if (!re.test(s || '')) throw new Error((label || '') + ' "' + s + '" did not match ' + re);
}
async function expectThrow(fn, regex, label) {
  try { await fn(); }
  catch (e) {
    if (regex && !regex.test(e.message)) throw new Error((label || '') + ' wrong error: ' + e.message);
    return;
  }
  throw new Error((label || '') + ' expected throw, did not throw');
}
function jsonRes(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj)
  };
}

// ============================================================================
// claudeComplete
// ============================================================================
await t('claudeComplete: missing API key throws BEFORE fetch is called', async () => {
  globalThis.__mockApiKey = null;
  await expectThrow(
    () => mod.claudeComplete({ system: 's', messages: [{ role: 'user', content: 'hi' }] }),
    /API key not unlocked/i
  );
  eq(fetchCalls.length, 0, 'fetch never called');
});

await t('claudeComplete: returns concatenated text from content blocks', async () => {
  fetchHandler = () => jsonRes({
    content: [
      { type: 'text', text: 'First part. ' },
      { type: 'text', text: 'Second part.' }
    ]
  });
  const out = await mod.claudeComplete({ system: 's', messages: [{ role: 'user', content: 'q' }] });
  eq(out, 'First part. Second part.');
});

await t('claudeComplete: sends correct headers + body', async () => {
  fetchHandler = () => jsonRes({ content: [{ type: 'text', text: 'ok' }] });
  await mod.claudeComplete({ system: 'sys', messages: [{ role: 'user', content: 'q' }], max_tokens: 1234, temperature: 0.5 });
  eq(fetchCalls.length, 1);
  const call = fetchCalls[0];
  eq(call.url, 'https://api.anthropic.com/v1/messages');
  eq(call.init.method, 'POST');
  eq(call.init.headers['x-api-key'], 'sk-test');
  eq(call.init.headers['anthropic-version'], '2023-06-01');
  // Direct-from-browser access header — required to call from a page.
  eq(call.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  const body = JSON.parse(call.init.body);
  eq(body.system, 'sys');
  eq(body.max_tokens, 1234);
  eq(body.temperature, 0.5);
  eq(body.messages[0].content, 'q');
  // Default model is the constant.
  eq(body.model, mod.CLAUDE_MODEL);
});

await t('claudeComplete: 4xx surfaces status + body in the error', async () => {
  fetchHandler = () => ({
    ok: false, status: 401,
    text: async () => 'invalid api key',
    json: async () => ({})
  });
  await expectThrow(
    () => mod.claudeComplete({ system: 's', messages: [{ role: 'user', content: 'q' }] }),
    /Claude API error: 401.*invalid api key/
  );
});

await t('claudeComplete: empty content array returns empty string (not undefined)', async () => {
  fetchHandler = () => jsonRes({ content: [] });
  const out = await mod.claudeComplete({ system: 's', messages: [{ role: 'user', content: 'q' }] });
  eq(out, '');
});

await t('claudeComplete: skips non-text blocks gracefully', async () => {
  fetchHandler = () => jsonRes({
    content: [
      { type: 'tool_use', id: 'x' },
      { type: 'text', text: 'hello' }
    ]
  });
  const out = await mod.claudeComplete({ system: 's', messages: [{ role: 'user', content: 'q' }] });
  eq(out, 'hello');
});

// ============================================================================
// claudeStream
// ============================================================================
function makeSseStream(events) {
  const encoder = new TextEncoder();
  const lines = events.map(e => 'data: ' + JSON.stringify(e)).join('\n\n') + '\n\n';
  let chunks = [encoder.encode(lines)];
  return {
    getReader() {
      return {
        async read() {
          if (chunks.length === 0) return { done: true, value: undefined };
          return { done: false, value: chunks.shift() };
        }
      };
    }
  };
}

await t('claudeStream: missing API key throws before fetch', async () => {
  globalThis.__mockApiKey = null;
  await expectThrow(
    () => mod.claudeStream({ system: 's', messages: [{ role: 'user', content: 'q' }] }),
    /API key not unlocked/i
  );
  eq(fetchCalls.length, 0);
});

await t('claudeStream: yields onDelta calls + returns full text', async () => {
  const events = [
    { type: 'content_block_delta', delta: { text: 'Hello ' } },
    { type: 'content_block_delta', delta: { text: 'world.' } },
    { type: 'message_stop' }
  ];
  fetchHandler = () => ({
    ok: true,
    status: 200,
    body: makeSseStream(events),
    text: async () => ''
  });
  const deltas = [];
  const full = await mod.claudeStream({
    system: 's',
    messages: [{ role: 'user', content: 'q' }],
    onDelta: (t) => deltas.push(t)
  });
  eq(full, 'Hello world.', 'full text concatenated');
  eq(deltas.length, 2, 'two delta callbacks');
  eq(deltas[0], 'Hello ');
});

await t('claudeStream: streams body=true in request payload', async () => {
  fetchHandler = () => ({ ok: true, body: makeSseStream([{ type: 'message_stop' }]), text: async () => '' });
  await mod.claudeStream({ system: 's', messages: [{ role: 'user', content: 'q' }] });
  const body = JSON.parse(fetchCalls[0].init.body);
  eq(body.stream, true);
});

await t('claudeStream: 5xx error surfaces status', async () => {
  fetchHandler = () => ({ ok: false, status: 503, body: null, text: async () => 'overloaded' });
  await expectThrow(
    () => mod.claudeStream({ system: 's', messages: [{ role: 'user', content: 'q' }] }),
    /Claude stream error: 503/
  );
});

await t('claudeStream: malformed SSE lines are skipped, valid ones still process', async () => {
  // The real Claude SSE stream interleaves several event types. Anything
  // we can't parse should be ignored without crashing the whole call.
  const encoder = new TextEncoder();
  const blob =
    'data: not-json\n\n' +
    'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { text: 'A' } }) + '\n\n' +
    'event: ping\n\n' +  // non-data line
    'data: [DONE]\n\n';
  const chunks = [encoder.encode(blob)];
  fetchHandler = () => ({
    ok: true,
    body: { getReader() {
      return { async read() { if (!chunks.length) return { done: true }; return { done: false, value: chunks.shift() }; } };
    }},
    text: async () => ''
  });
  const out = await mod.claudeStream({ system: 's', messages: [{ role: 'user', content: 'q' }] });
  eq(out, 'A');
});

// ============================================================================
// extractJSON — used everywhere we parse Claude's JSON output
// ============================================================================
await t('extractJSON: empty + null inputs return null (not throw)', () => {
  eq(mod.extractJSON(null), null);
  eq(mod.extractJSON(''), null);
  eq(mod.extractJSON(undefined), null);
});

await t('extractJSON: parses fenced ```json block', () => {
  const obj = mod.extractJSON('preamble\n```json\n{"a": 1, "b": "x"}\n```\nepilogue');
  eq(obj.a, 1);
  eq(obj.b, 'x');
});

await t('extractJSON: parses fenced plain ``` block', () => {
  const obj = mod.extractJSON('```\n{"a": 1}\n```');
  eq(obj.a, 1);
});

await t('extractJSON: pulls JSON from prose without fences', () => {
  const obj = mod.extractJSON('Here is the JSON: {"score": 9, "ok": true}. End of message.');
  eq(obj.score, 9);
  eq(obj.ok, true);
});

await t('extractJSON: returns null when no { } found', () => {
  eq(mod.extractJSON('plain text no json'), null);
});

await t('extractJSON: returns null for malformed JSON (does NOT throw)', () => {
  eq(mod.extractJSON('{"unclosed: 1'), null);
  eq(mod.extractJSON('```json\n{not even json}\n```'), null);
});

await t('extractJSON: handles nested objects', () => {
  const obj = mod.extractJSON('{"outer": {"inner": [1, 2, 3]}}');
  eq(obj.outer.inner[2], 3);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
