// Unit tests for aeoCensus.js — the grounded, intent-structured prompt census
// that replaces the old "guess 15 probe queries" model. Covers the pure
// helpers (grounding seeds, prompt construction, parsing, coverage, share of
// voice). The network-bound generators (generateCensus / inferLikelyTopics)
// are not exercised here.

import {
  INTENT_BUCKETS,
  DEFAULT_CENSUS_TARGET,
  topRankingSeeds,
  buildCensusPrompt,
  parseCensus,
  censusToProbeList,
  intentMap,
  intentCoverage,
  shareOfVoice
} from '../src/modules/reports/aeoCensus.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function assert(cond, label) { if (!cond) throw new Error(label || 'assertion failed'); }

// ============================================================================
// topRankingSeeds — pull non-branded #1-3 rankings as credibility seeds
// ============================================================================
const GSC = [
  { query: 'pallet racking', position: 1.2, impressions: 900 },
  { query: 'industrial shelving', position: 2.8, impressions: 600 },
  { query: 'krost racking', position: 1.0, impressions: 2000 },    // branded — drop
  { query: 'best mezzanine floors johannesburg', position: 2.1, impressions: 120 },
  { query: 'cheap racking', position: 8.0, impressions: 400 },     // pos > 3.5 — drop
  { query: 'storage', position: 3.0, impressions: 2 }              // < 5 impressions — drop
];

t('topRankingSeeds: keeps non-branded #1-3 with signal, sorted by impressions', () => {
  const seeds = topRankingSeeds(GSC, 'Krost');
  const queries = seeds.map(s => s.query);
  assert(queries.includes('pallet racking'), 'includes pallet racking');
  assert(queries.includes('industrial shelving'), 'includes industrial shelving');
  assert(!queries.includes('krost racking'), 'drops branded');
  assert(!queries.includes('cheap racking'), 'drops position > 3.5');
  assert(!queries.includes('storage'), 'drops low-impression');
  // Sorted by impressions desc.
  assertEq(seeds[0].query, 'pallet racking', 'highest impressions first');
});

t('topRankingSeeds: respects limit', () => {
  const seeds = topRankingSeeds(GSC, 'Krost Shelving', { limit: 1 });
  assertEq(seeds.length, 1, 'limit honoured');
});

t('topRankingSeeds: empty input → empty', () => {
  assertEq(topRankingSeeds([], 'Brand').length, 0, 'empty');
  assertEq(topRankingSeeds(null, 'Brand').length, 0, 'null safe');
});

// ============================================================================
// buildCensusPrompt — deterministic prompt construction
// ============================================================================
t('buildCensusPrompt: embeds grounding seeds, topics, intent mix', () => {
  const prompt = buildCensusPrompt({
    client: { name: 'Krost', industry: 'industrial storage', location: 'South Africa' },
    rankingSeeds: [{ query: 'pallet racking', position: 1.2 }],
    likelyTopics: ['heavy-duty pallet racking'],
    target: 80
  });
  assert(prompt.includes('pallet racking'), 'seed present');
  assert(prompt.includes('heavy-duty pallet racking'), 'topic present');
  assert(prompt.includes('SHARE OF VOICE'), 'frames share of voice');
  // Every intent bucket id appears in the mix instructions.
  for (const b of INTENT_BUCKETS) assert(prompt.includes(b.id), 'mentions ' + b.id);
});

t('buildCensusPrompt: handles no grounding gracefully', () => {
  const prompt = buildCensusPrompt({ client: { name: 'X', industry: 'plumbing' } });
  assert(prompt.includes('plumbing'), 'industry present');
  assert(prompt.includes('infer from industry'), 'fallback note for seeds');
});

// ============================================================================
// parseCensus / censusToProbeList / intentMap
// ============================================================================
const CENSUS = {
  version: 1,
  prompts: [
    { query: 'Best pallet racking suppliers in South Africa', intent: 'commercial' },
    { query: 'Where to buy shelving in Durban', intent: 'local' },
    { query: 'Krost vs Universal Storage racking', intent: 'comparison' }
  ]
};

t('parseCensus: reads object, JSON string, and client.aeo_census', () => {
  assertEq(parseCensus(CENSUS).prompts.length, 3, 'object');
  assertEq(parseCensus(JSON.stringify(CENSUS)).prompts.length, 3, 'json string');
  assertEq(parseCensus({ aeo_census: CENSUS }).prompts.length, 3, 'client field');
  assertEq(parseCensus({ aeo_census: JSON.stringify(CENSUS) }).prompts.length, 3, 'client field json string');
  assertEq(parseCensus(null), null, 'null safe');
  assertEq(parseCensus({ aeo_census: 'not json' }), null, 'bad json safe');
});

t('censusToProbeList: flattens to newline list', () => {
  const list = censusToProbeList(CENSUS).split('\n');
  assertEq(list.length, 3, 'three lines');
  assertEq(list[0], 'Best pallet racking suppliers in South Africa', 'first line');
});

t('intentMap: lower-cased query → intent lookup', () => {
  const m = intentMap({ aeo_census: CENSUS });
  assertEq(m['where to buy shelving in durban'], 'local', 'local lookup');
  assertEq(m['krost vs universal storage racking'], 'comparison', 'comparison lookup');
  assertEq(Object.keys(intentMap(null)).length, 0, 'null safe');
});

// ============================================================================
// intentCoverage — representativeness check
// ============================================================================
t('intentCoverage: counts per bucket and flags thin buckets', () => {
  const cov = intentCoverage(CENSUS, { floor: 2 });
  assertEq(cov.total, 3, 'total');
  assertEq(cov.counts.commercial, 1, 'commercial count');
  const commercial = cov.buckets.find(b => b.id === 'commercial');
  assert(commercial.thin, 'commercial thin (1 < floor 2)');
  // Buckets with zero prompts still appear (so the report can show the gap).
  assertEq(cov.buckets.length, INTENT_BUCKETS.length, 'all buckets present');
  const awareness = cov.buckets.find(b => b.id === 'awareness');
  assertEq(awareness.count, 0, 'awareness empty');
});

// ============================================================================
// shareOfVoice — the headline metric
// ============================================================================
t('shareOfVoice: brand vs competitor mention split', () => {
  const r = shareOfVoice(30, [{ mentions: 20 }, { mentions: 50 }]);
  assertEq(r.sov, 30, '30 / (30+70) = 30%');
  assertEq(r.totalMentions, 100, 'total mentions');
});

t('shareOfVoice: zero everything → 0, no divide-by-zero', () => {
  const r = shareOfVoice(0, []);
  assertEq(r.sov, 0, 'zero sov');
  assertEq(r.totalMentions, 0, 'zero total');
});

t('shareOfVoice: brand-only → 100%', () => {
  assertEq(shareOfVoice(12, []).sov, 100, 'brand only is 100');
  assertEq(shareOfVoice(12, [{ mentions: 0 }]).sov, 100, 'competitors with 0 mentions');
});

t('DEFAULT_CENSUS_TARGET is a sane census size', () => {
  assert(DEFAULT_CENSUS_TARGET >= 40, 'at least 40 prompts — representative, not a guess');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
