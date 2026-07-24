// Brand mention detection + scoring for an AEO probe response.
//
// Input: the raw answer text from a model, the client's brand name and
// optional domain, and a list of competitor names.
// Output: { mentioned, position, excerpt, competitorHits[] }.
//
// Scoring (per spec):
//   not mentioned              → 0
//   mentioned position 3+      → 25
//   mentioned position 2       → 50
//   mentioned position 1       → 75
//   position 1 + positive      → 100

import { claude } from './aeoEngines.js';

function normalize(s = '') { return s.toLowerCase().trim(); }

// Return the index of the first match of any of `needles` in `text`,
// or -1 if none.
function firstIndexOfAny(text, needles) {
  const lower = text.toLowerCase();
  let best = -1;
  for (const n of needles) {
    if (!n) continue;
    const idx = lower.indexOf(n.toLowerCase());
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

// Tokenize text into brand-mention order: list of { index, needle } sorted
// by character offset.
function mentionOrder(text, allBrands) {
  const lower = text.toLowerCase();
  const hits = [];
  for (const b of allBrands) {
    if (!b.name) continue;
    const idx = lower.indexOf(b.name.toLowerCase());
    if (idx !== -1) hits.push({ index: idx, key: b.key });
  }
  return hits.sort((a, b) => a.index - b.index);
}

// Extract the sentence containing a given character offset.
function sentenceAt(text, offset) {
  const start = Math.max(
    text.lastIndexOf('.', offset),
    text.lastIndexOf('\n', offset),
    -1
  ) + 1;
  const endCandidates = [text.indexOf('.', offset), text.indexOf('\n', offset)]
    .filter(x => x !== -1);
  const end = endCandidates.length ? Math.min(...endCandidates) : text.length;
  return text.slice(start, Math.min(end + 1, text.length)).trim();
}

export function detectBrand(text, { name, url, competitors }) {
  // Build multiple needles from the brand name + domain for broader matching.
  const brandDomain = (url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const brandDomainNoTld = brandDomain.split('.')[0];
  const brandNeedles = [
    name,                                          // "Hot Leathers"
    brandDomain,                                   // "hotleathers.com"
    brandDomainNoTld,                              // "hotleathers"
    name?.replace(/\s+/g, ''),                     // "HotLeathers"
    // Also try "www." prefix stripped
    brandDomain.replace(/^www\./, '')              // "hotleathers.com" without www
  ].filter(Boolean).filter(n => n.length >= 3);    // skip very short matches

  // Also try individual significant words (3+ chars) from the brand name.
  // If 2+ unique words match in the response, count it as a brand mention.
  const brandWords = (name || '').split(/\s+/).filter(w => w.length >= 4).map(w => w.toLowerCase());

  const competitorList = (competitors || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Check for any needle match.
  const lower = (text || '').toLowerCase();
  let mentioned = false;
  let matchOffset = -1;
  for (const needle of brandNeedles) {
    const idx = lower.indexOf(needle.toLowerCase());
    if (idx !== -1) {
      mentioned = true;
      if (matchOffset === -1 || idx < matchOffset) matchOffset = idx;
    }
  }

  // Fallback: if 2+ significant brand words appear, count as mentioned.
  if (!mentioned && brandWords.length >= 2) {
    const matchedWords = brandWords.filter(w => lower.includes(w));
    if (matchedWords.length >= 2) {
      mentioned = true;
      matchOffset = lower.indexOf(matchedWords[0]);
    }
  }

  // Build competitor + brand mention order for position scoring.
  const allBrands = [
    ...brandNeedles.map(n => ({ key: 'self', name: n })),
    ...competitorList.map(n => ({ key: n, name: n }))
  ];

  const order = mentionOrder(text, allBrands);
  const uniqueOrder = [];
  const seen = new Set();
  for (const hit of order) {
    if (seen.has(hit.key)) continue;
    seen.add(hit.key);
    uniqueOrder.push(hit);
  }

  const selfIdx = uniqueOrder.findIndex(h => h.key === 'self');
  const position = mentioned ? (selfIdx !== -1 ? selfIdx + 1 : 1) : null;

  let excerpt = '';
  if (mentioned && matchOffset !== -1) {
    excerpt = sentenceAt(text, matchOffset);
  }

  const competitorHits = uniqueOrder
    .filter(h => h.key !== 'self')
    .map(h => h.key);

  return { mentioned, position, excerpt, competitorHits };
}

// One extra Claude Haiku call to classify the sentiment of a mention.
// Returns "positive" | "neutral" | "negative" (best effort).
export async function sentimentOf(excerpt, brandName) {
  if (!excerpt) return 'neutral';
  const resp = await claude.ask(
    `Is this mention of "${brandName}" positive, neutral, or negative? One word only.\n\n"${excerpt}"`
  );
  if (resp.error) return 'neutral';
  const raw = (resp.text || '').toLowerCase();
  if (raw.includes('positive')) return 'positive';
  if (raw.includes('negative')) return 'negative';
  return 'neutral';
}

export function scoreMention({ mentioned, position, sentiment }) {
  if (!mentioned) return 0;
  if (position === 1 && sentiment === 'positive') return 100;
  if (position === 1) return 75;
  if (position === 2) return 50;
  return 25;
}

// Count URL/domain citations of a brand in a response. AI engines that
// surface sources (Perplexity, Gemini with grounding, Google AI Mode)
// tend to include the brand's domain in markdown links or as raw URLs.
// We treat each appearance as one citation — this is the metric that
// competitive AEO tools highlight as the "gold standard" of trust.
export function countCitations(text, url, name) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  const needles = new Set();

  if (url) {
    const cleaned = url.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '');
    if (cleaned.length >= 4) needles.add(cleaned);
    // Also match the bare domain word (e.g. "krost" from "krost.co.za").
    const root = cleaned.split('.')[0];
    if (root && root.length >= 4) needles.add(root + '.');
  }
  if (name) {
    // Match domain-style "brandname.com|.co.za|.io|..." patterns inside text.
    const slug = name.toLowerCase().replace(/\s+/g, '');
    if (slug.length >= 4) {
      const re = new RegExp('\\b' + slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.[a-z]{2,}', 'g');
      const matches = lower.match(re) || [];
      if (matches.length) return matches.length;
    }
  }

  let count = 0;
  for (const needle of needles) {
    let idx = 0;
    while ((idx = lower.indexOf(needle, idx)) !== -1) {
      count++;
      idx += needle.length;
    }
  }
  return count;
}
