// Probe relevance — keep prompts that have nothing to do with the client's
// business out of the AEO census (and therefore out of the report).
//
// The generators were tuned on a B2B Microsoft partner, so a consumer brand
// ended up probed with prompts like "Are Cuddledown duvets ethically sourced?
// for startups" (winner expansion bolting B2B buyer segments onto a question)
// or "Microsoft partner for regulated financial services" (a hard-coded gold
// grid line). Those prompts are meaningless to a B2C business and inflate its
// coverage with free wins. This module decides, per prompt, whether it belongs.
//
// It also keeps BRANDED prompts out. A prompt that names the client ("Are
// Cuddledown duvets ethically sourced?", "Acme vs Rival for X") is a free win:
// the engine names the brand because the user did. The report measures whether
// AI recommends the client when a buyer has NOT named it, so those prompts are
// never probed or reported. Reverse probes ("What is Acme known for?") are the
// one exception: they are instruments, never scored or shown, and the runner
// adds them itself.
//
// Pure and node-testable: no imports.

// Who the client sells to. A profile audience the LLM extracted from the site
// wins; otherwise an ecommerce client (Client Type) is treated as B2C.
// Unknown defaults to B2B so the original generator behaviour is unchanged.
export function clientAudience(client = {}, profile = null) {
  const explicit = String(profile?.audience || '').toLowerCase();
  if (explicit === 'b2c' || explicit === 'b2b') return explicit;
  return client?.client_type === 'ecommerce' ? 'b2c' : 'b2b';
}

// Buyer segments / industries the B2B generators append ("... for SMEs").
const B2B_SEGMENT = /\bfor (?:an? )?(?:mid-market(?: compan(?:y|ies))?|enterprises?|smes?|startups?|small businesses|financial services(?: firms)?|insurance compan(?:y|ies)|healthcare providers|public sector(?: organisations?)?|manufacturers|retailers|regulated (?:business(?:es)?|financial services))\s*$/i;

// Phrasing that only makes sense when the client sells to businesses.
const B2B_PHRASES = [
  /\bmicrosoft partner\b/i,
  /\bimplementation partner\b/i,
  /\btechnology partner\b/i,
  /\bpartner (?:in .+ )?for an? /i,
  /\bfor building ai agents\b/i,
  /\bour crm is outdated\b/i,
  /^ai solutions for\b/i,
  /\bdynamics 365\b/i
];

// A "for <segment>" qualifier glued on after the sentence already ended
// ("...sourced? for SMEs", "...similar to Cuddledown. for startups").
const QUALIFIER_AFTER_SENTENCE = /[?.!]\s*for\s+\S/i;

// Why `query` is off-topic for this client, or null if it belongs.
//   audience  'b2b' | 'b2c'
//   brand     client name — a brand-anchored prompt never takes a segment suffix
//   brandTerms  from brandTermsFor(client): prompts naming the brand are off-topic
export function offTopicReason(query, { audience = 'b2b', brand = '', brandTerms = null } = {}) {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  if (brandTerms && namesBrand(q, brandTerms)) return 'names the client brand (branded prompt)';
  if (QUALIFIER_AFTER_SENTENCE.test(q)) return 'qualifier appended after a complete question';
  const b = String(brand || '').trim().toLowerCase();
  if (b && q.toLowerCase().includes(b) && B2B_SEGMENT.test(q)) return 'buyer segment appended to a brand question';
  if (audience === 'b2c') {
    if (B2B_SEGMENT.test(q)) return 'B2B buyer segment on a consumer brand';
    if (B2B_PHRASES.some(re => re.test(q))) return 'B2B phrasing on a consumer brand';
  }
  return null;
}

// Words that are part of many brand names but are ordinary words in a buyer's
// prompt ("The Bed Shop" must not make "where to shop for a bed" branded).
const GENERIC_NAME_WORDS = new Set([
  'the', 'and', 'shop', 'shops', 'store', 'stores', 'online', 'group', 'company',
  'co', 'ltd', 'pty', 'inc', 'llc', 'plc', 'limited', 'holdings', 'international',
  'global', 'direct', 'digital', 'agency', 'studio', 'studios', 'solutions',
  'services', 'service', 'systems', 'products', 'supplies', 'supply', 'trading',
  'warehouse', 'outlet', 'centre', 'center', 'world', 'house', 'home',
  'south', 'africa', 'london', 'cape', 'town', 'best', 'quality', 'premium',
  'brands', 'brand', 'partners', 'consulting', 'industries', 'factory', 'depot',
  'express', 'hub', 'labs', 'lab', 'club', 'market', 'mart', 'plus', 'pro'
]);

function tokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s&'-]/g, ' ').replace(/['’]/g, '').split(/[\s-]+/).filter(Boolean);
}

// The terms that identify the client in a prompt: the full name as a phrase,
// the name run together ("hotleathers"), the website's domain word
// ("cuddledown" from cuddledown.com), and any name word that is distinctive
// (4+ letters, not an ordinary word, not in the client's industry text).
export function brandTermsFor(client = {}) {
  const name = String(client?.name || '').trim();
  const nameToks = tokens(name);
  const generic = new Set([...GENERIC_NAME_WORDS, ...tokens(client?.industry)]);
  const phrases = new Set();
  const words = new Set();
  if (nameToks.length) phrases.add(nameToks.join(' '));
  const concat = nameToks.join('');
  if (concat.length >= 5) words.add(concat);
  const isGeneric = (t) => generic.has(t) || generic.has(t.replace(/s$/, '')) || generic.has(t + 's');
  for (const t of nameToks) if (t.length >= 4 && !isGeneric(t) && !/^\d+$/.test(t)) words.add(t);
  const host = String(client?.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/:?#].*$/, '');
  const root = host.split('.')[0];
  if (root && root.length >= 4 && !isGeneric(root)) words.add(root);
  if (host.includes('.')) phrases.add(host);
  return { phrases: [...phrases].filter(p => p.length >= 3), words: [...words] };
}

// True when the prompt names the client (see brandTermsFor).
export function namesBrand(query, terms) {
  if (!terms) return false;
  const qt = tokens(query);
  if (!qt.length) return false;
  const joined = ' ' + qt.join(' ') + ' ';
  for (const p of terms.phrases || []) if (joined.includes(' ' + tokens(p).join(' ') + ' ')) return true;
  const set = new Set(qt);
  for (const w of terms.words || []) {
    if (set.has(w)) return true;
    // possessive / plural of the brand word ("Cuddledown's", "Krosts")
    if (set.has(w + 's')) return true;
    // the brand run together inside the prompt ("hotleathers.com" tokenises to "hotleathers com")
    if (w.length >= 6 && qt.some(t => t.length > w.length && t.startsWith(w))) return true;
  }
  return false;
}

// The context every relevance check for this client takes.
export function relevanceFor(client = {}, profile = null) {
  return { audience: clientAudience(client, profile), brand: client?.name || '', brandTerms: brandTermsFor(client) };
}

export const isRelevantProbe = (query, ctx) => offTopicReason(query, ctx) === null;

// Remove branded prompts from a snapshot that was measured before branded
// prompts were excluded, so the client never sees one in the report. Only the
// prompt lists are filtered; the headline scores of such a snapshot still
// include those prompts, which is why `brandedRemoved` is returned: a caller
// that gets a non-zero count should say the snapshot needs re-running.
export function withoutBrandedPrompts(snap, client) {
  if (!snap || typeof snap !== 'object') return { snapshot: snap, brandedRemoved: 0 };
  const terms = brandTermsFor(client);
  if (!terms.phrases.length && !terms.words.length) return { snapshot: snap, brandedRemoved: 0 };
  const removed = new Set();
  const keep = (row, { allowReverse = false } = {}) => {
    if (!row) return false;
    if (allowReverse && row.type === 'reverse') return true;
    if (namesBrand(row.query, terms)) { removed.add(String(row.query).toLowerCase().trim()); return false; }
    return true;
  };
  const out = { ...snap };
  if (Array.isArray(snap.per_query)) out.per_query = snap.per_query.filter(r => keep(r));
  if (Array.isArray(snap.probe_results)) out.probe_results = snap.probe_results.filter(r => keep(r, { allowReverse: true }));
  if (Array.isArray(snap.excerpts)) out.excerpts = snap.excerpts.filter(r => keep(r));
  if (Array.isArray(snap.expansion_probes)) out.expansion_probes = snap.expansion_probes.filter(r => keep(r));
  if (snap.keyword_wins && typeof snap.keyword_wins === 'object') {
    out.keyword_wins = {};
    for (const [k, list] of Object.entries(snap.keyword_wins)) {
      out.keyword_wins[k] = Array.isArray(list) ? list.filter(r => keep(r)) : list;
    }
  }
  if (Array.isArray(snap.citation_gaps)) {
    out.citation_gaps = snap.citation_gaps.map(g => Array.isArray(g?.exampleQueries)
      ? { ...g, exampleQueries: g.exampleQueries.filter(q => !namesBrand(q, terms)) }
      : g);
  }
  return { snapshot: out, brandedRemoved: removed.size };
}
