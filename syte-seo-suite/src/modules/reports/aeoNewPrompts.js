// New prompts every month.
//
// Carry-forward (aeoCarryForward.js) re-runs last month's long-tail prompts so
// progress can be tracked. On its own that makes the census a closed loop: the
// only other source of new prompts is winner expansion, which drills a won
// prompt by city or buyer segment. A consumer brand has no segments, most
// prompts name no city, and a winner expanded last month yields children that
// are already carried, so a month could easily ask nothing new at all.
//
// This pass asks one model for buyer prompts the census has NOT asked before,
// steered by what the engines said about the brand this month (the categories
// they placed it in, why they recommended it, who they named beside it). Each
// candidate must survive the same filters as every other prompt: not branded,
// on-topic for the business, and not a near-duplicate of anything already
// probed, tracked or carried. The survivors are probed this month and, like
// any long-tail prompt, carried into next month when they win.
//
// pickNewPrompts is pure; discoverNewPrompts takes an injectable `ask`.

import { isDuplicateQuery } from './aeoProbes.js';
import { offTopicReason, includeBrandedSearch } from './probeRelevance.js';

const INTENTS = new Set(['awareness', 'commercial', 'comparison', 'local', 'problem']);

// Keep candidates that are new, unbranded and on-topic, up to `max`.
export function pickNewPrompts(candidates, { known = [], relevance = {}, max = 15 } = {}) {
  const pool = known.map(q => ({ query: q }));
  const out = [];
  for (const c of candidates || []) {
    const query = String(c?.query ?? c ?? '').replace(/\s+/g, ' ').trim();
    if (query.length < 12 || query.length > 200) continue;
    if (offTopicReason(query, relevance)) continue;           // branded or off-topic
    if (isDuplicateQuery(query, pool, 0.7)) continue;          // asked before, or a near-twin
    const intent = INTENTS.has(String(c?.intent || '').toLowerCase()) ? String(c.intent).toLowerCase() : 'commercial';
    out.push({ query, intent });
    pool.push({ query });
    if (out.length >= max) break;
  }
  return out;
}

export function newPromptsRequest({ client = {}, country = null, known = [], signals = {}, count = 15 }) {
  const list = (arr, n) => [...new Set((arr || []).map(s => String(s || '').trim()).filter(Boolean))].slice(0, n);
  return `Write ${count} NEW questions a real buyer would type into ChatGPT, Gemini or Claude when looking for what this business sells. Each must be a question where the AI would naturally recommend specific companies, brands or products.

BUSINESS (context only): ${client.name || ''} (${client.url || ''})
INDUSTRY: ${client.industry || '(not set)'}
LOCATION / SERVICE AREA: ${client.location || '(not set)'}
BUYERS ARE IN: ${country?.name || '(not set)'}
AUDIENCE: ${client.audience || '(not set)'}

How AI engines described this business this month:
- categories they placed it in: ${list(signals.segmentLabels, 12).join('; ') || '(none)'}
- reasons they gave for recommending it: ${list(signals.reasonPhrases, 12).join('; ') || '(none)'}
- other companies they named beside it (context only, never put them in a question): ${list(signals.competitorsNamed, 12).join('; ') || '(none)'}

ALREADY ASKED (do not repeat or lightly reword any of these):
${list(known, 80).map(q => '- ' + q).join('\n') || '- (none)'}

RULES:
${includeBrandedSearch(client)
  ? `- This business KEEPS branded search: some questions should use "${client.name || ''}" (or the place/term it is named after) the way buyers do. NEVER name its website, a competitor or ANY other company or brand.`
  : `- NEVER name ${client.name || 'the business'}, its website, a competitor or ANY other company or brand. A question that names a company is useless: it measures a brand the buyer already chose.`}
- Cover new ground: products, problems, use cases, buyer situations and general comparisons (never "X vs Y" or "alternatives to X") the list above does not cover.
- Phrase them the way a person talks to an AI, 6-20 words, written for buyers in ${country?.name || 'the business\'s market'}.
- Only things this business actually offers. No B2B phrasing for a consumer business.
- Never mention load shedding.

Return ONLY a JSON array: [{"query": "...", "intent": "commercial|comparison|problem|local|awareness"}]`;
}

function parseCandidates(text) {
  const s = String(text || '');
  const m = s.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// ask(prompt) -> { text } | { error }. Never throws; returns [] on any failure
// so a model hiccup never stops the census.
export async function discoverNewPrompts({ client, country, known, signals, count = 15, relevance, ask }) {
  if (!ask || count <= 0) return [];
  let resp;
  try { resp = await ask(newPromptsRequest({ client, country, known, signals, count: Math.min(30, count * 2) })); }
  catch { return []; }
  if (!resp || resp.error) return [];
  return pickNewPrompts(parseCandidates(resp.text), { known, relevance, max: count });
}

