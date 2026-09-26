// Report Autopilot run for ONE client (background function).
// POST { clientId, month?, force? } with X-Suite-Auth. See lib/reportScan.js.
// Builds the month's SEO report (default: last month) and emails the report
// address that it's ready to review. Nothing is sent to the client.

import { runReportScan, newReportState, reportMonthFor } from './lib/reportScan.js';
import { claudeCompleteServer, openaiJson } from './lib/serverAi.js';
import { getServerSupabase } from './lib/serverSupabase.js';
import { loadClient } from './lib/autopilotStore.js';
import { installServerGoogleFetch, loadWork, loadExistingReport, saveGeneratedReport, saveReportCache, loadReportState, saveReportState } from './lib/reportStore.js';
import { reportRecipients, sendReport, buildReportReadyEmail } from './lib/reportEmail.js';
import { signedUrl } from './lib/previewSig.js';
import { fetchReportData } from '../../src/modules/reports/reportData.js';

const STALE_MS = 20 * 60 * 1000;

export async function handler(event) {
  const required = process.env.WP_PROXY_AUTH;
  const given = event.headers['x-suite-auth'] || event.headers['X-Suite-Auth'] || '';
  if (!required || given !== required) { console.error('[report] unauthorized call'); return { statusCode: 401 }; }
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
  const { clientId, force = false } = body;
  const month = /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : reportMonthFor();
  if (!clientId) return { statusCode: 400 };

  const supabase = getServerSupabase();
  const base = (process.env.URL || 'https://syte-seo-suite.netlify.app').replace(/\/+$/, '');
  installServerGoogleFetch(supabase);
  let state = null;
  let client = null;
  try {
    client = await loadClient(supabase, clientId);
    const prev = await loadReportState(supabase, clientId);
    const running = prev && ['queued', 'fetching', 'writing', 'checking'].includes(prev.status);
    if (running && Date.now() - new Date(prev.updated_at).getTime() < STALE_MS) return { statusCode: 202 };
    state = newReportState(client, month);
    await saveReportState(supabase, state);

    await runReportScan(client, state, {
      fetchData: (c, y, m) => fetchReportData(c, y, m),
      loadWork: c => loadWork(supabase, c),
      loadExisting: (c, m) => loadExistingReport(supabase, c, m),
      complete: claudeCompleteServer,
      checkReport: ({ system, user }) => openaiJson({ system, user, max_tokens: 900 }),
      saveGenerated: row => saveGeneratedReport(supabase, row),
      saveCache: (c, m, d) => saveReportCache(supabase, c, m, d),
      saveState: s => saveReportState(supabase, s)
    }, { force });
  } catch (e) {
    console.error('[report] failed:', e.message);
    if (state) {
      state.status = 'failed';
      state.error = String(e.message || e).slice(0, 400);
      state.updated_at = new Date().toISOString();
      try { await saveReportState(supabase, state); } catch { /* nothing more */ }
    }
  }
  if (state && state.status !== 'skipped') {
    try {
      const to = await reportRecipients(supabase);
      if (to.length) {
        const viewUrl = state.status === 'done' ? signedUrl('report-view', 'r', clientId + '-' + month) : '';
        await sendReport({ to, ...buildReportReadyEmail(client || { name: state.client_name }, state, base, viewUrl) });
        state.report = { sent_at: new Date().toISOString(), to };
      }
    } catch (e) {
      state.report = { error: String(e.message || e).slice(0, 200) };
    }
    try { await saveReportState(supabase, state); } catch { /* best effort */ }
  }
  return { statusCode: 202 };
}
