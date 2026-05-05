// Keyword classification + bucket helpers used by the monthly report.
//
// What clients actually care about — in order of importance:
//   1. Head terms ranking on page 1 ("shelving", "racking") — proves
//      we're winning competitive, high-volume search terms.
//   2. Position improvements MoM, especially for head terms.
//   3. Striking-distance keywords (page 2, easy to push to page 1).
//   4. Branded queries are interesting but not "SEO performance" —
//      they would rank #1 anyway. Filter them out of the showcase.
//
// They care LESS about long-tail queries like "best mezzanine floor
// supplier in PTA" because:
//   - Volume is tiny
//   - The match is half because the query is so specific
//   - It doesn't prove competitive standing in the market

// Words that mark a query as long-tail / qualifier-heavy.
// We keep this short on purpose — adding too many drops legitimate
// short head terms from the bucket (e.g. "office shelving sa" is fine).
const QUALIFIER_WORDS = new Set([
  'best', 'top', 'cheap', 'cheapest', 'affordable', 'leading',
  'near', 'around', 'closest', 'local',
  'reviews', 'reviewed', 'rating', 'ratings', 'comparison', 'vs', 'versus',
  'how', 'what', 'why', 'which', 'when', 'where', 'who',
  'guide', 'tutorial', 'tips', 'tricks', 'ideas',
  'cost', 'price', 'pricing', 'prices', 'quote', 'quotes',
  'company', 'companies', 'supplier', 'suppliers', 'manufacturer', 'manufacturers',
  'service', 'services', 'provider', 'providers'
]);

// Common South African location modifiers we should treat as long-tail
// markers when they appear alongside other words. Empty string match is
// avoided by requiring the location to be a separate token.
const SA_LOCATIONS = new Set([
  'south', 'africa', 'sa', 'rsa',
  'johannesburg', 'jhb', 'joburg', 'gauteng', 'sandton', 'midrand', 'pretoria', 'pta',
  'cape', 'town', 'cpt', 'western', 'durban', 'dbn', 'kzn', 'kwazulu', 'natal',
  'port', 'elizabeth', 'pe', 'gqeberha', 'east', 'london',
  'bloemfontein', 'bloem', 'free', 'state',
  'limpopo', 'mpumalanga', 'polokwane', 'nelspruit', 'mbombela',
  'zimbabwe', 'namibia', 'botswana'
]);

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'for', 'to', 'by', 'with', 'and', 'or',
  '&', '-', 'my', 'me', 'we', 'us', 'i'
]);

function tokenize(s) {
  return (s || '').toLowerCase().replace(/[^\w\s&-]/g, ' ').split(/\s+/).filter(Boolean);
}

// Significant tokens = total words minus stopwords.
function significantTokens(s) {
  return tokenize(s).filter(t => !STOPWORDS.has(t));
}

// Build brand-token list once per classifier call. We treat any keyword
// containing the brand name (or a strong fragment of it) as branded.
function brandTokens(brandName) {
  const tokens = tokenize(brandName);
  const out = new Set();
  for (const t of tokens) if (t.length >= 4) out.add(t);
  // Allow concatenated brand "krostshelving"
  const concat = tokens.join('');
  if (concat.length >= 5) out.add(concat);
  return out;
}

export function classifyKeyword(keyword, brandName) {
  const q = (keyword?.query || '').toLowerCase().trim();
  if (!q) return { branded: false, headTerm: false, longTail: true, hasLocation: false, wordCount: 0 };

  const tokens = tokenize(q);
  const sig = significantTokens(q);
  const brandSet = brandTokens(brandName);

  const branded = tokens.some(t => brandSet.has(t)) ||
                  (brandSet.has(tokens.join('')));

  const hasLocation = tokens.some(t => SA_LOCATIONS.has(t));
  const hasQualifier = tokens.some(t => QUALIFIER_WORDS.has(t));

  // Head term = short, no location, no qualifier, not branded.
  // We allow up to 3 significant tokens — "industrial racking systems"
  // counts, but "best industrial racking systems south africa" doesn't.
  const headTerm = !branded && !hasLocation && !hasQualifier && sig.length > 0 && sig.length <= 3;

  // Long tail = anything with a location, qualifier, or 4+ significant tokens.
  const longTail = !branded && !headTerm;

  return { branded, headTerm, longTail, hasLocation, hasQualifier, wordCount: tokens.length };
}

// Return a copy of `keywords` with .classification attached.
export function classifyKeywords(keywords, brandName) {
  return (keywords || []).map(kw => ({ ...kw, classification: classifyKeyword(kw, brandName) }));
}

// Build the bucketed views used by the report microsite.
//
// Each bucket is sorted to surface what matters most:
//   - top3 / top10: by impressions desc (head terms float to the top
//     within a position bucket because they get ranked first by a
//     prepass — see headFirst())
//   - improved: by absolute position improvement (positive change desc)
//   - striking: by impressions desc (high-volume page-2 wins matter most)
//
// Branded queries are excluded by default from every bucket because
// they would rank #1 regardless of SEO work. The full table at the
// bottom of the report still shows everything.
export function buildKeywordBuckets(keywords, brandName, opts = {}) {
  const { excludeBranded = true } = opts;
  const classified = classifyKeywords(keywords, brandName);
  const eligible = classified.filter(kw => excludeBranded ? !kw.classification.branded : true);

  // Helper to sort head terms first within a list, then by impressions.
  const headFirst = (a, b) => {
    const aHead = a.classification.headTerm ? 1 : 0;
    const bHead = b.classification.headTerm ? 1 : 0;
    if (aHead !== bHead) return bHead - aHead;
    return (b.impressions || 0) - (a.impressions || 0);
  };

  const top3 = eligible
    .filter(kw => kw.position > 0 && kw.position <= 3.4)
    .sort(headFirst);

  const top10 = eligible
    .filter(kw => kw.position > 3.4 && kw.position <= 10.4)
    .sort(headFirst);

  // Improved = position decreased (lower is better). change > 0 = improved.
  // We require at least 0.5 positions of movement to filter out noise.
  const improved = eligible
    .filter(kw => kw.change != null && kw.change >= 0.5)
    .sort((a, b) => (b.change || 0) - (a.change || 0));

  // Striking distance = page 2, with at least some impressions to be worth chasing.
  const striking = eligible
    .filter(kw => kw.position > 10.4 && kw.position <= 20.4 && (kw.impressions || 0) >= 5)
    .sort(headFirst);

  // Head term wins specifically — used for the showcase callout.
  const headTermWins = eligible
    .filter(kw => kw.classification.headTerm && kw.position <= 10.4)
    .sort((a, b) => a.position - b.position);

  // Branded queries kept separately so we can show them in a small chip
  // strip — useful context but not the SEO headline.
  const branded = classified
    .filter(kw => kw.classification.branded)
    .sort((a, b) => (b.clicks || 0) - (a.clicks || 0));

  return {
    top3, top10, improved, striking, headTermWins, branded,
    counts: {
      total: classified.length,
      eligible: eligible.length,
      top3: top3.length,
      top10: top10.length,
      improved: improved.length,
      striking: striking.length,
      headTermWins: headTermWins.length,
      branded: branded.length
    }
  };
}

// Pull AEO probe candidates from GSC keyword data. The idea: queries
// the brand already gets impressions for are real queries real users
// type — better probe targets than guessed-up ones. We prioritize
// head terms (no location, no qualifier) since the user wants the
// probe to test competitive market visibility, not long-tail niche.
//
// Returns up to `limit` deduped, lowercased query strings, sorted by
// impressions desc with head terms floated to the top.
export function probeCandidatesFromGSC(keywords, brandName, { limit = 30 } = {}) {
  const classified = classifyKeywords(keywords, brandName);

  // Drop branded (would always rank #1 for the brand) and queries with
  // weak signal (< 5 impressions over the month).
  const eligible = classified.filter(kw =>
    !kw.classification.branded &&
    (kw.impressions || 0) >= 5
  );

  // Head terms first, then by impressions.
  eligible.sort((a, b) => {
    const aHead = a.classification.headTerm ? 1 : 0;
    const bHead = b.classification.headTerm ? 1 : 0;
    if (aHead !== bHead) return bHead - aHead;
    return (b.impressions || 0) - (a.impressions || 0);
  });

  const seen = new Set();
  const out = [];
  for (const kw of eligible) {
    const q = (kw.query || '').toLowerCase().trim();
    if (!q || seen.has(q)) continue;
    seen.add(q);
    out.push(q);
    if (out.length >= limit) break;
  }
  return out;
}

// Merge new probe queries into an existing newline-separated list,
// case-insensitive deduping, preserving the existing order. Returns
// { merged: string, addedCount: number, totalCount: number }.
export function mergeProbeQueries(existingRaw, newQueries) {
  const existing = (existingRaw || '').split('\n').map(s => s.trim()).filter(Boolean);
  const seen = new Set(existing.map(s => s.toLowerCase()));
  let added = 0;
  const merged = existing.slice();
  for (const q of (newQueries || [])) {
    const lower = q.toLowerCase().trim();
    if (!lower || seen.has(lower)) continue;
    seen.add(lower);
    merged.push(q.trim());
    added++;
  }
  return { merged: merged.join('\n'), addedCount: added, totalCount: merged.length };
}
