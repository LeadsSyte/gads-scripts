// Winner expansion (spider web): the pure long-tail query generator, plus an
// end-to-end recursive test that drives runSnapshot with a mock engine.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.localStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };
globalThis.sessionStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const we = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/winnerExpansion.js')).href);
const runner = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/aeoRunner.js')).href);

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }
function eq(a, b, label) { if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
const norm = s => s.toLowerCase();

// ---- pure generator --------------------------------------------------------
await t('geo drill: swaps the named country for its cities', async () => {
  const kids = we.expandWinnerQuery('best azure document intelligence company in ireland', { maxPerWinner: 20 });
  const qs = kids.map(k => norm(k.query));
  ok(qs.some(q => q.includes('dublin')), 'no dublin variant');
  ok(qs.some(q => q.includes('cork')), 'no cork variant');
  ok(!qs.includes('best azure document intelligence company in ireland'), 'must not echo the parent');
});

await t('segment qualifier: appends buyer segments', async () => {
  const kids = we.expandWinnerQuery('best azure document intelligence company in ireland', { maxPerWinner: 30 });
  const qs = kids.map(k => norm(k.query));
  ok(qs.some(q => q.includes('for mid-market companies')), 'no mid-market variant');
  ok(qs.some(q => q.includes('for financial services firms') || q.includes('for insurance companies')), 'no industry qualifier');
});

await t('does not stack a second "for" qualifier', async () => {
  const kids = we.expandWinnerQuery('best crm for insurance companies in ireland', { maxPerWinner: 30 });
  ok(kids.every(k => (k.query.match(/\bfor\b/gi) || []).length <= 1), 'stacked a second for-clause');
});

await t('child tier deepens and caps at 3; parent linkage set', async () => {
  const t2 = we.expandWinnerQuery('best widgets in ireland', { parentTier: 1, parentProbeId: 'P1', maxPerWinner: 3 });
  ok(t2.every(k => k.tier === 2), 'tier should be 2');
  ok(t2.every(k => k.parentProbeId === 'P1'), 'parent id missing');
  const t3 = we.expandWinnerQuery('best widgets in dublin', { parentTier: 3 });
  ok(t3.every(k => k.tier === 3), 'tier should cap at 3');
});

await t('maxPerWinner caps fan-out width', async () => {
  eq(we.expandWinnerQuery('best widgets in ireland', { maxPerWinner: 4 }).length, 4, 'cap');
});

await t('empty / national query with no known geo yields only segment children', async () => {
  const kids = we.expandWinnerQuery('best widgets', { maxPerWinner: 20 });
  ok(kids.length > 0, 'should still produce segment children');
  ok(kids.every(k => norm(k.query).startsWith('best widgets for')), 'only segment appends expected');
});

// ---- end-to-end recursion through runSnapshot ------------------------------
// Engine that WINS only on queries containing "document intelligence", so
// expansion should keep finding winners as it drills that stem.
function stemWinnerEngine() {
  return {
    id: 'chatgpt', label: 'ChatGPT', model: 'gpt-4o', retrievalNative: false, supportsSearchOff: true,
    isConfigured: () => true,
    ask: async (q) => {
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

await t('runSnapshot expands winners into long-tail children', async () => {
  const snap = await runner.runSnapshot(CLIENT, {
    engines: [stemWinnerEngine()], extract: extractByText, iterations: 1, now: '2026-07-01T00:00:00.000Z',
    expandWinners: true, winnerTarget: 30, maxExpansionDepth: 2, maxExpansionQueries: 40
  });
  ok(snap.expansion_count > 0, 'no expansion happened');
  // Every discovered child descends from the winning "document intelligence" stem.
  ok(snap.expansion_probes.every(p => /document intelligence/i.test(p.query)), 'expanded off the wrong stem');
  // The children show up in the per-query results (volume the client cares about).
  const dubResult = snap.per_query?.some(r => /dublin/i.test(r.query) && r.mentioned);
  ok(dubResult, 'a drilled Dublin variant should appear as a winning result');
});

await t('expansion respects the query budget', async () => {
  const snap = await runner.runSnapshot(CLIENT, {
    engines: [stemWinnerEngine()], extract: extractByText, iterations: 1, now: '2026-07-01T00:00:00.000Z',
    expandWinners: true, winnerTarget: 999, maxExpansionDepth: 5, maxExpansionQueries: 12
  });
  ok(snap.expansion_count <= 12, 'exceeded maxExpansionQueries: ' + snap.expansion_count);
});

await t('no expansion when expandWinners is off', async () => {
  const snap = await runner.runSnapshot(CLIENT, {
    engines: [stemWinnerEngine()], extract: extractByText, iterations: 1, now: '2026-07-01T00:00:00.000Z'
  });
  eq(snap.expansion_count, 0, 'should not expand by default');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
