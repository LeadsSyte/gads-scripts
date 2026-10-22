// Winner expansion — the "spider web".
//
// When a probe WINS (the brand appears), we don't stop: we drill that exact
// winning query deeper into high-intent long-tail, along two dimensions:
//   1. GEO drill:      "... in ireland"  ->  "... in dublin", "... in cork", ...
//   2. SEGMENT/industry qualifier: "..."  ->  "... for mid-market companies",
//                                              "... for financial services", ...
// Each child that also wins gets expanded again (the runner recurses), so a
// single winner like "best azure document intelligence company in ireland"
// fans out across cities and buyer segments until the branch stops converting.
// The intent stays transactional — we only ever narrow a query the brand
// already ranks for, which is where a small specialist wins on volume.
//
// Consumer (B2C) brands get no default segment drill — "duvets for SMEs" is
// not a prompt their buyers ask — and no winner is ever segment-qualified if it
// is a complete question or names the brand ("...sourced? for startups").
//
// Pure and node-testable: only imports the pure relevance filter.
import { offTopicReason } from './probeRelevance.js';

// Default drill dimensions. Callers pass client-specific geos/segments/
// industries; these are the fallback so expansion still works with no profile.
export const DEFAULT_GEO_DRILL = {
  ireland: ['Dublin', 'Cork', 'Galway', 'Limerick', 'Belfast', 'UK and Ireland'],
  'united kingdom': ['London', 'Manchester', 'Birmingham', 'Leeds', 'Scotland'],
  'south africa': ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria'],
};
export const DEFAULT_SEGMENTS = [
  'mid-market companies', 'enterprises', 'SMEs', 'startups',
  'financial services firms', 'insurance companies', 'healthcare providers',
  'public sector organisations', 'manufacturers', 'retailers'
];

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Which broad geo (if any) does the query already name? Returns { geo, cities }.
function detectGeo(q, geoDrill) {
  const n = norm(q);
  for (const [geo, cities] of Object.entries(geoDrill)) {
    if (n.includes(geo)) return { geo, cities };
  }
  return { geo: null, cities: [] };
}

// Has the query already been narrowed with a "for <segment>" qualifier?
function hasSegment(q) {
  return /\bfor\b/i.test(String(q || ''));
}

// Expand ONE winning query into deeper long-tail children. Returns an array of
// { query, type, tier, intent, source, parentProbeId } candidates.
//
// opts:
//   geos          string[]  — extra cities/regions to drill into (merged with defaults for the detected country)
//   segments      string[]  — buyer segments / industries to qualify by
//   parentProbeId string
//   parentTier    number    — child tier = min(parentTier+1, 3)
//   maxPerWinner  number    — cap children per winner (controls fan-out width)
//   audience      'b2b' | 'b2c' — B2C skips the default B2B segment list
//   brand         string    — brand-anchored winners are never segment-qualified
//   brandTerms    from brandTermsFor(client) — children naming the brand are dropped
export function expandWinnerQuery(query, {
  geos = [], segments, geoDrill = DEFAULT_GEO_DRILL,
  parentProbeId = null, parentTier = 1, maxPerWinner = 6,
  audience = 'b2b', brand = '', brandTerms = null
} = {}) {
  if (!segments) segments = audience === 'b2c' ? [] : DEFAULT_SEGMENTS;
  const q = String(query || '').trim();
  if (!q) return [];
  const childTier = Math.min((Number(parentTier) || 1) + 1, 3);
  const seen = new Set([norm(q)]);
  const out = [];
  const push = (childQuery) => {
    const cq = String(childQuery || '').replace(/\s+/g, ' ').trim();
    const key = norm(cq);
    if (!cq || seen.has(key)) return;
    if (offTopicReason(cq, { audience, brand, brandTerms })) return;
    seen.add(key);
    out.push({ query: cq, type: 'qualified', tier: childTier, intent: 'commercial', source: 'fanout', parentProbeId });
  };

  // 1. Geo drill — swap the named country for its cities/regions (plus any
  //    caller-supplied geos). Only when the query actually names a known geo,
  //    so we don't blindly append locations to a national/global query.
  const { geo, cities } = detectGeo(q, geoDrill);
  const drillGeos = [...new Set([...(cities || []), ...geos])].filter(g => norm(g) !== geo);
  if (geo) {
    const re = new RegExp(geo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for (const city of drillGeos) push(q.replace(re, city));
  }

  // 2. Segment / industry qualifier — narrow by buyer type, but only if the
  //    query isn't already qualified (avoid "... for X for Y" stacking), isn't
  //    a complete question, and doesn't name the brand (a reverse probe like
  //    "List companies similar to Acme" has no buyer segment).
  const isQuestion = /[?.!]\s*$/.test(q);
  const namesBrand = !!brand && norm(q).includes(norm(brand));
  if (!hasSegment(q) && !isQuestion && !namesBrand) {
    for (const seg of segments) push(`${q} for ${seg}`);
  }

  return maxPerWinner > 0 ? out.slice(0, maxPerWinner) : out;
}
