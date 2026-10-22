// Every monthly run asks prompts it has never asked, on top of last month's
// carried ones, and those new prompts carry into the following month.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.localStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };
globalThis.sessionStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imp = (f) => import(pathToFileURL(path.join(__dirname, '../src/modules/reports/', f)).href);
const np = await imp('aeoNewPrompts.js');
const pr = await imp('probeRelevance.js');
const runner = await imp('aeoRunner.js');
const cf = await imp('aeoCarryForward.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }
function eq(a, b, label) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((label || '') + ' expected ' + B + ' got ' + A); }

const CLIENT = { id: 'cd', name: 'Cuddledown', url: 'https://cuddledown.co.uk/', industry: 'bedding', client_type: 'ecommerce', aeo_probe_queries: 'Best luxury down duvets in the UK' };

await t('only new, unbranded, on-topic prompts are kept', async () => {
  const got = np.pickNewPrompts([
    { query: 'Best luxury down duvets in the UK', intent: 'commercial' },          // already asked
    { query: 'best luxury down duvet in the UK?', intent: 'commercial' },          // near-twin
    { query: 'Are Cuddledown pillows worth it?', intent: 'awareness' },            // branded
    { query: 'Which hypoallergenic duvet is best for allergy sufferers?', intent: 'problem' },
    { query: 'Best duvets for startups', intent: 'commercial' },                    // B2B on B2C
    { query: 'Goose down vs duck down duvet, which brand is worth buying?', intent: 'comparison' }
  ], { known: ['Best luxury down duvets in the UK'], relevance: pr.relevanceFor(CLIENT), max: 15 });
  eq(got.map(g => g.query), ['Which hypoallergenic duvet is best for allergy sufferers?', 'Goose down vs duck down duvet, which brand is worth buying?']);
});

await t('the request never asks for the brand and lists what was already asked', async () => {
  const r = np.newPromptsRequest({ client: CLIENT, country: { name: 'United Kingdom' }, known: ['Best luxury down duvets in the UK'], signals: { segmentLabels: ['luxury bedding'] } });
  ok(/NEVER name Cuddledown/.test(r)); ok(/- Best luxury down duvets in the UK/.test(r)); ok(/United Kingdom/.test(r)); ok(/luxury bedding/.test(r));
});

const engine = (asked) => ({
  id: 'chatgpt', label: 'ChatGPT', model: 'gpt-4o', retrievalNative: false, supportsSearchOff: true, isConfigured: () => true,
  ask: async (q) => { asked.push(q); return { text: 'x', raw: {}, searchMode: 'search_on' }; }
});
const extract = async () => ({ appeared: true, position: 2, listLength: 5, segmentLabel: 'luxury bedding', reasonPhrase: 'ethically sourced down', sentiment: 'positive', competitorsNamed: ['John Lewis'] });

await t('a run with last month carried still asks new prompts, and they carry into next month', async () => {
  const asked = [];
  const seenArgs = [];
  const discover = async (args) => { seenArgs.push(args); return [
    { query: 'Which hypoallergenic duvet is best for allergy sufferers?', intent: 'problem' },
    { query: 'Cuddledown discount codes', intent: 'commercial' }
  ]; };
  const previousSnapshot = { month: '2026-09', expansion_probes: [{ query: 'Best summer weight duvet for hot sleepers', won: true, misses: 0 }] };
  const snap = await runner.runSnapshot(CLIENT, { engines: [engine(asked)], extract, iterations: 1, now: '2026-10-05T00:00:00.000Z', previousSnapshot, newPrompts: 15, discover });
  ok(asked.includes('Best summer weight duvet for hot sleepers'), 'last month carried');
  ok(asked.includes('Which hypoallergenic duvet is best for allergy sufferers?'), 'new prompt probed');
  ok(!asked.includes('Cuddledown discount codes'), 'branded discovery dropped');
  eq(snap.new_prompts_count, 1);
  ok(seenArgs[0].known.includes('Best summer weight duvet for hot sleepers'), 'discovery is told what was carried');
  ok(seenArgs[0].signals.competitorsNamed.includes('John Lewis'), 'steered by this month\'s answers');
  const next = cf.carriedPromptsFrom(snap).map(p => p.query);
  ok(next.includes('Which hypoallergenic duvet is best for allergy sufferers?'), 'new prompt carries to next month');
  ok(next.includes('Best summer weight duvet for hot sleepers'), 'old winner still tracked');
});

await t('a discovery failure never stops the census', async () => {
  const snap = await runner.runSnapshot(CLIENT, { engines: [engine([])], extract, iterations: 1, now: '2026-10-05T00:00:00.000Z', newPrompts: 15, discover: async () => { throw new Error('boom'); } });
  eq(snap.new_prompts_count, 0); ok(snap.scorable_probes >= 1);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
