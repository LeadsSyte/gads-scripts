// Search Console readiness gate for the SEO report.
//
// An SEO report is only as good as its Search Console feed. If the Google
// account isn't connected, the property isn't set, the API errored, or GSC
// came back empty (or for the wrong month), every keyword table and ranking
// claim in the report is wrong — and a wrong report is worse than a late
// one. This module answers one question: is GSC connected AND reading
// accurately for this client and month? If not, it says exactly what to fix.
//
// Pure functions only — no network, no DOM — so the rules are testable.

import { SCOPES } from '../technical/googleAuth.js';

// A row only counts as real data if Google actually reported activity for
// it. A property that returns rows with zero impressions across the board
// is connected but not reading anything useful.
function hasLiveRows(rows) {
  return (rows || []).some(r => Number(r.impressions) > 0 || Number(r.clicks) > 0);
}

function gscErrors(reportData) {
  return (reportData?.errors || []).filter(e => /^GSC/i.test(String(e)));
}

// month: 'YYYY-MM' (the report month)
// token: the saved Google OAuth token (or null) — see googleAuth.getToken()
// reportData: the object returned by fetchReportData(), or null
//
// Returns { ok, checks: [{ key, label, pass, note }], blocker }
// blocker (when !ok): { code, message, action } where action is one of
// 'configure' | 'connect' | 'refresh' — what the UI should offer next.
export function evaluateGscReadiness({ client, reportData, month, token } = {}) {
  const checks = [];
  const add = (key, label, pass, note = '') => checks.push({ key, label, pass, note });

  const property = client?.gsc_property || '';
  const hasProperty = !!property;
  add('property', 'Search Console property configured', hasProperty,
    hasProperty ? property : 'Set it in Edit Client → Google Connections');

  const scope = token?.scope || '';
  const connected = !!token?.access_token && scope.includes(SCOPES.gsc);
  add('connected', 'Google account connected with Search Console access', connected,
    connected ? '' : token?.access_token
      ? 'Signed in, but Search Console permission was not granted'
      : 'Not signed in to Google');

  const errs = gscErrors(reportData);
  // 'No property configured' is already covered by the property check —
  // don't report the same problem twice.
  const realErrs = errs.filter(e => !/no property configured/i.test(e));
  const fetched = !!reportData && realErrs.length === 0;
  add('fetched', 'Search Console data fetched without errors', fetched,
    !reportData ? 'No data pulled yet for this month' : realErrs.join(' · '));

  // Guard against a cached payload from a different month being passed off
  // as this month's numbers.
  const periodStart = reportData?.period?.current?.startDate || '';
  const monthMatches = !month || !periodStart || periodStart.startsWith(month);
  add('month', 'Data covers the selected report month', monthMatches,
    monthMatches ? '' : `Loaded data starts ${periodStart}, expected ${month}`);

  const keywords = reportData?.keywords || [];
  const topPages = reportData?.topPages || [];
  const reading = hasLiveRows(keywords) || hasLiveRows(topPages);
  add('reading', 'Search Console returning impressions for this month', reading,
    reading ? `${keywords.length} queries · ${topPages.length} pages` : 'Zero clicks and impressions returned');

  // First failing check wins — fix them in order.
  const blockers = {
    property: {
      code: 'no-property',
      message: 'No Search Console property is set for this client. Add it in Edit Client → Google Connections before generating an SEO report.',
      action: 'configure'
    },
    connected: {
      code: 'not-connected',
      message: 'Search Console is not connected. Connect the Google account that has access to this property, then refresh the data.',
      action: 'connect'
    },
    fetched: {
      code: reportData ? 'fetch-error' : 'no-data',
      message: reportData
        ? 'Search Console returned an error, so the numbers in this report cannot be trusted: ' + realErrs.join(' · ')
        : 'Search Console data has not been pulled for this month yet.',
      action: 'refresh'
    },
    month: {
      code: 'month-mismatch',
      message: 'The loaded Search Console data is for a different month than the one selected. Refresh the data before generating.',
      action: 'refresh'
    },
    reading: {
      code: 'no-rows',
      message: 'Search Console is connected but returned no clicks or impressions for ' + (month || 'this month') + '. Check the property (domain vs URL-prefix) and the account\'s access before reporting on it.',
      action: 'refresh'
    }
  };

  const failed = checks.find(c => !c.pass);
  return {
    ok: !failed,
    checks,
    blocker: failed ? blockers[failed.key] : null
  };
}

// Short one-liner for badges / disabled-button tooltips.
export function gscReadinessSummary(readiness) {
  if (!readiness) return '';
  return readiness.ok
    ? 'Search Console connected and reading'
    : readiness.blocker?.message || 'Search Console not ready';
}
