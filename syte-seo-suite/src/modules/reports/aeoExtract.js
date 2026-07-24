// AEO v2 per-run extraction (Requirement 2).
//
// ONE structured Claude Haiku call per response turns raw model text into the
// facts we score on: whether the brand appeared, its 1-based position among
// the brands named, the total list length, the segment label + reason phrase
// the engine attached to the brand, sentiment (folded in here to halve Haiku
// spend — no separate sentiment call), and which competitors were named.
//
// Citation URLs come from the STRUCTURED citation fields each API returns
// (Perplexity citations, Gemini grounding metadata, ChatGPT/Claude web-search
// results), with prose URL regex only as a fallback. See extractCitedUrls.

import { claudeComplete, extractJSON } from '../../lib/anthropic.js';

const EXTRACT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_REASON = 200;

// FNV-1a 32-bit → 8-char hex. Deterministic, synchronous, no crypto dep, so it
// works identically in the browser and in node tests. Used to key raw
// responses for the 90-day store.
export function hashResponse(text) {
  const s = String(text || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

// Pull cited URLs out of the raw API response object using each provider's
// structured citation surface. Prose regex is the fallback only, never the
// primary method (Requirement 2).
export function extractCitedUrls(engineId, raw, text) {
  const urls = new Set();
  const add = (u) => { if (u && /^https?:\/\//i.test(u)) urls.add(String(u).replace(/[.,;:)\]]+$/, '')); };
  try {
    if (engineId === 'perplexity') {
      for (const u of (raw?.citations || [])) add(u);
      for (const r of (raw?.search_results || [])) add(r?.url);
    } else if (engineId === 'gemini') {
      const gm = raw?.candidates?.[0]?.groundingMetadata || {};
      for (const c of (gm.groundingChunks || [])) add(c?.web?.uri);
      for (const s of (gm.groundingSupports || [])) add(s?.web?.uri);
    } else if (engineId === 'chatgpt') {
      const msg = raw?.choices?.[0]?.message || {};
      for (const a of (msg.annotations || [])) add(a?.url_citation?.url || a?.url);
      // Responses-API shape, if ever used.
      for (const o of (raw?.output || [])) {
        for (const c of (o?.content || [])) for (const a of (c?.annotations || [])) add(a?.url);
      }
    } else if (engineId === 'claude') {
      for (const block of (raw?.content || [])) {
        for (const c of (block?.citations || [])) add(c?.url);
        if (block?.type === 'web_search_tool_result') {
          for (const r of (block?.content || [])) add(r?.url);
        }
      }
    }
  } catch { /* fall through to regex */ }

  if (urls.size === 0) {
    for (const m of (String(text || '').match(/https?:\/\/[^\s)\]}"'<>]+/g) || [])) add(m);
  }
  return [...urls];
}

function normalizeExtraction(j, competitorNames) {
  const brands = Array.isArray(j.brandsInOrder) ? j.brandsInOrder.map(String) : [];
  const appeared = !!j.appeared;
  let position = Number.isFinite(j.position) ? Math.round(j.position) : null;
  if (!appeared) position = null;
  let listLength = Number.isFinite(j.listLength) ? Math.round(j.listLength)
    : (brands.length || null);
  const sentiment = ['positive', 'neutral', 'negative'].includes(j.sentiment) ? j.sentiment : 'neutral';
  const reason = j.reasonPhrase ? String(j.reasonPhrase).slice(0, MAX_REASON) : null;
  const seg = j.segmentLabel ? String(j.segmentLabel).slice(0, MAX_REASON) : null;
  let competitorsNamed = Array.isArray(j.competitorsNamed) ? j.competitorsNamed.map(String) : [];
  // Keep only clearly-named entries; dedupe case-insensitively.
  const seen = new Set();
  competitorsNamed = competitorsNamed.filter(c => {
    const k = c.toLowerCase().trim();
    if (!k || seen.has(k)) return false; seen.add(k); return true;
  });
  return {
    appeared,
    position: appeared ? position : null,
    listLength,
    segmentLabel: appeared ? seg : null,
    reasonPhrase: appeared ? reason : null,
    sentiment: appeared ? sentiment : 'neutral',
    competitorsNamed
  };
}

const EXTRACT_SYSTEM =
  'You analyze one AI assistant answer and extract structured facts about how a ' +
  'specific brand appears in it. Output ONLY valid JSON, no prose, no code fences.';

// Single structured extraction call. Returns the normalized object, or null on
// failure so the caller can fall back to regex detection.
export async function extractRun({ text, brandName, competitorNames = [] }) {
  if (!text) return null;
  const prompt = `BRAND: ${brandName}
KNOWN COMPETITORS (may or may not appear): ${competitorNames.join(', ') || '(none provided)'}

AI ANSWER TO ANALYZE:
"""
${String(text).slice(0, 4000)}
"""

Extract exactly this JSON shape:
{
  "appeared": true|false,
  "brandsInOrder": ["..."],
  "position": <1-based rank of BRAND within brandsInOrder, or null>,
  "listLength": <count of distinct brands named, or null>,
  "segmentLabel": "<exact label/category the answer placed BRAND under, verbatim, or null>",
  "reasonPhrase": "<the answer's stated reason BRAND was recommended, verbatim, max 200 chars, or null>",
  "sentiment": "positive"|"neutral"|"negative",
  "competitorsNamed": ["..."]
}
Rules:
- segmentLabel and reasonPhrase must be VERBATIM from the answer, not paraphrased.
- If BRAND is absent: appeared=false, position=null, segmentLabel=null, reasonPhrase=null, sentiment="neutral".
- brandsInOrder is every company/supplier/product-brand the answer named, in order of first appearance.`;
  try {
    const out = await claudeComplete({
      system: EXTRACT_SYSTEM,
      model: EXTRACT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 700,
      temperature: 0
    });
    const j = extractJSON(out);
    if (!j) return null;
    return normalizeExtraction(j, competitorNames);
  } catch {
    return null;
  }
}
