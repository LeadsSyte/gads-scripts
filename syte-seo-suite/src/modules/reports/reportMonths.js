// Month keys ("YYYY-MM") for the reporting views.
//
// Two ways of computing "last month" were in use, and both could disagree
// with the month a report was actually logged under:
//
//   new Date(); d.setMonth(d.getMonth() - 1)
//     overflows on long days — on 31 March that lands on 31 February, which
//     JS rolls forward to 3 March, so "last month" comes back as the CURRENT
//     month and every report logged for the real previous month disappears
//     from the dashboard.
//
//   d.toISOString().slice(0, 7)
//     formats a LOCAL instant as UTC. From Johannesburg (UTC+2) the first two
//     hours of the 1st of a month resolve to the previous month, so the
//     dashboard and the generator can disagree about which month is "last".
//
// Month keys are calendar labels, not instants, so they're built from the
// local calendar fields and shifted by plain integer arithmetic. Same
// treatment reportPeriods.js gives the Google API date windows.

// Calendar month of a date, as "YYYY-MM".
export function monthKeyOf(date = new Date()) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

// Shift a month key by whole months. Handles year boundaries in both
// directions and never touches days, so it cannot overflow.
export function shiftMonthKey(key, delta) {
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return key;
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return year + '-' + String(month).padStart(2, '0');
}

// Reports run a month in arrears: the default report month is the one that
// has just finished.
export function previousMonthKey(now = new Date()) {
  return shiftMonthKey(monthKeyOf(now), -1);
}

// "2026-08" → "August 2026". Built from the parts so the label can't drift a
// month across a timezone the way parsing "2026-08" as a date would.
export function monthKeyLabel(key) {
  if (!key) return '';
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return String(key);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// Newest-first list of month keys for a picker: the default report month,
// a few months back, and the month in progress (reports are occasionally
// generated for the current month).
export function selectableMonthKeys(count = 13, now = new Date()) {
  const current = monthKeyOf(now);
  const keys = [current];
  for (let i = 1; i < count; i++) keys.push(shiftMonthKey(current, -i));
  return keys;
}
