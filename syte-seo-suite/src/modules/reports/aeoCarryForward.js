// Carry-forward — last month's long-tail prompts become this month's starting
// point.
//
// The tracked probe set (aeo_probes) already persists month to month, but the
// long-tail children the winner expansion (the "spider web") discovers were
// thrown away after each run: next month started the web from the same seeds
// and spent its whole expansion budget rediscovering the same Dublin / "for
// mid-market companies" variants. This module reads the previous month's
// snapshot and hands those prompts back to runSnapshot, so:
//   - prompts the brand won last month are re-measured (MoM continuity on
//     exactly the prompts that matter, and newly-won prompts show improvement);
//   - prompts that missed get one more month, then drop off (MAX_MISSES);
//   - the expansion budget goes to NEW territory, drilling deeper off winners.
//
// The carried prompts never touch the client's stored probe set — fan-out
// stays an approval decision (aeoProbes.js HARD RULES).
//
// Pure and node-testable: no imports.

export const DEFAULT_MAX_CARRIED = 60;
// A carried prompt that missed this many months in a row is dropped.
export const MAX_MISSES = 2;

const normQ = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Long-tail (fan-out) probe ids the runner assigns: `${clientId}-FO<n>` for a
// new child, `${clientId}-CF<n>` for a carried one.
const isLongTailId = (id) => /-(FO|CF)\d+$/.test(String(id || ''));

// query -> { won, visibility } from whatever result rows a snapshot carries
// (v2 probe_results, else back-compat per_query).
function resultsByQuery(snap) {
  const out = new Map();
  const add = (query, appeared, vis) => {
    const k = normQ(query);
    if (!k) return;
    const prev = out.get(k) || { won: false, visibility: 0 };
    out.set(k, { won: prev.won || !!appeared, visibility: Math.max(prev.visibility, Number(vis) || 0) });
  };
  for (const r of (Array.isArray(snap?.probe_results) ? snap.probe_results : [])) add(r.query, r.appearances > 0, r.visibilityScore);
  if (!out.size) for (const r of (Array.isArray(snap?.per_query) ? snap.per_query : [])) add(r.query, r.mentioned || r.hits > 0, r.visibility_score ?? r.visibility);
  return out;
}

// The long-tail prompts a previous snapshot probed. Prefers the explicit
// expansion_probes list; older snapshots (or history rows saved without it)
// fall back to the long-tail rows in probe_results.
function longTailFrom(snap) {
  if (Array.isArray(snap?.expansion_probes) && snap.expansion_probes.length) return snap.expansion_probes;
  const seen = new Set();
  const out = [];
  for (const r of (Array.isArray(snap?.probe_results) ? snap.probe_results : [])) {
    if (!isLongTailId(r.probeId) || r.type === 'reverse') continue;
    const k = normQ(r.query);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ query: r.query, tier: r.tier, type: r.type, intent: r.intent });
  }
  return out;
}

// Pick the prompts to carry into this month's run from the previous snapshot.
// Returns probe candidates (no ids — the runner assigns them):
//   { query, tier, type, intent, parentProbeId, source: 'carried',
//     carriedFrom, wonLastMonth, misses, firstSeen }
// Winners first (highest visibility first), then misses with a month left.
export function carriedPromptsFrom(prevSnap, { max = DEFAULT_MAX_CARRIED, exclude = [] } = {}) {
  if (!prevSnap) return [];
  const results = resultsByQuery(prevSnap);
  const skip = new Set((exclude || []).map(normQ));
  const seen = new Set();
  const picked = [];
  for (const p of longTailFrom(prevSnap)) {
    const k = normQ(p?.query);
    if (!k || seen.has(k) || skip.has(k)) continue;
    seen.add(k);
    const r = results.get(k);
    // `won`/`misses` are stamped by the runner from this release on; derive
    // them from the result rows for snapshots taken before that.
    const won = p.won != null ? !!p.won : !!r?.won;
    const misses = p.misses != null ? Number(p.misses) || 0 : (won ? 0 : 1);
    if (!won && misses >= MAX_MISSES) continue;
    picked.push({
      query: String(p.query).trim(),
      tier: Math.min(3, Math.max(2, Number(p.tier) || 2)),
      type: p.type || 'qualified',
      intent: p.intent || 'commercial',
      parentProbeId: p.parentProbeId || null,
      source: 'carried',
      carriedFrom: prevSnap.month || null,
      wonLastMonth: won,
      misses,
      firstSeen: p.firstSeen || prevSnap.month || null,
      _vis: r?.visibility || 0
    });
  }
  picked.sort((a, b) => (b.wonLastMonth - a.wonLastMonth) || (b._vis - a._vis));
  const cap = Math.max(0, Number(max) || 0);
  return picked.slice(0, cap).map(({ _vis, ...p }) => p);
}

// After a run: stamp each long-tail prompt with this month's outcome so next
// month's carriedPromptsFrom can rank and retire them, and summarise how the
// carried prompts moved. `wonQueries` is the set of normalised queries the
// brand appeared on this run.
export function stampLongTail(probes, wonQueries, month) {
  return (probes || []).map(p => {
    const won = wonQueries.has(normQ(p.query));
    const carried = p.source === 'carried';
    return {
      ...p,
      won,
      misses: won ? 0 : (carried ? (Number(p.misses) || 0) + 1 : 1),
      firstSeen: p.firstSeen || month || null
    };
  });
}

export function carryForwardSummary(stamped, carriedFrom) {
  const carried = (stamped || []).filter(p => p.source === 'carried');
  const fresh = (stamped || []).filter(p => p.source !== 'carried');
  return {
    carried_from: carriedFrom || null,
    carried: carried.length,
    carried_won: carried.filter(p => p.won).length,
    // Missed last month, named this month — the improvement story.
    newly_won: carried.filter(p => p.won && !p.wonLastMonth).length,
    // Won last month, missed this month.
    lost: carried.filter(p => !p.won && p.wonLastMonth).length,
    new_prompts: fresh.length,
    new_won: fresh.filter(p => p.won).length
  };
}
