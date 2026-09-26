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

export const REPORT_CHECK_SYSTEM = `You are an independent reviewer at an SEO agency. Another AI wrote a client's monthly SEO report email and report page from the DATA below. Before an account manager sends it to the client, check that it is accurate and fair.

The figures have ALREADY been checked by code:
- NUMBERS VERIFIED BY CODE are correct (exact, normally rounded, or a simple sum of data values). NEVER flag them, whatever you think the arithmetic is.
- NUMBERS NOT FOUND IN THE DATA need your judgement: fine when they aren't data claims (e.g. "60 to 90 days", "four articles", "positions 1 to 3"), an ERROR when they're presented as this client's statistics.

Return JSON only: {"verdict": "accurate" | "issues", "issues": [{"severity": "error" | "warning", "issue": "one sentence, quoting the statement"}], "summary": "one sentence"}

ERROR: an unverified number presented as a statistic; a direction that contradicts the DATA (e.g. "traffic grew" when users fell); a claim about work done that WORK DONE doesn't support; the wrong client or month.
WARNING: a change listed under NOTABLE CHANGES that the email doesn't mention or honestly reflect (e.g. conversions dropping to zero, a large fall called "modest"); misleading comparisons.
Rounding (76,808 → "76,800", 12.4% → "12%") is always fine.`;

// ---------------------------------------------------------------------------
// Figure checking in code: every number in the text must match a data value,
// allowing normal rounding and sums of up to two values (e.g. two pages'
// clicks combined). An AI doing this from memory flagged correct figures
// (76,800 vs 76,808; 17 + 12 = 29) as errors in the first live run.
// ---------------------------------------------------------------------------
export function dataNumbers(data, form) {
  const vals = [];
  const add = v => { const n = Number(v); if (Number.isFinite(n)) vals.push(n); };
  const t = data?.traffic || {};
  for (const p of [t.current, t.previous, t.yoy]) if (p) Object.values(p).forEach(add);
  for (const c of [t.momChange, t.yoyChange]) if (c) Object.values(c).forEach(v => { add(v); add(Math.abs(v)); });
  ['gscClicksThis', 'gscImpressionsThis'].forEach(k => add(form?.[k]));
  add(String(form?.gscCtrThis || '').replace('%', ''));
  const kw = (data?.keywords || []).slice(0, 50);
  kw.forEach(k => { add(k.position); add(k.prevPosition); add(k.clicks); add(k.impressions); add(k.change); add(Math.abs(k.change || 0)); });
  const pages = (data?.topPages || []).slice(0, 20);
  pages.forEach(p => { add(p.clicks); add(p.impressions); add(p.position); });
  // Pairwise sums of page / keyword clicks ("these two pages combined for 29 clicks").
  const clicks = [...pages.map(p => p.clicks), ...kw.slice(0, 20).map(k => k.clicks)].filter(n => n > 0);
  for (let i = 0; i < clicks.length; i++) for (let j = i + 1; j < clicks.length; j++) vals.push(clicks[i] + clicks[j]);
  // Differences between this and last month (e.g. "62 fewer users").
  if (t.current && t.previous) for (const k of Object.keys(t.current)) add(Math.abs((t.current[k] || 0) - (t.previous[k] || 0)));
  return vals;
}

function matches(stated, isPct, values) {
  const decimals = (String(stated).split('.')[1] || '').length;
  return values.some(v => {
    if (Math.abs(v - stated) < 1e-9) return true;
    if (isPct || decimals) return Math.abs(v - stated) <= (decimals ? 0.5 * Math.pow(10, -decimals) + 1e-9 : 0.5);
    // Whole numbers: allow rounding to the stated precision (76,800 ← 76,808).
    const zeros = (String(Math.round(stated)).match(/0+$/) || [''])[0].length;
    const unit = Math.pow(10, zeros);
    return unit > 1 && Math.round(v / unit) * unit === stated;
  });
}

// → { verified: ['1,200', '20%', …], unmatched: ['60', …] } for the email + report text.
export function checkFigures(text, values) {
  const verified = [], unmatched = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(/(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s*%|k\b)?/gi)) {
    const raw = m[0].trim();
    if (seen.has(raw)) continue;
    seen.add(raw);
    let n = Number(m[1].replace(/,/g, ''));
    if (/k/i.test(m[2] || '')) n *= 1000;
    if (n >= 1990 && n <= 2035 && !m[2]) continue;   // years
    if (n < 10 && !m[2] && !m[1].includes('.')) continue; // small counts / ordinals — left to the reviewer
    (matches(n, /%/.test(m[2] || ''), values) ? verified : unmatched).push(raw);
  }
  return { verified, unmatched };
}

// Changes big enough that the email must reflect them honestly.
export function notableChanges(data) {
  const out = [];
  const t = data?.traffic || {};
  const label = { users: 'organic users', sessions: 'organic sessions', conversions: 'conversions', revenue: 'revenue' };
  for (const [k, pct] of Object.entries(t.momChange || {})) {
    if (!label[k] || !t.previous?.[k]) continue;
    if ((t.current?.[k] || 0) === 0) out.push(label[k] + ' fell to zero this month (from ' + t.previous[k] + ')');
    else if (Math.abs(pct) >= 25) out.push(label[k] + ' ' + (pct > 0 ? 'up ' : 'down ') + Math.abs(pct) + '% vs last month');
  }
  return out;
}

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
  const text = (email.subject || '') + '\n' + (email.body || '') + '\n' + JSON.stringify(micro || {});
  const figures = checkFigures(text, dataNumbers(data, form));
  const notable = notableChanges(data);
  return `DATA (authoritative):
${JSON.stringify(facts, null, 2)}

NUMBERS VERIFIED BY CODE (correct — do not flag): ${figures.verified.join(', ') || '(none)'}
NUMBERS NOT FOUND IN THE DATA (judge these): ${figures.unmatched.join(', ') || '(none)'}
NOTABLE CHANGES (the email must reflect these honestly): ${notable.join('; ') || '(none)'}

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
