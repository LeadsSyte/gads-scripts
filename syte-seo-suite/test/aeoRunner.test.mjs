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

// ── Segment labels + reasons surfaced (the qualitative core) ─
await t('probe_results + per_query carry segment labels, reasons and avg list length', async () => {
  const extractRich = async () => ({
    appeared: true, position: 2, listLength: 8, segmentLabel: 'Best for Copilot Studio agents',
    reasonPhrase: 'strong Dataverse integration', sentiment: 'positive', competitorsNamed: []
  });
  const snap = await mod.runSnapshot(CLIENT, { engines: [gptStub()], extract: extractRich, iterations: 2, now: NOW });
  const pr = snap.probe_results.find(r => r.type !== 'reverse');
  ok(pr.segmentLabels.includes('Best for Copilot Studio agents'), 'segment label captured');
  ok(pr.reasons.includes('strong Dataverse integration'), 'reason captured');
  eq(pr.avgListLength, 8, 'avg list length');
  const pq = snap.per_query.find(r => r.mentioned);
  ok(pq.segment_labels.includes('Best for Copilot Studio agents'), 'per_query segment label');
  eq(pq.reason, 'strong Dataverse integration', 'per_query reason');
  eq(pq.avg_list_length, 8, 'per_query avg list length');
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
  const bad = { id: 'gemini', label: 'Gemini', model: 'g', retrievalNative: true, supportsSearchOff: false, isConfigured: () => true, ask: async () => ({ error: 'server 500' }) };
  const snap = await mod.runSnapshot(CLIENT, { engines: [gptStub(), bad], extract: extractAppears, iterations: 1, now: NOW });
  ok(snap.engines_used.includes('chatgpt'), 'chatgpt ran');
  ok(!snap.engines_used.includes('gemini'), 'gemini did not run (all errored)');
  eq(snap.coverage_rate, 1, 'coverage still computed from actual runs');
  // engine_health (ported from main) surfaces the failing engine for the UI.
  ok(snap.engine_health, 'engine_health present');
  eq(snap.engine_health.gemini.all_failed, true, 'gemini all_failed');
  ok(snap.engine_health.gemini.errors > 0, 'gemini errors recorded');
  eq(snap.engine_health.chatgpt.all_failed, false, 'chatgpt healthy');
});

// ── Engine cools down (not killed) on sustained rate-limit ──
await t('rateLimited engine cools down — bounded calls, not every probe', async () => {
  let calls = 0;
  const limited = {
    id: 'chatgpt', label: 'ChatGPT', model: 'gpt-4o', retrievalNative: false, supportsSearchOff: true, isConfigured: () => true,
    ask: async () => { calls++; return { error: 'OpenAI 429 rate limit', rateLimited: true }; }
  };
  await mod.runSnapshot(CLIENT, { engines: [limited], extract: extractAppears, iterations: 3, retryDelayMs: 0, sleep: async () => {}, now: NOW });
  // A 429 triggers a cooldown window rather than paying the API on every probe,
  // so real calls stay well below the full precount (but the engine does retry).
  ok(calls >= 1 && calls < 10, 'cooldown kept calls bounded (calls=' + calls + ')');
});

// ── Cooldown RECOVERS: an engine that rate-limits early still contributes ──
await t('engine that rate-limits early recovers and returns data after cooldown', async () => {
  let calls = 0;
  const recovering = {
    id: 'chatgpt', label: 'ChatGPT', model: 'gpt-4o', retrievalNative: false, supportsSearchOff: true, isConfigured: () => true,
    ask: async (q, { search } = {}) => {
      calls++;
      // First call 429s (would previously bench the engine for the whole sweep);
      // every call after the cooldown succeeds.
      if (calls === 1) return { error: 'OpenAI 429 rate limit', rateLimited: true };
      return { text: 'Acme is the best.', raw: {}, searchMode: search ? 'search_on' : 'search_off' };
    }
  };
  const snap = await mod.runSnapshot(CLIENT, { engines: [recovering], extract: extractAppears, iterations: 3, retryDelayMs: 0, sleep: async () => {}, now: NOW });
  ok(snap.engines_used.includes('chatgpt'), 'engine recovered after cooldown (was permanently benched before)');
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

// ── Hardening: 429 backoff + concurrency cap ────────────────
await t('429 backoff: retries past transient 429s then succeeds', async () => {
  let calls = 0;
  const flaky = {
    id: 'chatgpt', label: 'ChatGPT', model: 'gpt-4o', retrievalNative: false, supportsSearchOff: true, isConfigured: () => true,
    ask: async (q, { search } = {}) => {
      calls++;
      if (calls <= 2) return { error: '429 rate limit', status: 429 };
      return { text: 'Acme wins', raw: {}, searchMode: search ? 'search_on' : 'search_off' };
    }
  };
  const snap = await mod.runSnapshot(CLIENT, { engines: [flaky], extract: extractAppears, iterations: 1, retries: 3, retryDelayMs: 0, sleep: async () => {}, now: NOW });
  ok(calls > 2, 'retried past the 429s (calls=' + calls + ')');
  ok(snap.engines_used.includes('chatgpt'), 'engine ran after backoff');
});

await t('concurrency cap: never more than 2 requests in-flight per engine', async () => {
  let inFlight = 0, maxSeen = 0;
  const eng = {
    id: 'chatgpt', label: 'ChatGPT', model: 'gpt-4o', retrievalNative: false, supportsSearchOff: true, isConfigured: () => true,
    ask: async (q, { search } = {}) => {
      inFlight++; maxSeen = Math.max(maxSeen, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return { text: 'Acme', raw: {}, searchMode: search ? 'search_on' : 'search_off' };
    }
  };
  await mod.runSnapshot(CLIENT, { engines: [eng], extract: extractAppears, iterations: 2, concurrency: 2, now: NOW });
  ok(maxSeen <= 2 && maxSeen > 0, 'peak in-flight was ' + maxSeen + ' (<=2)');
});

// ── A repeatedly-failing engine cools down (no hang, but not permanently dead) ──
await t('engine failing repeatedly (e.g. 504 storm) cools down after 3 misses', async () => {
  let calls = 0;
  const flaky = {
    id: 'chatgpt', label: 'ChatGPT', model: 'gpt-4o', retrievalNative: false, supportsSearchOff: true, isConfigured: () => true,
    ask: async () => { calls++; return { error: 'OpenAI 504 gateway timeout' }; } // not rateLimited/configError
  };
  await mod.runSnapshot(CLIENT, { engines: [flaky], extract: extractAppears, iterations: 3, retryDelayMs: 0, sleep: async () => {}, now: NOW });
  // After 3 straight failures the engine cools down instead of paying the API on
  // every probe, so total real calls stay small (a few bursts, not one-per-probe).
  ok(calls >= 3 && calls < 14, 'cooled down after a few failures (calls=' + calls + ')');
});

// ── A genuine config / bad-key error DOES permanently disable ──
await t('configError permanently disables the engine (no pointless retries)', async () => {
  let calls = 0;
  const badKey = {
    id: 'chatgpt', label: 'ChatGPT', model: 'gpt-4o', retrievalNative: false, supportsSearchOff: true, isConfigured: () => true,
    ask: async () => { calls++; return { error: 'OpenAI 401 invalid key', configError: true }; }
  };
  await mod.runSnapshot(CLIENT, { engines: [badKey], extract: extractAppears, iterations: 3, concurrency: 1, retryDelayMs: 0, sleep: async () => {}, now: NOW });
  ok(calls === 1, 'benched permanently on the first config error (calls=' + calls + ')');
});

// ── Retrieval-first scoring: parametric runs must not dilute the score ─
await t('parametric no-search runs do not dilute the engine score (retrieval is the headline)', async () => {
  const eng = {
    id: 'chatgpt', label: 'ChatGPT', model: 'gpt-4o', retrievalNative: false, supportsSearchOff: true, isConfigured: () => true,
    ask: async (q, { search } = {}) => ({
      text: search ? 'Acme is a top pick. WEB' : 'I do not have enough information.',
      raw: {}, searchMode: search ? 'search_on' : 'search_off'
    })
  };
  // Appears only when web search is on (like ChatGPT in real life).
  const extractByMode = async ({ text }) => text.includes('WEB')
    ? { appeared: true, position: 1, listLength: 3, segmentLabel: 'best for X', reasonPhrase: 'good', sentiment: 'positive', competitorsNamed: [] }
    : { appeared: false, position: null, listLength: null, segmentLabel: null, reasonPhrase: null, sentiment: 'neutral', competitorsNamed: [] };
  const snap = await mod.runSnapshot(CLIENT, { engines: [eng], extract: extractByMode, iterations: 3, now: NOW });
  // 3/3 retrieval runs appear, 0/3 parametric. Headline = 100 (retrieval), not
  // 50 (the blend that made ChatGPT look broken).
  eq(snap.engine_scores.chatgpt, 100, 'engine score is retrieval-only (100), not blended (50)');
  const row = snap.probe_results.find(r => r.type !== 'reverse' && r.engine === 'chatgpt');
  eq(row.appearanceRate, 1, 'headline appearanceRate from retrieval');
  eq(row.parametric_appearance_rate, 0, 'parametric reported separately as 0');
  eq(snap.coverage_rate, 1, 'coverage counts the retrieval win');
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
