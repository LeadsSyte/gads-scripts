// Branded-query detection shared by the AEO census, the AEO runner and the
// report builders.
//
// House rule: SEO and AEO reports never showcase, or even mention, how the
// client performs for searches/prompts that contain its own name. Those
// would rank / get named regardless of our work, so they inflate the numbers
// and prove nothing. Branded prompts are kept out of AEO scoring entirely and
// branded keywords are kept out of everything the SEO report narrates.
//
// Matching keys off DISTINCTIVE brand tokens — brand-name words that aren't
// also generic category words (derived from the client's industry). So a
// brand named after its category ("Krost Shelving" in industrial storage
// shelving) still flags "krost racking" as branded but KEEPS "industrial
// shelving" as a legitimate category query.

export function tokenize(s) {
  return (s || '').toLowerCase().replace(/[^\w\s&-]/g, ' ').split(/\s+/).filter(Boolean);
}

// Brand-name tokens that actually identify the brand, excluding any token that
// also appears in the category/industry text (those are generic, not branded).
export function distinctiveBrandTokens(brandName, category = '') {
  const generic = new Set(tokenize(category));
  const toks = tokenize(brandName);
  const out = new Set();
  for (const t of toks) if (t.length >= 4 && !generic.has(t)) out.add(t);
  // The concatenated name catches "krostshelving", and for a single short
  // name ("DPA") it is the only token, so it's allowed down to 3 chars.
  const concat = toks.join('');
  if (concat.length >= 3 && !generic.has(concat)) out.add(concat);
  return out;
}

export function isBrandedQuery(query, brandTokenSet) {
  if (!brandTokenSet || !brandTokenSet.size) return false;
  const toks = tokenize(query);
  return toks.some(t => brandTokenSet.has(t)) || brandTokenSet.has(toks.join(''));
}

// Predicate for a client record: (query) => true when the query names the
// client. Build once per list, not per query.
export function brandedMatcherFor(client) {
  const set = distinctiveBrandTokens(client?.name || '', client?.industry || '');
  return (query) => isBrandedQuery(query, set);
}

// Remove branded prompts from a stored AEO snapshot's query-level lists, so a
// snapshot taken before branded prompts were excluded from runs never lists
// one in a report table or the AI payload. New snapshots don't contain any
// (the runner skips them); this is the guard for older ones. Returns a copy.
const QUERY_LISTS = ['per_query', 'probe_results', 'expansion_probes', 'excerpts'];
export function stripBrandedPrompts(snap, client) {
  if (!snap || !client?.name) return snap;
  const isBranded = brandedMatcherFor(client);
  const keep = (rows) => Array.isArray(rows) ? rows.filter(r => !isBranded(r?.query || '')) : rows;
  const out = { ...snap };
  for (const k of QUERY_LISTS) if (Array.isArray(out[k])) out[k] = keep(out[k]);
  if (out.keyword_wins && typeof out.keyword_wins === 'object') {
    const kw = {};
    for (const [k, v] of Object.entries(out.keyword_wins)) kw[k] = keep(v);
    out.keyword_wins = kw;
  }
  return out;
}
