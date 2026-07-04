// Tests the v2 normalize shim + compare deltas. Ensures pre-v2 single-shot
// snapshots map into the recursive-engine shape (N=1, appearanceRate = cited?1:0,
// avgPositionWhenAppearing = old position) and render without errors (AC1).

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const c = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/aeoCompare.js')).href);

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) { if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }

const OLD = {
  month: '2026-05', overall_score: 40,
  per_query: [
    { query: 'best widgets', engine: 'chatgpt', mentioned: true, position: 2 },
    { query: 'buy widgets', engine: 'chatgpt', mentioned: false, position: null }
  ],
  competitors: [{ name: 'BetaCorp', appearances: 1 }],
  sentiment: '80% positive'
};

t('normalize: old snapshot maps to N=1 probe_results with appearanceRate 0/1', () => {
  const n = c.normalizeSnapshot(OLD);
  ok(n.probe_results, 'probe_results built');
  const hit = n.probe_results.find(r => r.query === 'best widgets');
  const miss = n.probe_results.find(r => r.query === 'buy widgets');
  eq(hit.appearanceRate, 1, 'cited → ar 1');
  eq(hit.avgPositionWhenAppearing, 2, 'avgPos = old position');
  eq(hit.visibilityScore, 50, 'vis = 1*(1/2)*100');
  eq(hit.runs, 1, 'N=1');
  eq(miss.appearanceRate, 0, 'uncited → ar 0');
  eq(miss.avgPositionWhenAppearing, null, 'uncited → avgPos null');
  eq(miss.visibilityScore, 0, 'uncited → vis 0');
});

t('normalize: derives coverage_rate / prompt_coverage / composite_index', () => {
  const n = c.normalizeSnapshot(OLD);
  eq(n.coverage_rate, 0.5, 'coverage 1 of 2');
  eq(n.prompt_coverage, 1, 'one query covered');
  eq(n.composite_index, 40, 'composite from overall_score');
});

t('normalize: idempotent on a v2 snapshot', () => {
  const v2 = { coverage_rate: 0.8, composite_index: 70, probe_results: [{ query: 'x' }] };
  eq(c.normalizeSnapshot(v2), v2, 'returned unchanged');
});

t('normalize: does not throw on an empty/degenerate snapshot', () => {
  const n = c.normalizeSnapshot({ month: '2026-01' });
  ok(n.probe_results, 'probe_results present (empty ok)');
  eq(n.coverage_rate, 0, 'coverage 0');
});

t('compare: coverage + composite deltas computed', () => {
  const prev = c.normalizeSnapshot(OLD);                       // coverage .5, composite 40
  const curr = { coverage_rate: 0.75, composite_index: 60, probe_results: [{}] };
  const cmp = c.compareSnapshots(curr, prev);
  eq(cmp.deltas.coverage.absolute, 25, 'coverage +25pp');   // 75 - 50
  eq(cmp.deltas.composite.absolute, 20, 'composite +20');   // 60 - 40
  ok(cmp.has_previous, 'has previous');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
