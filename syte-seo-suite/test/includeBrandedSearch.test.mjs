// A client that keeps branded search (include_branded_search) — Sabi Sands
// Lodges, an aggregator named after the reserve — gets branded prompts
// generated, probed and reported, and branded keywords in its keyword report.
// Every other client keeps the no-branded rule.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.localStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };
globalThis.sessionStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imp = (f) => import(pathToFileURL(path.join(__dirname, '../src/modules/reports/', f)).href);
const pr = await imp('probeRelevance.js');
const census = await imp('aeoCensus.js');
const np = await imp('aeoNewPrompts.js');
const kb = await imp('keywordBuckets.js');
const runner = await imp('aeoRunner.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }

const BASE = { id: 'ssl', name: 'Sabi Sands Lodges', url: 'https://sabisandslodges.com', industry: 'safari lodges', client_type: 'ecommerce', competitors: 'Londolozi' };
const SSL = { ...BASE, include_branded_search: true };
const Q = 'Which Sabi Sands Lodges are best for leopard sightings?';

await t('the flag is off unless set', async () => {
  ok(!pr.includeBrandedSearch(BASE));
  ok(!pr.includeBrandedSearch({}));
  ok(pr.includeBrandedSearch(SSL));
  ok(pr.includeBrandedSearch({ include_branded_search: 'true' }));
});

await t('branded prompts are off-topic by default, kept when the client opts in', async () => {
  ok(/branded/.test(pr.offTopicReason(Q, pr.relevanceFor(BASE)) || ''), 'default drops it');
  ok(pr.offTopicReason(Q, pr.relevanceFor(SSL)) === null, 'opt-in keeps it');
});

await t('competitor prompts are still dropped for an opted-in client', async () => {
  ok(/competitor/.test(pr.offTopicReason('Is Londolozi worth the price?', pr.relevanceFor(SSL)) || ''));
});

await t('withoutBrandedPrompts keeps branded rows for an opted-in client', async () => {
  const snap = { per_query: [{ query: Q }, { query: 'Londolozi alternatives' }, { query: 'best safari lodge in kruger' }] };
  const def = pr.withoutBrandedPrompts(snap, BASE);
  ok(def.snapshot.per_query.length === 1 && def.brandedRemoved === 2, 'default removes branded + competitor');
  const opt = pr.withoutBrandedPrompts(snap, SSL);
  ok(opt.snapshot.per_query.length === 2, 'opt-in removes only the competitor');
  ok(opt.snapshot.per_query.some(r => r.query === Q));
});

await t('the runner probes branded prompts for an opted-in client', async () => {
  const client = { ...SSL, aeo_probe_queries: ['best safari lodge in kruger', Q].join('\n') };
  const { scorable } = runner.resolveProbes(client, { now: '2026-10-01T00:00:00.000Z' });
  ok(scorable.some(p => p.query === Q), 'branded prompt kept');
  const def = runner.resolveProbes({ ...BASE, aeo_probe_queries: client.aeo_probe_queries }, { now: '2026-10-01T00:00:00.000Z' });
  ok(!def.scorable.some(p => p.query === Q), 'default drops it');
});

await t('census and new-prompt instructions ask for branded prompts only when opted in', async () => {
  ok(/NEVER name the brand itself/.test(census.buildCensusPrompt({ client: BASE })));
  const c = census.buildCensusPrompt({ client: SSL });
  ok(!/NEVER name the brand itself/.test(c) && /KEEPS branded search/.test(c));
  ok(/NEVER name Sabi Sands Lodges/.test(np.newPromptsRequest({ client: BASE })));
  ok(/KEEPS branded search/.test(np.newPromptsRequest({ client: SSL })));
  ok(np.pickNewPrompts([{ query: Q }], { relevance: pr.relevanceFor(SSL) }).length === 1, 'branded new prompt kept');
});

await t('census ranking seeds keep branded rankings when the brand name is cleared', async () => {
  const gsc = [{ query: 'sabi sands lodges', position: 1, impressions: 500 }, { query: 'kruger safari lodge', position: 2, impressions: 50 }];
  ok(census.topRankingSeeds(gsc, BASE.name).length === 1);
  ok(census.topRankingSeeds(gsc, '').length === 2);
});

await t('keyword buckets keep branded queries when classified without a brand name', async () => {
  const kws = [{ query: 'sabi sands lodges', position: 1, impressions: 900, clicks: 90 }];
  ok(kb.buildKeywordBuckets(kws, BASE.name).top3.length === 0, 'default excludes it');
  ok(kb.buildKeywordBuckets(kws, '').top3.length === 1, 'opt-in shows it');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
