// brandDetection.js contract tests. Drives the AEO probe — every model
// response goes through detectBrand() to decide if the brand was cited,
// in what position, and with what excerpt. countCitations decides the
// "URLs cited" metric that competitive AEO tools highlight.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/reports/brandDetection.js'), 'utf8');

// brandDetection.js imports `claude` from aeoEngines for sentimentOf.
// Stub it so we control the model response.
globalThis.__claudeAsk = async () => ({ text: 'positive' });
const PATCHED = SRC.replace(
  "import { claude } from './aeoEngines.js';",
  "const claude = { ask: (...a) => globalThis.__claudeAsk(...a) };"
);

const tmp = path.join(os.tmpdir(), 'brandDetection-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
async function t(name, fn) {
  globalThis.__claudeAsk = async () => ({ text: 'positive' });
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

// ============================================================================
// detectBrand
// ============================================================================
await t('detectBrand: brand name match returns mentioned=true', () => {
  const r = mod.detectBrand('Acme is the best widget maker.', { name: 'Acme' });
  eq(r.mentioned, true);
});

await t('detectBrand: no brand mention returns mentioned=false, position=null', () => {
  const r = mod.detectBrand('Generic widgets are nice.', { name: 'Acme' });
  eq(r.mentioned, false);
  eq(r.position, null);
});

await t('detectBrand: domain match counts as a mention (when name absent)', () => {
  const r = mod.detectBrand('Visit acme.com for more.', { name: 'OtherName', url: 'https://acme.com/' });
  eq(r.mentioned, true);
});

await t('detectBrand: matches www. prefix-stripped domain', () => {
  const r = mod.detectBrand('Check out www.acme.com.', { url: 'https://www.acme.com/' });
  eq(r.mentioned, true);
});

await t('detectBrand: position 1 when brand mentioned before any competitor', () => {
  const r = mod.detectBrand(
    'Acme leads the category. BetaCorp is solid. GammaCorp is new.',
    { name: 'Acme', competitors: 'BetaCorp,GammaCorp' }
  );
  eq(r.position, 1);
});

await t('detectBrand: position 2 when one competitor appears first', () => {
  const r = mod.detectBrand(
    'BetaCorp leads. Acme is very good too.',
    { name: 'Acme', competitors: 'BetaCorp,GammaCorp' }
  );
  eq(r.position, 2);
});

await t('detectBrand: position 3 when two competitors precede', () => {
  const r = mod.detectBrand(
    'BetaCorp first. GammaCorp second. Then Acme.',
    { name: 'Acme', competitors: 'BetaCorp,GammaCorp' }
  );
  eq(r.position, 3);
});

await t('detectBrand: excerpt is the sentence containing the mention', () => {
  const r = mod.detectBrand(
    'First sentence. Acme is great here. Final thought.',
    { name: 'Acme' }
  );
  if (!/Acme is great here/.test(r.excerpt)) throw new Error('excerpt should contain mention');
});

await t('detectBrand: 2-significant-word fallback (multi-word brand split)', () => {
  // The fallback requires 2 brand words >=4 chars present in the text,
  // even when the brand string itself isn't contiguous. Brand "Hilton
  // Sandton" → both words long enough; the response splits them but
  // both appear → counts as a mention.
  const r = mod.detectBrand(
    'The Hilton in central Sandton is the closest match.',
    { name: 'Hilton Sandton' }
  );
  eq(r.mentioned, true, 'fallback should catch split multi-word brand');
});

await t('detectBrand: competitorHits lists all competitors that appeared', () => {
  const r = mod.detectBrand(
    'BetaCorp and GammaCorp dominate. Acme is up-and-coming.',
    { name: 'Acme', competitors: 'BetaCorp,GammaCorp,DeltaCo' }
  );
  // All three competitors specified; only BetaCorp + GammaCorp in text.
  if (r.competitorHits.includes('DeltaCo')) throw new Error('DeltaCo not in text');
  if (!r.competitorHits.includes('BetaCorp')) throw new Error('BetaCorp missing');
  if (!r.competitorHits.includes('GammaCorp')) throw new Error('GammaCorp missing');
});

await t('detectBrand: very short brand fragment ignored (no false positives on 1-2 chars)', () => {
  const r = mod.detectBrand('No brand mentioned at all.', { name: 'Hi' });
  eq(r.mentioned, false);
});

// ============================================================================
// scoreMention — the spec'd 0/25/50/75/100 ladder
// ============================================================================
await t('scoreMention: not mentioned → 0', () => {
  eq(mod.scoreMention({ mentioned: false }), 0);
});

await t('scoreMention: mentioned at position 1 + positive sentiment → 100', () => {
  eq(mod.scoreMention({ mentioned: true, position: 1, sentiment: 'positive' }), 100);
});

await t('scoreMention: position 1, neutral sentiment → 75', () => {
  eq(mod.scoreMention({ mentioned: true, position: 1, sentiment: 'neutral' }), 75);
});

await t('scoreMention: position 2 → 50', () => {
  eq(mod.scoreMention({ mentioned: true, position: 2, sentiment: 'positive' }), 50);
});

await t('scoreMention: position 3+ → 25', () => {
  eq(mod.scoreMention({ mentioned: true, position: 3, sentiment: 'positive' }), 25);
  eq(mod.scoreMention({ mentioned: true, position: 7, sentiment: 'positive' }), 25);
});

// ============================================================================
// countCitations — URL/domain references
// ============================================================================
await t('countCitations: no text returns 0', () => {
  eq(mod.countCitations('', 'https://acme.com', 'Acme'), 0);
  eq(mod.countCitations(null, 'https://acme.com', 'Acme'), 0);
});

await t('countCitations: counts each occurrence of the brand domain', () => {
  const text = 'Visit acme.com for products. See acme.com/blog for articles.';
  const n = mod.countCitations(text, 'https://acme.com', 'Acme');
  if (n < 2) throw new Error('expected >= 2 occurrences, got ' + n);
});

await t('countCitations: no double-count when both url and name match', () => {
  const text = 'See acme.com for details.';
  const n = mod.countCitations(text, 'https://acme.com', 'Acme');
  // domain regex via name path returns 1; either way 1 — never 2.
  eq(n, 1);
});

await t('countCitations: matches www. prefix-stripped form', () => {
  const text = 'See www.acme.com today.';
  const n = mod.countCitations(text, 'https://www.acme.com', 'Acme');
  if (n < 1) throw new Error('expected >= 1');
});

// ============================================================================
// sentimentOf — Claude Haiku call
// ============================================================================
await t('sentimentOf: empty excerpt returns "neutral" without calling Claude', async () => {
  let called = false;
  globalThis.__claudeAsk = async () => { called = true; return { text: 'positive' }; };
  const out = await mod.sentimentOf('', 'Acme');
  eq(out, 'neutral');
  eq(called, false);
});

await t('sentimentOf: parses "positive" from any response containing the word', async () => {
  globalThis.__claudeAsk = async () => ({ text: 'POSITIVE.' });
  eq(await mod.sentimentOf('Acme is great', 'Acme'), 'positive');
});

await t('sentimentOf: parses "negative"', async () => {
  globalThis.__claudeAsk = async () => ({ text: 'Negative — they reported issues.' });
  eq(await mod.sentimentOf('Acme has problems', 'Acme'), 'negative');
});

await t('sentimentOf: defaults to "neutral" when neither pos nor neg', async () => {
  globalThis.__claudeAsk = async () => ({ text: 'unclear' });
  eq(await mod.sentimentOf('Acme exists', 'Acme'), 'neutral');
});

await t('sentimentOf: error from Claude gracefully returns "neutral" (does not throw)', async () => {
  globalThis.__claudeAsk = async () => ({ error: 'rate limit' });
  eq(await mod.sentimentOf('Acme is fine', 'Acme'), 'neutral');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
