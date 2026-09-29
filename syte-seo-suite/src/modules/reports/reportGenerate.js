// The monthly reports' generation steps, shared by the Monthly Report page
// (browser) and the server-side Report Autopilots
// (netlify/functions/lib/reportScan.js and aeoReportScan.js), so both write
// the same report:
//   SEO: report data → form fields → Alice email → microsite JSON → QA
//   AEO: snapshot (+ last month's) → Alice email → microsite JSON → QA
// `complete` is the Claude call (the server passes its own).

import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { ALICE_SEO_SYSTEM, MICROSITE_SEO_SYSTEM, QA_SEO_SYSTEM, buildAlicePayload,
  ALICE_AEO_SYSTEM, MICROSITE_AEO_SYSTEM, QA_AEO_SYSTEM, buildAeoPayload } from './reportPrompts.js';
import { compareSnapshots, rankBrandWithCompetitors } from './aeoCompare.js';
import { sanitizeEmail } from './sanitize.js';

export const REPORT_MODEL = 'claude-sonnet-4-6';

export function parseAliceOutput(text) {
  if (!text) return { subject: '', body: '' };
  const lines = text.split('\n');
  let subject = '';
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^SUBJECT:\s*(.+)/i);
    if (m) { subject = m[1].trim(); continue; }
    if (lines[i].trim() === '---') { bodyStart = i + 1; break; }
  }
  const body = lines.slice(bodyStart).join('\n').trim();
  return { subject, body: body || text };
}

// The Alice/microsite prompt reads form fields, not the report data — this
// is the mapping the Monthly Report page applies after a data pull.
export function formFromReportData(data) {
  const form = {};
  if (data?.traffic?.current) {
    const t = data.traffic;
    Object.assign(form, {
      seoOrganicThis: String(t.current.users),
      seoOrganicLast: String(t.previous?.users || ''),
      seoUsersYoy: String(t.yoy?.users || ''),
      seoConvThis: String(t.current.conversions),
      seoConvLast: String(t.previous?.conversions || ''),
      seoSessThis: String(t.current.sessions),
      seoSessLast: String(t.previous?.sessions || ''),
      seoRevenueThis: String(t.current.revenue || ''),
      seoRevenueLast: String(t.previous?.revenue || '')
    });
  }
  if (data?.keywords?.length > 0) {
    // Search Console totals, derived from the same query rows the report
    // tables render. Alice needs these for the click narrative and the
    // PPC equivalent estimate, which otherwise both read as "—".
    const gscClicks = data.keywords.reduce((a, k) => a + (Number(k.clicks) || 0), 0);
    const gscImpr = data.keywords.reduce((a, k) => a + (Number(k.impressions) || 0), 0);
    Object.assign(form, {
      gscClicksThis: String(gscClicks),
      gscImpressionsThis: String(gscImpr),
      gscCtrThis: gscImpr > 0 ? ((gscClicks / gscImpr) * 100).toFixed(1) + '%' : '',
      topQueries: data.keywords.slice(0, 10).map(k =>
        k.query + ' — pos ' + k.position + (k.change != null ? ' (' + (k.change > 0 ? '+' : '') + k.change + ')' : '') + ', ' + k.clicks + ' clicks'
      ).join('\n')
    });
  }
  if (data?.topPages?.length > 0) {
    form.topPages = data.topPages.slice(0, 10).map(p => {
      let path = p.page;
      try { path = new URL(p.page).pathname; } catch {}
      return path + ' — ' + p.clicks + ' clicks';
    }).join('\n');
  }
  return form;
}

// Build the SEO report. onPhase('alice' | 'micro' | 'qa') for progress.
// Returns { payload, aliceText, email, micro, qa }. QA is advisory: a failed
// QA call leaves qa null rather than losing the report.
export async function generateSeoReport({ client, form, workSummary, monthLabel, algorithmContext = '', complete = claudeComplete, onPhase }) {
  const payload = buildAlicePayload({
    clientName: client.name,
    industry: client.industry || '',
    goals: client.context,
    startDate: client.start_date,
    month: monthLabel,
    algorithmContext,
    ...form,
    // Scope is fixed: this produces the SEO deliverable, nothing else.
    hasSeo: true,
    hasAeo: false,
    seoOnly: true
  }, null, workSummary);

  onPhase?.('alice');
  const aliceText = await complete({
    system: ALICE_SEO_SYSTEM, messages: [{ role: 'user', content: payload }],
    model: REPORT_MODEL, max_tokens: 1000, temperature: 0.7
  });
  const email = sanitizeEmail(parseAliceOutput(aliceText));

  onPhase?.('micro');
  const micrositeText = await complete({
    system: MICROSITE_SEO_SYSTEM, messages: [{ role: 'user', content: payload }],
    model: REPORT_MODEL, max_tokens: 4000, temperature: 0.5
  });
  const micro = extractJSON(micrositeText);
  if (!micro) {
    console.error('[Report] Microsite raw output:', micrositeText);
    throw new Error('Microsite JSON could not be parsed from model output — usually truncated output or stray prose around the JSON.');
  }
  if (!micro.clientName) micro.clientName = client.name;

  onPhase?.('qa');
  let qa = null;
  try {
    const qaText = await complete({
      system: QA_SEO_SYSTEM, messages: [{ role: 'user', content: 'Alice email to review:\n\n' + aliceText }],
      model: REPORT_MODEL, max_tokens: 500, temperature: 0
    });
    qa = extractJSON(qaText);
  } catch (e) {
    console.warn('[Report] SEO QA pass failed, keeping the report:', e.message);
  }
  return { payload, aliceText, email, micro, qa };
}

// Build the AEO report from a snapshot (runSnapshot's result) and, when there
// is one, the previous month's. onPhase('alice' | 'micro' | 'qa').
// Returns { payload, aliceText, email, micro, qa, compare, ranking, brandRank }.
export async function generateAeoReport({ client, probe, previousSnap = null, monthLabel, previousMonthLabel = null, complete = claudeComplete, onPhase }) {
  const compare = compareSnapshots(probe, previousSnap);
  const ranking = rankBrandWithCompetitors(probe, client.name);
  const brandRank = ranking.findIndex(r => r.isBrand) + 1;
  const payload = buildAeoPayload({
    client, monthLabel, previousMonthLabel: previousSnap ? previousMonthLabel : null,
    probe, compare, ranking, brandRank
  });

  onPhase?.('alice');
  const aliceText = await complete({
    system: ALICE_AEO_SYSTEM, messages: [{ role: 'user', content: payload }],
    model: REPORT_MODEL, max_tokens: 1200, temperature: 0.7
  });
  const email = sanitizeEmail(parseAliceOutput(aliceText));

  onPhase?.('micro');
  const micrositeText = await complete({
    system: MICROSITE_AEO_SYSTEM, messages: [{ role: 'user', content: payload }],
    // The AEO microsite JSON has narratives, highlights and work items that
    // truncate mid-JSON at lower limits, which then fails extractJSON.
    model: REPORT_MODEL, max_tokens: 4000, temperature: 0.5
  });
  const micro = extractJSON(micrositeText);
  if (!micro) {
    console.error('[Report] Microsite (AEO) raw output:', micrositeText);
    throw new Error('Microsite JSON could not be parsed. Raw output logged to console — usually means truncated output (raise max_tokens) or model wrapped JSON in stray prose.');
  }
  if (!micro.clientName) micro.clientName = client.name;

  // Advisory only — the report exists at this point, so a failed QA call
  // must not lose it.
  onPhase?.('qa');
  let qa = null;
  try {
    const qaText = await complete({
      system: QA_AEO_SYSTEM, messages: [{ role: 'user', content: 'Alice email to review:\n\n' + aliceText }],
      model: REPORT_MODEL, max_tokens: 500, temperature: 0
    });
    qa = extractJSON(qaText);
  } catch (e) {
    console.warn('[Report] AEO QA pass failed, keeping the report:', e.message);
  }
  return { payload, aliceText, email, micro, qa, compare, ranking, brandRank };
}
