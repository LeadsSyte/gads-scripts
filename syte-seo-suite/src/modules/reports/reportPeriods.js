// Calendar month ranges for the monthly report (current / previous / YoY).
//
// These are CALENDAR DATES for the Google APIs ("2026-08-01"), not instants,
// so no timezone conversion may happen anywhere in here — hence Date.UTC.
//
// The bug this exists to prevent: the ranges used to be built with
// `new Date(year, month, 1)`, which is LOCAL midnight, and then formatted
// with `.toISOString()`, which converts back to UTC. From Johannesburg
// (UTC+2) that shifted the whole month a day earlier — August 2026 was
// fetched as 2026-07-31 → 2026-08-30. Every SEO report quietly included the
// last day of the previous month, dropped the last day of the month being
// reported on, and tripped the Search Console guard's month check
// ("Loaded data starts 2026-07-31, expected 2026-08"), which blocks the
// report. It reproduces in any positive-offset timezone and never in UTC,
// which is why it survived so long.
//
// Pure and dependency-free so plain-node tests can import it (reportData.js
// pulls in browser/Vite-only modules).

// month is 0-based, matching the Date constructor.
export function monthRange(year, month) {
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0)); // day 0 = last day of `month`
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  };
}

// month is 0-based (0=Jan).
export function getReportPeriods(year, month) {
  const current = monthRange(year, month);
  const prev = monthRange(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1);
  const yoy = monthRange(year - 1, month);
  return { current, prev, yoy };
}
