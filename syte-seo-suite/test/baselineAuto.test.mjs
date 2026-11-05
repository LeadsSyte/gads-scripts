// Automatic Onboarding Baseline: when it starts (shouldAutoBaseline), and
// what the server run captures and saves (runBaselineScan). Every outside
// call is faked.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.localStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; } };
globalThis.sessionStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; } };

const here = path.dirname(fileURLToPath(import.meta.url));
const load = p => import(pathToFileURL(path.join(here, p)).href);
const { shouldAutoBaseline, BASELINE_REFILL_DAYS } = await load('../src/modules/reports/baselineAuto.js');
const { runBaselineScan, newBaselineState, summarizeCrawl, summarizeAeo, buildBaselineData, BASELINE_AEO_MAX_PROMPTS } = await load('../netlify/functions/lib/baselineScan.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function ok(v, label) { if (!v) throw new Error(label || 'expected truthy'); }

const NOW = new Date('2026-11-05T10:00:00Z');
const CLIENT = {
  id: 'c1', name: 'Acme', url: 'https://acme.test/', ga4_property_id: '123', gsc_property: 'sc-domain:acme.test',
  aeo_probe_queries: 'best widgets in cape town\nwidget suppliers south africa'
};

// ── shouldAutoBaseline ─────────────────────────────────────────
await t('new client with sources → run', () => {
  eq(shouldAutoBaseline(CLIENT, null, NOW), { run: true, force: false, reason: 'no-baseline' });
});
await t('client with no website, GA4 or GSC → nothing to capture', () => {
  eq(shouldAutoBaseline({ id: 'c2', name: 'Bare' }, null, NOW).run, false);
});
await t('manual baseline is never replaced', () => {
  const b = { captured_at: NOW.toISOString(), data: { keywords: [] } };
  eq(shouldAutoBaseline(CLIENT, b, NOW).reason, 'manual-baseline');
});
await t('auto baseline missing GSC is refilled once GSC is connected', () => {
  const b = { captured_at: new Date(NOW - 3 * 86400000).toISOString(), data: { baseline: { mode: 'auto', sources: { ga4: 'ok', gsc: 'not_connected' } } } };
  eq(shouldAutoBaseline(CLIENT, b, NOW), { run: true, force: true, reason: 'fill-missing-search' });
});
await t('complete auto baseline is left alone', () => {
  const b = { captured_at: NOW.toISOString(), data: { baseline: { mode: 'auto', sources: { ga4: 'ok', gsc: 'ok' } } } };
  eq(shouldAutoBaseline(CLIENT, b, NOW).run, false);
});
await t('old auto baseline is not refilled', () => {
  const b = { captured_at: new Date(NOW - (BASELINE_REFILL_DAYS + 1) * 86400000).toISOString(), data: { baseline: { mode: 'auto', sources: { ga4: 'not_connected', gsc: 'not_connected' } } } };
  eq(shouldAutoBaseline(CLIENT, b, NOW).reason, 'too-old');
});

// ── summaries ──────────────────────────────────────────────────
await t('summarizeCrawl counts severities and groups widespread issues', () => {
  const crawl = {
    totalCrawled: 3, withIssues: 2, withErrors: 1, urlsDiscovered: 10, discoverySource: 'sitemap',
    pages: [
      { url: 'a', issues: [{ type: 'meta_title', severity: 'high', detail: 'Missing <title> tag entirely' }, { type: 'h1', severity: 'medium', detail: 'No H1' }] },
      { url: 'b', issues: [{ type: 'meta_title', severity: 'high', detail: 'Missing <title> tag entirely' }] },
      { url: 'c', error: 'timeout', skipped: true, issues: [] }
    ]
  };
  const s = summarizeCrawl(crawl);
  eq(s.by_severity, { critical: 0, high: 2, medium: 1, low: 0 });
  eq(s.total_issues, 3);
  eq(s.top_issues[0], { type: 'meta_title', severity: 'high', detail: 'Missing <title> tag entirely', pages: 2 });
  eq(s.pages_unreachable, 1);
});
await t('summarizeAeo keeps headline numbers and one row per prompt', () => {
  const s = summarizeAeo({
    composite_index: 42, coverage_rate: 0.5, share_of_voice: 30, mentions: 3, citations: 1,
    engine_scores: { chatgpt: 50, gemini: 0 }, engines_used: ['chatgpt', 'gemini'], total_runs: 4,
    probe_results: [
      { query: 'q1', engine: 'chatgpt', appearances: 1, appearanceRate: 1, avgPositionWhenAppearing: 2 },
      { query: 'q1', engine: 'gemini', appearances: 0, appearanceRate: 0 },
      { query: 'rev', engine: 'chatgpt', type: 'reverse', appearances: 1 }
    ]
  });
  eq(s.composite_index, 42); eq(s.coverage_pct, 50);
  eq(s.prompts.length, 1);
  eq(s.prompts[0].engines.chatgpt, { appeared: true, rate: 1, position: 2 });
});

// ── runBaselineScan ────────────────────────────────────────────
function fakeDeps(over = {}) {
  const calls = { saved: null, snapshotOpts: null, states: 0, crawled: 0 };
  const deps = {
    loadBaseline: async () => null,
    fetchData: async () => ({ traffic: { current: { users: 100, sessions: 120 } }, keywords: [{ query: 'widgets', position: 4 }], topPages: [], errors: [] }),
    crawl: async () => { calls.crawled++; return { totalCrawled: 1, withIssues: 1, withErrors: 0, pages: [{ url: 'a', issues: [{ type: 'x', severity: 'low', detail: 'd' }] }] }; },
    engines: () => [{ id: 'chatgpt' }],
    extract: async () => ({}),
    snapshot: async (c, opts) => { calls.snapshotOpts = opts; return { composite_index: 10, engine_scores: { chatgpt: 10 }, total_runs: 2, probe_results: [] }; },
    saveBaseline: async (id, month, data) => { calls.saved = { id, month, data }; },
    saveState: async () => { calls.states++; },
    now: () => NOW,
    ...over
  };
  return { deps, calls };
}

await t('full run saves search + technical + AI visibility against the client', async () => {
  const { deps, calls } = fakeDeps();
  const state = newBaselineState(CLIENT, NOW);
  eq(state.month, '2026-10');
  const r = await runBaselineScan(CLIENT, state, deps);
  eq(r.more, false); eq(state.status, 'done');
  eq(calls.saved.id, 'c1'); eq(calls.saved.month, '2026-10');
  const d = calls.saved.data;
  eq(d.keywords.length, 1);
  eq(d.baseline.mode, 'auto');
  eq(d.baseline.sources, { ga4: 'ok', gsc: 'ok', technical: 'ok', aeo: 'ok' });
  eq(d.baseline.technical.total_issues, 1);
  eq(d.baseline.aeo.composite_index, 10);
  ok(!state.sections.traffic.data, 'report data not duplicated in the state row');
});

await t('no gem hunting: one pass, no winner expansion, no new prompts, bounded prompts', async () => {
  const { deps, calls } = fakeDeps();
  await runBaselineScan(CLIENT, newBaselineState(CLIENT, NOW), deps);
  const o = calls.snapshotOpts;
  eq([o.expandWinners, o.newPrompts, o.iterations, o.previousSnapshot, o.maxQueries], [false, 0, 1, null, BASELINE_AEO_MAX_PROMPTS]);
});

await t('existing baseline is not overwritten without force', async () => {
  const { deps, calls } = fakeDeps({ loadBaseline: async () => ({ id: 'b1' }) });
  const state = newBaselineState(CLIENT, NOW);
  await runBaselineScan(CLIENT, state, deps);
  eq(state.status, 'skipped'); eq(calls.saved, null);
});

await t('force replaces an existing baseline', async () => {
  const { deps, calls } = fakeDeps({ loadBaseline: async () => ({ id: 'b1' }) });
  await runBaselineScan(CLIENT, newBaselineState(CLIENT, NOW, { force: true }), deps);
  ok(calls.saved, 'saved');
});

await t('client with only a website: search skipped, still saved', async () => {
  const c = { id: 'c3', name: 'Web Only', url: 'https://w.test', does_aeo: false };
  const { deps, calls } = fakeDeps({ fetchData: async () => { throw new Error('should not be called'); } });
  await runBaselineScan(c, newBaselineState(c, NOW), deps);
  const d = calls.saved.data;
  eq(d.baseline.sources, { ga4: 'not_connected', gsc: 'not_connected', technical: 'ok', aeo: 'skipped' });
  eq(d.keywords, []);
});

await t('a failing section does not stop the others', async () => {
  const { deps, calls } = fakeDeps({ crawl: async () => { throw new Error('blocked by WAF'); } });
  await runBaselineScan(CLIENT, newBaselineState(CLIENT, NOW), deps);
  eq(calls.saved.data.baseline.technical, { status: 'error', error: 'blocked by WAF' });
  eq(calls.saved.data.baseline.aeo.status, 'ok');
});

await t('AEO measurement that runs out of time carries on in the next run', async () => {
  let n = 0;
  const { deps, calls } = fakeDeps({
    snapshot: async (c, opts) => {
      n++;
      if (n === 1) return { partial: true, groups_done: 3, carry: { groups: [{ runs: [{ ok: 1 }] }], runRecords: [] } };
      ok(opts.carry && opts.carry.groups.length === 1, 'carry passed back');
      return { composite_index: 5, engine_scores: {}, total_runs: 1, probe_results: [] };
    }
  });
  const state = newBaselineState(CLIENT, NOW);
  eq((await runBaselineScan(CLIENT, state, deps)).more, true);
  eq(state.stage, 'aeo'); eq(calls.saved, null);
  eq((await runBaselineScan(CLIENT, state, deps)).more, false);
  eq(calls.crawled, 1, 'crawl not repeated');
  eq(calls.saved.data.baseline.aeo.composite_index, 5);
});

await t('buildBaselineData without search data still has the dashboard shape', () => {
  const d = buildBaselineData({ trigger: 'auto', month: '2026-10', sections: { traffic: { ga4: 'not_connected', gsc: 'not_connected', note: 'x' } } });
  eq(d.topPages, []); eq(d.traffic.current, null); eq(d.errors, ['x']);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
