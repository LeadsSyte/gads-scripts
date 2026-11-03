// Report Autopilot run for ONE client (background function).
// POST { clientId, month?, force? } with X-Suite-Auth. See lib/reportScan.js.
// Builds the month's SEO report (default: last month) and emails the report
// address that it's ready to review. Nothing is sent to the client.

import { authorize, fromEvent } from './lib/requireAuth.js';
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
  const auth = await authorize(fromEvent(event));
  if (!auth.ok) { console.error('[report-run-background] unauthorized call'); return { statusCode: auth.status }; }
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
