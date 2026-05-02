// generateHeroImage routing — when the user explicitly picks a provider,
// the function must NOT silently fall back to the other one (which is the
// bug that produced the misleading "Imagen 3 not available" message after
// the user had selected DALL-E).
//
// Run: npm test  (from syte-seo-suite/)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/content/imageGen.js'), 'utf8');

// Patch: replace the settings import with a global stub.
globalThis.__settings = {};
const PATCHED = SRC
  .replace("import { loadSettings } from '../../lib/settings.js';",
           "const loadSettings = () => globalThis.__settings;");

const tmp = path.join(os.tmpdir(), 'imageGen-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let fetchCalls = [];
let fetchHandler;
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), body: init?.body });
  return fetchHandler(String(url), init);
};

let pass = 0, fail = 0;
async function t(name, fn) {
  fetchCalls = [];
  globalThis.__settings = {};
  fetchHandler = () => { throw new Error('fetch not configured for ' + name); };
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function assertMatch(s, re, label) {
  if (!re.test(s || '')) throw new Error((label || '') + ' "' + s + '" did not match ' + re);
}
async function expectThrow(fn, regex, label) {
  try { await fn(); }
  catch (e) {
    if (!regex.test(e.message)) throw new Error((label || '') + ' wrong error: ' + e.message);
    return;
  }
  throw new Error((label || '') + ' expected throw, did not throw');
}

const CLIENT = { name: 'Test', industry: 'Hospitality', location: 'Cape Town' };

// ============================================================================
// Provider availability
// ============================================================================
await t('throws if no API keys at all', async () => {
  await expectThrow(
    () => mod.generateHeroImage('Title', 'kw', CLIENT, { preferredProvider: 'dalle' }),
    /No image generation API key configured/,
    'no keys'
  );
});

await t('chosen provider with no key surfaces a clear error (not a silent fallback)', async () => {
  globalThis.__settings = { googleAiKey: 'g' }; // imagen available, dalle is not
  await expectThrow(
    () => mod.generateHeroImage('Title', 'kw', CLIENT, { preferredProvider: 'dalle' }),
    /DALL-E 3 selected but no API key/,
    'dalle picked, no openai key'
  );
});

// ============================================================================
// REGRESSION: explicit DALL-E pick must NOT fall back to Imagen
// ============================================================================
await t('explicit DALL-E pick — DALL-E error surfaces, no Imagen fallback', async () => {
  globalThis.__settings = { openaiKey: 'o', googleAiKey: 'g' };
  fetchHandler = (url) => {
    if (url.includes('openai.com')) {
      return { ok: false, status: 400, text: async () => 'content policy violation' };
    }
    throw new Error('Imagen should not be called when user picked DALL-E');
  };
  await expectThrow(
    () => mod.generateHeroImage('T', 'k', CLIENT, { preferredProvider: 'dalle' }),
    /DALL-E error 400/,
    'dalle 400'
  );
  // Critical assertion: only one fetch happened, to OpenAI.
  assertEq(fetchCalls.length, 1, 'fetch count');
  assertMatch(fetchCalls[0].url, /openai\.com/, 'fetch URL');
});

await t('explicit Imagen pick — Imagen error surfaces, no DALL-E fallback', async () => {
  globalThis.__settings = { openaiKey: 'o', googleAiKey: 'g' };
  fetchHandler = (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return { ok: false, status: 404, text: async () => 'not enabled' };
    }
    throw new Error('DALL-E should not be called when user picked Imagen');
  };
  await expectThrow(
    () => mod.generateHeroImage('T', 'k', CLIENT, { preferredProvider: 'imagen' }),
    /Imagen 3 is not available/,
    'imagen 404'
  );
  assertEq(fetchCalls.length, 1, 'fetch count');
  assertMatch(fetchCalls[0].url, /generativelanguage\.googleapis\.com/, 'fetch URL');
});

// ============================================================================
// allowFallback opts back into the old behaviour for the CMS auto-push
// flow where no human is watching.
// ============================================================================
await t('allowFallback=true falls through to the other provider when first fails', async () => {
  globalThis.__settings = { openaiKey: 'o', googleAiKey: 'g' };
  fetchHandler = (url) => {
    if (url.includes('openai.com')) {
      return { ok: false, status: 500, text: async () => 'down' };
    }
    if (url.includes('generativelanguage.googleapis.com')) {
      return { ok: true, json: async () => ({ predictions: [{ bytesBase64Encoded: 'AAAA' }] }) };
    }
    throw new Error('unexpected ' + url);
  };
  const r = await mod.generateHeroImage('T', 'k', CLIENT, { preferredProvider: 'dalle', allowFallback: true });
  assertEq(r.provider, 'imagen', 'fallback provider used');
  // Both endpoints called — DALL-E first, Imagen second.
  assertEq(fetchCalls.length, 2, 'fetch count');
});

await t('allowFallback=true returns success directly when first provider works', async () => {
  globalThis.__settings = { openaiKey: 'o', googleAiKey: 'g' };
  fetchHandler = (url) => {
    if (url.includes('openai.com')) {
      return { ok: true, json: async () => ({ data: [{ b64_json: 'BBBB', revised_prompt: 'p' }] }) };
    }
    throw new Error('Imagen should not be called when DALL-E works');
  };
  const r = await mod.generateHeroImage('T', 'k', CLIENT, { preferredProvider: 'dalle', allowFallback: true });
  assertEq(r.provider, 'dalle', 'primary provider used');
  assertEq(fetchCalls.length, 1, 'no second fetch');
});

await t('successful DALL-E call returns expected shape', async () => {
  globalThis.__settings = { openaiKey: 'o' };
  fetchHandler = () => ({ ok: true, json: async () => ({ data: [{ b64_json: 'XYZ', revised_prompt: 'a cat' }] }) });
  const r = await mod.generateHeroImage('T', 'k', CLIENT, { preferredProvider: 'dalle' });
  assertEq(r.provider, 'dalle');
  assertMatch(r.dataUrl, /^data:image\/png;base64,XYZ/);
  assertEq(r.revisedPrompt, 'a cat');
});

await t('successful Imagen call returns expected shape', async () => {
  globalThis.__settings = { googleAiKey: 'g' };
  fetchHandler = () => ({ ok: true, json: async () => ({ predictions: [{ bytesBase64Encoded: 'XYZ' }] }) });
  const r = await mod.generateHeroImage('T', 'k', CLIENT, { preferredProvider: 'imagen' });
  assertEq(r.provider, 'imagen');
  assertMatch(r.dataUrl, /^data:image\/png;base64,XYZ/);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
