// weekly_approval_report.js (Google Apps Script) — Phase F.
// Pins the contracts of:
//   • main() — sends one weekly email with applied/expired/pending totals
//     across the last 7 days of PendingChanges
//   • _summarizeChanges — turns the changes_json blob into "X kw pauses,
//     Y negations, Z winners" summary (or "No changes" / "Unable to parse")
//   • _formatCategories — keyword_pauses → "Keywords", etc.

import { loadGasScript, makeStubs, makeSheet } from './gas-harness.mjs';

const HEADERS = [
  'run_id', 'timestamp', 'account_name', 'status',
  'approved_categories', 'approved_by', 'approved_at', 'notes',
  'changes_json', 'eval_summary'
];

function rowFor(overrides = {}) {
  const base = {
    run_id: 'r-' + Math.random().toString(36).slice(2),
    timestamp: new Date().toISOString(),
    account_name: 'AcmeCo',
    status: 'PENDING',
    approved_categories: '',
    approved_by: '',
    approved_at: '',
    notes: '',
    changes_json: '{}',
    eval_summary: 'AI says OK'
  };
  const merged = { ...base, ...overrides };
  return HEADERS.map(h => merged[h]);
}

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

// ============================================================================
// _summarizeChanges
// ============================================================================
await t('_summarizeChanges: empty {} returns "No changes"', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_approval_report.js', ['_summarizeChanges'], stubs);
  eq(mod._summarizeChanges('{}'), 'No changes');
});

await t('_summarizeChanges: malformed JSON returns "Unable to parse"', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_approval_report.js', ['_summarizeChanges'], stubs);
  eq(mod._summarizeChanges('not json{'), 'Unable to parse');
});

await t('_summarizeChanges: counts each section type', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_approval_report.js', ['_summarizeChanges'], stubs);
  const json = JSON.stringify({
    keyword_pauses: { keywordsPaused: ['a', 'b'], ecomKeywordsPaused: ['c'], lowQsPaused: [] },
    search_term_negations: { smartNegated: ['x'], ngramNegatives: ['y', 'z'] },
    winner_promotions: { winnersPromoted: ['w'], ecomWinnersPromoted: [] },
    auto_optimizations: { deviceAdjustments: ['d'], scheduleAdjustments: [], geoAdjustments: ['g'] },
    shopping_pmax: { shoppingProductsPaused: [], pmaxSearchTermsNegated: ['p'] }
  });
  const summary = mod._summarizeChanges(json);
  if (!/3 kw pauses/.test(summary)) throw new Error('expected "3 kw pauses": ' + summary);
  if (!/3 negations/.test(summary)) throw new Error('expected "3 negations": ' + summary);
  if (!/1 winners/.test(summary))   throw new Error('expected "1 winners": ' + summary);
  if (!/2 bid adj/.test(summary))   throw new Error('expected "2 bid adj": ' + summary);
  if (!/1 shopping/.test(summary))  throw new Error('expected "1 shopping": ' + summary);
});

await t('_summarizeChanges: skips zero-count sections from the summary', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_approval_report.js', ['_summarizeChanges'], stubs);
  const json = JSON.stringify({
    keyword_pauses: { keywordsPaused: ['a'] },
    search_term_negations: {},
    winner_promotions: {}
  });
  const summary = mod._summarizeChanges(json);
  eq(summary, '1 kw pauses');
});

// ============================================================================
// _formatCategories
// ============================================================================
await t('_formatCategories: empty input → em dash', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_approval_report.js', ['_formatCategories'], stubs);
  eq(mod._formatCategories(''), '—');
  eq(mod._formatCategories(null), '—');
});

await t('_formatCategories: "all" returns "All Categories"', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_approval_report.js', ['_formatCategories'], stubs);
  eq(mod._formatCategories('all'), 'All Categories');
});

await t('_formatCategories: maps known keys to friendly labels', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_approval_report.js', ['_formatCategories'], stubs);
  eq(mod._formatCategories('keyword_pauses,winner_promotions'), 'Keywords, Winners');
  eq(mod._formatCategories('shopping_pmax'), 'Shopping/PMax');
});

await t('_formatCategories: unknown keys passed through', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_approval_report.js', ['_formatCategories'], stubs);
  eq(mod._formatCategories('some_unknown_key'), 'some_unknown_key');
});

// ============================================================================
// main() — full email flow
// ============================================================================
await t('main: missing PendingChanges tab → log + skip email', async () => {
  const stubs = makeStubs();
  stubs.SpreadsheetApp.openById = () => ({ getSheetByName: () => null });
  const mod = await loadGasScript('weekly_approval_report.js', ['main'], stubs);
  mod.main();
  eq(stubs.MailApp.sendEmail.calls.length, 0);
});

await t('main: empty PendingChanges → log + skip email', async () => {
  const stubs = makeStubs();
  stubs.SpreadsheetApp.openById = () => makeSheet([HEADERS]);
  const mod = await loadGasScript('weekly_approval_report.js', ['main'], stubs);
  mod.main();
  eq(stubs.MailApp.sendEmail.calls.length, 0);
});

await t('main: only old (>7 day) rows → no email sent', async () => {
  const stubs = makeStubs();
  const old = new Date();
  old.setDate(old.getDate() - 30);
  stubs.SpreadsheetApp.openById = () => makeSheet([
    HEADERS,
    rowFor({ timestamp: old.toISOString(), status: 'EXPIRED' })
  ]);
  const mod = await loadGasScript('weekly_approval_report.js', ['main'], stubs);
  mod.main();
  eq(stubs.MailApp.sendEmail.calls.length, 0);
});

await t('main: APPLIED + EXPIRED + PENDING → email sent with totals', async () => {
  const stubs = makeStubs();
  const recent = new Date();
  recent.setHours(recent.getHours() - 6);
  stubs.SpreadsheetApp.openById = () => makeSheet([
    HEADERS,
    rowFor({ timestamp: recent.toISOString(), status: 'APPLIED', approved_categories: 'keyword_pauses' }),
    rowFor({ timestamp: recent.toISOString(), status: 'EXPIRED' }),
    rowFor({ timestamp: recent.toISOString(), status: 'PENDING' })
  ]);
  const mod = await loadGasScript('weekly_approval_report.js', ['main'], stubs);
  mod.main();
  eq(stubs.MailApp.sendEmail.calls.length, 1);
  const subject = stubs.MailApp.sendEmail.calls[0][0].subject;
  if (!/1 approved, 1 expired/.test(subject)) throw new Error('subject totals wrong: ' + subject);
});

await t('main: PENDING with approved_categories counts as APPLIED', async () => {
  const stubs = makeStubs();
  const recent = new Date();
  stubs.SpreadsheetApp.openById = () => makeSheet([
    HEADERS,
    // Status PENDING, but approved_categories is non-empty → treated as applied.
    rowFor({ timestamp: recent.toISOString(), status: 'PENDING', approved_categories: 'winner_promotions' })
  ]);
  const mod = await loadGasScript('weekly_approval_report.js', ['main'], stubs);
  mod.main();
  const subject = stubs.MailApp.sendEmail.calls[0][0].subject;
  if (!/1 approved/.test(subject)) throw new Error('PENDING+approved_categories should count as approved: ' + subject);
});

await t('main: Expired Changes section appears only when there are expired rows', async () => {
  const stubs = makeStubs();
  const recent = new Date();
  stubs.SpreadsheetApp.openById = () => makeSheet([
    HEADERS,
    rowFor({ timestamp: recent.toISOString(), status: 'APPLIED', approved_categories: 'keyword_pauses' })
  ]);
  const mod = await loadGasScript('weekly_approval_report.js', ['main'], stubs);
  mod.main();
  const html = stubs.MailApp.sendEmail.calls[0][0].htmlBody;
  if (/Expired Changes/.test(html)) throw new Error('Expired Changes section should not appear');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
