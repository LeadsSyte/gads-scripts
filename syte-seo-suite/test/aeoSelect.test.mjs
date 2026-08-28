// Site-wide AEO shortlist — the ranker that replaced "5 optimizations per
// page, every page". Guards the properties the hand-off depends on: a hard
// total, no single page hogging the list, content beating schema, and a
// deterministic result.

import {
  selectTopOptimizations,
  scoreOptimization,
  aeoItemTarget,
  pagesForTarget,
  AEO_ITEMS_PER_RUN,
  MAX_OPTS_PER_PAGE
} from '../src/modules/aeo/aeoSelect.js';
import { buildAeoSystem } from '../src/modules/aeo/aeoTypes.js';

let failed = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ✓ ' + name); return; }
  failed++;
  console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''));
}

const opt = (type, name, i = 0) => ({
  type, name,
  description: name,
  implementation: '<p>' + name + ' ' + i + '</p>',
  where: 'After the H1'
});

// A realistic run: 5 pages × 3 optimizations = 15 generated.
function makeRows(pages = 5, per = 3) {
  return Array.from({ length: pages }, (_, p) => ({
    url: 'https://example.com/page-' + p,
    path: '/page-' + p,
    sessions: (pages - p) * 100,
    optimizations: Array.from({ length: per }, (_, i) =>
      opt(i === 0 ? 'content' : i === 1 ? 'structure' : 'schema', 'Item ' + p + '-' + i, i)
    )
  }));
}

console.log('=== aeoSelect ===');

// ---- total cap ------------------------------------------------------------
{
  const res = selectTopOptimizations(makeRows(5, 3), { limit: 10 });
  check('keeps exactly the limit when more were generated', res.kept === 10, 'kept=' + res.kept);
  check('reports what was dropped', res.dropped === 5, 'dropped=' + res.dropped);
  const total = res.rows.reduce((n, r) => n + r.optimizations.length, 0);
  check('rows carry only the kept items', total === 10, 'total=' + total);
}

// A 12-page client is the case that produced 60 items before.
{
  const res = selectTopOptimizations(makeRows(12, 5), { limit: 10 });
  const total = res.rows.reduce((n, r) => n + r.optimizations.length, 0);
  check('12-page run still hands back 10, not 60', total === 10, 'total=' + total);
}

// ---- per-page cap ---------------------------------------------------------
{
  // One huge-traffic page with 8 strong items — it must not take the lot.
  const rows = [
    {
      url: 'https://example.com/', sessions: 50000,
      optimizations: Array.from({ length: 8 }, (_, i) => opt('content', 'Answer Block ' + i, i))
    },
    ...makeRows(4, 3)
  ];
  const res = selectTopOptimizations(rows, { limit: 10, maxPerPage: 3 });
  const home = res.rows.find(r => r.url === 'https://example.com/');
  check('no page contributes more than maxPerPage', home.optimizations.length <= 3,
    'homepage got ' + home.optimizations.length);
  check('shortlist spreads across pages', res.rows.filter(r => r.optimizations.length).length >= 4,
    res.rows.filter(r => r.optimizations.length).length + ' pages');
}

// ---- content beats schema -------------------------------------------------
{
  const rows = [{
    url: 'https://example.com/x', sessions: 100,
    optimizations: [
      opt('schema', 'WebPage Schema', 0),
      opt('schema', 'Breadcrumb Schema', 1),
      opt('content', 'Answer Block', 2)
    ]
  }];
  const res = selectTopOptimizations(rows, { limit: 1 });
  check('a content item outranks schema even when listed last',
    res.rows[0].optimizations[0].type === 'content',
    'kept ' + res.rows[0].optimizations[0].name);
}

{
  // 10 slots, schema everywhere — the schema share stays capped.
  const rows = Array.from({ length: 6 }, (_, p) => ({
    url: 'https://example.com/s' + p, sessions: 100,
    optimizations: [opt('schema', 'FAQ Schema', 0), opt('schema', 'Article Schema', 1), opt('content', 'FAQ Content Section', 2)]
  }));
  const res = selectTopOptimizations(rows, { limit: 10 });
  const schema = res.rows.flatMap(r => r.optimizations).filter(o => o.type === 'schema').length;
  check('schema never dominates the shortlist', schema <= 3, schema + ' schema items kept');
}

// ---- unshippable items sink ----------------------------------------------
{
  const rows = [{
    url: 'https://example.com/y', sessions: 10,
    optimizations: [
      { type: 'content', name: 'Answer Block', implementation: '' },
      opt('schema', 'Article Schema', 1)
    ]
  }];
  const res = selectTopOptimizations(rows, { limit: 1 });
  check('an item with no pasteable code loses to one that has code',
    res.rows[0].optimizations[0].name === 'Article Schema',
    'kept ' + res.rows[0].optimizations[0].name);
}

// ---- empty + error rows ---------------------------------------------------
{
  const rows = [
    { url: 'https://example.com/ok', sessions: 10, optimizations: [opt('content', 'Answer Block')] },
    { url: 'https://example.com/dead', sessions: 0, optimizations: [], error: 'CORS blocked' },
    { url: 'https://example.com/trimmed', sessions: 5, optimizations: [opt('schema', 'WebPage Schema')] }
  ];
  const res = selectTopOptimizations(rows, { limit: 1 });
  check('error rows survive so failures stay visible',
    res.rows.some(r => r.url.endsWith('/dead')), JSON.stringify(res.rows.map(r => r.url)));
  check('pages trimmed to nothing are dropped (so rotation revisits them)',
    !res.rows.some(r => r.url.endsWith('/trimmed')), JSON.stringify(res.rows.map(r => r.url)));
}

// ---- determinism ----------------------------------------------------------
{
  const a = selectTopOptimizations(makeRows(6, 3), { limit: 10 });
  const b = selectTopOptimizations(makeRows(6, 3), { limit: 10 });
  check('same input → same shortlist', JSON.stringify(a.rows) === JSON.stringify(b.rows));
}

// ---- traffic tie-break ----------------------------------------------------
{
  const rows = [
    { url: 'https://example.com/low', sessions: 1, optimizations: [opt('content', 'Answer Block')] },
    { url: 'https://example.com/high', sessions: 9000, optimizations: [opt('content', 'Answer Block')] }
  ];
  const res = selectTopOptimizations(rows, { limit: 1 });
  check('between equal items the higher-traffic page wins',
    res.rows.length === 1 && res.rows[0].url.endsWith('/high'),
    JSON.stringify(res.rows.map(r => r.url)));
  check('scoreOptimization rewards traffic',
    scoreOptimization(opt('content', 'Answer Block'), { sessions: 9000 }) >
    scoreOptimization(opt('content', 'Answer Block'), { sessions: 1 }));
}

// ---- targets + page maths -------------------------------------------------
{
  check('default target is 10', aeoItemTarget({}) === AEO_ITEMS_PER_RUN && AEO_ITEMS_PER_RUN === 10);
  check('per-client override is honoured', aeoItemTarget({ aeo_items_per_month: 6 }) === 6);
  check('junk override falls back to the default', aeoItemTarget({ aeo_items_per_month: 0 }) === 10);
  check('override is capped', aeoItemTarget({ aeo_items_per_month: 999 }) === 50);
  check('10 items → 5 pages, not 15', pagesForTarget(10, 500) === 5);
  check('page count never exceeds what the site has', pagesForTarget(10, 2) === 2);
  check('always at least one page', pagesForTarget(1, 500) === 1);
}

// ---- prompt reflects the caps --------------------------------------------
{
  const sys = buildAeoSystem(MAX_OPTS_PER_PAGE, 10);
  check('prompt has no leftover placeholders', !/__[A-Z_]+__/.test(sys),
    (sys.match(/__[A-Z_]+__/g) || []).join(', '));
  check('prompt states the per-page cap', sys.includes('at most 3 COPY-PASTE READY'));
  check('prompt states the site-wide shortlist', sys.includes('shortlist of 10'));
  check('prompt no longer demands exactly 5', !/exactly 5/.test(sys));
}

console.log(failed === 0 ? '\nAll aeoSelect checks passed' : '\n' + failed + ' check(s) failed');
process.exit(failed === 0 ? 0 : 1);
