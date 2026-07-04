// AEO probe set — the persisted, append-only prompt model that replaces the
// flat census list. Each client owns an array of probe objects (stored in the
// `aeo_probes` jsonb column). The census (`aeo_census`) and the flat newline
// list (`aeo_probe_queries`) are kept in sync for back-compat, but the probe
// array is the source of truth going forward.
//
// Probe shape (Requirement 1):
//   {
//     id:            string   // stable, e.g. "TEK-014"
//     tier:          1 | 2 | 3 // 1 = core tracked panel, 2 = fan-out grid, 3 = long-tail
//     type:          "category" | "qualified" | "comparison" | "reverse" | "niche" | "conversational"
//     intent:        "awareness" | "commercial" | "comparison" | "local" | "problem"
//     query:         string
//     source:        "gsc" | "site" | "fanout" | "manual" | "discovery"
//     parentProbeId: string | null  // probe whose extracted attributes generated this one
//     discoveredAt:  ISO date string
//     active:        boolean
//     runMode:       "search_on" | "search_off" | "both"
//   }
//
// HARD RULES:
//  - Append-only. Never delete or rewrite a probe that has run history —
//    deactivate it instead. The only mutating helpers here are addProbes()
//    (append) and setProbeActive() (flip the active flag).
//  - Tier 1 is the stable client-facing panel. Migration and fan-out never
//    touch existing tier-1 probes, so month-over-month trends stay comparable.
//  - Fan-out discoveries land as INACTIVE tier-2 proposals; the user approves
//    them in the UI before they join runs.
//
// This module deliberately imports nothing that touches the browser (no
// anthropic/auth/supabase), so it stays pure and node-testable in isolation.

export const PROBE_TYPES = ['category', 'qualified', 'comparison', 'reverse', 'niche', 'conversational'];
export const RUN_MODES = ['search_on', 'search_off', 'both'];
export const INTENT_IDS = ['awareness', 'commercial', 'comparison', 'local', 'problem'];

// Tier-1 probes run both parametric (search_off) and retrieval (search_on) by
// default; tiers 2/3 run search_on only to control cost (Requirement 5).
export const DEFAULT_RUN_MODE = { 1: 'both', 2: 'search_on', 3: 'search_on' };

// ---------------------------------------------------------------------------
// Minimal, dependency-free census parse. Mirrors aeoCensus.parseCensus but
// re-implemented here so this module has no browser-coupled imports.
// ---------------------------------------------------------------------------
function parseCensusObj(clientOrCensus) {
  const raw = clientOrCensus?.aeo_census ?? clientOrCensus;
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || !Array.isArray(obj.prompts)) return null;
  return obj;
}

function normalizeIntent(intent) {
  const v = String(intent || '').trim().toLowerCase();
  return INTENT_IDS.includes(v) ? v : 'commercial';
}

// ---------------------------------------------------------------------------
// Stable IDs — "<PREFIX>-<NNN>". Prefix is derived from the brand name (first
// three alpha chars, uppercased) so IDs read as belonging to the client; the
// counter is monotonic across the whole probe set regardless of prefix, so a
// mixed set never collides.
// ---------------------------------------------------------------------------
export function probeIdPrefix(clientName) {
  const letters = String(clientName || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length >= 3) return letters.slice(0, 3);
  return (letters + 'AEO').slice(0, 3);
}

function maxProbeNumber(probes) {
  let max = 0;
  for (const p of (probes || [])) {
    const m = String(p?.id || '').match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

// Allocate the next N ids for a set, continuing the existing counter.
export function allocateProbeIds(existingProbes, prefix, count) {
  let n = maxProbeNumber(existingProbes);
  const ids = [];
  for (let i = 0; i < count; i++) {
    n += 1;
    ids.push(`${prefix}-${String(n).padStart(3, '0')}`);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Text normalization + Jaccard token similarity — used to dedupe fan-out
// candidates against the whole existing probe set (Requirement 4).
// ---------------------------------------------------------------------------
export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenSet(s) {
  return new Set(normalizeText(s).split(' ').filter(Boolean));
}

export function jaccard(a, b) {
  const A = a instanceof Set ? a : tokenSet(a);
  const B = b instanceof Set ? b : tokenSet(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

// True if `query` is a near-duplicate of any existing probe query.
export function isDuplicateQuery(query, existingProbes, threshold = 0.7) {
  const A = tokenSet(query);
  const norm = normalizeText(query);
  for (const p of (existingProbes || [])) {
    if (normalizeText(p.query) === norm) return true;      // exact after normalization
    if (jaccard(A, tokenSet(p.query)) > threshold) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Read helpers.
// ---------------------------------------------------------------------------
export function parseProbes(client) {
  const raw = client?.aeo_probes;
  if (!raw) return null;
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return null; }
  }
  return Array.isArray(arr) ? arr : null;
}

export function activeProbes(probes) {
  return (probes || []).filter(p => p && p.active);
}

// Probes that count toward coverage / the composite index. Reverse probes are
// instruments (they feed extraction), not visibility targets, so they are
// excluded here (Requirement 4).
export function scorableProbes(probes) {
  return activeProbes(probes).filter(p => p.type !== 'reverse');
}

// Active queries as a newline list — keeps aeo_probe_queries and the legacy
// runner path working.
export function probesToProbeList(probes) {
  return activeProbes(probes).map(p => p.query).join('\n');
}

// ---------------------------------------------------------------------------
// Reverse probes — "instruments" that run every snapshot at tier 1 to harvest
// the attribute vocabulary each engine holds about the brand (Requirement 4).
// They are regenerated deterministically from the brand name, so they are not
// persisted as editable tier-1 panel entries; the runner injects them.
// ---------------------------------------------------------------------------
export function reverseProbesFor(client, { now } = {}) {
  const name = client?.name || 'the brand';
  const at = (now ? new Date(now) : new Date()).toISOString();
  const prefix = probeIdPrefix(name);
  const specs = [
    { suffix: 'REV1', query: `What is ${name} known for?` },
    { suffix: 'REV2', query: `List companies similar to ${name}.` }
  ];
  return specs.map(s => ({
    id: `${prefix}-${s.suffix}`,
    tier: 1,
    type: 'reverse',
    intent: 'awareness',
    query: s.query,
    source: 'site',
    parentProbeId: null,
    discoveredAt: at,
    active: true,
    runMode: 'search_on'
  }));
}

// ---------------------------------------------------------------------------
// Migration — turn an existing client's census (or flat probe list) into the
// tier-1 probe panel, in place and idempotently. Existing clients lose
// nothing: if aeo_probes already exists it is returned unchanged.
//
// Per Requirement 1: migrated probes are tier 1, source "gsc" or "manual",
// type "qualified", parentProbeId null. A prompt is tagged source "gsc" when
// it matches one of the census's GSC ranking seeds (those queries came from
// Search Console); everything else is "manual".
// ---------------------------------------------------------------------------
export function migrateClientProbes(client, { now } = {}) {
  const existing = parseProbes(client);
  if (existing && existing.length) return existing; // already migrated — untouched

  const at = (now ? new Date(now) : new Date()).toISOString();
  const prefix = probeIdPrefix(client?.name);

  // Source rows: prefer the structured census, fall back to the flat list.
  const census = parseCensusObj(client);
  let rows;
  const gscSeeds = new Set(
    (census?.grounding?.ranking_seeds || [])
      .map(s => normalizeText(s?.query))
      .filter(Boolean)
  );

  if (census?.prompts?.length) {
    rows = census.prompts.map(p => ({ query: String(p.query || '').trim(), intent: normalizeIntent(p.intent) }));
  } else {
    const flat = String(client?.aeo_probe_queries || '')
      .split('\n').map(s => s.trim()).filter(Boolean);
    rows = flat.map(q => ({ query: q, intent: 'commercial' }));
  }

  // Dedupe by normalized text, preserving order.
  const seen = new Set();
  const deduped = [];
  for (const r of rows) {
    if (!r.query) continue;
    const key = normalizeText(r.query);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  let n = 0;
  return deduped.map(r => {
    n += 1;
    return {
      id: `${prefix}-${String(n).padStart(3, '0')}`,
      tier: 1,
      type: 'qualified',
      intent: r.intent,
      query: r.query,
      source: gscSeeds.has(normalizeText(r.query)) ? 'gsc' : 'manual',
      parentProbeId: null,
      discoveredAt: at,
      active: true,
      runMode: 'both'
    };
  });
}

// ---------------------------------------------------------------------------
// Append-only mutation.
// ---------------------------------------------------------------------------

// Coerce a loose candidate into a full probe object with a fresh id. Never
// overwrites an existing probe. Returns the augmented probe (not persisted).
export function makeProbe(candidate, { id, now } = {}) {
  const tier = [1, 2, 3].includes(candidate.tier) ? candidate.tier : 2;
  return {
    id,
    tier,
    type: PROBE_TYPES.includes(candidate.type) ? candidate.type : 'category',
    intent: normalizeIntent(candidate.intent),
    query: String(candidate.query || '').trim(),
    source: candidate.source || 'fanout',
    parentProbeId: candidate.parentProbeId ?? null,
    discoveredAt: (now ? new Date(now) : new Date()).toISOString(),
    active: candidate.active === true, // fan-out proposals default INACTIVE
    runMode: RUN_MODES.includes(candidate.runMode) ? candidate.runMode : (DEFAULT_RUN_MODE[tier] || 'search_on')
  };
}

// Append candidates to an existing probe set. Skips empty queries and any
// candidate that duplicates an existing probe (exact-normalized only here;
// Jaccard novelty filtering is the fan-out module's job). Returns
// { probes, added } with `probes` a NEW array (never mutates the input).
export function addProbes(existingProbes, candidates, { now } = {}) {
  const base = Array.isArray(existingProbes) ? existingProbes.slice() : [];
  const prefix = probeIdPrefix(candidates?.[0]?.clientName) ||
                 probeIdPrefix(base.find(Boolean)?.id?.replace(/-.*$/, ''));
  // Prefer a prefix from an existing id so ids stay consistent per client.
  const existingPrefix = (base.find(p => p?.id)?.id || '').replace(/-\d+$/, '').replace(/-REV\d+$/, '');
  const usePrefix = existingPrefix || prefix || 'AEO';

  const seen = new Set(base.map(p => normalizeText(p.query)));
  const ids = allocateProbeIds(base, usePrefix, candidates.length);
  let added = 0;
  candidates.forEach((c, i) => {
    const q = normalizeText(c.query);
    if (!q || seen.has(q)) return;
    seen.add(q);
    base.push(makeProbe(c, { id: ids[added], now }));
    added += 1;
  });
  // We over-allocated ids if some candidates were skipped; that's fine — ids
  // stay monotonic, gaps are harmless and preserve append-only stability.
  return { probes: base, added };
}

// Flip a probe's active flag. This is the ONLY way to "remove" a probe from
// runs — the record and its history stay intact.
export function setProbeActive(probes, id, active) {
  return (probes || []).map(p => (p.id === id ? { ...p, active: !!active } : p));
}

// Count of fan-out probes that became active since a reference ISO timestamp —
// "new themes discovered" for the portfolio metrics (Requirement 3).
export function countNewThemesSince(probes, sinceISO) {
  if (!sinceISO) return activeProbes(probes).filter(p => p.source === 'fanout').length;
  return (probes || []).filter(p =>
    p.active && p.source === 'fanout' && p.discoveredAt && p.discoveredAt > sinceISO
  ).length;
}
