// daily_digest.js (Google Apps Script) — Phase F.
//
// daily_digest.main() reads today's rows from the DailyDigest tab,
// builds an HTML email, and sends it via MailApp. We mock the GAS
// globals so the function runs in Node and we can assert on:
//   • SpreadsheetApp.openById called with the configured SHEET_ID
//   • MailApp.sendEmail called when there are today's rows
//   • MailApp.sendEmail NOT called when no rows match today
//   • Email body contains the expected per-account totals
//   • "Needs Attention" section only appears when criteria match

import { loadGasScript, makeStubs, makeSheet } from './gas-harness.mjs';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

// Helper — build a sheet with the headers daily_digest expects.
const HEADERS = [
  'date', 'account', 'mode', 'run_mode', 'duration_s',
  'keywords_paused', 'search_terms_negated', 'ai_negated', 'ai_review',
  'winners_promoted', 'audit_findings', 'errors',
  'conv_this_week', 'conv_last_week'
];
function rowFor(date, account, overrides = {}) {
  const base = {
    date, account, mode: 'lead_gen', run_mode: 'PREVIEW', duration_s: 12,
    keywords_paused: 0, search_terms_negated: 0, ai_negated: 5, ai_review: 2,
    winners_promoted: 1, audit_findings: 0, errors: 0,
    conv_this_week: 10, conv_last_week: 8
  };
  const merged = { ...base, ...overrides };
  return HEADERS.map(h => merged[h]);
}

// Today's date in the script's TZ format.
function todayKey() {
  const d = new Date();
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

// ============================================================================
// No DailyDigest tab — log + return, no email
// ============================================================================
await t('main: missing DailyDigest tab logs and skips email', async () => {
  const stubs = makeStubs();
  stubs.SpreadsheetApp.openById = () => ({ getSheetByName: () => null });
  const mod = await loadGasScript('daily_digest.js', ['main'], stubs);
  mod.main();
  eq(stubs.MailApp.sendEmail.calls.length, 0, 'no email sent');
  // Logged the missing-tab note.
  const logged = stubs.Logger.log.calls.map(a => a[0]).join('\n');
  if (!/No DailyDigest/.test(logged)) throw new Error('expected "No DailyDigest" log');
});

await t('main: empty sheet (header only) logs and skips email', async () => {
  const stubs = makeStubs();
  stubs.SpreadsheetApp.openById = () => makeSheet([HEADERS]).getSheetByName()
    ? ({ getSheetByName: () => makeSheet([HEADERS]).getSheetByName() })
    : null;
  // makeSheet returns the parent that has getSheetByName — so just pass it through.
  stubs.SpreadsheetApp.openById = () => makeSheet([HEADERS]);
  const mod = await loadGasScript('daily_digest.js', ['main'], stubs);
  mod.main();
  eq(stubs.MailApp.sendEmail.calls.length, 0);
});

// ============================================================================
// No rows match today's date — log + return, no email
// ============================================================================
await t('main: rows exist but none for today → no email', async () => {
  const stubs = makeStubs();
  // Yesterday's row only.
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  stubs.SpreadsheetApp.openById = () => makeSheet([HEADERS, rowFor(yKey, 'AcmeCo')]);
  const mod = await loadGasScript('daily_digest.js', ['main'], stubs);
  mod.main();
  eq(stubs.MailApp.sendEmail.calls.length, 0);
  const logged = stubs.Logger.log.calls.map(a => a[0]).join('\n');
  if (!/No runs found for today/.test(logged)) throw new Error('expected "No runs found" log');
});

// ============================================================================
// Happy path: at least one row for today → email sent
// ============================================================================
await t('main: today has 1 row → MailApp.sendEmail called once', async () => {
  const stubs = makeStubs();
  stubs.SpreadsheetApp.openById = () => makeSheet([
    HEADERS,
    rowFor(todayKey(), 'AcmeCo', { ai_negated: 12, conv_this_week: 25, conv_last_week: 20 })
  ]);
  const mod = await loadGasScript('daily_digest.js', ['main'], stubs);
  mod.main();
  eq(stubs.MailApp.sendEmail.calls.length, 1, 'email sent');
});

await t('main: email subject includes today + account count + total conversions', async () => {
  const stubs = makeStubs();
  stubs.SpreadsheetApp.openById = () => makeSheet([
    HEADERS,
    rowFor(todayKey(), 'AcmeCo', { conv_this_week: 30 }),
    rowFor(todayKey(), 'BetaCorp', { conv_this_week: 12 })
  ]);
  const mod = await loadGasScript('daily_digest.js', ['main'], stubs);
  mod.main();
  const call = stubs.MailApp.sendEmail.calls[0][0];
  if (!call.subject.includes(todayKey())) throw new Error('subject missing date: ' + call.subject);
  if (!call.subject.includes('2 accounts')) throw new Error('subject missing account count: ' + call.subject);
  // Total conv = 30 + 12 = 42.
  if (!/42/.test(call.subject)) throw new Error('subject missing total conv: ' + call.subject);
});

await t('main: email body includes per-account row for each account', async () => {
  const stubs = makeStubs();
  stubs.SpreadsheetApp.openById = () => makeSheet([
    HEADERS,
    rowFor(todayKey(), 'AcmeCo'),
    rowFor(todayKey(), 'BetaCorp')
  ]);
  const mod = await loadGasScript('daily_digest.js', ['main'], stubs);
  mod.main();
  const html = stubs.MailApp.sendEmail.calls[0][0].htmlBody;
  if (!html.includes('AcmeCo')) throw new Error('AcmeCo missing from body');
  if (!html.includes('BetaCorp')) throw new Error('BetaCorp missing from body');
});

// ============================================================================
// "Needs Attention" filter
// ============================================================================
await t('main: account with errors > 0 lands in "Needs Attention"', async () => {
  const stubs = makeStubs();
  stubs.SpreadsheetApp.openById = () => makeSheet([
    HEADERS,
    rowFor(todayKey(), 'BrokenCo', { errors: 3 }),
    rowFor(todayKey(), 'HappyCo',  { errors: 0 })
  ]);
  const mod = await loadGasScript('daily_digest.js', ['main'], stubs);
  mod.main();
  const html = stubs.MailApp.sendEmail.calls[0][0].htmlBody;
  if (!/Needs Attention/.test(html)) throw new Error('Needs Attention section missing');
  // BrokenCo flagged with "3 errors".
  if (!/BrokenCo.*3 errors/s.test(html)) throw new Error('BrokenCo not flagged for errors');
  // HappyCo NOT in the attention list (no errors, no review > 10, no big conv drop).
  // The attention <ul> shouldn't list HappyCo.
  const attentionMatch = html.match(/<h3[^>]*>Needs Attention[\s\S]*?<\/ul>/);
  if (attentionMatch && /HappyCo/.test(attentionMatch[0])) {
    throw new Error('HappyCo wrongly flagged');
  }
});

await t('main: ai_review > 10 triggers "Needs Attention"', async () => {
  const stubs = makeStubs();
  stubs.SpreadsheetApp.openById = () => makeSheet([
    HEADERS,
    rowFor(todayKey(), 'NoisyCo', { ai_review: 15 })
  ]);
  const mod = await loadGasScript('daily_digest.js', ['main'], stubs);
  mod.main();
  const html = stubs.MailApp.sendEmail.calls[0][0].htmlBody;
  if (!/15 terms need review/.test(html)) throw new Error('expected "15 terms need review" flag');
});

await t('main: 50%+ conv drop triggers "Needs Attention" with %', async () => {
  const stubs = makeStubs();
  stubs.SpreadsheetApp.openById = () => makeSheet([
    HEADERS,
    // Conv this week is 40% of last week → 60% drop.
    rowFor(todayKey(), 'TankingCo', { conv_this_week: 4, conv_last_week: 10 })
  ]);
  const mod = await loadGasScript('daily_digest.js', ['main'], stubs);
  mod.main();
  const html = stubs.MailApp.sendEmail.calls[0][0].htmlBody;
  if (!/Conversions dropped 60%/.test(html)) throw new Error('expected "Conversions dropped 60%" flag');
});

await t('main: no accounts in attention set → "Needs Attention" section omitted', async () => {
  const stubs = makeStubs();
  stubs.SpreadsheetApp.openById = () => makeSheet([
    HEADERS,
    rowFor(todayKey(), 'HappyCo')
  ]);
  const mod = await loadGasScript('daily_digest.js', ['main'], stubs);
  mod.main();
  const html = stubs.MailApp.sendEmail.calls[0][0].htmlBody;
  if (/Needs Attention/.test(html)) throw new Error('Needs Attention should not appear');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
