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
  const brandDomain = (url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').split('.')[0];
  const brandNeedles = [name, brandDomain].filter(Boolean);
  const competitorList = (competitors || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

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
  const mentioned = selfIdx !== -1;
  const position = mentioned ? selfIdx + 1 : null;

  let excerpt = '';
  if (mentioned) {
    const offset = firstIndexOfAny(text, brandNeedles);
    if (offset !== -1) excerpt = sentenceAt(text, offset);
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
