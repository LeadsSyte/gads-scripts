// End-to-end test for runSnapshot — exercises the full AEO probe
// pipeline with mocked engines. Catches the silent-fail mode where the
// runner returns a snapshot with all-zeros if engines/queries flow
// through but brand detection or aggregation breaks.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/reports/aeoRunner.js'), 'utf8');

// Mock engines + brand detection functions via globals.
globalThis.__activeEngines = () => [];
globalThis.__allEngines = [];
globalThis.__detectBrand = () => ({ mentioned: false });
globalThis.__sentimentOf = async () => 'neutral';
globalThis.__scoreMention = () => 0;
globalThis.__countCitations = () => 0;

const PATCHED = SRC
  .replace("import { ALL_ENGINES, activeEngines } from './aeoEngines.js';",
           "const ALL_ENGINES = globalThis.__allEngines; const activeEngines = () => globalThis.__activeEngines();")
  .replace("import { detectBrand, sentimentOf, scoreMention, countCitations } from './brandDetection.js';",
           "const detectBrand = (...a) => globalThis.__detectBrand(...a); " +
           "const sentimentOf = (...a) => globalThis.__sentimentOf(...a); " +
           "const scoreMention = (...a) => globalThis.__scoreMention(...a); " +
           "const countCitations = (...a) => globalThis.__countCitations(...a);")
  // Inline the pure aeoCensus helpers so the patched tmp module needs no
  // relative import (it lives in os.tmpdir(), not src/modules/reports/).
  .replace("import { intentMap, shareOfVoice, INTENT_BUCKETS } from './aeoCensus.js';",
           "const intentMap = (c) => { try { const r = c?.aeo_census; const o = typeof r === 'string' ? JSON.parse(r) : r; const m = {}; (o?.prompts || []).forEach(p => m[p.query.toLowerCase().trim()] = p.intent); return m; } catch { return {}; } }; " +
           "const shareOfVoice = (b, comps) => { const brand = Math.max(0, Number(b) || 0); const ct = (comps || []).reduce((a, c) => a + (Number(c.mentions) || 0), 0); const d = brand + ct; return d === 0 ? { sov: 0, brand, competitorTotal: ct, totalMentions: 0 } : { sov: Math.round((brand / d) * 1000) / 10, brand, competitorTotal: ct, totalMentions: d }; }; " +
           "const INTENT_BUCKETS = [{ id: 'awareness' }, { id: 'commercial' }, { id: 'comparison' }, { id: 'local' }, { id: 'problem' }];");

const tmp = path.join(os.tmpdir(), 'aeoRunner-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
async function t(name, fn) {
  // Reset all stubs to defaults.
  globalThis.__activeEngines = () => [];
  globalThis.__allEngines = [];
  globalThis.__detectBrand = () => ({ mentioned: false });
  globalThis.__sentimentOf = async () => 'neutral';
  globalThis.__scoreMention = () => 0;
  globalThis.__countCitations = () => 0;
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function assertGT(a, b, label) {
  if (!(a > b)) throw new Error((label || '') + ' expected > ' + b + ' got ' + a);
}
async function expectThrow(fn, regex, label) {
  try { await fn(); }
  catch (e) {
    if (!regex.test(e.message)) throw new Error((label || '') + ' wrong error: ' + e.message);
    return;
  }
  throw new Error((label || '') + ' expected throw, did not throw');
}

const CLIENT = {
  id: 'c1', name: 'Acme', url: 'https://acme.test/',
  aeo_probe_queries: 'best widgets\nbuy widgets cape town',
  competitors: 'BetaCorp, GammaLtd | gamma.test'
};

// ============================================================================
// Preflight
// ============================================================================
await t('snapshotPreflight: cannot run with no engines configured', () => {
  globalThis.__allEngines = [];
  globalThis.__activeEngines = () => [];
  const r = mod.snapshotPreflight(CLIENT);
  assertEq(r.canRun, false);
  assertEq(r.queries.length, 2);
});

await t('snapshotPreflight: cannot run with no probe queries', () => {
  globalThis.__activeEngines = () => [{ id: 'e', label: 'E', isConfigured: () => true }];
  globalThis.__allEngines = [{ id: 'e', label: 'E', isConfigured: () => true }];
  const r = mod.snapshotPreflight({ ...CLIENT, aeo_probe_queries: '' });
  assertEq(r.canRun, false);
});

await t('snapshotPreflight: canRun=true when both engines and queries present', () => {
  globalThis.__activeEngines = () => [{ id: 'chatgpt', label: 'ChatGPT', isConfigured: () => true }];
  globalThis.__allEngines = [{ id: 'chatgpt', label: 'ChatGPT', isConfigured: () => true }];
  const r = mod.snapshotPreflight(CLIENT);
  assertEq(r.canRun, true);
  assertEq(r.engines.length, 1);
  assertEq(r.queries.length, 2);
});

// ============================================================================
// runSnapshot — guard rails
// ============================================================================
await t('runSnapshot: refuses when client has no id', async () => {
  await expectThrow(
    () => mod.runSnapshot({}),
    /pick a client first/i,
    'no id'
  );
});

await t('runSnapshot: refuses when no engines are configured', async () => {
  globalThis.__activeEngines = () => [];
  await expectThrow(
    () => mod.runSnapshot(CLIENT),
    /No AI engines configured/,
    'no engines'
  );
});

await t('runSnapshot: refuses when client has no probe queries', async () => {
  globalThis.__activeEngines = () => [{ id: 'e', label: 'E', isConfigured: () => true, ask: async () => ({ text: '' }) }];
  await expectThrow(
    () => mod.runSnapshot({ ...CLIENT, aeo_probe_queries: '' }),
    /no AEO probe queries/i,
    'no queries'
  );
});

// ============================================================================
// runSnapshot — full happy path with one engine + one mention
// ============================================================================
await t('runSnapshot: complete probe → snapshot has all expected fields', async () => {
  let askCalls = 0;
  globalThis.__activeEngines = () => [{
    id: 'chatgpt',
    label: 'ChatGPT',
    isConfigured: () => true,
    ask: async (q) => {
      askCalls++;
      return { text: 'Acme is the best widget maker in Cape Town. Visit https://acme.test/' };
    }
  }];
  globalThis.__detectBrand = (text, { name }) => {
    // Brand mentioned with position 1 in every response. Competitors not mentioned.
    if (text.includes(name)) return { mentioned: true, position: 1, excerpt: 'Acme is the best widget maker' };
    return { mentioned: false };
  };
  globalThis.__sentimentOf = async () => 'positive';
  globalThis.__scoreMention = () => 100;
  globalThis.__countCitations = (text, url) => (url && text.includes(url)) ? 1 : 0;

  const result = await mod.runSnapshot(CLIENT, { iterations: 1 });

  // Hero metrics
  assertGT(result.overall_score, 0, 'overall_score nonzero');
  assertEq(result.queries_count, 2, 'queries_count');
  assertEq(result.iterations, 1, 'iterations');
  assertEq(result.engines_used.length, 1, 'engines_used');
  assertEq(result.mentions, 2, 'mentions (1 per query)');
  assertEq(result.visibility_score, 100, 'visibility=100% (mentioned every time)');
  // Share of voice: brand mentioned, no competitor mentions in the text → 100%.
  assertEq(result.share_of_voice, 100, 'share_of_voice=100% (no competitor mentions)');
  assertEq(result.detection_rate, 100, 'detection rate=100% (every query had ≥1 hit)');
  assertEq(result.top3_rate, 100, 'top3 rate=100% (position 1 every time)');
  assertEq(result.sentiment_score, 100, 'sentiment 100% positive');

  // Per-query breakdown
  assertEq(result.per_query.length, 2, 'per_query rows = 2 (1 query × 1 engine × 2 queries)');
  for (const pq of result.per_query) {
    assertEq(pq.visibility, 100, 'per-query visibility');
    assertEq(pq.mentioned, true, 'per-query mentioned');
  }

  // Engine scores
  assertEq(result.engine_scores.chatgpt, 100, 'chatgpt=100');

  // Keyword wins bucketing — both queries hit ≥70% so they're in active.
  assertEq(result.keyword_wins.active.length, 2, 'two active wins');
  assertEq(result.keyword_wins.emerging.length, 0, 'no emerging');
  assertEq(result.keyword_wins.zero.length, 0, 'no zero');

  // Total ask calls = 2 queries × 1 engine × 1 iteration.
  assertEq(askCalls, 2, 'ask called once per (query, engine, iteration)');

  // Citations counted (url present in every response).
  assertEq(result.citations, 2, 'citations counted from countCitations stub');
});

await t('runSnapshot: per-iteration aggregation produces fractional visibility', async () => {
  let n = 0;
  globalThis.__activeEngines = () => [{
    id: 'gpt', label: 'ChatGPT', isConfigured: () => true,
    // Alternating responses: cited, uncited, cited (3 iterations → 66.7%)
    ask: async () => ({ text: (n++ % 2 === 0) ? 'Acme is great.' : 'No mention here.' })
  }];
  globalThis.__detectBrand = (text, { name }) => text.includes(name)
    ? { mentioned: true, position: 4, excerpt: 'Acme is great' }
    : { mentioned: false };
  globalThis.__sentimentOf = async () => 'neutral';
  globalThis.__scoreMention = () => 50;
  globalThis.__countCitations = () => 0;

  const result = await mod.runSnapshot({ ...CLIENT, aeo_probe_queries: 'one query' }, { iterations: 3 });
  // 1 query × 1 engine × 3 iterations = 3 runs. Pattern cited/uncited/cited → visibility = 66.7%.
  const pq = result.per_query[0];
  assertEq(pq.iterations, 3, 'three iterations');
  assertEq(pq.hits, 2, 'two hits');
  assertEq(pq.visibility, 66.7, 'visibility 66.7%');
  // Position 4 was hit twice → not in top 3.
  assertEq(pq.top3_rate, 0, 'top3 rate 0');
});

await t('runSnapshot: errored engine response does not abort the sweep', async () => {
  globalThis.__activeEngines = () => [
    { id: 'e1', label: 'E1', isConfigured: () => true, ask: async () => ({ error: 'rate limit' }) },
    { id: 'e2', label: 'E2', isConfigured: () => true, ask: async () => ({ text: 'Acme rules.' }) }
  ];
  globalThis.__detectBrand = (text, { name }) => text && text.includes(name)
    ? { mentioned: true, position: 2, excerpt: 'x' }
    : { mentioned: false };
  globalThis.__sentimentOf = async () => 'positive';
  globalThis.__scoreMention = () => 100;
  globalThis.__countCitations = () => 0;

  const result = await mod.runSnapshot({ ...CLIENT, aeo_probe_queries: 'q1' }, { iterations: 1 });
  // E1 errored, E2 hit → visibility on E2 = 100%, E1 = 0%.
  assertEq(result.engine_scores.e1, 0);
  assertEq(result.engine_scores.e2, 100);
  // detection rate = 100% (any engine hit on the query).
  assertEq(result.detection_rate, 100, 'detection rate 100');
});

await t('runSnapshot: competitors get their own visibility metrics', async () => {
  globalThis.__activeEngines = () => [{
    id: 'gpt', label: 'GPT', isConfigured: () => true,
    ask: async () => ({ text: 'BetaCorp leads the widget category. GammaLtd is also strong.' })
  }];
  globalThis.__detectBrand = (text, { name }) =>
    text.includes(name) ? { mentioned: true, position: 1, excerpt: name + ' leads' } : { mentioned: false };
  globalThis.__sentimentOf = async () => 'neutral';
  globalThis.__scoreMention = () => 0;
  globalThis.__countCitations = () => 0;

  const result = await mod.runSnapshot(CLIENT, { iterations: 1 });
  assertEq(result.competitors.length, 2, 'two competitors tracked');
  // BetaCorp + GammaLtd both mentioned → 100% visibility each.
  for (const c of result.competitors) assertEq(c.visibility, 100, c.name + ' visibility');
  // Brand never mentioned but both competitors were → share of voice is 0%.
  assertEq(result.share_of_voice, 0, 'share_of_voice=0% (brand absent, competitors present)');
});

// ============================================================================
// Census intent tagging — per_query rows carry their buyer-intent bucket,
// and intent_breakdown aggregates visibility per bucket.
// ============================================================================
await t('runSnapshot: tags per_query intent + builds intent_breakdown from census', async () => {
  globalThis.__activeEngines = () => [{
    id: 'gpt', label: 'GPT', isConfigured: () => true,
    ask: async () => ({ text: 'Acme is a top widget maker.' })
  }];
  globalThis.__detectBrand = (text, { name }) =>
    text.includes(name) ? { mentioned: true, position: 1, excerpt: 'Acme' } : { mentioned: false };
  globalThis.__sentimentOf = async () => 'positive';
  globalThis.__scoreMention = () => 100;
  globalThis.__countCitations = () => 0;

  const census = {
    prompts: [
      { query: 'best widgets', intent: 'commercial' },
      { query: 'buy widgets cape town', intent: 'local' }
    ]
  };
  const result = await mod.runSnapshot(
    { ...CLIENT, aeo_census: census },
    { iterations: 1 }
  );
  const byQuery = Object.fromEntries(result.per_query.map(r => [r.query, r.intent]));
  assertEq(byQuery['best widgets'], 'commercial', 'commercial intent tagged');
  assertEq(byQuery['buy widgets cape town'], 'local', 'local intent tagged');
  // intent_breakdown should have one entry per populated bucket.
  const intents = result.intent_breakdown.map(b => b.intent).sort();
  assertEq(intents.join(','), 'commercial,local', 'breakdown buckets');
  for (const b of result.intent_breakdown) assertEq(b.visibility, 100, b.intent + ' visibility');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
