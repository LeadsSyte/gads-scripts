// aeoCompare.js contract tests. Drives the MoM delta hero in the report
// (e.g. "+68% citations vs April"). Pins:
//   • normalizeSnapshot upgrades pre-multi-iteration shapes so the new
//     renderer doesn't crash on legacy data
//   • compareSnapshots returns null deltas when previous is missing,
//     never throws on legacy-only data
//   • rankBrandWithCompetitors places the brand in the right slot

import {
  normalizeSnapshot,
  compareSnapshots,
  rankBrandWithCompetitors
} from '../src/modules/reports/aeoCompare.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

// A "modern" snapshot — has all the multi-iteration fields.
const MODERN = {
  month: '2026-05',
  overall_score: 72,
  visibility_score: 65.5,
  detection_rate: 80,
  top3_rate: 40,
  mentions: 25,
  citations: 12,
  sentiment_score: 78,
  iterations: 3,
  total_runs: 30,
  queries_count: 10,
  per_query: [],
  competitors: [
    { name: 'BetaCorp', visibility: 50, mentions: 15, citations: 4, top3_rate: 20 }
  ],
  keyword_wins: { active: [], emerging: [], zero: [] }
};

// A "legacy" snapshot — pre-multi-iteration. Has overall_score + per_query.
const LEGACY = {
  month: '2026-04',
  overall_score: 60,
  sentiment: '70% positive',
  per_query: [
    { query: 'q1', engine: 'chatgpt', mentioned: true,  position: 1, sentiment: 'positive' },
    { query: 'q1', engine: 'gemini',  mentioned: false, position: null },
    { query: 'q2', engine: 'chatgpt', mentioned: true,  position: 4, sentiment: 'neutral' }
  ],
  competitors: [
    { name: 'BetaCorp', appearances: 1 }
  ]
};

// ============================================================================
// normalizeSnapshot
// ============================================================================
await t('normalizeSnapshot: modern snapshot is returned as-is', () => {
  const out = normalizeSnapshot(MODERN);
  // visibility_score and keyword_wins both present → no normalization.
  eq(out, MODERN);
  if (out._legacy) throw new Error('modern snapshot incorrectly flagged legacy');
});

await t('normalizeSnapshot: legacy snapshot gets visibility_score derived from per_query', () => {
  const out = normalizeSnapshot(LEGACY);
  // 2 of 3 mentioned → 66.7%.
  eq(out.visibility_score, 66.7);
  eq(out._legacy, true);
});

await t('normalizeSnapshot: legacy gets detection_rate derived from distinct queries', () => {
  const out = normalizeSnapshot(LEGACY);
  // q1 hit at least once + q2 hit at least once → 100% detection.
  eq(out.detection_rate, 100);
});

await t('normalizeSnapshot: legacy gets top3_rate from positions ≤ 3', () => {
  const out = normalizeSnapshot(LEGACY);
  // q1 chatgpt at position 1 → top3. 1 of 3 → 33.3%.
  eq(out.top3_rate, 33.3);
});

await t('normalizeSnapshot: legacy gets sentiment_score from positive/mentioned ratio', () => {
  const out = normalizeSnapshot(LEGACY);
  // 1 positive of 2 mentioned → 50%.
  eq(out.sentiment_score, 50);
});

await t('normalizeSnapshot: legacy gets keyword_wins active/zero buckets', () => {
  const out = normalizeSnapshot(LEGACY);
  // Both q1 and q2 had at least one mention → both active, none zero.
  eq(out.keyword_wins.active.length, 2);
  eq(out.keyword_wins.zero.length, 0);
});

await t('normalizeSnapshot: legacy with NO mentions gets sentiment from string ("84% positive")', () => {
  const noMentions = {
    overall_score: 0, sentiment: '84% positive',
    per_query: [{ query: 'q', engine: 'chatgpt', mentioned: false }]
  };
  const out = normalizeSnapshot(noMentions);
  eq(out.sentiment_score, 84);
});

await t('normalizeSnapshot: legacy competitors get visibility derived from appearances', () => {
  const out = normalizeSnapshot(LEGACY);
  // 1 appearance / 3 total runs = 33.3%.
  eq(out.competitors[0].visibility, 33.3);
});

await t('normalizeSnapshot: handles null input gracefully', () => {
  eq(normalizeSnapshot(null), null);
});

// ============================================================================
// compareSnapshots
// ============================================================================
await t('compareSnapshots: previous=null returns has_previous=false + null deltas', () => {
  const r = compareSnapshots(MODERN, null);
  eq(r.has_previous, false);
  eq(r.deltas, null);
  eq(r.current.visibility, 65.5);
});

await t('compareSnapshots: positive delta reports positive=true', () => {
  const prev = { visibility_score: 50, citations: 10, mentions: 20, sentiment_score: 70, detection_rate: 75, top3_rate: 30, overall_score: 65 };
  const r = compareSnapshots(MODERN, prev);
  eq(r.has_previous, true);
  eq(r.deltas.visibility.absolute, 15.5);
  eq(r.deltas.visibility.positive, true);
  // Citations: 12 vs 10 = +2.
  eq(r.deltas.citations.absolute, 2);
});

await t('compareSnapshots: negative delta reports positive=false', () => {
  const prev = { visibility_score: 90, citations: 50, mentions: 100, sentiment_score: 95, detection_rate: 100, top3_rate: 80, overall_score: 95 };
  const r = compareSnapshots(MODERN, prev);
  eq(r.deltas.visibility.positive, false);
  if (r.deltas.visibility.absolute >= 0) throw new Error('expected negative delta');
});

await t('compareSnapshots: handles legacy current vs modern previous', () => {
  // Legacy has overall_score + per_query, no visibility_score directly.
  // The compare layer maps overall_score / 5 as a fallback.
  const r = compareSnapshots(LEGACY, MODERN);
  // r.current.visibility derived from overall_score=60 → 12.0.
  eq(r.current.visibility, 12);
  if (!r.has_previous) throw new Error('previous should be present');
});

await t('compareSnapshots: deltas null when both fields are null', () => {
  const sparse = { overall_score: 50 }; // no visibility, no per_query, etc.
  const r = compareSnapshots(sparse, null);
  // No previous means no deltas — verified.
  eq(r.deltas, null);
});

// ============================================================================
// rankBrandWithCompetitors
// ============================================================================
await t('rankBrandWithCompetitors: brand row marked isBrand=true', () => {
  const list = rankBrandWithCompetitors(MODERN, 'Acme');
  const brand = list.find(r => r.isBrand);
  if (!brand) throw new Error('no brand row');
  eq(brand.name, 'Acme');
  eq(brand.visibility, 65.5);
});

await t('rankBrandWithCompetitors: list sorted by visibility DESC', () => {
  // Acme visibility 65.5, BetaCorp visibility 50.
  const list = rankBrandWithCompetitors(MODERN, 'Acme');
  eq(list[0].name, 'Acme', 'higher visibility first');
  eq(list[1].name, 'BetaCorp');
});

await t('rankBrandWithCompetitors: competitor outranking brand sorts above it', () => {
  const snap = {
    visibility_score: 30, mentions: 10, citations: 2, top3_rate: 5, sentiment_score: 60,
    competitors: [
      { name: 'StrongCo', visibility: 80, mentions: 50, citations: 20, top3_rate: 60 },
      { name: 'WeakCo',   visibility: 5,  mentions: 1,  citations: 0,  top3_rate: 0 }
    ]
  };
  const list = rankBrandWithCompetitors(snap, 'Acme');
  eq(list[0].name, 'StrongCo');
  eq(list[1].name, 'Acme');
  eq(list[2].name, 'WeakCo');
});

await t('rankBrandWithCompetitors: handles missing competitors array', () => {
  const list = rankBrandWithCompetitors({ visibility_score: 50 }, 'Acme');
  eq(list.length, 1);
  eq(list[0].name, 'Acme');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
