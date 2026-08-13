// AEO v2 citation gaps (Requirement 5).
//
// The actionable half of the report. For every COMMERCIAL probe where the
// brand did NOT appear but competitors did, we aggregate the sources the
// engines cited, group them by domain, and rank them. Each row says: which
// domain, how many times it surfaced, example queries, which competitors it
// surfaced, whether the brand is present there (unknown by default, the user
// edits this), and a suggested action.
//
// Pure + dependency-free so it can be computed inside the runner and unit
// tested in isolation.

function domainOf(url) {
  try { return new URL(url).host.replace(/^www\./, '').toLowerCase(); }
  catch { return null; }
}

function suggestAction(domain, competitors) {
  const who = competitors.length
    ? competitors.slice(0, 2).join(' and ')
    : 'competitors';
  return `Earn a presence on ${domain}: ${who} surface here and the brand does not. Pitch a listing, guest article, or review.`;
}

// runRecords: per-run records from the snapshot (probeId, appeared,
// competitorsNamed, citedUrls, error). probes: the probe set (for intent +
// query lookup). Returns a ranked array of gap rows.
export function buildCitationGaps(runRecords, probes, { brandName, brandUrl, limit = 20 } = {}) {
  const probeMap = new Map((probes || []).map(p => [p.id, p]));
  const brandDomain = (brandUrl || '').toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

  const byDomain = new Map();
  for (const r of (runRecords || [])) {
    if (r.error) continue;
    const probe = probeMap.get(r.probeId);
    if (!probe || probe.intent !== 'commercial') continue;   // commercial probes only
    if (r.appeared) continue;                                // brand did NOT appear
    if (!(r.competitorsNamed || []).length) continue;        // ...but competitors did
    for (const url of (r.citedUrls || [])) {
      const d = domainOf(url);
      if (!d) continue;
      if (brandDomain && (d === brandDomain || d.endsWith('.' + brandDomain))) continue; // own domain is not a gap
      if (!byDomain.has(d)) byDomain.set(d, { domain: d, hitCount: 0, queries: new Set(), competitors: new Set(), urls: new Set() });
      const g = byDomain.get(d);
      g.hitCount++;
      g.queries.add(probe.query);
      for (const c of r.competitorsNamed) g.competitors.add(c);
      g.urls.add(url);
    }
  }

  return [...byDomain.values()]
    .map(g => ({
      domain: g.domain,
      hitCount: g.hitCount,
      exampleQueries: [...g.queries].slice(0, 5),
      competitors: [...g.competitors].slice(0, 8),
      exampleUrls: [...g.urls].slice(0, 3),
      brandPresent: 'unknown',              // user-editable: 'unknown' | 'yes' | 'no'
      suggestedAction: suggestAction(g.domain, [...g.competitors])
    }))
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, limit);
}
