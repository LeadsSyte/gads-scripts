// AEO Prompt Census — replaces the old "guess 15 probe queries" model.
//
// The problem with the old approach: the AEO score hung off a small,
// hand-picked (or GSC-seeded) list of probe queries. Since the space of
// prompts a buyer could type into an AI engine is effectively infinite, any
// short list is arbitrary — "cited for 4 of 15" is a meaningless number when
// the 15 were guessed. A client can always say "those aren't the prompts that
// matter" and they'd be right.
//
// The fix: stop guessing individual prompts. Generate a STRUCTURED,
// REPRESENTATIVE census of how real buyers ask AI engines about this
// category — bucketed by buyer intent — and measure the brand's SHARE OF
// VOICE across that census. The census is generated once, reviewed, persisted
// and reused month-over-month so trends are comparable. Its size and
// intent-coverage are the point, not a liability.
//
// Grounding (the key to keeping it relevant): generation is steered by real
// signals so the census centers on categories where the brand is genuinely
// credible rather than random prompts:
//   - the brand's top NON-branded organic rankings (what it actually ranks
//     #1-3 for in Google — hard proof of category authority)
//   - client industry / products / location / audience / competitors
//   - an LLM "direction" pass: what is this brand most likely to be
//     recommended for by an AI engine, given the above?

import { claudeComplete, extractJSON } from '../../lib/anthropic.js';

// The buyer-intent taxonomy the census is built around. Every generated
// prompt is tagged with exactly one of these. Coverage across all five is
// what makes the census representative instead of cherry-picked.
export const INTENT_BUCKETS = [
  { id: 'awareness',  label: 'Awareness',       hint: 'informational — how/what/why, "is X safe", "how to choose"' },
  { id: 'commercial', label: 'Commercial',      hint: 'best/top supplier & recommendation queries where AI names brands' },
  { id: 'comparison', label: 'Comparison',      hint: 'brand vs brand, "alternatives to X", "X or Y"' },
  { id: 'local',      label: 'Local',           hint: 'location-anchored — "where to buy X in <city>", "X near me"' },
  { id: 'problem',    label: 'Problem-solving', hint: 'use-case framed — "I need X for Y", "best way to do Z"' }
];

const INTENT_IDS = new Set(INTENT_BUCKETS.map(b => b.id));

// Rough target split across intents for an ~80-prompt census. Used both to
// instruct the generator and to flag under-covered buckets in the report.
export const DEFAULT_CENSUS_TARGET = 80;
const INTENT_MIX = {
  awareness:  0.20,
  commercial: 0.30,
  comparison: 0.15,
  local:      0.15,
  problem:    0.20
};

// ---------------------------------------------------------------------------
// Grounding signal 1 — the brand's top NON-branded organic rankings.
// These are queries the brand already ranks #1-3 for on Google, with branded
// queries stripped out (they'd rank #1 regardless and prove nothing about
// category authority). They tell the generator which product/topic areas the
// brand is genuinely credible in, so the census centers there.
//
// Branded filtering keys off DISTINCTIVE brand tokens — brand-name words that
// aren't also generic category words (derived from the client's industry). So
// a brand named after its category ("Krost Shelving" in industrial storage)
// still drops "krost racking" as branded but KEEPS "industrial shelving" as a
// legitimate category ranking, instead of nuking every "...shelving" query.
// ---------------------------------------------------------------------------
function tokenize(s) {
  return (s || '').toLowerCase().replace(/[^\w\s&-]/g, ' ').split(/\s+/).filter(Boolean);
}

// Brand-name tokens that actually identify the brand, excluding any token that
// also appears in the category/industry text (those are generic, not branded).
function distinctiveBrandTokens(brandName, category = '') {
  const generic = new Set(tokenize(category));
  const toks = tokenize(brandName);
  const out = new Set();
  for (const t of toks) if (t.length >= 4 && !generic.has(t)) out.add(t);
  const concat = toks.join('');
  if (concat.length >= 5) out.add(concat); // catch "krostshelving"
  return out;
}

function isBrandedQuery(query, brandTokenSet) {
  const toks = tokenize(query);
  return toks.some(t => brandTokenSet.has(t)) || brandTokenSet.has(toks.join(''));
}

export function topRankingSeeds(gscKeywords, brandName, { limit = 15, maxPosition = 3.5, minImpressions = 5, category = '' } = {}) {
  const brandTokenSet = distinctiveBrandTokens(brandName, category);
  const seeds = (gscKeywords || [])
    .filter(kw =>
      !isBrandedQuery(kw.query || '', brandTokenSet) &&
      (kw.position || 99) > 0 &&
      (kw.position || 99) <= maxPosition &&
      (kw.impressions || 0) >= minImpressions
    )
    .sort((a, b) => (b.impressions || 0) - (a.impressions || 0));

  const seen = new Set();
  const out = [];
  for (const kw of seeds) {
    const q = (kw.query || '').toLowerCase().trim();
    if (!q || seen.has(q)) continue;
    seen.add(q);
    out.push({ query: q, position: Math.round((kw.position || 0) * 10) / 10, impressions: kw.impressions || 0 });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grounding signal 2 — an LLM "direction" pass.
// Asks the model: given this brand, its site and its top rankings, what
// product/topic areas is it most likely to be recommended for by an AI
// engine? Returns a short list of focus areas that steer the census so it
// doesn't drift into category-adjacent prompts the brand has no shot at.
// ---------------------------------------------------------------------------
const DIRECTION_SYSTEM =
  'You are an AEO strategist. Given a brand and evidence of what it ranks for, ' +
  'identify the specific product/topic areas an AI assistant would plausibly ' +
  'recommend this brand for. Output ONLY valid JSON — no code fences, no prose.';

export async function inferLikelyTopics({ client, rankingSeeds = [] }) {
  const seedsBlock = rankingSeeds.length
    ? rankingSeeds.map(s => `- "${s.query}" (Google #${s.position})`).join('\n')
    : '(no ranking data available — infer from industry/context)';

  const prompt = `Brand: ${client.name || '(unnamed)'}
Website: ${client.url || ''}
Industry: ${client.industry || ''}
Location / service area: ${client.location || ''}
Brand context: ${client.context || ''}

Top NON-branded Google rankings (proof of category authority):
${seedsBlock}

Identify the 5-8 specific product/topic areas this brand is most likely to be
recommended for by an AI assistant (ChatGPT, Gemini, Perplexity). Be concrete
and category-anchored — "heavy-duty pallet racking", not "storage". Anchor to
the evidence above; do NOT invent areas the brand shows no signal for.

Return ONLY JSON: { "topics": ["...", "..."] }`;

  const text = await claudeComplete({
    system: DIRECTION_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 600,
    temperature: 0.4
  });
  const parsed = extractJSON(text);
  if (!parsed?.topics || !Array.isArray(parsed.topics)) return [];
  return parsed.topics.map(t => String(t).trim()).filter(Boolean).slice(0, 8);
}

// ---------------------------------------------------------------------------
// Census generation — the structured, intent-bucketed prompt set.
// ---------------------------------------------------------------------------
const CENSUS_SYSTEM =
  'You generate a representative census of the prompts real buyers type into ' +
  'AI assistants (ChatGPT, Perplexity, Gemini, Claude) when researching a ' +
  'category. Every prompt is tagged with one buyer-intent bucket. Output ONLY ' +
  'valid JSON — no code fences, no prose.';

function intentTargets(target) {
  return INTENT_BUCKETS.map(b => `  - ${b.id} (${b.label}): ~${Math.round(target * INTENT_MIX[b.id])} prompts — ${b.hint}`).join('\n');
}

// Build the user-message prompt for the census generator. Exported so tests
// (and the UI's "preview the prompt" affordance) can assert on it without a
// network call.
export function buildCensusPrompt({ client, rankingSeeds = [], likelyTopics = [], target = DEFAULT_CENSUS_TARGET }) {
  const seedsBlock = rankingSeeds.length
    ? rankingSeeds.map(s => `- "${s.query}" (Google #${s.position})`).join('\n')
    : '(none — infer from industry/context)';
  const topicsBlock = likelyTopics.length
    ? likelyTopics.map(t => `- ${t}`).join('\n')
    : '(none — derive focus areas from the rankings and industry above)';

  return `Brand: ${client.name || '(unnamed)'}
Website: ${client.url || ''}
Industry: ${client.industry || ''}
Location / service area: ${client.location || ''}
Target audience: ${client.audience || ''}
Brand context: ${client.context || ''}
Competitors: ${client.competitors || ''}

GROUNDING — center the census on these. Do NOT drift into adjacent categories
the brand has no authority in.

Top NON-branded Google rankings (what this brand genuinely ranks for):
${seedsBlock}

Focus areas this brand is most likely to be recommended for:
${topicsBlock}

TASK: Produce a representative census of ~${target} prompts that real buyers
type into AI assistants when researching this category. The goal is to measure
the brand's SHARE OF VOICE across a broad, representative surface — not to
"guess" the few prompts that mention the brand. Breadth and representativeness
are the point.

Tag every prompt with exactly ONE intent bucket and hit roughly this mix:
${intentTargets(target)}

RULES:
- Prompts must be the kind where an AI engine naturally names specific brands,
  suppliers or products (so visibility is measurable).
- Phrase them the way a person actually talks to an AI — fuller and more
  conversational than a Google keyword. Prefer "what's the best company to buy
  heavy-duty pallet racking from in Johannesburg?" over "pallet racking jhb".
- Comparison prompts may reference the named competitors above.
- Include the location in the local bucket (AI uses it for local recs).
- Include 1-2 brand-name prompts (in comparison or awareness) to test brand
  knowledge, but keep the census overwhelmingly NON-branded.
- Each prompt unique, natural, 6-18 words.

Return ONLY JSON in this exact shape:
{ "prompts": [ { "query": "...", "intent": "commercial" }, ... ] }`;
}

function normalizePrompts(rawPrompts) {
  const seen = new Set();
  const out = [];
  for (const p of (rawPrompts || [])) {
    const query = String(p?.query || '').trim();
    if (!query) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let intent = String(p?.intent || '').trim().toLowerCase();
    if (!INTENT_IDS.has(intent)) intent = 'commercial'; // safe default
    out.push({ query, intent });
  }
  return out;
}

// Full one-call generation. Caller supplies rankingSeeds (from GSC) and,
// optionally, likelyTopics (from inferLikelyTopics). Returns a persisted-shape
// census object. `now` is injectable for deterministic tests.
export async function generateCensus({ client, rankingSeeds = [], likelyTopics = [], target = DEFAULT_CENSUS_TARGET, now } = {}) {
  if (!client?.industry && !client?.context) {
    throw new Error('Add Industry or Brand Context first so the census generator has direction.');
  }
  const prompt = buildCensusPrompt({ client, rankingSeeds, likelyTopics, target });
  const text = await claudeComplete({
    system: CENSUS_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4000,
    temperature: 0.6
  });
  const parsed = extractJSON(text);
  if (!parsed?.prompts || !Array.isArray(parsed.prompts)) {
    throw new Error('Census generator returned unexpected output. Try again.');
  }
  const prompts = normalizePrompts(parsed.prompts);
  if (!prompts.length) throw new Error('Census generator produced no usable prompts. Try again.');

  return {
    version: 1,
    generated_at: (now || new Date()).toISOString(),
    target,
    grounding: {
      ranking_seeds: rankingSeeds,
      likely_topics: likelyTopics
    },
    prompts
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers — the census lives on the client as `aeo_census` (jsonb
// in Supabase / object in local state). We keep the flat newline list in
// `aeo_probe_queries` in sync so the runner and any legacy code keep working.
// ---------------------------------------------------------------------------
export function parseCensus(clientOrCensus) {
  const raw = clientOrCensus?.aeo_census ?? clientOrCensus;
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || !Array.isArray(obj.prompts)) return null;
  return obj;
}

// Flatten a census to the newline probe list the runner consumes.
export function censusToProbeList(census) {
  const c = parseCensus(census);
  if (!c) return '';
  return c.prompts.map(p => p.query).join('\n');
}

// Build a query → intent lookup (lower-cased keys) from a census.
export function intentMap(census) {
  const c = parseCensus(census);
  const map = {};
  if (!c) return map;
  for (const p of c.prompts) map[p.query.toLowerCase().trim()] = p.intent;
  return map;
}

// Count prompts per intent bucket; flags buckets below a coverage floor so
// the report can honestly say "this census under-covers comparison prompts".
export function intentCoverage(census, { floor = 3 } = {}) {
  const c = parseCensus(census);
  const counts = {};
  for (const b of INTENT_BUCKETS) counts[b.id] = 0;
  if (c) for (const p of c.prompts) {
    if (counts[p.intent] == null) counts[p.intent] = 0;
    counts[p.intent]++;
  }
  const total = c ? c.prompts.length : 0;
  return {
    total,
    counts,
    buckets: INTENT_BUCKETS.map(b => ({
      ...b,
      count: counts[b.id] || 0,
      pct: total ? Math.round(((counts[b.id] || 0) / total) * 100) : 0,
      thin: (counts[b.id] || 0) < floor
    }))
  };
}

// ---------------------------------------------------------------------------
// Share of Voice — the headline metric that replaces "cited for X of N".
// SoV = brand mentions / (brand + all competitor mentions) across the census.
// It answers "of all the brand-naming an AI engine does in this category, what
// fraction is us?" — defensible because the census is broad and representative.
// ---------------------------------------------------------------------------
export function shareOfVoice(brandMentions, competitors) {
  const brand = Math.max(0, Number(brandMentions) || 0);
  const compTotal = (competitors || []).reduce((a, c) => a + (Number(c.mentions) || 0), 0);
  const denom = brand + compTotal;
  if (denom === 0) return { sov: 0, brand, competitorTotal: compTotal, totalMentions: 0 };
  return {
    sov: Math.round((brand / denom) * 1000) / 10,
    brand,
    competitorTotal: compTotal,
    totalMentions: denom
  };
}
