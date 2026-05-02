// approval_webapp.js — Phase F. Pin the pure helpers used by the
// approval web app:
//   • _catLabel — category key → friendly label
//   • _countCategory — counts items in a changes JSON section
//   • _escape — HTML-escapes user-controlled strings (XSS safety)
//   • _summarizeChangesDashboard — short text summary of a parsed changes obj

import { loadGasScript, makeStubs } from './gas-harness.mjs';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

const HELPERS = ['_catLabel', '_countCategory', '_escape', '_summarizeChangesDashboard'];

// ============================================================================
// _catLabel
// ============================================================================
await t('_catLabel: known categories return the friendly label', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('approval_webapp.js', HELPERS, stubs);
  eq(mod._catLabel('keyword_pauses'), 'Keyword Pauses');
  eq(mod._catLabel('winner_promotions'), 'Winner Promotions');
  eq(mod._catLabel('shopping_pmax'), 'Shopping/PMax');
  eq(mod._catLabel('flagged_review_negations'), 'Flagged Review Negations');
});

await t('_catLabel: unknown key passes through', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('approval_webapp.js', HELPERS, stubs);
  eq(mod._catLabel('something_new'), 'something_new');
});

// ============================================================================
// _countCategory — counts every array in a category object
// ============================================================================
await t('_countCategory: missing category returns 0', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('approval_webapp.js', HELPERS, stubs);
  eq(mod._countCategory({}, 'keyword_pauses'), 0);
});

await t('_countCategory: sums lengths of every array in the section', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('approval_webapp.js', HELPERS, stubs);
  const changes = {
    keyword_pauses: {
      keywordsPaused: ['a', 'b', 'c'],
      ecomKeywordsPaused: ['d'],
      lowQsPaused: ['e', 'f']
    }
  };
  eq(mod._countCategory(changes, 'keyword_pauses'), 6);
});

await t('_countCategory: ignores non-array values', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('approval_webapp.js', HELPERS, stubs);
  const changes = {
    keyword_pauses: {
      keywordsPaused: ['a'],
      meta: { foo: 'bar' }, // not an array — must NOT count
      summary: 'text',
      lowQsPaused: ['x', 'y']
    }
  };
  eq(mod._countCategory(changes, 'keyword_pauses'), 3);
});

// ============================================================================
// _escape — HTML safety (every approval page renders user-supplied data)
// ============================================================================
await t('_escape: escapes &, <, >, "', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('approval_webapp.js', HELPERS, stubs);
  eq(mod._escape('Tom & Jerry'), 'Tom &amp; Jerry');
  eq(mod._escape('<b>bold</b>'), '&lt;b&gt;bold&lt;/b&gt;');
  eq(mod._escape('say "hi"'), 'say &quot;hi&quot;');
});

await t('_escape: REGRESSION — script tags fully escaped (no XSS)', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('approval_webapp.js', HELPERS, stubs);
  const out = mod._escape('<script>alert(1)</script>');
  if (/<script>/.test(out)) throw new Error('script tag not escaped: ' + out);
  eq(out, '&lt;script&gt;alert(1)&lt;/script&gt;');
});

await t('_escape: null + undefined return empty string (not "null")', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('approval_webapp.js', HELPERS, stubs);
  eq(mod._escape(null), '');
  eq(mod._escape(undefined), '');
});

await t('_escape: numbers stringified', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('approval_webapp.js', HELPERS, stubs);
  eq(mod._escape(42), '42');
});

// ============================================================================
// _summarizeChangesDashboard — drives the "Pending Changes" overview row
// ============================================================================
await t('_summarizeChangesDashboard: empty changes → "No changes"', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('approval_webapp.js', HELPERS, stubs);
  eq(mod._summarizeChangesDashboard({}), 'No changes');
});

await t('_summarizeChangesDashboard: aggregates all categories with counts', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('approval_webapp.js', HELPERS, stubs);
  const changes = {
    keyword_pauses: { keywordsPaused: ['a'], lowQsPaused: ['b'] },
    search_term_negations: { smartNegated: ['x', 'y'] },
    winner_promotions: { winnersPromoted: ['w'] },
    auto_optimizations: { deviceAdjustments: ['d'], scheduleAdjustments: [], geoAdjustments: [] }
  };
  const summary = mod._summarizeChangesDashboard(changes);
  if (!/2 kw pauses/.test(summary)) throw new Error('kw count wrong: ' + summary);
  if (!/2 negations/.test(summary)) throw new Error('neg count wrong: ' + summary);
  if (!/1 winner/.test(summary)) throw new Error('winner count wrong: ' + summary);
  if (!/1 bid/.test(summary)) throw new Error('bid count wrong: ' + summary);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
