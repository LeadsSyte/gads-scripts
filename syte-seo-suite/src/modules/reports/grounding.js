// AEO probe grounding — pure, node-testable decision logic.
//
// This is the step that decides WHICH probes a client runs before a snapshot.
// It was previously inlined in MonthlyReport/AEOSnapshot and kept regressing
// (clients stuck on old junk; sets collapsing to a degenerate handful). Pulling
// it here makes it unit-testable against every failure path, with one hard
// invariant:
//
//   THE ACTIVE PROBE SET MUST NEVER SHRINK.
//
// A run must never end up with fewer active probes than it started with just
// because website/LLM/GSC signals were unavailable this cycle. We only retire
// the old keyword-stuffed GSC probes when a genuinely HEALTHY gold grid is
// ready to take their place; otherwise we add what we can and keep the rest.
//
// The gold-grid builder (browser-coupled: LLM + page-proxy) is INJECTED so this
// module imports nothing that touches the browser.

import { parseProbes, migrateClientProbes, addProbes, probesToProbeList } from './aeoProbes.js';

// A gold build below this size, or covering fewer than this many probe types,
// is treated as a thin/failed derivation — not something to retire real probes
// for. Tier-1 alone is ~20 probes across 6 types, so a healthy grid clears this
// comfortably; an all-signals-failed build (a few reverse probes) does not.
export const MIN_HEALTHY_GOLD = 12;
export const MIN_HEALTHY_TYPES = 3;

export function isHealthyGold(probes) {
  if (!Array.isArray(probes) || probes.length < MIN_HEALTHY_GOLD) return false;
  const types = new Set(probes.map(p => p && p.type).filter(Boolean));
  return types.size >= MIN_HEALTHY_TYPES;
}

function countActive(probes) {
  return (probes || []).filter(p => p && p.active !== false).length;
}

function retireGsc(probes) {
  return (probes || []).map(p => (p && p.source === 'gsc' && p.active !== false) ? { ...p, active: false } : p);
}

// Resolve a client to the probe set it should run.
//
// opts:
//   gscQueries   string[]  — GSC head-terms (seed for the builder + fallback)
//   buildGold    async (client, { gscQueries }) => { probes }   (injected)
//   fallbackSet  probe-candidate[] — GSC-derived set to use if gold is thin
//
// Returns { client, changed, reason, activeBefore, activeAfter }. `client` is a
// new object with updated aeo_probes when changed, else the input unchanged.
export async function groundClientForAeo(client, { gscQueries = [], buildGold = null, fallbackSet = [] } = {}) {
  if (!client) return { client, changed: false, reason: 'no-client', activeBefore: 0, activeAfter: 0 };
  const existing = parseProbes(client) || migrateClientProbes(client) || [];
  const activeBefore = countActive(existing);

  // Already on a healthy active gold grid — keep it stable for MoM continuity.
  const activeGold = existing.filter(p => p && p.source === 'gold' && p.active !== false);
  if (isHealthyGold(activeGold)) {
    return { client: { ...client, aeo_probes: existing }, changed: false, reason: 'already-gold', activeBefore, activeAfter: activeBefore };
  }

  let gold = [];
  if (buildGold) {
    try {
      const r = await buildGold(client, { gscQueries });
      gold = (r && Array.isArray(r.probes)) ? r.probes : [];
    } catch { gold = []; }
  }

  // Healthy grid: retire the old GSC junk and switch the active set to the grid.
  if (isHealthyGold(gold)) {
    const { probes } = addProbes(retireGsc(existing), gold);
    return {
      client: { ...client, aeo_probes: probes, aeo_probe_queries: probesToProbeList(probes) },
      changed: true, reason: 'upgraded-to-gold', activeBefore, activeAfter: countActive(probes)
    };
  }

  // Gold is thin/failed. NEVER strip the existing set. Add whatever gold we got
  // plus any GSC fallback, keeping existing probes active as the safety net.
  let base = existing;
  let added = 0;
  if (gold.length) { const r = addProbes(base, gold); base = r.probes; added += r.added; }
  if (fallbackSet && fallbackSet.length) { const r = addProbes(base, fallbackSet); base = r.probes; added += r.added; }
  if (added > 0) {
    return {
      client: { ...client, aeo_probes: base, aeo_probe_queries: probesToProbeList(base) },
      changed: true, reason: 'additive', activeBefore, activeAfter: countActive(base)
    };
  }
  return { client: { ...client, aeo_probes: existing }, changed: false, reason: 'kept-existing', activeBefore, activeAfter: activeBefore };
}
