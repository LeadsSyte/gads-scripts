// Compute month-on-month deltas between two AEO snapshots.
// Old snapshots (pre-multi-iteration runner) won't have visibility_score
// or detection_rate fields — we fall back to derived equivalents so the
// comparison still works for historical data.

function pct(n) { return Number.isFinite(n) ? Number(n) : 0; }

function visibilityFrom(snap) {
  if (!snap) return null;
  if (snap.visibility_score != null) return pct(snap.visibility_score);
  // Legacy fallback — overall_score was 0-100, divide by 5 to approximate
  // the modern visibility% scale (which is typically 0-20).
  if (snap.overall_score != null) return Math.round((snap.overall_score / 5) * 10) / 10;
  return null;
}

function citationsFrom(snap) {
  if (!snap) return null;
  if (snap.citations != null) return snap.citations;
  // Legacy: count mentioned per_query as a rough proxy
  if (Array.isArray(snap.per_query)) {
    return snap.per_query.filter(r => r.mentioned).length;
  }
  return null;
}

function mentionsFrom(snap) {
  if (!snap) return null;
  if (snap.mentions != null) return snap.mentions;
  if (Array.isArray(snap.per_query)) {
    return snap.per_query.filter(r => r.mentioned).length;
  }
  return null;
}

function sentimentFrom(snap) {
  if (!snap) return null;
  if (snap.sentiment_score != null) return pct(snap.sentiment_score);
  // Legacy: parse "84% positive" string
  const m = (snap.sentiment || '').match(/([\d.]+)\s*%/);
  if (m) return parseFloat(m[1]);
  return null;
}

function detectionFrom(snap) {
  if (!snap) return null;
  if (snap.detection_rate != null) return pct(snap.detection_rate);
  return null;
}

function top3From(snap) {
  if (!snap) return null;
  if (snap.top3_rate != null) return pct(snap.top3_rate);
  return null;
}

// Returns { current, previous, deltas } where deltas are per-metric
// diffs (current - previous). Pct-point values keep one decimal.
export function compareSnapshots(current, previous) {
  const c = {
    visibility: visibilityFrom(current),
    citations:  citationsFrom(current),
    mentions:   mentionsFrom(current),
    sentiment:  sentimentFrom(current),
    detection:  detectionFrom(current),
    top3:       top3From(current),
    overall:    current?.overall_score ?? null
  };
  const p = previous ? {
    visibility: visibilityFrom(previous),
    citations:  citationsFrom(previous),
    mentions:   mentionsFrom(previous),
    sentiment:  sentimentFrom(previous),
    detection:  detectionFrom(previous),
    top3:       top3From(previous),
    overall:    previous?.overall_score ?? null
  } : null;

  function delta(curr, prev) {
    if (curr == null || prev == null) return null;
    const diff = Math.round((curr - prev) * 10) / 10;
    const pctChange = prev !== 0 ? Math.round((diff / Math.abs(prev)) * 100) : null;
    return { absolute: diff, percent: pctChange, positive: diff >= 0 };
  }

  return {
    current: c,
    previous: p,
    has_previous: !!previous,
    previous_month: previous?.month || null,
    deltas: p ? {
      visibility: delta(c.visibility, p.visibility),
      citations:  delta(c.citations,  p.citations),
      mentions:   delta(c.mentions,   p.mentions),
      sentiment:  delta(c.sentiment,  p.sentiment),
      detection:  delta(c.detection,  p.detection),
      top3:       delta(c.top3,       p.top3),
      overall:    delta(c.overall,    p.overall)
    } : null
  };
}

// Rank the brand against competitors using the same visibility metric.
// Returns sorted array with { name, visibility, ... } including the brand.
// Used for the "Krost leads every SA competitor" hero in the microsite.
export function rankBrandWithCompetitors(snap, brandName) {
  const all = [
    {
      name: brandName,
      isBrand: true,
      visibility:    visibilityFrom(snap) || 0,
      mentions:      mentionsFrom(snap) || 0,
      citations:     citationsFrom(snap) || 0,
      top3_rate:     top3From(snap) || 0,
      sentiment:     sentimentFrom(snap) || 0,
      detection:     detectionFrom(snap) || 0,
      avg_position:  snap?.avg_position || null
    },
    ...((snap?.competitors || []).map(c => ({
      name: c.name,
      isBrand: false,
      visibility:    pct(c.visibility),
      mentions:      pct(c.mentions),
      citations:     pct(c.citations),
      top3_rate:     pct(c.top3_rate),
      sentiment:     0,
      detection:     0,
      avg_position:  c.avg_position || null
    })))
  ];
  all.sort((a, b) => b.visibility - a.visibility);
  return all;
}
