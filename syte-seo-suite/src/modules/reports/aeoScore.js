// AEO v2 scoring math (Requirement 3) — pure, dependency-free, node-testable.
//
// Single-shot position is dead. Over N runs of a (probe x engine) we report:
//   appearanceRate            = appearances / N
//   avgPositionWhenAppearing  = mean(position) across runs where appeared,
//                               NEVER averaging absent runs (nulls/zeros) in
//   visibilityScore           = round(appearanceRate * (1/avgPos) * 100),
//                               0 if never appeared, capped at 100
//
// Portfolio (per snapshot):
//   promptCoverage   = count of active scorable probes with appearanceRate > 0
//   coverageRate     = promptCoverage / active scorable probe count
//   newThemesDiscovered = fan-out probes approved since last snapshot
//
// Composite AEO Performance Index (0..100), weights:
//   coverageRate 30 · mean visibilityScore across covered probes 30 ·
//   Share of Voice 20 · citation density 10 · sentiment 10

function round1(n) { return Math.round(n * 10) / 10; }
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

// runs: array of per-run records, each { appeared: bool, position: number|null }.
export function appearanceRate(runs) {
  const n = runs.length;
  if (!n) return 0;
  const appearances = runs.filter(r => r.appeared).length;
  return appearances / n;
}

// Mean position across ONLY the runs where the brand appeared with a real
// position. Absent runs (appeared=false, position null/0) are never averaged
// in. Returns null if the brand never appeared.
export function avgPositionWhenAppearing(runs) {
  const positions = runs
    .filter(r => r.appeared && r.position != null && r.position > 0)
    .map(r => r.position);
  if (!positions.length) return null;
  return round1(mean(positions));
}

// visibilityScore = appearanceRate * (1/avgPos) * 100, 0 if never appeared,
// capped at 100. Prominence-weighted: appearing often AND high beats appearing
// often but buried.
export function visibilityScore(ar, avgPos) {
  if (!avgPos || avgPos <= 0) return 0;
  return Math.min(100, Math.round(ar * (1 / avgPos) * 100));
}

// Score one (probe x engine x runMode) group of runs.
export function scoreRunGroup(runs) {
  const ar = appearanceRate(runs);
  const avgPos = avgPositionWhenAppearing(runs);
  return {
    runs: runs.length,
    appearances: runs.filter(r => r.appeared).length,
    appearanceRate: round1(ar * 100) / 100,   // keep 2dp precision, still a 0..1 ratio
    avgPositionWhenAppearing: avgPos,
    visibilityScore: visibilityScore(ar, avgPos)
  };
}

// ---------------------------------------------------------------------------
// Portfolio-level rollups. `probeAggregates` is an array of per-probe rows,
// each already aggregated across that probe's engines/modes:
//   { probeId, type, appearanceRate (0..1), visibilityScore (0..100) }
// Reverse probes must be filtered out by the caller (scorableProbes) — they
// are instruments, not visibility targets.
// ---------------------------------------------------------------------------
export function promptCoverage(probeAggregates) {
  return probeAggregates.filter(p => (p.appearanceRate || 0) > 0).length;
}

export function coverageRate(probeAggregates) {
  const total = probeAggregates.length;
  if (!total) return 0;
  return round1((promptCoverage(probeAggregates) / total) * 100) / 100; // 0..1, 2dp
}

// Mean visibilityScore across COVERED probes only (appearanceRate > 0).
export function meanVisibilityCovered(probeAggregates) {
  const covered = probeAggregates.filter(p => (p.appearanceRate || 0) > 0);
  return covered.length ? Math.round(mean(covered.map(p => p.visibilityScore || 0))) : 0;
}

// Composite index. Inputs already normalized to their natural ranges:
//   cr:          coverageRate 0..1
//   meanVis:     mean visibilityScore across covered probes 0..100
//   sov:         share of voice 0..100 (%)
//   citeDensity: 0..100 (brand citations per run, scaled + capped)
//   sentiment:   0..100 (% positive)
export function compositeIndex({ coverageRate: cr, meanVis, sov, citeDensity, sentiment }) {
  const score =
    (cr || 0) * 30 +
    ((meanVis || 0) / 100) * 30 +
    ((sov || 0) / 100) * 20 +
    ((citeDensity || 0) / 100) * 10 +
    ((sentiment || 0) / 100) * 10;
  return Math.min(100, Math.round(score));
}

// Brand citations per run, scaled to 0..100 and capped (matches the pre-v2
// citation-density intuition).
export function citationDensity(totalBrandCitations, totalRuns) {
  if (!totalRuns) return 0;
  return Math.min(100, Math.round((totalBrandCitations / totalRuns) * 100));
}

// Active / Emerging / Zero buckets defined on appearanceRate (Requirement 3):
//   active   >= 0.7
//   emerging  0.3 .. 0.69   (nominal; with the default N=3 the achievable
//                            bands are 0, .33, .67, 1 so the 0.3 floor and the
//                            "any nonzero-below-active" intent coincide)
//   zero      == 0
// Values in (0, 0.3) — only reachable at higher N — are grouped with emerging
// so no probe is silently dropped from the report.
export function bucketByAppearance(ar) {
  if (ar >= 0.7) return 'active';
  if (ar > 0) return 'emerging';
  return 'zero';
}
