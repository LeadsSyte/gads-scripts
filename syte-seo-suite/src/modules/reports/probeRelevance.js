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
export function offTopicReason(query, { audience = 'b2b', brand = '' } = {}) {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  if (QUALIFIER_AFTER_SENTENCE.test(q)) return 'qualifier appended after a complete question';
  const b = String(brand || '').trim().toLowerCase();
  if (b && q.toLowerCase().includes(b) && B2B_SEGMENT.test(q)) return 'buyer segment appended to a brand question';
  if (audience === 'b2c') {
    if (B2B_SEGMENT.test(q)) return 'B2B buyer segment on a consumer brand';
    if (B2B_PHRASES.some(re => re.test(q))) return 'B2B phrasing on a consumer brand';
  }
  return null;
}

export const isRelevantProbe = (query, ctx) => offTopicReason(query, ctx) === null;
