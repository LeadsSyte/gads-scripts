// From the Mattress Company report (Oct 2026): prompts that named competitors
// ("Mattress King alternatives for these types of pillows", "Brand vs Rival")
// were probed and shown; the team wants their own queries run exactly; and a
// 900-answer census looked like a 100-prompt report.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.localStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };
globalThis.sessionStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imp = (f) => import(pathToFileURL(path.join(__dirname, '../src/modules/reports/', f)).href);
const pr = await imp('probeRelevance.js');
const cq = await imp('customQueries.js');
const gg = await imp('goldGrid.js');
const runner = await imp('aeoRunner.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }
function eq(a, b, label) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((label || '') + ' expected ' + B + ' got ' + A); }

const TMC = { id: 'tmc', name: 'The Mattress Company', url: 'https://themattresscompany.co.za', industry: 'bedding', client_type: 'ecommerce', competitors: 'mattressking.co.za, sealy.co.za, Dial a Bed' };
const ctx = pr.relevanceFor(TMC);

await t('prompts naming a competitor are off-topic, however the name is written', async () => {
  for (const q of ['Mattress King alternatives for these types of pillows', 'mattressking.co.za reviews', 'Sealy vs Restonic mattresses', 'Is Dial a Bed any good?', 'The Mattress Company vs Mattress King'])
    ok(pr.offTopicReason(q, ctx), q);
});

await t('ordinary buyer prompts that share words with a brand are kept', async () => {
  for (const q of ['best king size mattress in cape town', 'best mattress king size deals', 'where to buy a mattress online in South Africa', 'which mattress company delivers fastest in Johannesburg?'])
    eq(pr.offTopicReason(q, ctx), null, q);
});

await t('the gold grid names no competitor and no client', async () => {
  const grid = gg.buildGoldGrid({ brand: 'The Mattress Company', audience: 'b2c', geo: 'South Africa', services: ['mattresses', 'pillows', 'bed bases', 'duvets'], competitors: ['mattressking.co.za', 'sealy.co.za'] });
  const probes = Array.isArray(grid) ? grid : grid.probes;
  ok(probes.filter(p => p.type === 'comparison').length >= 2, 'comparisons still asked');
  for (const p of probes) if (p.type !== 'reverse') eq(pr.offTopicReason(p.query, ctx), null, p.query);
});

await t('custom queries parse from pasted text, CSV and Word', async () => {
  eq(cq.parseQueryText('1. best mattress for back pain\n- where to buy a bed?\n\nbest mattress for back pain'), ['best mattress for back pain', 'where to buy a bed?']);
  eq(cq.parseQueryText('Query,Volume\n"best bed, cheap",10\nmattress sale,5', 'q.csv'), ['best bed, cheap', 'mattress sale']);
  eq(cq.parseQueryText(cq.docxXmlToText('<w:p><w:r><w:t>best </w:t></w:r><w:r><w:t>pillow &amp; duvet</w:t></w:r></w:p><w:p><w:r><w:t>Prompts</w:t></w:r></w:p>')), ['best pillow & duvet']);
});

await t('custom queries run exactly as written, first, even when they name a brand', async () => {
  const asked = [];
  const engine = {
    id: 'claude', label: 'Claude', model: 'm', retrievalNative: false, supportsSearchOff: true, isConfigured: () => true,
    ask: async (q) => { asked.push(q); return { text: 'x', raw: {}, searchMode: 'search_on' }; }
  };
  const extract = async () => ({ appeared: false, position: null, competitorsNamed: [] });
  const client = { ...TMC, aeo_probe_queries: 'best mattress for side sleepers\nMattress King alternatives for pillows', aeo_custom_queries: 'Is Sealy better than The Mattress Company?\nbest orthopaedic mattress in Durban' };
  const { active } = runner.resolveProbes(client);
  eq(active.slice(0, 2).map(p => p.query), ['Is Sealy better than The Mattress Company?', 'best orthopaedic mattress in Durban'], 'custom first');
  eq(runner.resolveProbes(client).active[0].id, runner.resolveProbes(client).active[0].id, 'stable id');
  const snap = await runner.runSnapshot(client, { engines: [engine], extract, iterations: 1, retrievalOnly: true, now: '2026-10-22T00:00:00.000Z' });
  ok(asked.includes('Is Sealy better than The Mattress Company?'), 'custom asked as written');
  ok(!asked.includes('Mattress King alternatives for pillows'), 'competitor prompt from the census dropped');
  const shown = pr.withoutBrandedPrompts(snap, client).snapshot.per_query;
  ok(shown.some(r => r.query === 'Is Sealy better than The Mattress Company?' && r.source === 'custom'), 'custom kept in the report');
});

await t('the report lists every prompt once, with a column per engine', async () => {
  const { buildMicrositeHtml } = await imp('microsite.js');
  const per_query = [];
  for (let i = 0; i < 120; i++) for (const e of ['chatgpt', 'gemini', 'claude']) per_query.push({ query: 'prompt number ' + i, engine: e, engine_label: e, visibility: i % 2 ? 33 : 0, mentioned: !!(i % 2) });
  const html = buildMicrositeHtml({
    micro: {}, client: TMC, monthLabel: 'October 2026', aeoOnly: true, seoOnly: false, reportData: null,
    aeoProbe: { per_query, engines_used: ['chatgpt', 'gemini', 'claude'], scorable_probes: 120, iterations: 3, total_runs: 1080, keyword_wins: { active: [], emerging: [], zero: [] } }
  });
  ok(/120 buyer prompts, each asked 3 times on every engine: 1080 AI answers/.test(html), 'maths spelled out');
  ok(/Every buyer prompt measured this month \(120\)/.test(html));
  for (const i of [0, 59, 119]) ok(html.includes('>prompt number ' + i + '<'), 'prompt ' + i + ' listed');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
