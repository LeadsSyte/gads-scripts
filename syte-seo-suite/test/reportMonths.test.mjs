// The report month key must be the same calendar month everywhere.
//
// Two ways of computing "last month" were in use, and both could disagree
// with the month a report was logged under — a report generated for a month
// the dashboard wasn't looking for shows nowhere at all:
//
//   1. d.setMonth(d.getMonth() - 1) overflows on a long day. On 31 March that
//      is 31 February, which rolls forward to 3 March — "last month" comes
//      back as the CURRENT month, and every report for the real previous
//      month vanishes off the board.
//   2. toISOString().slice(0, 7) formats a LOCAL instant as UTC. From
//      Johannesburg (UTC+2) the first two hours of the 1st of a month resolve
//      to the previous month, so the generator and the dashboard can disagree
//      about which month is "last".
//
// Run: node test/reportMonths.test.mjs

import { monthKeyOf, shiftMonthKey, previousMonthKey, monthKeyLabel, selectableMonthKeys } from '../src/modules/reports/reportMonths.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

const ZONES = ['Africa/Johannesburg', 'UTC', 'Pacific/Auckland', 'Asia/Kolkata', 'America/New_York', 'Pacific/Honolulu'];

t('previous month never overflows on a long day', () => {
  // The old setMonth(-1) form returned "2026-03" here: February has no 31st.
  assertEq(previousMonthKey(new Date(2026, 2, 31, 12, 0)), '2026-02', '31 March');
  assertEq(previousMonthKey(new Date(2026, 4, 31, 12, 0)), '2026-04', '31 May');
  assertEq(previousMonthKey(new Date(2026, 6, 31, 12, 0)), '2026-06', '31 July');
  assertEq(previousMonthKey(new Date(2026, 9, 31, 12, 0)), '2026-09', '31 October');
});

t('month keys are the local calendar month in every timezone', () => {
  for (const tz of ZONES) {
    process.env.TZ = tz;
    // 00:30 on the 1st: the UTC-formatted form slid this back a month from
    // any positive offset, so the dashboard looked for July while the
    // generator had logged August.
    assertEq(previousMonthKey(new Date(2026, 8, 1, 0, 30)), '2026-08', tz + ' 1 Sept 00:30');
    assertEq(previousMonthKey(new Date(2026, 8, 2, 9, 0)), '2026-08', tz + ' 2 Sept');
    assertEq(monthKeyOf(new Date(2026, 8, 1, 0, 30)), '2026-09', tz + ' current month');
  }
  process.env.TZ = 'UTC';
});

t('previous month crosses the year boundary', () => {
  assertEq(previousMonthKey(new Date(2026, 0, 15, 12, 0)), '2025-12', 'January');
  assertEq(previousMonthKey(new Date(2026, 0, 1, 0, 5)), '2025-12', '1 January just after midnight');
});

t('shiftMonthKey does plain month arithmetic', () => {
  assertEq(shiftMonthKey('2026-01', -1), '2025-12', 'back over the year');
  assertEq(shiftMonthKey('2026-12', 1), '2027-01', 'forward over the year');
  assertEq(shiftMonthKey('2026-08', -14), '2025-06', 'more than a year back');
  assertEq(shiftMonthKey('2026-08', 0), '2026-08', 'no shift');
});

t('labels read as the month they name', () => {
  assertEq(monthKeyLabel('2026-08'), 'August 2026', 'August');
  assertEq(monthKeyLabel('2026-01'), 'January 2026', 'January');
  assertEq(monthKeyLabel(''), '', 'empty');
});

t('the picker offers the month in progress and the months behind it', () => {
  const keys = selectableMonthKeys(4, new Date(2026, 8, 2));
  assertEq(keys.join(','), '2026-09,2026-08,2026-07,2026-06', 'newest first');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
