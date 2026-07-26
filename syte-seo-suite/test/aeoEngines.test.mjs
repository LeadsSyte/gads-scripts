// Unit test for fetchJsonWithRetry — the transient-error retry wrapper the
// AEO engine callers (ChatGPT / Claude / Perplexity) use. This is the fix
// for the "1 of 24 probes failed" flake: a single 504 gateway timeout or
// 429 rate-limit used to fail its whole iteration with no retry.
//
// aeoEngines.js pulls in browser-only modules (settings/auth/http), so we
// load it the same way aeoRunner.test.mjs does: read the source, swap the
// imports for stubs, neutralise the backoff delays, and export the helper.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/reports/aeoEngines.js'), 'utf8');

const PATCHED = SRC
  .replace("import { loadSettings } from '../../lib/settings.js';", 'const loadSettings = () => ({});')
  .replace("import { getStoredApiKey } from '../../lib/auth.js';", 'const getStoredApiKey = () => null;')
  .replace("import { fetchWithTimeout } from '../../lib/http.js';",
           'const fetchWithTimeout = (...a) => globalThis.__fetchWithTimeout(...a);')
  // Make backoff instant so the retries-exhausted path doesn't take 7s.
  .replace('const RETRY_DELAYS_MS = [1000, 2000, 4000];', 'const RETRY_DELAYS_MS = [0, 0, 0];')
  // engineReadiness + CORE_ENGINE_IDS are already exported by the source;
  // only fetchJsonWithRetry is internal and needs re-exporting for the test.
  + '\nexport { fetchJsonWithRetry };\n';

const tmp = path.join(os.tmpdir(), 'aeoEngines-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

// Build a stub fetchWithTimeout that returns queued responses in order. Each
// entry is either a status number (→ a Response-like object) or an Error to
// throw (→ a network/timeout failure). Records the call count.
function stubResponses(entries) {
  let i = 0;
  const calls = { n: 0 };
  globalThis.__fetchWithTimeout = async () => {
    calls.n++;
    const entry = entries[Math.min(i, entries.length - 1)];
    i++;
    if (entry instanceof Error) throw entry;
    return { ok: entry >= 200 && entry < 300, status: entry, text: async () => 'body-' + entry };
  };
  return calls;
}

// ============================================================================
await t('returns immediately on first-try success (no retry)', async () => {
  const calls = stubResponses([200]);
  const res = await mod.fetchJsonWithRetry('u', {});
  assertEq(res.status, 200, 'status');
  assertEq(calls.n, 1, 'called once');
});

await t('non-retryable 4xx returns immediately without retrying', async () => {
  const calls = stubResponses([400, 200]);
  const res = await mod.fetchJsonWithRetry('u', {});
  assertEq(res.status, 400, 'status (no retry to the 200)');
  assertEq(calls.n, 1, 'called once');
});

await t('retries a transient 503 then succeeds', async () => {
  const calls = stubResponses([503, 200]);
  const res = await mod.fetchJsonWithRetry('u', {});
  assertEq(res.status, 200, 'recovered');
  assertEq(calls.n, 2, 'called twice');
});

await t('504 gateway timeout is retried (the ChatGPT flake)', async () => {
  const calls = stubResponses([504, 504, 200]);
  const res = await mod.fetchJsonWithRetry('u', {});
  assertEq(res.status, 200, 'recovered on third attempt');
  assertEq(calls.n, 3, 'called three times');
});

await t('exhausted retries return the last transient Response (body readable)', async () => {
  const calls = stubResponses([504, 504, 504, 504]);
  const res = await mod.fetchJsonWithRetry('u', {});
  assertEq(res.status, 504, 'final 504 surfaced');
  assertEq(calls.n, 4, '1 initial + 3 retries');
  assertEq(await res.text(), 'body-504', 'body still readable for the error message');
});

await t('network/timeout error is retried then recovers', async () => {
  const calls = stubResponses([new Error('Request timed out after 45s'), 200]);
  const res = await mod.fetchJsonWithRetry('u', {});
  assertEq(res.status, 200, 'recovered after a throw');
  assertEq(calls.n, 2, 'called twice');
});

await t('all attempts throw → rejects with the last error', async () => {
  stubResponses([new Error('boom'), new Error('boom'), new Error('boom'), new Error('boom')]);
  let threw = false;
  try { await mod.fetchJsonWithRetry('u', {}); }
  catch (e) { threw = /boom/.test(e.message); }
  assertEq(threw, true, 'threw the network error');
});

await t('CORE_ENGINE_IDS covers claude/chatgpt/gemini', async () => {
  assertEq([...mod.CORE_ENGINE_IDS].sort().join(','), 'chatgpt,claude,gemini', 'core ids');
});

await t('engineReadiness reports one entry per engine with a ready flag', async () => {
  const r = mod.engineReadiness();
  assertEq(r.length, 4, 'four engines');
  // loadSettings/getStoredApiKey are stubbed empty here, so nothing is ready.
  assertEq(r.every(e => e.ready === false), true, 'all not ready with no keys');
  assertEq(r.every(e => typeof e.label === 'string' && !!e.id), true, 'shape');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
