// Gold-grid probe generator.
//
// The hand-built "gold standard" probe sheet is not a bag of keywords — it is a
// deterministic, template-driven grid built from a small structured PROFILE of
// the client (service lines, target industries, buyer segments, competitors,
// geo + regional variants). This module reproduces that grid from the same
// kind of profile, so an auto-generated probe set has the same strategic
// breadth as one a strategist would hand-write:
//
//   Tier 1 (~24): reverse probes, category "money" terms, qualified terms,
//                 competitor comparisons, niche moonshots, one conversational
//                 buyer-journey prompt.
//   Tier 2 (~76): {service} x {geo variant} "implementation partner" grid, plus
//                 a {service} x {buyer segment} qualifier grid.
//   Tier 3 (~24): {template} x {industry} grid.
//
// Pure and node-testable: imports nothing browser-coupled. Emits probe-candidate
// objects ({ tier, type, intent, query, theme, source }) ready for addProbes().

// ---- profile normalisation ------------------------------------------------

const DEFAULT_GEO_VARIANTS = (geo) => {
  const g = String(geo || '').trim();
  if (!g) return [];
  // Ireland gets its canonical regional spread; other geos fall back to the
  // geo itself plus its primary city if we know one (caller can override).
  if (/ireland/i.test(g)) return ['Ireland', 'Dublin', 'UK and Ireland', 'Northern Ireland'];
  return [g];
};

const DEFAULT_SEGMENTS = ['mid-market company', 'SME', 'enterprise', 'regulated business', 'public sector organisation'];

// Industries that are inherently global (no national geo suffix) or already
// carry a geo token, so we do not bolt " Ireland" onto them.
const GLOBAL_INDUSTRIES = /aviation leasing|aircraft leasing/i;

function geoAdjective(geo) {
  const g = String(geo || '').trim();
  const MAP = { ireland: 'Irish', 'united kingdom': 'British', uk: 'British', 'south africa': 'South African' };
  return MAP[g.toLowerCase()] || g;
}

function geoScopedIndustry(industry, geo) {
  const ind = String(industry || '').trim();
  if (!ind) return '';
  if (/\b(irish|ireland|uk|british|england|scotland|wales)\b/i.test(ind)) return ind;
  if (GLOBAL_INDUSTRIES.test(ind)) return ind;
  return geo ? `${ind} ${geo}` : ind;
}

// Turn a raw client into a gold-grid profile. Callers can pass a fully-formed
// profile (the eval does), or a partial one that we top up with defaults.
export function toGridProfile(input = {}) {
  const brand = String(input.brand || input.name || '').trim();
  const geo = String(input.geo || '').split(/[,/]/)[0].trim();
  const competitors = (Array.isArray(input.competitors)
    ? input.competitors
    : String(input.competitors || '').split(/[,\n]/))
    .map(s => String(s).trim()).filter(Boolean);
  return {
    brand,
    geo,
    geoVariants: (input.geoVariants && input.geoVariants.length) ? input.geoVariants : DEFAULT_GEO_VARIANTS(geo),
    primaryCity: input.primaryCity || (DEFAULT_GEO_VARIANTS(geo)[1] || geo),
    services: (input.services || []).map(s => String(s).trim()).filter(Boolean),
    headlineServices: (input.headlineServices || []).map(s => String(s).trim()).filter(Boolean),
    gridQualifierServices: (input.gridQualifierServices || []).map(s => String(s).trim()).filter(Boolean),
    segments: (input.segments && input.segments.length) ? input.segments : DEFAULT_SEGMENTS,
    industries: (input.industries || []).map(s => String(s).trim()).filter(Boolean),
    competitors
  };
}

// ---- tier builders --------------------------------------------------------

// Tier 1: the strategic, mostly hand-shaped panel. Reproduced from templates so
// the entities (services, competitors, segments, industries) are always the
// client's own, while covering every probe TYPE the gold sheet uses.
function tier1(p) {
  const out = [];
  const geo = p.geo;
  const adj = geoAdjective(geo);
  const svc = p.headlineServices.length ? p.headlineServices : p.services;
  const s0 = p.services[0] || svc[0] || '';
  const push = (type, intent, theme, query) => {
    const q = String(query || '').replace(/\s+/g, ' ').trim();
    if (q) out.push({ tier: 1, type, intent, theme, query: q, source: 'gold' });
  };

  // Reverse probes (brand-anchored).
  if (p.brand) {
    push('reverse', 'awareness', 'Reverse probe', `What is ${p.brand} known for?`);
    push('reverse', 'awareness', 'Reverse probe', `What kind of company is ${p.brand} and who are their competitors${geo ? ' in ' + geo : ''}?`);
    push('reverse', 'awareness', 'Reverse probe', `List companies similar to ${p.brand}`);
  }

  // Category "money" terms — the headline service lines.
  for (const s of svc.slice(0, 6)) {
    push('category', 'commercial', 'Core money', `Best ${s}${geo ? ' in ' + geo : ''}`);
  }

  // Qualified money — service x segment / capability / who-should.
  if (s0) {
    push('qualified', 'commercial', 'Qualified money', `Best ${s0} partner${geo ? ' in ' + geo : ''} for ${p.segments[0] || 'mid-market companies'}`);
    push('qualified', 'commercial', 'Qualified money', `Microsoft partner${geo ? ' ' + geo : ''} for regulated financial services`);
    const aiSvc = p.services.find(s => /ai|agent/i.test(s)) || s0;
    push('qualified', 'commercial', 'Qualified money', `${aiSvc}${p.primaryCity ? ' ' + p.primaryCity : ''} for building AI agents`);
    const nicheIndustry = p.industries.find(i => /insurance|credit|bank|pension/i.test(i)) || p.industries[0];
    if (nicheIndustry) push('qualified', 'commercial', 'Qualified money', `Who should implement ${s0} for ${adj ? 'an ' + adj : 'an'} ${singular(nicheIndustry)}`);
  }

  // Comparison — must name real competitors.
  const c0 = p.competitors[0], c1 = p.competitors[1];
  const cmpSvc = p.services[0] || svc[0] || '';
  if (c0) push('comparison', 'comparison', 'Comparison', `Alternatives to ${c0} for ${cmpSvc}${geo ? ' in ' + geo : ''}`);
  if (c1) push('comparison', 'comparison', 'Comparison', `Alternatives to ${c1} for ${p.services[3] || cmpSvc} work`);
  if (c0 && c1 && p.brand) push('comparison', 'comparison', 'Comparison', `${c0} vs ${p.brand} vs ${c1} for ${cmpSvc}`);

  // Niche moonshots — industry-anchored, high-intent.
  for (const ind of p.industries.slice(0, 4)) {
    push('niche', 'problem', 'Niche moonshot', `AI solutions for ${geoScopedIndustry(ind, geo)}`);
  }

  // Conversational buyer-journey.
  const convoInd = p.industries.find(i => /insurance/i.test(i)) || p.industries[0];
  if (convoInd && s0) {
    push('conversational', 'problem', 'Buyer journey',
      `I run ${adj ? 'an ' + adj : 'a'} ${singular(convoInd)} and our CRM is outdated, who should I talk to about ${s0}?`);
  }
  return out;
}

// Tier 2a: {service} x {geo variant} "implementation partner" grid. The Best/
// Top/Recommended qualifier rotates continuously across the flattened grid,
// exactly like the gold sheet.
function tier2ServiceGeo(p) {
  const QUALIFIERS = ['Best', 'Top', 'Recommended'];
  const out = [];
  let i = 0;
  for (const s of p.services) {
    for (const g of p.geoVariants) {
      const q = `${QUALIFIERS[i % QUALIFIERS.length]} ${s} implementation partner in ${g}`;
      out.push({ tier: 2, type: 'qualified', intent: 'commercial', theme: `Grid: ${s}`, query: q, source: 'gold' });
      i++;
    }
  }
  return out;
}

// Tier 2b: {service} x {buyer segment} qualifier grid.
function tier2Qualifier(p) {
  const out = [];
  const services = p.gridQualifierServices.length ? p.gridQualifierServices : p.services.slice(0, 4);
  for (const s of services) {
    for (const seg of p.segments) {
      const q = `Best ${s} partner${p.geo ? ' in ' + p.geo : ''} for a ${seg}`;
      out.push({ tier: 2, type: 'qualified', intent: 'commercial', theme: 'Grid: qualifier', query: q, source: 'gold' });
    }
  }
  return out;
}

// Tier 3: {template} x {industry} grid.
function tier3Industry(p) {
  const TEMPLATES = ['Best technology partner for', 'Dynamics 365 for', 'AI solutions for'];
  const svc0 = p.services[0] || 'Dynamics 365';
  // Use the client's flagship service in the middle template rather than a
  // hard-coded "Dynamics 365" so the grid stays on-brand for any client.
  const templates = ['Best technology partner for', `${svc0} for`, 'AI solutions for'];
  const out = [];
  for (const ind of p.industries) {
    const scoped = geoScopedIndustry(ind, p.geo);
    for (const t of templates) {
      out.push({ tier: 3, type: 'niche', intent: 'problem', theme: 'Industry', query: `${t} ${scoped}`, source: 'gold' });
    }
  }
  return out;
}

function singular(s) {
  // "insurance companies" -> "insurance company"; light touch, only the tail.
  return String(s || '')
    .replace(/\bcompanies\b/i, 'company')
    .replace(/\borganisations\b/i, 'organisation')
    .replace(/\bunions\b/i, 'union');
}

// ---- generic profile derivation (any client) ------------------------------
//
// The gold grid is only as good as the profile it is built from. For an
// arbitrary client we assemble that profile from three signals, in order of
// trust:
//   1. llmProfile  — a structured extraction of the client's website
//                    ({ services, industries, headlineServices }), produced at
//                    runtime by an LLM. Most reliable; overrides the rest.
//   2. sitePhrases — heuristic noun phrases pulled from the site (title/h1-h3).
//   3. gscQueries  — the client's real search terms.
// Competitors, geo and segments come straight off the client record / defaults.
// Nothing here is client-specific, so it works for every client.

// Light lexicons so the heuristic fallback can recognise service/industry
// language when no LLM profile is supplied. Deliberately broad, not exhaustive.
const SERVICE_HINTS = /\b(consult(?:ing|ancy)|development|implementation|integration|migration|platform|software|analytics|data|cloud|ai|automation|crm|erp|seo|marketing|design|support|managed services|cyber ?security|devops)\b/i;
const INDUSTRY_HINTS = /\b(insurance|bank(?:ing)?|credit union|healthcare|pharma|government|public sector|retail|ecommerce|manufactur|logistics|aviation|energy|utilities|education|legal|law|hospitality|construction|agri|food|telecom|non ?profit|charity|real estate|property)\b/i;

function cleanPhrase(s) {
  return String(s || '').replace(/[|•·–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function pickByHint(phrases, hint, limit) {
  const seen = new Set();
  const out = [];
  for (const raw of phrases) {
    const p = cleanPhrase(raw);
    if (!p || p.length > 60) continue;
    if (!hint.test(p)) continue;
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

// Derive a gold-grid profile for any client. All named options are optional;
// with none supplied you still get a (thin) profile that produces a valid grid.
export function deriveGridProfile(client = {}, { sitePhrases = [], gscQueries = [], llmProfile = null } = {}) {
  const geo = String(client.geo || client.country || '').split(/[,/]/)[0].trim()
    || guessGeoFromText([...(sitePhrases || []), ...(gscQueries || [])].join(' '));
  const competitors = (Array.isArray(client.competitors)
    ? client.competitors
    : String(client.competitors || '').split(/[,\n]/))
    .map(s => s.trim()).filter(Boolean);

  const lp = llmProfile || {};
  const services = dedupeStrings([
    ...(lp.services || []),
    ...pickByHint(sitePhrases, SERVICE_HINTS, 14),
    ...pickByHint(gscQueries, SERVICE_HINTS, 14)
  ]).slice(0, 14);
  const industries = dedupeStrings([
    ...(lp.industries || []),
    ...pickByHint(sitePhrases, INDUSTRY_HINTS, 8),
    ...pickByHint(gscQueries, INDUSTRY_HINTS, 8)
  ]).slice(0, 8);
  const headlineServices = dedupeStrings([...(lp.headlineServices || []), ...services]).slice(0, 6);

  return toGridProfile({
    brand: client.name || client.brand,
    geo,
    services,
    headlineServices,
    gridQualifierServices: (lp.gridQualifierServices || services.slice(0, 4)),
    industries,
    competitors
  });
}

function dedupeStrings(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    const v = cleanPhrase(s);
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function guessGeoFromText(text) {
  const t = String(text || '').toLowerCase();
  const GEOS = ['ireland', 'united kingdom', 'south africa', 'australia', 'canada', 'new zealand', 'singapore'];
  for (const g of GEOS) if (t.includes(g)) return g.replace(/\b\w/g, c => c.toUpperCase());
  return '';
}

// ---- public API -----------------------------------------------------------

// Build the full gold grid for a client/profile. Returns probe-candidate
// objects; dedupes case-insensitively while preserving tier order.
export function buildGoldGrid(input = {}, { maxProbes = 0 } = {}) {
  const p = toGridProfile(input);
  const all = [
    ...tier1(p),
    ...tier2ServiceGeo(p),
    ...tier2Qualifier(p),
    ...tier3Industry(p)
  ];
  const seen = new Set();
  const out = [];
  for (const probe of all) {
    const k = probe.query.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(probe);
    if (maxProbes && out.length >= maxProbes) break;
  }
  return out;
}
