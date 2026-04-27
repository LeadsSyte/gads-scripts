// Compute month-on-month deltas between two AEO snapshots.
// Old snapshots (pre-multi-iteration runner) won't have visibility_score
// or detection_rate fields — we fall back to derived equivalents so the
// comparison still works for historical data.

function pct(n) { return Number.isFinite(n) ? Number(n) : 0; }

// Upgrade a legacy snapshot (pre-multi-iteration runner) so the new
// renderer can use it. Returns the snap as-is if it already has the
// new fields. Derives best-effort values from the old shape otherwise:
//   visibility_score = mentioned / total responses
//   detection_rate   = % of distinct queries with at least one mention
//   top3_rate        = mentions where position ≤ 3 / total responses
//   mentions         = count of mentioned per_query rows
//   citations        = same as mentions (no URL signal in old shape)
//   sentiment_score  = parsed from "X% positive" string
//   keyword_wins     = active = mentioned queries; zero = unmentioned;
//                      emerging is empty (we have no probability signal)
//   per_query        = augmented with visibility (100 if mentioned else 0)
//   competitors      = augmented with visibility computed from appearances
export function normalizeSnapshot(snap) {
  if (!snap) return snap;
  // Already new shape — nothing to do.
  if (snap.visibility_score != null && snap.keyword_wins) return snap;

  const out = { ...snap };
  const perQuery = Array.isArray(snap.per_query) ? snap.per_query : [];
  const totalRuns = perQuery.length;
  const mentionedRows = perQuery.filter(r => r.mentioned);
  const top3Rows = mentionedRows.filter(r => r.position && r.position <= 3);
  const positiveRows = mentionedRows.filter(r => r.sentiment === 'positive');

  if (out.visibility_score == null) {
    out.visibility_score = totalRuns
      ? Math.round((mentionedRows.length / totalRuns) * 1000) / 10
      : 0;
  }
  if (out.top3_rate == null) {
    out.top3_rate = totalRuns
      ? Math.round((top3Rows.length / totalRuns) * 1000) / 10
      : 0;
  }
  if (out.mentions == null) out.mentions = mentionedRows.length;
  if (out.citations == null) out.citations = mentionedRows.length;
  if (out.sentiment_score == null) {
    if (mentionedRows.length) {
      out.sentiment_score = Math.round((positiveRows.length / mentionedRows.length) * 1000) / 10;
    } else {
      const m = (snap.sentiment || '').match(/([\d.]+)\s*%/);
      out.sentiment_score = m ? parseFloat(m[1]) : 0;
    }
  }
  if (out.detection_rate == null) {
    const queries = new Set(perQuery.map(r => r.query));
    const detected = new Set(mentionedRows.map(r => r.query));
    out.detection_rate = queries.size
      ? Math.round((detected.size / queries.size) * 1000) / 10
      : 0;
  }
  if (out.iterations == null) out.iterations = 1;
  if (out.total_runs == null) out.total_runs = totalRuns;
  if (out.queries_count == null) {
    out.queries_count = new Set(perQuery.map(r => r.query)).size;
  }

  // Augment per_query rows with the fields the new renderer reads.
  out.per_query = perQuery.map(r => ({
    ...r,
    iterations: r.iterations ?? 1,
    hits: r.hits ?? (r.mentioned ? 1 : 0),
    visibility: r.visibility ?? (r.mentioned ? 100 : 0),
    top3_rate: r.top3_rate ?? (r.mentioned && r.position && r.position <= 3 ? 100 : 0),
    avg_position: r.avg_position ?? r.position ?? null,
    engine_label: r.engine_label ?? r.engine
  }));

  // Augment competitors with visibility derived from appearances.
  out.competitors = (snap.competitors || []).map(c => ({
    ...c,
    visibility: c.visibility ?? (totalRuns
      ? Math.round((c.appearances || 0) / totalRuns * 1000) / 10
      : 0),
    top3_rate: c.top3_rate ?? 0,
    mentions: c.mentions ?? c.appearances ?? 0,
    citations: c.citations ?? 0
  }));

  // Build keyword_wins from binary mention data. Without iteration depth
  // we can only mark hit queries as "active" and unhit as "zero".
  if (!out.keyword_wins) {
    const queries = [...new Set(perQuery.map(r => r.query))];
    const active = [];
    const zero = [];
    for (const q of queries) {
      const rows = perQuery.filter(r => r.query === q);
      const best = rows.find(r => r.mentioned);
      if (best) {
        active.push({
          query: q,
          engine: best.engine,
          engine_label: best.engineLabel || best.engine,
          visibility: 100,
          top3_rate: best.position && best.position <= 3 ? 100 : 0
        });
      } else {
        zero.push({ query: q, best_visibility: 0 });
      }
    }
    out.keyword_wins = { active, emerging: [], zero };
  }

  // Mark this so callers can show a small "legacy snapshot — derived
  // metrics" hint if they want.
  out._legacy = true;
  return out;
}

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
