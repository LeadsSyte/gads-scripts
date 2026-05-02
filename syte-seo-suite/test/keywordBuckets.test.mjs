// keywordBuckets.js contract tests. The bucketing logic decides what
// shows up in the "Top 3 / Top 10 / Improved / Striking Distance / Head-
// Term Wins" sections of the monthly report. A regression here directly
// changes what clients see.

import {
  classifyKeyword,
  classifyKeywords,
  buildKeywordBuckets,
  probeCandidatesFromGSC,
  mergeProbeQueries
} from '../src/modules/reports/keywordBuckets.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

// ============================================================================
// classifyKeyword
// ============================================================================
await t('classifyKeyword: branded query is flagged regardless of position', () => {
  const c = classifyKeyword({ query: 'krost shelving johannesburg' }, 'Krost Shelving');
  eq(c.branded, true);
  eq(c.headTerm, false, 'branded never counts as head term');
});

await t('classifyKeyword: short head term (industrial racking)', () => {
  const c = classifyKeyword({ query: 'industrial racking' }, 'Krost');
  eq(c.headTerm, true);
  eq(c.branded, false);
  eq(c.longTail, false);
});

await t('classifyKeyword: 3-significant-token head term still counts', () => {
  const c = classifyKeyword({ query: 'industrial racking systems' }, 'Krost');
  eq(c.headTerm, true);
});

await t('classifyKeyword: location modifier disqualifies head term', () => {
  const c = classifyKeyword({ query: 'industrial racking johannesburg' }, 'Krost');
  eq(c.headTerm, false);
  eq(c.hasLocation, true);
  eq(c.longTail, true);
});

await t('classifyKeyword: qualifier word ("best") disqualifies head term', () => {
  const c = classifyKeyword({ query: 'best racking systems' }, 'Krost');
  eq(c.headTerm, false);
  eq(c.hasQualifier, true);
});

await t('classifyKeyword: long-tail (4+ significant tokens)', () => {
  const c = classifyKeyword({ query: 'industrial heavy duty steel racking solutions' }, 'Krost');
  eq(c.longTail, true);
  eq(c.headTerm, false);
});

await t('classifyKeyword: empty query returns longTail=true and wordCount=0', () => {
  const c = classifyKeyword({ query: '' }, 'Krost');
  eq(c.wordCount, 0);
  eq(c.longTail, true);
});

await t('classifyKeyword: handles brand-name concatenation (krostshelving)', () => {
  const c = classifyKeyword({ query: 'krostshelving' }, 'Krost Shelving');
  eq(c.branded, true);
});

// ============================================================================
// buildKeywordBuckets
// ============================================================================
const SAMPLE = [
  // Top 3
  { query: 'industrial racking',          position: 2,  change: 1.5, clicks: 50, impressions: 1000 },
  { query: 'krost industrial racking',    position: 1,  change: 0.0, clicks: 30, impressions: 500 }, // branded
  // Top 10 (head term)
  { query: 'office shelving',             position: 6.2, change: 0.8, clicks: 20, impressions: 800 },
  // Top 10 (long tail)
  { query: 'best racking jhb',            position: 9.5, change: 0.3, clicks: 5,  impressions: 200 },
  // Striking distance
  { query: 'mezzanine floor solutions',   position: 14,  change: 2.1, clicks: 1,  impressions: 100 },
  // Striking but too few impressions to count
  { query: 'rare niche term',             position: 12,  change: 0.0, clicks: 0,  impressions: 2 },
  // Improved (movement >= 0.5)
  { query: 'pallet racking',              position: 5,   change: 3.0, clicks: 25, impressions: 500 },
  // Not enough movement to count as improved
  { query: 'noise term',                  position: 11,  change: 0.2, clicks: 0,  impressions: 50 }
];

await t('buildKeywordBuckets: branded queries excluded from top3 by default', () => {
  const b = buildKeywordBuckets(SAMPLE, 'Krost');
  // 'krost industrial racking' is branded — must NOT show up in top3.
  if (b.top3.some(kw => /krost/i.test(kw.query))) throw new Error('branded leaked into top3');
});

await t('buildKeywordBuckets: top3 contains only positions 1-3.4', () => {
  const b = buildKeywordBuckets(SAMPLE, 'Krost');
  for (const kw of b.top3) {
    if (kw.position < 0 || kw.position > 3.4) throw new Error('position out of band: ' + kw.position);
  }
});

await t('buildKeywordBuckets: top10 contains positions 3.4-10.4', () => {
  const b = buildKeywordBuckets(SAMPLE, 'Krost');
  for (const kw of b.top10) {
    if (kw.position <= 3.4 || kw.position > 10.4) throw new Error('out of band: ' + kw.position);
  }
});

await t('buildKeywordBuckets: head terms float to the top within top10', () => {
  const b = buildKeywordBuckets(SAMPLE, 'Krost');
  // 'office shelving' (head term) must come before 'best racking jhb' (long tail).
  const headIdx = b.top10.findIndex(kw => kw.query === 'office shelving');
  const longIdx = b.top10.findIndex(kw => kw.query === 'best racking jhb');
  if (headIdx === -1 || longIdx === -1) throw new Error('expected both queries in top10');
  if (headIdx > longIdx) throw new Error('head term should come first');
});

await t('buildKeywordBuckets: improved requires change >= 0.5', () => {
  const b = buildKeywordBuckets(SAMPLE, 'Krost');
  for (const kw of b.improved) {
    if ((kw.change || 0) < 0.5) throw new Error('change below threshold: ' + kw.change);
  }
  // Specific assertion — pallet racking (change 3.0) must be there.
  if (!b.improved.some(kw => kw.query === 'pallet racking')) throw new Error('pallet racking missing');
});

await t('buildKeywordBuckets: striking-distance requires impressions >= 5', () => {
  const b = buildKeywordBuckets(SAMPLE, 'Krost');
  // 'rare niche term' has 2 impressions — should NOT appear.
  if (b.striking.some(kw => kw.query === 'rare niche term')) throw new Error('low-impression query leaked into striking');
  // 'mezzanine floor solutions' has 100 impressions — should appear.
  if (!b.striking.some(kw => kw.query === 'mezzanine floor solutions')) throw new Error('mezzanine missing');
});

await t('buildKeywordBuckets: branded bucket contains exactly the branded queries', () => {
  const b = buildKeywordBuckets(SAMPLE, 'Krost');
  eq(b.branded.length, 1);
  eq(b.branded[0].query, 'krost industrial racking');
});

await t('buildKeywordBuckets: counts object summarises every bucket size', () => {
  const b = buildKeywordBuckets(SAMPLE, 'Krost');
  eq(b.counts.total, SAMPLE.length);
  eq(b.counts.branded, 1);
  eq(b.counts.eligible, SAMPLE.length - 1);
});

// ============================================================================
// probeCandidatesFromGSC — head terms first, dedup, ≥5 impressions
// ============================================================================
await t('probeCandidatesFromGSC: drops branded + low-impression queries', () => {
  const out = probeCandidatesFromGSC(SAMPLE, 'Krost');
  if (out.includes('krost industrial racking')) throw new Error('branded leaked');
  if (out.includes('rare niche term')) throw new Error('low-impression leaked');
});

await t('probeCandidatesFromGSC: head terms ordered before long tail', () => {
  const out = probeCandidatesFromGSC(SAMPLE, 'Krost');
  const head = out.indexOf('industrial racking');
  const long = out.indexOf('best racking jhb');
  if (head === -1 || long === -1) throw new Error('expected both: ' + out.join(', '));
  if (head > long) throw new Error('head term should come first');
});

await t('probeCandidatesFromGSC: dedupes case-insensitively', () => {
  const dupes = [
    { query: 'Industrial Racking', position: 5, impressions: 100 },
    { query: 'industrial racking', position: 4, impressions: 200 }
  ];
  const out = probeCandidatesFromGSC(dupes, 'X');
  eq(out.length, 1);
});

await t('probeCandidatesFromGSC: respects limit', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({
    query: 'term ' + i, position: 5, impressions: 100 + i
  }));
  const out = probeCandidatesFromGSC(many, 'X', { limit: 10 });
  eq(out.length, 10);
});

// ============================================================================
// mergeProbeQueries — case-insensitive dedup, preserves order
// ============================================================================
await t('mergeProbeQueries: appends new queries, preserving existing order', () => {
  const r = mergeProbeQueries('alpha\nbeta', ['gamma', 'delta']);
  eq(r.merged, 'alpha\nbeta\ngamma\ndelta');
  eq(r.addedCount, 2);
  eq(r.totalCount, 4);
});

await t('mergeProbeQueries: dedupes case-insensitively', () => {
  const r = mergeProbeQueries('alpha', ['ALPHA', 'beta']);
  eq(r.addedCount, 1, 'alpha already present');
  eq(r.merged, 'alpha\nbeta');
});

await t('mergeProbeQueries: tolerates empty existing input', () => {
  const r = mergeProbeQueries('', ['x', 'y']);
  eq(r.merged, 'x\ny');
  eq(r.addedCount, 2);
});

await t('mergeProbeQueries: tolerates null/undefined', () => {
  const r = mergeProbeQueries(null, null);
  eq(r.merged, '');
  eq(r.addedCount, 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
