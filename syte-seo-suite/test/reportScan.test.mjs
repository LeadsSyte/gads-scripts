// Report Autopilot: data → gate → report → independent accuracy check → saved.
// Every outside call is faked.

import { runReportScan, newReportState, reportMonthFor, normalizeReportCheck, buildReportCheckInput } from '../netlify/functions/lib/reportScan.js';
import { formFromReportData } from '../src/modules/reports/reportGenerate.js';
import { workSummaryFrom } from '../src/modules/reports/reportPrompts.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

const CLIENT = { id: 'c1', name: 'Krost Shelving', industry: 'Shelving', gsc_property: 'sc-domain:krost.example', gsc_account_email: 'seo@syte.example', ga4_property_id: '123' };
const DATA = () => ({
  period: { current: { startDate: '2026-08-01', endDate: '2026-08-31' } },
  traffic: { current: { users: 1200, sessions: 1500, conversions: 30, revenue: 0 }, previous: { users: 1000, sessions: 1300, conversions: 25, revenue: 0 }, yoy: { users: 900 },
    momChange: { users: 20, sessions: 15.4, conversions: 20, revenue: 0 } },
  keywords: [{ query: 'mezzanine floors', position: 3.2, prevPosition: 5.1, change: 1.9, clicks: 40, impressions: 900 }],
  topPages: [{ page: 'https://krost.example/mezzanine/', clicks: 40, impressions: 900, position: 3.2 }],
  errors: []
});

function fakeDeps(over = {}) {
  const calls = { saved: null, complete: 0, states: [] };
  const deps = {
    fetchData: async () => DATA(),
    loadWork: async () => ({ articles: [{ client_id: 'c1', topic: 'Mezzanine guide', generated_at: '2026-08-10' }], tasks: [], aeoResults: [], impls: [] }),
    loadExisting: async () => null,
    complete: async ({ system }) => {
      calls.complete++;
      if (/QA|quality/i.test(system.slice(0, 400)) && !/microsite/i.test(system.slice(0, 200))) return '{"overallScore": 8, "readyToSend": true, "checks": []}';
      if (/JSON/.test(system) && /microsite|report page/i.test(system)) return '{"headline":"Organic users up 20%","summary":"Good month"}';
      return 'SUBJECT: August SEO update\n---\nHi team, organic users grew 20% to 1,200 in August.';
    },
    checkReport: async () => ({ verdict: 'accurate', issues: [], summary: 'All figures match.' }),
    saveGenerated: async (row) => { calls.saved = row; },
    saveCache: async () => {},
    saveState: async (s) => { calls.states.push(s.status); },
    ...over
  };
  return { deps, calls };
}

await t('the report month is last month', () => {
  assertEq(reportMonthFor(new Date('2026-09-05T08:00:00Z')), '2026-08');
  assertEq(reportMonthFor(new Date('2026-01-05T08:00:00Z')), '2025-12');
});

await t('builds, checks and saves the month\'s SEO report (never sends it)', async () => {
  const { deps, calls } = fakeDeps();
  const state = newReportState(CLIENT, '2026-08');
  await runReportScan(CLIENT, state, deps);
  assertEq(state.status, 'done');
  assertEq(calls.saved.report_type, 'seo'); assertEq(calls.saved.month, '2026-08');
  assertEq(calls.saved.qa.independent_check.verdict, 'accurate', 'accuracy check stored on the qa blob');
  if (!calls.saved.microsite_json || !calls.saved.email_subject) throw new Error('report content missing');
  assertEq(calls.saved.report_data.version != null, true, 'data stamped like the page does');
});

await t('an existing report is not overwritten unless asked', async () => {
  const { deps, calls } = fakeDeps({ loadExisting: async () => ({ id: 'r1' }) });
  const state = newReportState(CLIENT, '2026-08');
  await runReportScan(CLIENT, state, deps);
  assertEq(state.status, 'skipped'); assertEq(calls.saved, null); assertEq(calls.complete, 0);
  const again = fakeDeps({ loadExisting: async () => ({ id: 'r1' }) });
  const s2 = newReportState(CLIENT, '2026-08');
  await runReportScan(CLIENT, s2, again.deps, { force: true });
  assertEq(s2.status, 'done');
});

await t('a broken Search Console feed blocks the report (same gate as the page)', async () => {
  const { deps, calls } = fakeDeps({ fetchData: async () => ({ ...DATA(), keywords: [], topPages: [], errors: ['GSC: 403 forbidden'] }) });
  const state = newReportState(CLIENT, '2026-08');
  await runReportScan(CLIENT, state, deps);
  assertEq(state.status, 'blocked'); assertEq(calls.saved, null); assertEq(calls.complete, 0);
});

await t('the accuracy reviewer gets the real figures, and an error means "issues"', () => {
  const data = DATA();
  const input = buildReportCheckInput({ client: CLIENT, month: '2026-08', data, form: formFromReportData(data), work: {}, email: { subject: 's', body: 'b' }, micro: {} });
  if (!/"this_month": 1200/.test(input) || !/"last_month": 1000/.test(input)) throw new Error('users missing');
  if (!/mezzanine floors/.test(input)) throw new Error('keywords missing');
  assertEq(normalizeReportCheck({ verdict: 'accurate', issues: [{ severity: 'error', issue: 'Says up 30%, data says 20%' }] }).verdict, 'issues');
  assertEq(normalizeReportCheck(null).verdict, 'issues');
});

await t('work summary from database rows (server) counts only this client and month', () => {
  const w = workSummaryFrom({
    articles: [{ client_id: 'c1', topic: 'A', generated_at: '2026-08-02' }, { client_id: 'c1', topic: 'B', generated_at: '2026-07-30' }, { client_id: 'x', topic: 'C', generated_at: '2026-08-02' }],
    tasks: [{ client_id: 'c1', status: 'verified', priority: 'critical', created_at: '2026-08-03' }],
    aeoResults: [{ client_id: 'c1', generated_at: '2026-08-04', optimizations: [{}, {}] }],
    impls: [{ client_id: 'c1', verification_status: 'verified', implemented_at: '2026-08-05' }]
  }, 'c1', '2026-08');
  assertEq(w.content.count, 1); assertEq(w.technical.done, 1); assertEq(w.aeo.optimizations, 2); assertEq(w.implementations.verified, 1);
});

await t('figures are checked in code — the real Krost email (the AI got two of these wrong)', async () => {
  const { checkFigures, dataNumbers, notableChanges } = await import('../netlify/functions/lib/reportScan.js');
  const data = {
    traffic: { current: { users: 541, sessions: 700, conversions: 0, revenue: 0 }, previous: { users: 603, sessions: 777, conversions: 4, revenue: 0 },
      momChange: { users: -10.3, sessions: -9.9, conversions: -100, revenue: 0 } },
    keywords: [{ query: 'gondola shelving', position: 4.2, clicks: 12, impressions: 76000 }, { query: 'racking prices', position: 6, clicks: 17, impressions: 808 }],
    topPages: [{ page: 'https://k/', clicks: 168 }, { page: 'https://k/racking-prices/', clicks: 17 }, { page: 'https://k/gondola/', clicks: 12 }]
  };
  const form = { gscClicksThis: '177', gscImpressionsThis: '76808', gscCtrThis: '0.2%' };
  const email = 'the racking prices guide and gondola shelving cost page, combining for 29 clicks. 76,800 impressions. Organic users came in at 541 against 603 last month, down 10%. Expect movement over 60 to 90 days. We published 4 articles in 2026. Users grew 35%.';
  const f = checkFigures(email, dataNumbers(data, form));
  for (const ok of ['29', '76,800', '541', '603', '10%']) if (!f.verified.includes(ok)) throw new Error(ok + ' should verify; got ' + JSON.stringify(f));
  if (!f.unmatched.includes('35%')) throw new Error('an invented percentage must be unmatched');
  if (f.verified.includes('2026') || f.unmatched.includes('2026')) throw new Error('years are ignored');
  if (!notableChanges(data).some(n => /conversions fell to zero/.test(n))) throw new Error('conversions to zero must be notable');
});

console.log(`\nreportScan: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
