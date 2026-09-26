// AEO Autopilot run for ONE client (background function, ~15 min).
// POST { clientId, restart? } with X-Suite-Auth. See lib/aeoScan.js.
// Saves the checked optimisations to the AEO Engine and emails the report
// address a summary. Nothing is changed on the client's site.

import { runAeoScan, newAeoState } from './lib/aeoScan.js';
import { installDomParser } from './lib/techScan.js';
import { claudeCompleteServer, openaiJson } from './lib/serverAi.js';
import { getServerSupabase } from './lib/serverSupabase.js';
import { fetchGscPages } from './lib/serverGsc.js';
import { loadClient } from './lib/autopilotStore.js';
import { fetchLiveHtml } from './lib/techStore.js';
import { loadAeoPrior, saveAeoRow, loadAeoState, saveAeoState, trafficFromGsc } from './lib/aeoStore.js';
import { reportRecipients, sendReport, buildAeoSummaryEmail } from './lib/reportEmail.js';
import { discoverSiteUrls } from '../../src/modules/aeo/sitemap.js';

const BUDGET_MS = 14 * 60 * 1000;
const MAX_HOPS = 6;
const STALE_MS = 20 * 60 * 1000;

export async function handler(event) {
  const required = process.env.WP_PROXY_AUTH;
  const given = event.headers['x-suite-auth'] || event.headers['X-Suite-Auth'] || '';
  if (!required || given !== required) { console.error('[aeoscan] unauthorized call'); return { statusCode: 401 }; }
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
  const { clientId, hop = 0 } = body;
  if (!clientId) return { statusCode: 400 };

  const started = Date.now();
  const supabase = getServerSupabase();
  const base = (process.env.URL || 'https://syte-seo-suite.netlify.app').replace(/\/+$/, '');
  globalThis.__SYTE_FN_BASE = base; // sitemap discovery calls page-proxy by URL
  installDomParser();
  let state = null;
  let client = null;
  try {
    client = await loadClient(supabase, clientId);
    state = await loadAeoState(supabase, clientId);
    const running = state && ['queued', 'discovering', 'generating', 'checking', 'saving'].includes(state.status);
    const fresh = state && Date.now() - new Date(state.updated_at).getTime() < STALE_MS;
    if (hop === 0 && running && fresh) return { statusCode: 202 };
    if (hop === 0 || !state) state = newAeoState(client);
    state.hops = hop;
    state.error = null;
    await saveAeoState(supabase, state);

    const { more } = await runAeoScan(client, state, {
      discover: c => discoverSiteUrls(c, { maxPages: 500 }),
      trafficRows: async c => trafficFromGsc(await fetchGscPages(supabase, c)),
      loadPrior: c => loadAeoPrior(supabase, c),
      complete: claudeCompleteServer,
      fetchHtml: fetchLiveHtml,
      checkOpt: ({ system, user }) => openaiJson({ system, user, max_tokens: 400 }),
      saveRow: (row, existing) => saveAeoRow(supabase, row, existing),
      saveState: s => saveAeoState(supabase, s),
      timeLeftMs: () => BUDGET_MS - (Date.now() - started)
    });

    if (more) {
      if (hop + 1 > MAX_HOPS) throw new Error('Stopped after ' + MAX_HOPS + ' continuations');
      await fetch(base + '/.netlify/functions/aeoscan-run-background', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': required },
        body: JSON.stringify({ clientId, hop: hop + 1 })
      });
    } else {
      await emailSummary(supabase, client, state, base);
    }
  } catch (e) {
    console.error('[aeoscan] failed:', e.message);
    if (state) {
      state.status = 'failed';
      state.error = String(e.message || e).slice(0, 400);
      state.updated_at = new Date().toISOString();
      try { await saveAeoState(supabase, state); } catch { /* nothing more */ }
      await emailSummary(supabase, client || { id: clientId, name: state.client_name || 'Client' }, state, base);
    }
  }
  return { statusCode: 202 };
}

async function emailSummary(supabase, client, state, base) {
  try {
    const to = await reportRecipients(supabase);
    if (!to.length) return;
    await sendReport({ to, ...buildAeoSummaryEmail(client, state, base) });
    state.report = { sent_at: new Date().toISOString(), to };
  } catch (e) {
    state.report = { error: String(e.message || e).slice(0, 200) };
  }
  try { await saveAeoState(supabase, state); } catch { /* best effort */ }
}
