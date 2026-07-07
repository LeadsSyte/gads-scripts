// AEO Discovery — find queries the brand is ACTUALLY cited for in AI
// engines, instead of guessing. The regular probe answers "do these
// queries we picked cite us?" — Discovery answers "what queries are we
// already showing up for?" so the probe list reflects real visibility.
//
// Approach:
//   1. Generate a wide net of broad category × city queries from the
//      client's industry, location and products. Templates produce
//      natural phrasings ("shelving companies in Durban", not just
//      "best industrial shelving companies in Johannesburg").
//   2. Fire one iteration of each query against every configured engine.
//   3. For each response, run brand detection.
//   4. Return the queries that cited the brand on at least one engine.
//   5. Caller (UI) can then merge selected queries into the saved probe
//      list so future snapshots track them as recurring tests.

import { activeEngines } from './aeoEngines.js';
import { detectBrand } from './brandDetection.js';

// Major SA metros + region modifiers that AI engines commonly use to
// rank local recommendations. Keep this conservative — every extra
// city multiplies the query count.
const SA_CITIES = [
  'Johannesburg', 'Cape Town', 'Durban', 'Pretoria',
  'Port Elizabeth', 'Sandton', 'Centurion', 'Bloemfontein'
];
const SA_REGIONS = ['South Africa', 'Gauteng', 'KZN', 'Western Cape'];

// Phrasings that real users type. Each placeholder gets filled with
// the brand's category + a city/region. {category} is required;
// {city} / {region} are optional (templates without them just go once).
const QUERY_TEMPLATES = [
  // City-anchored, varied verbs
  '{category} in {city}',
  '{category} companies in {city}',
  '{category} suppliers in {city}',
  '{category} stores in {city}',
  'best {category} in {city}',
  'top {category} in {city}',
  'where to buy {category} in {city}',
  '{category} near me {city}',
  // Region-anchored
  '{category} suppliers {region}',
  'best {category} {region}',
  'top {category} companies in {region}',
  // Generic / no location
  'best {category} companies',
  'top {category} suppliers',
  '{category} reviews',
  'where to buy {category}',
  'who sells {category}',
  '{category} recommendations'
];

// Pull category seeds from the client. Industry is the primary source;
// we also try a few derived terms so the discovery net is wider than
// just one phrase. e.g. for industrial-storage clients we'll try
// "shelving", "racking", "warehouse storage" too.
function categorySeeds(client) {
  const seeds = new Set();
  const industry = (client.industry || '').toLowerCase().trim();
  if (industry) seeds.add(industry);

  // Common industrial-storage variants — only added if the client's
  // industry hints at it. Prevents "shelving" being added for a client
  // who isn't actually in shelving.
  const STORAGE_HINTS = ['shelving', 'racking', 'storage', 'mezzanine', 'warehouse', 'pallet'];
  if (STORAGE_HINTS.some(h => industry.includes(h))) {
    if (industry.includes('shelv')) seeds.add('shelving').add('industrial shelving');
    if (industry.includes('rack'))  seeds.add('racking').add('pallet racking');
    if (industry.includes('storage')) seeds.add('storage solutions').add('warehouse storage');
    if (industry.includes('mezzanine')) seeds.add('mezzanine floors');
  }

  // Pull short noun phrases from the client's `context` field if present
  // (e.g. brand description). We grab any 1-3 word phrases that look
  // like product nouns. Conservative — only add 2-3 of them.
  const context = (client.context || '').toLowerCase();
  const matches = context.match(/\b([a-z]+(?:\s+[a-z]+){0,2})\s+(?:solutions?|systems?|products?|services?|suppliers?)\b/g) || [];
  for (const m of matches.slice(0, 3)) {
    const phrase = m.replace(/\s+(solutions?|systems?|products?|services?|suppliers?)$/, '').trim();
    if (phrase.length > 3) seeds.add(phrase);
  }

  // If we ended up with nothing, fall back to a generic.
  if (seeds.size === 0 && industry) seeds.add(industry);

  return [...seeds].slice(0, 6); // cap to keep total query count sane
}

// The client's own geo(s) for local templates — from their market/location,
// NOT a hardcoded country. Falls back to no-geo (global) phrasing.
function geosFor(client) {
  const raw = String(client.location || client.market || client.geo || '')
    .split(/[,/]/).map(s => s.trim()).filter(Boolean);
  return raw.slice(0, 3);
}

// Extract candidate service/topic phrases from a client's fetched website HTML
// (title, H1-H3, meta description). Pure + dependency-free. This grounds
// discovery in what the brand actually says it does.
export function extractSitePhrases(html, { limit = 15 } = {}) {
  if (!html) return [];
  const strip = s => String(s).replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const raw = [];
  const grab = (re) => { let m; while ((m = re.exec(html))) raw.push(strip(m[1])); };
  grab(/<title[^>]*>([\s\S]*?)<\/title>/gi);
  grab(/<h1[^>]*>([\s\S]*?)<\/h1>/gi);
  grab(/<h2[^>]*>([\s\S]*?)<\/h2>/gi);
  grab(/<h3[^>]*>([\s\S]*?)<\/h3>/gi);
  const md = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  if (md) raw.push(strip(md[1]));
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    const words = p.split(' ').filter(Boolean);
    if (words.length < 1 || words.length > 6) continue;             // keep short noun phrases
    const k = p.toLowerCase();
    if (seen.has(k) || /^(home|about|about us|contact|contact us|privacy|cookies?|menu|sign in|log ?in|careers|blog|news)$/.test(k)) continue;
    seen.add(k); out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

// Build the discovery query list. Grounded, in priority order:
//   1. GSC head-terms — the real queries the brand ranks for on Google (gold),
//      probed directly plus a couple of buyer-intent variants.
//   2. Website + industry phrases, expanded with buyer templates and the
//      client's OWN geo (not a hardcoded country).
// Returns deduped, lower-cased query strings capped at `limit`.
export function buildDiscoveryQueries(client, { limit = 120, gscSeeds = [], sitePhrases = [] } = {}) {
  const out = new Set();
  const norm = s => String(s || '').trim().toLowerCase();

  // 1. GSC head-terms first — strongest grounding.
  for (const raw of gscSeeds) {
    const q = norm(raw);
    if (!q) continue;
    out.add(q);
    out.add('best ' + q);
    out.add('top ' + q + ' companies');
    if (out.size >= limit) break;
  }

  // 2. Category seeds = website phrases + industry, expanded with the client geo.
  const cats = [...new Set([...categorySeeds(client), ...sitePhrases.map(norm)])].filter(Boolean);
  const geos = geosFor(client);
  const VERBS = ['best {c}', 'top {c} companies', '{c} companies', '{c} providers', 'who offers {c}', 'recommended {c}'];
  for (const c of cats) {
    if (out.size >= limit) break;
    for (const v of VERBS) {
      out.add(v.replace('{c}', c));
      for (const g of geos) out.add(v.replace('{c}', c) + ' in ' + g.toLowerCase());
      if (out.size >= limit) break;
    }
  }
  return [...out].slice(0, limit);
}

// Run the discovery sweep. Returns:
//   {
//     citingQueries: [{ query, engines: ['chatgpt', 'gemini'], ... }],
//     totalQueries: 120,
//     totalRuns: 480,         // queries × engines
//     errors: [{ engine, query, message }]
//   }
//
// onProgress({ index, total, query, engine }) called after each call.
export async function runDiscoverySweep(client, { onProgress, queries, perEngineConcurrency = 3 } = {}) {
  const engines = activeEngines();
  if (!engines.length) throw new Error('No AI engines configured.');

  const list = queries && queries.length > 0 ? queries : buildDiscoveryQueries(client);
  if (!list.length) throw new Error('Could not derive discovery queries — set client industry first.');

  const competitorList = (client.competitors || '')
    .split(/[,\n]/).map(s => s.trim()).filter(Boolean);

  const total = list.length * engines.length;
  let done = 0;
  const citing = new Map(); // query → { query, engines: Set, excerpts: {engine: text} }
  const errors = [];

  // Run with a small batch concurrency per engine to stay polite to APIs
  // while keeping the sweep fast. Each engine processes its queries
  // sequentially within the batch.
  for (let i = 0; i < list.length; i += perEngineConcurrency) {
    const batch = list.slice(i, i + perEngineConcurrency);
    await Promise.all(batch.flatMap(query =>
      engines.map(async (eng) => {
        onProgress?.({ index: done, total, query, engine: eng.label });
        try {
          const resp = await eng.ask(query);
          done++;
          if (resp.error) {
            errors.push({ engine: eng.id, query, message: resp.error });
            return;
          }
          const detected = detectBrand(resp.text || '', {
            name: client.name,
            url: client.url,
            competitors: competitorList.join(',')
          });
          if (detected.mentioned) {
            const existing = citing.get(query) || { query, engines: new Set(), excerpts: {}, position: detected.position };
            existing.engines.add(eng.id);
            if (!existing.excerpts[eng.id]) existing.excerpts[eng.id] = detected.excerpt;
            citing.set(query, existing);
          }
        } catch (e) {
          errors.push({ engine: eng.id, query, message: e.message });
          done++;
        }
      })
    ));
  }

  return {
    citingQueries: [...citing.values()].map(c => ({ ...c, engines: [...c.engines] })),
    totalQueries: list.length,
    totalRuns: total,
    errors
  };
}
