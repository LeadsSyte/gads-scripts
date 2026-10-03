// Carry-forward: last month's long-tail prompts seed this month's run.
// Pure selection/stamping, plus an end-to-end two-month run through
// runSnapshot with a mock engine.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.localStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };
globalThis.sessionStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cf = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/aeoCarryForward.js')).href);
const runner = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/aeoRunner.js')).href);

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }
function eq(a, b, label) { if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

// ---- pure selection ---------------------------------------------------------
await t('no previous snapshot carries nothing', async () => {
  eq(cf.carriedPromptsFrom(null).length, 0);
  eq(cf.carriedPromptsFrom({ month: '2026-08' }).length, 0);
});

await t('winners first, misses kept for one more month, repeat misses dropped', async () => {
  const prev = {
    month: '2026-08',
    expansion_probes: [
      { query: 'loser twice', won: false, misses: 2 },
      { query: 'loser once', won: false, misses: 1 },
      { query: 'winner', won: true, misses: 0 }
    ]
  };
  const got = cf.carriedPromptsFrom(prev);
  eq(got.map(p => p.query).join('|'), 'winner|loser once');
  eq(got[0].source, 'carried');
  eq(got[0].carriedFrom, '2026-08');
  ok(got[0].wonLastMonth && !got[1].wonLastMonth, 'wonLastMonth');
});

await t('older snapshots: outcome derived from probe_results; long-tail found by id', async () => {
  const prev = {
    month: '2026-08',
    probe_results: [
      { probeId: 'c1-FO1', query: 'best x in dublin', tier: 2, type: 'qualified', intent: 'local', appearances: 2, visibilityScore: 40 },
      { probeId: 'c1-FO2', query: 'best x in cork', tier: 2, type: 'qualified', intent: 'local', appearances: 0, visibilityScore: 0 },
      { probeId: 'ACM-001', query: 'best x in ireland', tier: 1, type: 'category', intent: 'commercial', appearances: 3, visibilityScore: 60 }
    ]
  };
  const got = cf.carriedPromptsFrom(prev);
  eq(got.map(p => p.query).join('|'), 'best x in dublin|best x in cork', 'only long-tail, winner first');
  eq(got[1].misses, 1);
});

await t('cap and exclude are honoured', async () => {
  const prev = { month: '2026-08', expansion_probes: [1, 2, 3, 4, 5].map(i => ({ query: 'q' + i, won: true })) };
  eq(cf.carriedPromptsFrom(prev, { max: 2 }).length, 2);
  eq(cf.carriedPromptsFrom(prev, { exclude: ['Q1', 'q2'] }).map(p => p.query).join('|'), 'q3|q4|q5');
});

await t('stamping counts consecutive misses for carried prompts', async () => {
  const stamped = cf.stampLongTail([
    { query: 'a', source: 'carried', misses: 1, wonLastMonth: false },
    { query: 'b', source: 'carried', misses: 0, wonLastMonth: true },
    { query: 'c', source: 'fanout' }
  ], new Set(['a']), '2026-09');
  eq(stamped[0].misses, 0); eq(stamped[1].misses, 1); eq(stamped[2].misses, 1);
  const s = cf.carryForwardSummary(stamped, '2026-08');
  eq(s.carried, 2); eq(s.newly_won, 1); eq(s.lost, 1); eq(s.new_prompts, 1); eq(s.new_won, 0);
});

// ---- two months through runSnapshot ----------------------------------------
function stemWinnerEngine(log) {
  return {
    id: 'chatgpt', label: 'ChatGPT', model: 'gpt-4o', retrievalNative: false, supportsSearchOff: true,
    isConfigured: () => true,
    ask: async (q) => {
      log?.push(q);
      const wins = /document intelligence/i.test(q);
      return { text: wins ? 'Acme is a top provider. https://acme.test/' : 'No specific brands.', raw: {}, searchMode: 'search_on' };
    }
  };
}
const extractByText = async ({ text }) => /acme/i.test(text)
  ? { appeared: true, position: 1, listLength: 3, segmentLabel: 'doc intelligence', reasonPhrase: 'top', sentiment: 'positive', competitorsNamed: [] }
  : { appeared: false, position: null, listLength: null, segmentLabel: null, reasonPhrase: null, sentiment: 'neutral', competitorsNamed: [] };
const CLIENT = {
  id: 'c1', name: 'Acme', url: 'https://acme.test/',
  aeo_probe_queries: 'best azure document intelligence company in ireland\nbest widgets in ireland',
  competitors: 'BetaCorp'
};
const opts = { extract: extractByText, iterations: 1, retrievalOnly: true, expandWinners: true, winnerTarget: 30, maxExpansionDepth: 1, maxExpansionQueries: 6 };

await t('month two re-runs month one\'s long-tail and explores new prompts', async () => {
  const m1 = await runner.runSnapshot(CLIENT, { ...opts, engines: [stemWinnerEngine()], now: '2026-08-01T00:00:00.000Z' });
  ok(m1.expansion_count > 0, 'month one should expand');
  eq(m1.carry_forward.carried, 0, 'nothing carried in month one');
  ok(m1.expansion_probes.every(p => typeof p.won === 'boolean'), 'month one prompts stamped with outcome');

  const asked = [];
  const m2 = await runner.runSnapshot(CLIENT, {
    ...opts, engines: [stemWinnerEngine(asked)], now: '2026-09-01T00:00:00.000Z',
    previousSnapshot: { ...m1, month: '2026-08' }
  });
  const m1Queries = m1.expansion_probes.map(p => p.query.toLowerCase());
  for (const q of m1Queries) ok(asked.some(a => a.toLowerCase() === q), 'carried prompt not re-asked: ' + q);
  eq(m2.carry_forward.carried, m1Queries.length, 'carried count');
  eq(m2.carry_forward.carried_from, '2026-08');
  // Nothing asked twice; the new expansion is all new ground.
  eq(new Set(asked.map(a => a.toLowerCase())).size, asked.length, 'a prompt was asked twice');
  const fresh = m2.expansion_probes.filter(p => p.source !== 'carried');
  ok(fresh.every(p => !m1Queries.includes(p.query.toLowerCase())), 'rediscovered a carried prompt');
  eq(m2.expansion_count, fresh.length, 'expansion_count counts new prompts only');
  // Carried prompts count in the headline like any other prompt.
  ok(m2.scorable_probes > m1.scorable_probes, 'month two measures more prompts');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
