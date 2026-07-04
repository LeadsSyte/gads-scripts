// End-to-end tests for the AEO v2 runSnapshot pipeline. The runner takes
// injected engines + extraction stub (no network, no supabase import), so we
// import it directly and drive it with fakes.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Minimal browser-storage shims so aeoEngines' isConfigured()/activeEngines()
// don't throw if reached.
globalThis.localStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };
globalThis.sessionStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/aeoRunner.js')).href);

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) { if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }
async function expectThrow(fn, re, label) {
  try { await fn(); } catch (e) { if (!re.test(e.message)) throw new Error((label||'')+' wrong error: '+e.message); return; }
  throw new Error((label || '') + ' expected throw');
}

const NOW = '2026-07-01T00:00:00.000Z';
const CLIENT = {
  id: 'c1', name: 'Acme', url: 'https://acme.test/',
  aeo_probe_queries: 'best widgets\nbuy widgets cape town',
  competitors: 'BetaCorp, GammaLtd | gamma.test'
};

// Engine that supports both search modes and always cites the brand at pos 1.
function gptStub(overrides = {}) {
  return {
    id: 'chatgpt', label: 'ChatGPT', model: 'gpt-4o',
    retrievalNative: false, supportsSearchOff: true, isConfigured: () => true,
    ask: async (q, { search } = {}) => ({
      text: 'Acme is the best widget maker. See https://acme.test/',
      raw: { choices: [{ message: { annotations: [{ url_citation: { url: 'https://acme.test/' } }] } }] },
      model: search ? 'gpt-4o-search-preview' : 'gpt-4o',
      searchMode: search ? 'search_on' : 'search_off'
    }),
    ...overrides
  };
}
const extractAppears = async () => ({
  appeared: true, position: 1, listLength: 2, segmentLabel: 'best for widgets',
  reasonPhrase: 'top rated', sentiment: 'positive', competitorsNamed: []
});

// ── Guard rails ─────────────────────────────────────────────
await t('runSnapshot: refuses without client.id', () =>
  expectThrow(() => mod.runSnapshot({}, { engines: [gptStub()] }), /pick a client first/i));

await t('runSnapshot: refuses with no engines', () =>
  expectThrow(() => mod.runSnapshot(CLIENT, { engines: [] }), /No AI engines/));

await t('runSnapshot: refuses with no active probes', () =>
  expectThrow(() => mod.runSnapshot({ ...CLIENT, aeo_probes: [], aeo_probe_queries: '', aeo_census: null }, { engines: [gptStub()] }), /no active AEO probes/i));

// ── AC2: per-probe scoring + portfolio metrics ─────────────
await t('AC2: probe_results carry appearanceRate/avgPos/visibilityScore; portfolio has coverage/SoV/composite', async () => {
  const snap = await mod.runSnapshot(CLIENT, { engines: [gptStub()], extract: extractAppears, iterations: 1, now: NOW });
  ok(snap.probe_results.length > 0, 'probe_results present');
  const scorable = snap.probe_results.filter(r => r.type !== 'reverse');
  for (const r of scorable) {
    eq(r.appearanceRate, 1, 'ar=1 ' + r.query);
    eq(r.avgPositionWhenAppearing, 1, 'avgPos=1');
    eq(r.visibilityScore, 100, 'vis=100');
  }
  eq(snap.coverage_rate, 1, 'coverage 100%');
  eq(snap.prompt_coverage, 2, 'named in 2 probes');
  eq(snap.share_of_voice, 100, 'SoV 100% (no competitor mentions)');
  ok(snap.composite_index > 0, 'composite > 0');
  eq(snap.overall_score, snap.composite_index, 'overall == composite');
});

// ── AC5: dual-mode — search_on and search_off stored separately ─
await t('AC5: tier-1 probe on ChatGPT produces separate search_off + search_on results', async () => {
  const runs = [];
  const snap = await mod.runSnapshot(CLIENT, {
    engines: [gptStub()], extract: extractAppears, iterations: 1, now: NOW,
    onRuns: (records) => { runs.push(...records); }
  });
  const row = snap.probe_results.find(r => r.type !== 'reverse' && r.engine === 'chatgpt');
  ok(row.modes.search_off, 'search_off scored');
  ok(row.modes.search_on, 'search_on scored');
  // Raw run records: both modes present for the same probe on chatgpt.
  const modesForProbe = new Set(runs.filter(r => r.probeId === row.probeId && r.engine === 'chatgpt').map(r => r.runMode));
  ok(modesForProbe.has('search_off') && modesForProbe.has('search_on'), 'both modes recorded');
});

// ── Retrieval-native engine runs search_on only ─────────────
await t('retrieval-native engine (perplexity) runs search_on only even for a both-mode probe', async () => {
  const px = { id: 'perplexity', label: 'Perplexity', model: 'sonar', retrievalNative: true, supportsSearchOff: false, isConfigured: () => true,
    ask: async () => ({ text: 'Acme leads.', raw: { citations: ['https://acme.test/'] }, searchMode: 'search_on' }) };
  const snap = await mod.runSnapshot(CLIENT, { engines: [px], extract: extractAppears, iterations: 1, now: NOW });
  const row = snap.probe_results.find(r => r.engine === 'perplexity' && r.type !== 'reverse');
  ok(row.modes.search_on && !row.modes.search_off, 'only search_on');
});

// ── Errored engine skips, does not abort; engines_used reflects actual ─
await t('errored engine does not abort; engines_used reflects engines that ran', async () => {
  const bad = { id: 'gemini', label: 'Gemini', model: 'g', retrievalNative: true, supportsSearchOff: false, isConfigured: () => true, ask: async () => ({ error: 'rate limit', status: 429 }) };
  const snap = await mod.runSnapshot(CLIENT, { engines: [gptStub(), bad], extract: extractAppears, iterations: 1, now: NOW });
  ok(snap.engines_used.includes('chatgpt'), 'chatgpt ran');
  ok(!snap.engines_used.includes('gemini'), 'gemini did not run (all errored)');
  eq(snap.coverage_rate, 1, 'coverage still computed from actual runs');
});

// ── Reverse probes excluded from coverage/index ─────────────
await t('reverse probes run but are excluded from scorable coverage', async () => {
  const snap = await mod.runSnapshot(CLIENT, { engines: [gptStub()], extract: extractAppears, iterations: 1, now: NOW });
  eq(snap.scorable_probes, 2, 'only 2 scorable (reverse excluded)');
  const reverseRows = snap.probe_results.filter(r => r.type === 'reverse');
  ok(reverseRows.length > 0, 'reverse probes did run');
});

// ── Absence handled: avgPos null, visibility 0 ──────────────
await t('brand never appears → visibilityScore 0, avgPos null, coverage 0', async () => {
  const extractAbsent = async () => ({ appeared: false, position: null, listLength: 3, segmentLabel: null, reasonPhrase: null, sentiment: 'neutral', competitorsNamed: ['BetaCorp'] });
  const snap = await mod.runSnapshot(CLIENT, { engines: [gptStub()], extract: extractAbsent, iterations: 2, now: NOW });
  const row = snap.probe_results.find(r => r.type !== 'reverse');
  eq(row.appearanceRate, 0, 'ar 0');
  eq(row.avgPositionWhenAppearing, null, 'avgPos null');
  eq(row.visibilityScore, 0, 'vis 0');
  eq(snap.coverage_rate, 0, 'coverage 0');
  ok(snap.share_of_voice < 100, 'competitors took share');
});

// ── Cost preview ────────────────────────────────────────────
await t('estimateRunCost: totals probes×engines×modes×N', async () => {
  const est = mod.estimateRunCost(CLIENT, { engines: [gptStub()], iterations: 3 });
  // 2 scorable + 2 reverse = 4 active probes. chatgpt: reverse runMode search_on (1 mode),
  // scorable runMode 'both' (2 modes). engineCalls = (2*2 + 2*1)*3 = 18.
  eq(est.engineCalls, 18, 'engine calls');
  eq(est.totalCalls, 36, 'engine + extraction calls');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
