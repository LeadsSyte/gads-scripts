// The AI (AEO) report never probes or shows a branded prompt (one that names
// the client), and every engine searches from the client's country.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.localStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };
globalThis.sessionStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imp = (f) => import(pathToFileURL(path.join(__dirname, '../src/modules/reports/', f)).href);
const pr = await imp('probeRelevance.js');
const sc = await imp('searchCountry.js');
const gg = await imp('goldGrid.js');
const runner = await imp('aeoRunner.js');
const engines = await imp('aeoEngines.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }
function eq(a, b, label) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((label || '') + ' expected ' + B + ' got ' + A); }

const CUDDLEDOWN = { id: 'cd', name: 'Cuddledown', url: 'https://cuddledown.co.uk/', industry: 'bedding', client_type: 'ecommerce' };
const branded = (q, c) => pr.namesBrand(q, pr.brandTermsFor(c));

// ── Branded prompts ──
await t('a prompt naming the client, its run-together name or its domain is branded', async () => {
  ok(branded('Are Cuddledown duvets ethically sourced?', CUDDLEDOWN));
  ok(branded("Is Cuddledown's down ethically sourced?", CUDDLEDOWN));
  ok(branded('is cuddledown.co.uk legit', CUDDLEDOWN));
  const hot = { name: 'Hot Leathers', url: 'https://hotleathers.com', industry: 'leather motorcycle apparel' };
  ok(branded('Hot Leathers vs Harley jackets', hot));
  ok(branded('hotleathers reviews', hot));
  const krost = { name: 'Krost Shelving', url: 'krost.co.za', industry: 'industrial shelving and racking' };
  ok(branded('Rival vs Krost vs Other for racking', krost));
});

await t('category words in a brand name do not make category prompts branded', async () => {
  const bedShop = { name: 'The Bed Shop', url: 'https://thebedshop.co.za', industry: 'beds and mattresses' };
  ok(!branded('where to shop for a bed in cape town', bedShop), 'shop / bed are ordinary words');
  ok(branded('The Bed Shop specials', bedShop));
  const krost = { name: 'Krost Shelving', url: 'krost.co.za', industry: 'industrial shelving and racking' };
  ok(!branded('best industrial shelving johannesburg', krost));
  const hot = { name: 'Hot Leathers', url: 'https://hotleathers.com', industry: 'leather motorcycle apparel' };
  ok(!branded('best leather jackets for bikers', hot));
  ok(!branded('Best luxury down duvets in the UK', CUDDLEDOWN));
});

await t('the run never probes or reports a branded prompt, reverse instruments still run unseen', async () => {
  const asked = [];
  const engine = {
    id: 'chatgpt', label: 'ChatGPT', model: 'gpt-4o', retrievalNative: false, supportsSearchOff: true,
    isConfigured: () => true,
    ask: async (q) => { asked.push(q); return { text: 'Cuddledown is great.', raw: {}, searchMode: 'search_on' }; }
  };
  const extract = async () => ({ appeared: true, position: 1, listLength: 3, segmentLabel: null, reasonPhrase: null, sentiment: 'positive', competitorsNamed: [] });
  const client = { ...CUDDLEDOWN, aeo_probe_queries: ['Best luxury down duvets', 'Are Cuddledown duvets ethically sourced?', 'Cuddledown vs John Lewis duvets'].join('\n') };
  const snap = await runner.runSnapshot(client, {
    engines: [engine], extract, iterations: 1, now: '2026-10-01T00:00:00.000Z',
    expandWinners: true, winnerTarget: 30, maxExpansionQueries: 40
  });
  const shown = [
    ...snap.per_query.map(r => r.query),
    ...snap.probe_results.filter(r => r.type !== 'reverse').map(r => r.query),
    ...snap.keyword_wins.active.map(r => r.query), ...snap.keyword_wins.emerging.map(r => r.query), ...snap.keyword_wins.zero.map(r => r.query),
    ...snap.expansion_probes.map(r => r.query), ...snap.excerpts.map(r => r.query)
  ];
  ok(shown.some(q => /best luxury down duvets/i.test(q)), 'the unbranded prompt is reported');
  for (const q of shown) ok(!branded(q, client), 'branded prompt reported: ' + q);
  ok(asked.some(q => /^What is Cuddledown known for/.test(q)), 'reverse instrument still asked');
  for (const q of asked) ok(/^(What is|List companies similar to) Cuddledown/.test(q) || !branded(q, client), 'branded prompt probed: ' + q);
  eq(snap.scorable_probes, 1, 'only the unbranded prompt is scored');
});

await t('an older snapshot loses its branded prompts before the report sees it', async () => {
  const old = {
    per_query: [{ query: 'Are Cuddledown duvets ethically sourced?' }, { query: 'Best luxury down duvets' }],
    probe_results: [{ query: 'What is Cuddledown known for?', type: 'reverse' }, { query: 'Cuddledown vs Soak&Sleep', type: 'comparison' }, { query: 'Best luxury down duvets', type: 'qualified' }],
    keyword_wins: { active: [{ query: 'Cuddledown reviews' }], emerging: [], zero: [{ query: 'Best luxury down duvets' }] },
    citation_gaps: [{ domain: 'x.com', exampleQueries: ['Cuddledown pillows', 'best pillows'] }]
  };
  const { snapshot, brandedRemoved } = pr.withoutBrandedPrompts(old, CUDDLEDOWN);
  eq(snapshot.per_query.map(r => r.query), ['Best luxury down duvets']);
  eq(snapshot.probe_results.map(r => r.query), ['What is Cuddledown known for?', 'Best luxury down duvets']);
  eq(snapshot.keyword_wins.active, []);
  eq(snapshot.citation_gaps[0].exampleQueries, ['best pillows']);
  eq(brandedRemoved, 3, 'distinct branded prompts dropped');
  eq(old.per_query.length, 2, 'input untouched');
});

await t('the gold grid holds no branded prompt outside the reverse instruments', async () => {
  const grid = gg.buildGoldGrid
    ? gg.buildGoldGrid({ brand: 'Cuddledown', audience: 'b2c', geo: 'United Kingdom', services: ['down duvets'], competitors: ['John Lewis', 'Soak&Sleep'] })
    : null;
  const probes = Array.isArray(grid) ? grid : (grid?.probes || []);
  ok(probes.length > 5, 'grid built');
  ok(probes.some(p => p.type === 'comparison' && /John Lewis vs Soak/.test(p.query)), 'head-to-head kept, without the client');
  for (const p of probes) if (p.type !== 'reverse') ok(!branded(p.query, CUDDLEDOWN), 'branded grid line: ' + p.query);
});

// ── Search country ──
await t('the country comes from the field, then the website domain, then Location', async () => {
  eq(sc.resolveSearchCountry({ search_country: 'us', url: 'https://x.co.uk' })?.code, 'US', 'the field wins');
  eq(sc.resolveSearchCountry({ url: 'https://cuddledown.co.uk' }), { code: 'GB', name: 'United Kingdom', source: 'website' });
  eq(sc.resolveSearchCountry({ url: 'krost.co.za' })?.code, 'ZA');
  eq(sc.resolveSearchCountry({ url: 'https://shop.example.com.au/x' })?.code, 'AU');
  eq(sc.resolveSearchCountry({ url: 'https://acme.com', location: 'London & the South East' }), { code: 'GB', name: 'United Kingdom', source: 'location' });
  eq(sc.resolveSearchCountry({ url: 'https://acme.com', location: 'Austin, Texas' })?.code, 'US');
  eq(sc.resolveSearchCountry({ url: 'https://acme.com', location: 'Serving US clients' })?.code, 'US');
  eq(sc.resolveSearchCountry({ url: 'https://acme.com', location: 'Sydney, New South Wales' })?.code, 'AU', 'not Wales');
  eq(sc.resolveSearchCountry({ url: 'https://acme.com', location: 'Cape Town, South Africa' })?.code, 'ZA');
});

await t('no country is guessed when nothing says where the client is', async () => {
  eq(sc.resolveSearchCountry({ url: 'https://acme.com' }), null);
  eq(sc.resolveSearchCountry({ url: 'https://acme.com', location: 'come to us for help' }), null, '"us" the pronoun');
  eq(sc.resolveSearchCountry({ url: 'https://acme.com', location: 'UK and South Africa' }), null, 'two countries is a person\'s call');
  eq(sc.resolveSearchCountry({ search_country: 'AUTO', url: 'https://acme.com' }), null);
});

await t('every engine searches from the client country; without one the request is unchanged', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    const body = /openai/.test(url) ? { output: [{ content: [{ text: 'Acme' }] }] }
      : /googleapis/.test(url) ? { candidates: [{ content: { parts: [{ text: 'Acme' }] } }] }
      : { content: [{ text: 'Acme' }] };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  try {
    globalThis.__SYTE_AEO_KEYS = { openai: 'sk-o', google: 'g-key', anthropic: 'sk-a' };
    const country = { code: 'GB', name: 'United Kingdom' };
    await engines.chatgpt.ask('best duvets', { search: true, country });
    await engines.gemini.ask('best duvets', { country });
    await engines.claude.ask('best duvets', { search: true, country });
    const [o, g, c] = seen;
    eq(o.body.tools[0].user_location, { type: 'approximate', country: 'GB' });
    eq(o.body.instructions, 'The user is located in United Kingdom.');
    eq(g.body.systemInstruction, { parts: [{ text: 'The user is located in United Kingdom.' }] });
    eq(c.body.tools[0].user_location, { type: 'approximate', country: 'GB' });
    eq(c.body.system, 'The user is located in United Kingdom.');

    seen.length = 0;
    await engines.chatgpt.ask('best duvets', { search: true });
    await engines.gemini.ask('best duvets');
    await engines.claude.ask('best duvets', { search: true });
    ok(!('instructions' in seen[0].body) && !('user_location' in seen[0].body.tools[0]), 'openai unchanged');
    ok(!('systemInstruction' in seen[1].body), 'gemini unchanged');
    ok(!('system' in seen[2].body) && !('user_location' in seen[2].body.tools[0]), 'claude unchanged');
  } finally { globalThis.fetch = realFetch; delete globalThis.__SYTE_AEO_KEYS; }
});

await t('the run passes the client country to every engine call and records it', async () => {
  const opts = [];
  const engine = {
    id: 'claude', label: 'Claude', model: 'm', retrievalNative: false, supportsSearchOff: true, isConfigured: () => true,
    ask: async (q, o) => { opts.push(o); return { text: 'x', raw: {}, searchMode: 'search_on' }; }
  };
  const extract = async () => ({ appeared: false, position: null, competitorsNamed: [] });
  const snap = await runner.runSnapshot({ ...CUDDLEDOWN, aeo_probe_queries: 'Best luxury down duvets' }, { engines: [engine], extract, iterations: 1, now: '2026-10-01T00:00:00.000Z' });
  ok(opts.length > 0);
  for (const o of opts) eq(o.country, { code: 'GB', name: 'United Kingdom' });
  eq(snap.search_country, { code: 'GB', name: 'United Kingdom', source: 'website' });
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
