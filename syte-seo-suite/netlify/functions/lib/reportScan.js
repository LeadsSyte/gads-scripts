// Report Autopilot — the monthly SEO report, built on the server:
//
//   GA4 + Search Console data for the month (same fetcher as the Monthly
//   Report page) → Search Console gate → the same Alice email + microsite +
//   QA (src/modules/reports/reportGenerate.js) → an INDEPENDENT accuracy
//   check (a different AI compares every figure in the email and report with
//   the real data) → saved as the month's generated report, ready for Chris
//   to review and send. Nothing is sent to the client.
//
// Every outside call is injected (`deps`), so it's testable.

import { fetchReportData } from '../../../src/modules/reports/reportData.js';
import { formFromReportData, generateSeoReport } from '../../../src/modules/reports/reportGenerate.js';
import { workSummaryFrom } from '../../../src/modules/reports/reportPrompts.js';
import { evaluateGscReadiness } from '../../../src/modules/reports/gscGuard.js';
import { REPORT_DATA_VERSION } from '../../../src/modules/reports/reportDataVersion.js';
import { previousMonthKey, monthKeyLabel } from '../../../src/modules/reports/reportMonths.js';

export const REPORT_STATE_PREFIX = 'reportscan:';

// The month a run reports on: the previous calendar month.
export function reportMonthFor(now = new Date()) {
  return previousMonthKey(now);
}

export function newReportState(client, month, now = new Date()) {
  return { client_id: client.id, client_name: client.name, month, status: 'queued', started_at: now.toISOString(), updated_at: now.toISOString(), log: [] };
}
function log(state, line, now) {
  state.log = [...(state.log || []), (now || new Date()).toISOString().slice(11, 19) + ' ' + line].slice(-30);
}

export const REPORT_CHECK_SYSTEM = `You are an independent reviewer at an SEO agency. Another AI wrote a client's monthly SEO report email and report page from the DATA below. Before an account manager sends it to the client, check that it is accurate.

Return JSON only: {"verdict": "accurate" | "issues", "issues": [{"severity": "error" | "warning", "issue": "one sentence, quoting the wrong statement and the correct figure"}], "summary": "one sentence"}

ERROR (verdict "issues"):
- any number, percentage or direction (up/down) that contradicts the DATA — e.g. "traffic grew 20%" when users fell, or a keyword position that isn't in the data;
- a claim about work done that the WORK DONE section doesn't support;
- the wrong client name or the wrong month;
- figures presented as facts that appear nowhere in the data (invented statistics).
WARNING: rounding that changes the meaning, vague or misleading comparisons, a missing obvious headline (e.g. a large drop not mentioned).
Rounding within normal reporting (e.g. 1,234 → "about 1,200", 12.4% → "12%") is fine. Judge only against the DATA.`;

export function buildReportCheckInput({ client, month, data, form, work, email, micro }) {
  const facts = {
    client: client.name, month: monthKeyLabel(month),
    organic_users: { this_month: data.traffic?.current?.users ?? null, last_month: data.traffic?.previous?.users ?? null, same_month_last_year: data.traffic?.yoy?.users ?? null },
    organic_sessions: { this_month: data.traffic?.current?.sessions ?? null, last_month: data.traffic?.previous?.sessions ?? null },
    conversions: { this_month: data.traffic?.current?.conversions ?? null, last_month: data.traffic?.previous?.conversions ?? null },
    revenue: { this_month: data.traffic?.current?.revenue ?? null, last_month: data.traffic?.previous?.revenue ?? null },
    change_vs_last_month_pct: data.traffic?.momChange || null,
    change_vs_last_year_pct: data.traffic?.yoyChange || null,
    search_console: { clicks: form.gscClicksThis || null, impressions: form.gscImpressionsThis || null, ctr: form.gscCtrThis || null },
    top_keywords: (data.keywords || []).slice(0, 25).map(k => ({ query: k.query, position: k.position, previous_position: k.prevPosition, clicks: k.clicks })),
    top_pages: (data.topPages || []).slice(0, 10)
  };
  return `DATA (authoritative):
${JSON.stringify(facts, null, 2)}

WORK DONE THIS MONTH (from the agency's records):
${JSON.stringify(work, null, 2)}

EMAIL TO CHECK:
Subject: ${email.subject || ''}
${email.body || ''}

REPORT PAGE CONTENT TO CHECK (JSON):
${JSON.stringify(micro).slice(0, 12000)}`;
}

export function normalizeReportCheck(raw) {
  const issues = Array.isArray(raw?.issues) ? raw.issues.filter(i => i?.issue)
    .map(i => ({ severity: i.severity === 'error' ? 'error' : 'warning', issue: String(i.issue).slice(0, 400) })) : [];
  const verdict = raw?.verdict === 'accurate' && !issues.some(i => i.severity === 'error') ? 'accurate' : 'issues';
  return { verdict, issues, summary: String(raw?.summary || '').slice(0, 300) };
}

// deps:
//   fetchData(client, year, month1Based) → report data (fetchReportData-shaped)
//   loadWork(client)            → { articles, tasks, aeoResults, impls }
//   loadExisting(client, month) → the month's generated SEO report row | null
//   complete(opts)              Claude
//   checkReport({system, user}) → raw reviewer JSON (independent AI)
//   saveGenerated(row), saveCache(client, month, data), saveState(state), now()
export async function runReportScan(client, state, deps, { force = false } = {}) {
  const now = () => (deps.now ? deps.now() : new Date());
  const save = async () => { state.updated_at = now().toISOString(); await deps.saveState(state); };
  const month = state.month;

  const existing = await deps.loadExisting(client, month);
  if (existing && !force) {
    state.status = 'skipped';
    state.note = 'A report for ' + monthKeyLabel(month) + ' already exists — not overwritten. Use "Run again" to replace it.';
    log(state, state.note, now());
    await save();
    return state;
  }

  state.status = 'fetching';
  log(state, 'Pulling GA4 + Search Console for ' + monthKeyLabel(month), now());
  await save();
  const [year, mo] = month.split('-').map(Number);
  const data = await deps.fetchData(client, year, mo);
  Object.assign(data, {
    version: REPORT_DATA_VERSION, ga4_property_id: client.ga4_property_id || null, gsc_property: client.gsc_property || null,
    ga4_account_email: client.ga4_account_email || client.google_account_email || null,
    gsc_account_email: client.gsc_account_email || client.google_account_email || null
  });
  try { await deps.saveCache(client, month, data); } catch { /* cache is optional */ }
  state.data_errors = data.errors || [];

  // Same hard gate as the page: never build an SEO report on a broken
  // Search Console feed — every keyword table and click figure comes from it.
  const gate = evaluateGscReadiness({ client, reportData: data, month, token: null, serverAuth: true });
  if (!gate.ok) {
    state.status = 'blocked';
    state.error = 'Search Console check failed: ' + (gate.blocker?.message || 'no data');
    log(state, state.error, now());
    await save();
    return state;
  }

  state.status = 'writing';
  log(state, 'Writing the email and report', now());
  await save();
  const form = formFromReportData(data);
  const work = workSummaryFrom(await deps.loadWork(client), client.id, month);
  const gen = await generateSeoReport({ client, form, workSummary: work, monthLabel: monthKeyLabel(month), complete: deps.complete });

  state.status = 'checking';
  log(state, 'Checking every figure against the data', now());
  await save();
  let check;
  try {
    check = normalizeReportCheck(await deps.checkReport({ system: REPORT_CHECK_SYSTEM, user: buildReportCheckInput({ client, month, data, form, work, email: gen.email, micro: gen.micro }) }));
  } catch (e) {
    check = { verdict: 'issues', issues: [{ severity: 'warning', issue: 'The accuracy check could not run: ' + String(e.message || e).slice(0, 200) }], summary: '' };
  }

  await deps.saveGenerated({
    client_id: client.id, month, report_type: 'seo',
    qa_score: gen.qa?.overallScore || null,
    email_subject: gen.email.subject || '',
    email_body: gen.email.body || gen.aliceText,
    microsite_json: gen.micro,
    // The independent check rides on the qa blob (no schema change needed).
    qa: { ...(gen.qa || {}), independent_check: check, generated_by: 'Report Autopilot' },
    report_data: data
  });
  state.status = 'done';
  state.qa_score = gen.qa?.overallScore || null;
  state.check = check;
  state.email_subject = gen.email.subject || '';
  state.email_body = gen.email.body || '';
  state.finished_at = now().toISOString();
  log(state, 'Report ready for review', now());
  await save();
  return state;
}
