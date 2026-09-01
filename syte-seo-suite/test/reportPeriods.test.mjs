// Report month ranges must be the calendar month, in every timezone.
//
// The bug: ranges were built with new Date(year, month, 1) (LOCAL midnight)
// and formatted with toISOString() (UTC). From Johannesburg (UTC+2) the whole
// window slid a day earlier — August 2026 was fetched as 2026-07-31 →
// 2026-08-30. Two consequences, both silent:
//   1. every SEO report included the last day of the previous month and
//      dropped the last day of the month it was reporting on;
//   2. the Search Console guard compared period.current.startDate against the
//      selected month and blocked the report with "Loaded data starts
//      2026-07-31, expected 2026-08". (That check has since been removed —
//      reporting runs a month in arrears — but the window itself must still
//      be the calendar month it claims to be.)
// It reproduces in any positive-offset timezone and never in UTC.
//
// Run: node test/reportPeriods.test.mjs

import { monthRange, getReportPeriods } from '../src/modules/reports/reportPeriods.js';
import { evaluateGscReadiness } from '../src/modules/reports/gscGuard.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

// Johannesburg is where the suite is used; the others bracket the range of
// offsets that can shift a local midnight across a UTC date boundary.
const ZONES = ['Africa/Johannesburg', 'UTC', 'Pacific/Auckland', 'Asia/Kolkata', 'America/New_York', 'Pacific/Honolulu'];

t('month ranges are the calendar month in every timezone', () => {
  for (const tz of ZONES) {
    process.env.TZ = tz;
    assertEq(monthRange(2026, 7).startDate, '2026-08-01', tz + ' Aug start');
    assertEq(monthRange(2026, 7).endDate, '2026-08-31', tz + ' Aug end');
    // 30-day month, and a leap February.
    assertEq(monthRange(2026, 3).endDate, '2026-04-30', tz + ' Apr end');
    assertEq(monthRange(2024, 1).endDate, '2024-02-29', tz + ' leap Feb end');
    // Year boundaries in both directions.
    assertEq(monthRange(2026, 0).startDate, '2026-01-01', tz + ' Jan start');
    assertEq(monthRange(2026, 11).endDate, '2026-12-31', tz + ' Dec end');
  }
  process.env.TZ = 'UTC';
});

t('previous + year-on-year windows line up with their own months', () => {
  process.env.TZ = 'Africa/Johannesburg';
  const p = getReportPeriods(2026, 7); // August 2026
  assertEq(p.current.startDate, '2026-08-01', 'current start');
  assertEq(p.prev.startDate, '2026-07-01', 'prev start');
  assertEq(p.prev.endDate, '2026-07-31', 'prev end');
  assertEq(p.yoy.startDate, '2025-08-01', 'yoy start');
  assertEq(p.yoy.endDate, '2025-08-31', 'yoy end');

  // January rolls the previous month back into the prior year.
  const jan = getReportPeriods(2026, 0);
  assertEq(jan.prev.startDate, '2025-12-01', 'Jan prev start');
  assertEq(jan.prev.endDate, '2025-12-31', 'Jan prev end');
  process.env.TZ = 'UTC';
});

// The guard no longer polices the month (reporting runs a month in arrears),
// but a report built from these ranges must still clear it cleanly.
t('the Search Console guard accepts a report built from these ranges', () => {
  process.env.TZ = 'Africa/Johannesburg';
  const periods = getReportPeriods(2026, 7);
  const readiness = evaluateGscReadiness({
    client: { gsc_property: 'sc-domain:apiproperty.co.za' },
    token: { access_token: 'x', scope: 'https://www.googleapis.com/auth/webmasters.readonly' },
    month: '2026-08',
    reportData: {
      period: { current: periods.current },
      keywords: [{ query: 'k', impressions: 120, clicks: 4 }],
      topPages: [{ page: '/', impressions: 90, clicks: 3 }],
      errors: []
    }
  });
  assertEq(readiness.ok, true, 'readiness.ok');
  assertEq(readiness.blocker, null, 'blocker');
  process.env.TZ = 'UTC';
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
