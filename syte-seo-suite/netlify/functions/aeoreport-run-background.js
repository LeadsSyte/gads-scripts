// AEO Report Autopilot run for ONE client (background function).
// POST { clientId, month?, force? } with X-Suite-Auth. See lib/aeoReportScan.js.
// Measures the client across ChatGPT, Claude and Gemini, builds the month's
// AEO report (default: last month) and emails the report address that it's
// ready to review. A full census takes several runs; this function calls
// itself until it's done. Nothing is sent to the client.

import { runAeoReportScan, newAeoReportState } from './lib/aeoReportScan.js';
import { reportMonthFor } from './lib/reportScan.js';
import { claudeCompleteServer, openaiJson } from './lib/serverAi.js';
import { getServerSupabase } from './lib/serverSupabase.js';
import { loadClient } from './lib/autopilotStore.js';
import {
  serverEngines, serverExtract, groundClientServer, saveClientProbes, loadExistingAeoReport, loadPreviousAeo,
  saveGeneratedAeoReport, persistRunsServer, saveSnapshotToHistory,
  loadAeoReportState, saveAeoReportState, loadAeoCarry, saveAeoCarry
} from './lib/aeoReportStore.js';
import { reportRecipients, sendReport, buildReportReadyEmail } from './lib/reportEmail.js';
import { signedUrl } from './lib/previewSig.js';

const BUDGET_MS = 13.5 * 60 * 1000;
const MAX_HOPS = 10;
const STALE_MS = 20 * 60 * 1000;
const ACTIVE = ['queued', 'preparing', 'probing', 'writing', 'checking'];

export async function handler(event) {
  const required = process.env.WP_PROXY_AUTH;
  const given = event.headers['x-suite-auth'] || event.headers['X-Suite-Auth'] || '';
  if (!required || given !== required) { console.error('[aeoreport] unauthorized call'); return { statusCode: 401 }; }
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
  const { clientId, force = false, hop = 0 } = body;
  const month = /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : reportMonthFor();
  if (!clientId) return { statusCode: 400 };

  const started = Date.now();
  const supabase = getServerSupabase();
  const base = (process.env.URL || 'https://syte-seo-suite.netlify.app').replace(/\/+$/, '');
  globalThis.__SYTE_FN_BASE = base; // the prompt-set builder reads the website through page-proxy
  let state = null;
  let client = null;
  let more = false;
  try {
    client = await loadClient(supabase, clientId);
    const prev = await loadAeoReportState(supabase, clientId);
    if (hop === 0) {
      const running = prev && ACTIVE.includes(prev.status);
      if (running && Date.now() - new Date(prev.updated_at).getTime() < STALE_MS) return { statusCode: 202 };
      // A census that stopped part-way (a crashed run) is picked up where it
      // stopped — the answers already collected were paid for.
      const resumable = prev && prev.month === month && ['probing', 'probed'].includes(prev.stage) && prev.status !== 'done';
      if (resumable) {
        state = { ...prev, error: null, log: [...(prev.log || []), new Date().toISOString().slice(11, 19) + ' Picking up where it stopped'].slice(-30) };
      } else {
        state = newAeoReportState(client, month);
        state.force = !!force;
      }
    } else {
      // A continued run carries on from the saved state, for the same month.
      if (!prev || prev.month !== month || !ACTIVE.includes(prev.status)) return { statusCode: 202 };
      state = prev;
    }
    state.hops = hop;
    await saveAeoReportState(supabase, state);

    ({ more } = await runAeoReportScan(client, state, {
      loadExisting: (c, m) => loadExistingAeoReport(supabase, c, m),
      loadPrevious: (c, m) => loadPreviousAeo(supabase, c, m),
      groundClient: c => groundClientServer(supabase, c),
      saveClientProbes: c => saveClientProbes(supabase, c),
      engines: () => serverEngines(),
      extract: serverExtract,
      loadCarry: c => loadAeoCarry(supabase, c.id),
      saveCarry: (c, data) => saveAeoCarry(supabase, c.id, data),
      persistRuns: (records, raws) => persistRunsServer(supabase, records, raws),
      saveSnapshot: snap => saveSnapshotToHistory(supabase, snap),
      complete: claudeCompleteServer,
      checkReport: ({ system, user }) => openaiJson({ system, user, max_tokens: 900 }),
      saveGenerated: row => saveGeneratedAeoReport(supabase, row),
      saveState: s => saveAeoReportState(supabase, s),
      timeLeftMs: () => BUDGET_MS - (Date.now() - started)
    }, { force: !!state.force }));

    if (more) {
      if (hop + 1 > MAX_HOPS) throw new Error('Stopped after ' + MAX_HOPS + ' continuations — the census is taking too long.');
      await fetch(base + '/.netlify/functions/aeoreport-run-background', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': required },
        body: JSON.stringify({ clientId, month, hop: hop + 1 })
      });
      return { statusCode: 202 };
    }
  } catch (e) {
    console.error('[aeoreport] failed:', e.message);
    if (state) {
      state.status = 'failed';
      state.error = String(e.message || e).slice(0, 400);
      state.updated_at = new Date().toISOString();
      try { await saveAeoReportState(supabase, state); } catch { /* nothing more */ }
    }
  }
  if (state && state.status !== 'skipped') {
    try {
      const to = await reportRecipients(supabase);
      if (to.length) {
        const viewUrl = state.status === 'done' ? signedUrl('report-view', 'e', clientId + '-' + month) : '';
        await sendReport({ to, ...buildReportReadyEmail(client || { name: state.client_name }, state, base, viewUrl, { kind: 'aeo' }) });
        state.report = { sent_at: new Date().toISOString(), to };
      }
    } catch (e) {
      state.report = { error: String(e.message || e).slice(0, 200) };
    }
    try { await saveAeoReportState(supabase, state); } catch { /* best effort */ }
  }
  return { statusCode: 202 };
}
