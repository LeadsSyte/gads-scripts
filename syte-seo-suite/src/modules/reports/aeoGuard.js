// Search Console readiness gate for the AEO report.
//
// The sibling of gscGuard.js, for the other deliverable — and it asks a
// deliberately different question.
//
// gscGuard asks "is Search Console CONNECTED?", because every number in the
// SEO report is a live Google figure. The AEO report contains no Google
// figures at all: it reports what the answer engines say. What it needs
// Search Console for is GROUNDING — the head-terms a brand already gets
// impressions for are what the gold probe grid, the discovery sweep and the
// head-term expansion are built from. So this gate asks "is there Search
// Console DATA on file for this month?" and does not care where it came
// from: a live pull and an imported Performance export (gscImport.js) ground
// the grid identically.
//
// Why gate at all: without those head-terms the grid falls back to website +
// industry phrasing and collapses to a handful of probes — the "only 3 probe
// queries ran, all 0%" report. That report is worse than no report, because
// it reads as "the brand is invisible in AI search" when it actually means
// "we never asked a real question". Blocking is the honest answer.
//
// Pure functions only — no network, no DOM — so the rules are testable.

import { GSC_IMPORT_SOURCE } from './gscImport.js';

// Rows only count as grounding if Google actually reported activity for
// them. An all-zero pull is data in shape only, and seeds nothing useful.
function liveRowCount(rows) {
  return (rows || []).filter(r => Number(r.impressions) > 0 || Number(r.clicks) > 0).length;
}

// Minimum head-terms worth calling grounding. Below this the grid is built
// from so little that it lands in the same degenerate place as no data at
// all — see MIN_HEALTHY_GOLD in grounding.js for the probe-side equivalent.
export const MIN_GROUNDING_KEYWORDS = 5;

// client:     the client being reported on
// reportData: the object returned by fetchReportData(), the cached blob, or
//             an imported one (buildImportedReportData) — or null
// month:      'YYYY-MM' (the report month), for the message only
//
// Returns { ok, source, checks: [{ key, label, pass, note }], blocker }
// blocker (when !ok): { code, message, action } where action is one of
// 'import' | 'refresh' — what the UI should offer next.
export function evaluateAeoReadiness({ client, reportData, month } = {}) {
  const checks = [];
  const add = (key, label, pass, note = '') => checks.push({ key, label, pass, note });

  const keywords = reportData?.keywords || [];
  const imported = reportData?.source === GSC_IMPORT_SOURCE;
  const source = !keywords.length ? null : imported ? 'import' : 'live';

  const present = keywords.length > 0;
  add('present', 'Search Console data on file for this month', present,
    present
      ? (imported
          ? `Imported CSV${reportData.imported_at ? ' · ' + String(reportData.imported_at).slice(0, 10) : ''}`
          : 'Live Search Console pull')
      : 'Nothing pulled or imported yet');

  const usable = liveRowCount(keywords);
  add('grounding', `At least ${MIN_GROUNDING_KEYWORDS} head-terms to ground the probe grid`,
    usable >= MIN_GROUNDING_KEYWORDS,
    present
      ? `${usable} ${usable === 1 ? 'query' : 'queries'} with impressions or clicks`
      : '');

  // What the operator should do next depends on whether this client is one we
  // have Search Console access to at all. No property = there is nothing to
  // refresh, so send them to the import; a configured property that came back
  // empty is a fetch worth retrying.
  const action = client?.gsc_property ? 'refresh' : 'import';
  const importLine = 'Import their Search Console export instead (Performance → Export → Download CSV) using the card below.';

  const blockers = {
    present: {
      code: 'no-gsc-data',
      message: 'No Search Console data on file for ' + (month || 'this month') +
        '. The AEO probe grid is built from the head-terms a brand already gets impressions for, and without them the grid collapses to a handful of guessed prompts. ' +
        (action === 'refresh'
          ? 'Pull the data with Refresh Data, or import the client\'s Performance export using the card below.'
          : importLine),
      action
    },
    grounding: {
      code: 'thin-gsc-data',
      message: 'Only ' + usable + ' Search Console ' + (usable === 1 ? 'query has' : 'queries have') +
        ' impressions for ' + (month || 'this month') + ' — too little to ground a probe grid on (need at least ' +
        MIN_GROUNDING_KEYWORDS + '). Check the export covers the right property and month, then re-import.',
      action
    }
  };

  const failed = checks.find(c => !c.pass);
  return {
    ok: !failed,
    source,
    checks,
    blocker: failed ? blockers[failed.key] : null
  };
}

// Short one-liner for badges / disabled-button tooltips.
export function aeoReadinessSummary(readiness) {
  if (!readiness) return '';
  if (!readiness.ok) return readiness.blocker?.message || 'Search Console data not ready';
  return readiness.source === 'import'
    ? 'Grounded on imported Search Console data'
    : 'Grounded on live Search Console data';
}
