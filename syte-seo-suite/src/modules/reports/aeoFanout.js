// AEO v2 recursive fan-out (Requirement 4).
//
// After a snapshot, the engines have told us — via segment labels, reason
// phrases and the competitors they named — what attribute vocabulary they hold
// about the brand. We turn that into candidate probes and propose the most
// NOVEL ones for approval. Approved candidates join runs as INACTIVE-until-
// approved tier-2 probes (the UI flips them active).
//
// Flow:
//   1. Collect segmentLabels / reasonPhrases / competitorsNamed from appeared
//      runs (already aggregated on snapshot.fanout_signals).
//   2. ONE Claude Sonnet call → candidate attributes (services, qualifiers,
//      geos, personas, competitors). Strict JSON schema.
//   3. Grid: [attribute] x [verb] x [geo] x [modifier] + conversational
//      buyer-phrasing variants.
//   4. Dedupe against every existing probe with Jaccard token overlap > 0.7.
//   5. Rank by novelty, present the top 25.
//   6. Exhaustion: a fan-out branch whose first snapshot yields < 10% covered
//      probes is flagged exhausted so we stop proposing its children.

import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { normalizeText, tokenSet, jaccard, isDuplicateQuery } from './aeoProbes.js';

const VERBS = ['partner', 'consultants', 'specialists'];
const MODIFIERS = ['best', 'top', 'recommended'];
const CONVERSATIONAL = [
  s => `what's the best ${s} to work with?`,
  s => `who should I hire for ${s}?`,
  s => `can you recommend a good ${s} provider?`
];
export const FANOUT_EXHAUSTION_THRESHOLD = 0.1; // < 10% covered → branch dead

const ATTR_SYSTEM =
  'You are an AEO strategist. Given the labels, reasons and competitor names AI ' +
  'engines attached to a brand, extract the reusable attribute vocabulary that ' +
  'qualified buyer queries are built from. Output ONLY valid JSON, no prose, no code fences.';

function uniqNorm(list, cap = 40) {
  const seen = new Set();
  const out = [];
  for (const s of (list || [])) {
    const v = String(s || '').trim();
    const k = normalizeText(v);
    if (!v || seen.has(k)) continue;
    seen.add(k); out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

// Step 2 — the single Sonnet call. Injectable via opts.complete for tests.
export async function extractAttributes(signals, client, { complete = claudeComplete } = {}) {
  const seg = uniqNorm(signals?.segmentLabels, 60);
  const reasons = uniqNorm(signals?.reasonPhrases, 60);
  const comps = uniqNorm(signals?.competitorsNamed, 40);
  const prompt = `Brand: ${client?.name || ''}
Industry: ${client?.industry || ''}
Location / service area: ${client?.location || ''}

Segment labels engines placed the brand under:
${seg.map(s => '- ' + s).join('\n') || '(none)'}

Reason phrases engines gave for recommending the brand:
${reasons.map(s => '- ' + s).join('\n') || '(none)'}

Competitors the engines named alongside the brand:
${comps.map(s => '- ' + s).join('\n') || '(none)'}

Extract the reusable attribute vocabulary. Return ONLY this JSON:
{
  "services":   ["short service/product nouns, category-anchored"],
  "qualifiers": ["adjectives/qualifiers buyers attach, e.g. 'heavy-duty', 'mid-market'"],
  "geos":       ["locations/regions worth probing"],
  "personas":   ["buyer personas, e.g. 'warehouse manager'"],
  "competitors":["named competitors worth building 'alternatives to X' probes from"]
}
Keep each list tight (max ~8). Do not invent areas with no signal above.`;
  try {
    const text = await complete({
      system: ATTR_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      model: 'claude-sonnet-4-20250514',
      max_tokens: 900,
      temperature: 0.4
    });
    const j = extractJSON(text) || {};
    return {
      services: uniqNorm(j.services, 8),
      qualifiers: uniqNorm(j.qualifiers, 8),
      geos: uniqNorm(j.geos, 8),
      personas: uniqNorm(j.personas, 8),
      competitors: uniqNorm(j.competitors, 8)
    };
  } catch {
    return { services: [], qualifiers: [], geos: [], personas: [], competitors: [] };
  }
}

// Step 3 — grid generation. Pure. Returns candidate probe objects (inactive
// tier-2) with parentProbeId set to the seed probe that anchored this batch.
export function buildCandidates(attributes = {}, { competitors = [], seedProbeId = null } = {}) {
  const services = uniqNorm(attributes.services, 12);
  const qualifiers = uniqNorm(attributes.qualifiers, 6);
  const geos = uniqNorm(attributes.geos, 6);
  const comps = uniqNorm([...(attributes.competitors || []), ...competitors], 8);

  // Attribute phrases = services plus a few qualifier+service combos.
  const phrases = [...services];
  for (const q of qualifiers.slice(0, 3)) for (const s of services.slice(0, 4)) phrases.push(`${q} ${s}`);

  const out = [];
  const push = (query, type, intent) => out.push({
    query, type, intent, source: 'fanout', parentProbeId: seedProbeId,
    tier: 2, runMode: 'search_on', active: false
  });

  for (const attr of uniqNorm(phrases, 16)) {
    for (const mod of MODIFIERS) {
      for (const verb of VERBS) push(`${mod} ${attr} ${verb}`, 'qualified', 'commercial');
      for (const geo of geos) push(`${mod} ${attr} in ${geo}`, 'niche', 'local');
    }
    for (const comp of comps) push(`alternatives to ${comp} for ${attr}`, 'comparison', 'comparison');
    for (const tmpl of CONVERSATIONAL) push(tmpl(attr), 'conversational', 'problem');
  }
  return out;
}

// Step 4 + 5 — dedupe vs existing probes (Jaccard > 0.7), dedupe among
// candidates themselves, rank by novelty, return the top `limit`. Pure.
export function dedupeAndRank(candidates, existingProbes = [], { limit = 25 } = {}) {
  // Novelty = 1 - max Jaccard against any existing probe. Drop exact/near dups.
  const existingTokenSets = (existingProbes || []).map(p => tokenSet(p.query));
  const scored = [];
  const seenNorm = new Set();
  for (const c of (candidates || [])) {
    const norm = normalizeText(c.query);
    if (!norm || seenNorm.has(norm)) continue;
    seenNorm.add(norm);
    if (isDuplicateQuery(c.query, existingProbes, 0.7)) continue;
    const ts = tokenSet(c.query);
    let maxSim = 0;
    for (const es of existingTokenSets) maxSim = Math.max(maxSim, jaccard(ts, es));
    scored.push({ candidate: c, novelty: 1 - maxSim, ts });
  }

  // Rank most-novel first (tie-break alphabetically for determinism), then
  // greedily accept while keeping accepted candidates mutually distinct.
  scored.sort((a, b) => (b.novelty - a.novelty) || a.candidate.query.localeCompare(b.candidate.query));
  const accepted = [];
  const acceptedTs = [];
  for (const s of scored) {
    if (accepted.length >= limit) break;
    let dup = false;
    for (const ts of acceptedTs) if (jaccard(s.ts, ts) > 0.7) { dup = true; break; }
    if (dup) continue;
    accepted.push({ ...s.candidate, novelty: Math.round(s.novelty * 100) / 100 });
    acceptedTs.push(s.ts);
  }
  return accepted;
}

// Orchestrator. Injectable extractFn for tests. Returns { attributes,
// candidates, seedProbeId }.
export async function generateFanout({ snapshot, client, existingProbes = [], limit = 25, extractFn = extractAttributes, exhaustedParents = [] }) {
  const signals = snapshot?.fanout_signals || { segmentLabels: [], reasonPhrases: [], competitorsNamed: [] };
  const exhausted = new Set(exhaustedParents);
  // Anchor the batch to the best-covered scorable probe (a real parent id),
  // skipping any probe on an exhausted branch (Requirement 4 stopping rule).
  const seedProbeId = pickSeedProbe(snapshot, exhausted);
  // If the only signal comes from exhausted branches, stop proposing children.
  if (seedProbeId === null && (snapshot?.probe_results || []).some(r => r.type !== 'reverse')) {
    return { attributes: { services: [], qualifiers: [], geos: [], personas: [], competitors: [] }, candidates: [], seedProbeId: null, exhausted: true };
  }
  const attributes = await extractFn(signals, client);
  const raw = buildCandidates(attributes, {
    competitors: (client?.competitors || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean),
    seedProbeId
  });
  const candidates = dedupeAndRank(raw, existingProbes, { limit });
  return { attributes, candidates, seedProbeId };
}

function pickSeedProbe(snapshot, exhausted = new Set()) {
  const rows = (snapshot?.probe_results || [])
    .filter(r => r.type !== 'reverse' && !exhausted.has(r.probeId));
  if (!rows.length) return null;
  const best = rows.reduce((acc, r) => (r.visibilityScore > (acc?.visibilityScore ?? -1) ? r : acc), null);
  return best?.probeId || null;
}

// Step 6 — branch exhaustion. `rows` are per-probe aggregates for the newly
// run batch: [{ parentProbeId, appearanceRate }]. Returns a map keyed by
// parentProbeId → { total, covered, rate, exhausted }. A branch is exhausted
// when < threshold of its probes were covered in this, its first, snapshot.
export function evaluateBranchExhaustion(rows, { threshold = FANOUT_EXHAUSTION_THRESHOLD } = {}) {
  const byParent = {};
  for (const r of (rows || [])) {
    const key = r.parentProbeId || '__root__';
    if (!byParent[key]) byParent[key] = { total: 0, covered: 0 };
    byParent[key].total++;
    if ((r.appearanceRate || 0) > 0) byParent[key].covered++;
  }
  const out = {};
  for (const [key, v] of Object.entries(byParent)) {
    const rate = v.total ? v.covered / v.total : 0;
    out[key] = { total: v.total, covered: v.covered, rate: Math.round(rate * 100) / 100, exhausted: rate < threshold };
  }
  return out;
}
