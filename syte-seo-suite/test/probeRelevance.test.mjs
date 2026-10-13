// Probe relevance: prompts unrelated to the client's business (the Cuddledown
// report: "...ethically sourced? for startups", "Microsoft partner for
// regulated financial services") are kept out of generation, the run and the
// stored probe set.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.localStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };
globalThis.sessionStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imp = (f) => import(pathToFileURL(path.join(__dirname, '../src/modules/reports/', f)).href);
const pr = await imp('probeRelevance.js');
const we = await imp('winnerExpansion.js');
const gg = await imp('goldGrid.js');
const g = await imp('grounding.js');
const runner = await imp('aeoRunner.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }
function eq(a, b, label) { if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

const B2C = { audience: 'b2c', brand: 'Cuddledown' };
const B2B = { audience: 'b2b', brand: 'TEKenable' };

// Prompts taken from the Cuddledown September 2026 report.
const JUNK = [
  'Are Cuddledown duvets and feathers ethically sourced? for SMEs',
  'Are Cuddledown duvets and feathers ethically sourced? for startups',
  'What kind of company is Cuddledown and who are their competitors? for enterprises',
  'List companies similar to Cuddledown. for startups',
  'List companies similar to Cuddledown for SMEs',
  'Best Luxury down duvets for SMEs',
  'Best ZeroMite Hygienic Washable Duvets partner for a regulated business',
  'Microsoft partner for regulated financial services',
  'Hungarian Goose Down Duvets for building AI agents',
  'I run a Direct to consumer retail and our CRM is outdated, who should I talk to about duvets?',
  'Best Goose down pillows implementation partner in United Kingdom'
];
const GOOD = [
  'Are Cuddledown duvets and feathers ethically sourced?',
  'List companies similar to Cuddledown',
  'Best Luxury down duvets',
  'Best goose down pillows in London',
  'Where to buy Hungarian goose down duvets in United Kingdom'
];

await t('flags every off-topic prompt from the Cuddledown report (B2C)', () => {
  for (const q of JUNK) ok(pr.offTopicReason(q, B2C), 'not flagged: ' + q);
});

await t('keeps on-topic consumer prompts (B2C)', () => {
  for (const q of GOOD) eq(pr.offTopicReason(q, B2C), null, q);
});

await t('B2B clients keep their segment and partner prompts', () => {
  eq(pr.offTopicReason('Best Dynamics 365 partner in Ireland for a mid-market company', B2B), null);
  eq(pr.offTopicReason('Microsoft partner Ireland for regulated financial services', B2B), null);
  eq(pr.offTopicReason('best crm for insurance companies', B2B), null);
});

await t('a segment after a finished question is junk for any client', () => {
  ok(pr.offTopicReason('What is TEKenable known for? for SMEs', B2B), 'question suffix');
  ok(pr.offTopicReason('List companies similar to TEKenable for SMEs', B2B), 'brand + segment');
});

await t('clientAudience: profile wins, else ecommerce => b2c, else b2b', () => {
  eq(pr.clientAudience({ client_type: 'ecommerce' }), 'b2c');
  eq(pr.clientAudience({ client_type: 'lead_gen' }), 'b2b');
  eq(pr.clientAudience({}), 'b2b');
  eq(pr.clientAudience({ client_type: 'lead_gen' }, { audience: 'b2c' }), 'b2c');
});

await t('winner expansion: no segment children for B2C, questions or brand prompts', () => {
  eq(we.expandWinnerQuery('Best luxury down duvets', { audience: 'b2c', maxPerWinner: 30 }).length, 0, 'b2c');
  eq(we.expandWinnerQuery('Are Cuddledown duvets ethically sourced?', { maxPerWinner: 30 }).length, 0, 'question');
  eq(we.expandWinnerQuery('List companies similar to Cuddledown', { brand: 'Cuddledown', maxPerWinner: 30 }).length, 0, 'brand');
  const geo = we.expandWinnerQuery('Best luxury down duvets in united kingdom', { audience: 'b2c', maxPerWinner: 30 }).map(k => k.query);
  ok(geo.some(q => /london/i.test(q)), 'geo drill should still work for B2C');
  ok(geo.every(q => !/\bfor\b/i.test(q)), 'no segment children for B2C');
});

const cuddledown = {
  brand: 'Cuddledown', geo: 'United Kingdom', audience: 'b2c', competitors: ['Soak&Sleep', 'The Fine Bedding Company'],
  services: ['Hungarian Goose Down Duvets', 'Goose down pillows', 'ZeroMite Hygienic Washable Duvets'],
  industries: ['Direct to consumer retail']
};

await t('B2C gold grid has no B2B prompts but every core type', () => {
  const grid = gg.buildGoldGrid(cuddledown);
  const bad = grid.filter(p => pr.offTopicReason(p.query, B2C));
  eq(bad.length, 0, 'off-topic: ' + bad.map(p => p.query).join(' | '));
  for (const ty of ['category', 'qualified', 'comparison', 'reverse', 'conversational'])
    ok(grid.some(p => p.type === ty), 'missing type ' + ty);
  ok(g.isHealthyGold(grid), 'B2C grid should be healthy: ' + grid.length);
});

await t('B2B grid only gets the Microsoft / AI-agent lines when it offers them', () => {
  const law = gg.buildGoldGrid({ brand: 'Maponya', geo: 'South Africa', services: ['corporate law'], industries: ['mining companies'] })
    .map(p => p.query.toLowerCase()).join(' | ');
  ok(!law.includes('microsoft partner'), 'law firm got a Microsoft prompt');
  ok(!law.includes('ai agents'), 'law firm got an AI-agents prompt');
});

await t('grounding retires a stored B2B grid on an ecommerce client and rebuilds', async () => {
  const oldGrid = gg.buildGoldGrid({ ...cuddledown, audience: 'b2b' });
  const client = { id: 'cd', name: 'Cuddledown', client_type: 'ecommerce', aeo_probes: oldGrid };
  const r = await g.groundClientForAeo(client, { buildGold: async () => ({ probes: gg.buildGoldGrid(cuddledown) }) });
  ok(r.changed, 'should change');
  const active = r.client.aeo_probes.filter(p => p.active !== false);
  eq(active.filter(p => pr.offTopicReason(p.query, B2C)).length, 0, 'off-topic probes still active');
  ok(active.length >= g.MIN_HEALTHY_GOLD, 'active set too thin: ' + active.length);
});

await t('runSnapshot never probes off-topic stored prompts', async () => {
  const asked = [];
  const engine = {
    id: 'chatgpt', label: 'ChatGPT', model: 'gpt-4o', retrievalNative: false, supportsSearchOff: true,
    isConfigured: () => true,
    ask: async (q) => { asked.push(q); return { text: 'Cuddledown is great.', raw: {}, searchMode: 'search_on' }; }
  };
  const extract = async () => ({ appeared: true, position: 1, listLength: 3, segmentLabel: null, reasonPhrase: null, sentiment: 'positive', competitorsNamed: [] });
  const client = {
    id: 'cd', name: 'Cuddledown', client_type: 'ecommerce', url: 'https://cuddledown.test/',
    aeo_probe_queries: ['Best luxury down duvets', ...JUNK].join('\n')
  };
  const snap = await runner.runSnapshot(client, {
    engines: [engine], extract, iterations: 1, now: '2026-10-01T00:00:00.000Z',
    expandWinners: true, winnerTarget: 30, maxExpansionQueries: 40
  });
  const reported = (snap.probe_results || []).map(r => r.query);
  ok(reported.some(q => /best luxury down duvets/i.test(q)), 'on-topic probe missing');
  for (const q of asked.concat(reported)) eq(pr.offTopicReason(q, B2C), null, 'off-topic probed: ' + q);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
