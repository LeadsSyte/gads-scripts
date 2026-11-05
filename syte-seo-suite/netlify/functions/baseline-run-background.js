// Onboarding Baseline for ONE client (background function).
// POST { clientId, force?, trigger? } with X-Suite-Auth. See lib/baselineScan.js.
// Started automatically when a client is added (ClientModal), or from the
// Reports → Baseline page. Captures where the client stands today — search
// traffic + rankings, technical health, AI-engine visibility — and saves it
// against the client. No opportunity hunting, no tasks, no emails.

import { runBaselineScan, newBaselineState, BASELINE_ACTIVE, BASELINE_CRAWL_PAGES } from './lib/baselineScan.js';
import { realCrawl } from './lib/techScan.js';
import { getServerSupabase } from './lib/serverSupabase.js';
import { installServerAuthGlobals, internalHeaders, authorize, fromEvent } from './lib/requireAuth.js';
import { loadClient } from './lib/autopilotStore.js';
import { installServerGoogleFetch } from './lib/reportStore.js';
import { serverEngines, serverExtract, groundClientServer, saveClientProbes } from './lib/aeoReportStore.js';
import { loadBaselineRow, saveBaselineRow, loadBaselineState, saveBaselineState } from './lib/baselineStore.js';
import { fetchReportData } from '../../src/modules/reports/reportData.js';

const BUDGET_MS = 13.5 * 60 * 1000;
const MAX_HOPS = 6;
const STALE_MS = 20 * 60 * 1000;

export async function handler(event) {
  const auth = await authorize(fromEvent(event));
  if (!auth.ok) { console.error('[baseline-run-background] unauthorized call'); return { statusCode: auth.status }; }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
  const { clientId, force = false, hop = 0 } = body;
  const trigger = body.trigger === 'manual' ? 'manual' : 'auto';
  if (!clientId) return { statusCode: 400 };

  const started = Date.now();
  const supabase = getServerSupabase();
  const base = (process.env.URL || 'https://syte-seo-suite.netlify.app').replace(/\/+$/, '');
  globalThis.__SYTE_FN_BASE = base; // the crawler + prompt builder call page-proxy by URL
  installServerAuthGlobals();
  installServerGoogleFetch(supabase);
  let state = null;
  try {
    const client = await loadClient(supabase, clientId);
    const prev = await loadBaselineState(supabase, clientId);
    if (hop === 0) {
      const running = prev && BASELINE_ACTIVE.includes(prev.status);
      if (running && Date.now() - new Date(prev.updated_at).getTime() < STALE_MS) return { statusCode: 202 };
      state = newBaselineState(client, new Date(), { force, trigger });
    } else {
      if (!prev || !BASELINE_ACTIVE.includes(prev.status)) return { statusCode: 202 };
      state = prev;
    }
    state.hops = hop;
    await saveBaselineState(supabase, state);

    const { more } = await runBaselineScan(client, state, {
      loadBaseline: c => loadBaselineRow(supabase, c.id),
      fetchData: fetchReportData,
      crawl: realCrawl(BASELINE_CRAWL_PAGES),
      groundClient: c => groundClientServer(supabase, c),
      saveClientProbes: c => saveClientProbes(supabase, c),
      engines: () => serverEngines(),
      extract: serverExtract,
      saveBaseline: (id, month, data) => saveBaselineRow(supabase, id, month, data),
      saveState: s => saveBaselineState(supabase, s),
      timeLeftMs: () => BUDGET_MS - (Date.now() - started)
    });

    if (more) {
      if (hop + 1 > MAX_HOPS) throw new Error('Stopped after ' + MAX_HOPS + ' continuations');
      await fetch(base + '/.netlify/functions/baseline-run-background', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders() },
        body: JSON.stringify({ clientId, hop: hop + 1 })
      });
    }
  } catch (e) {
    console.error('[baseline] failed:', e.message);
    if (state) {
      state.status = 'failed';
      state.error = String(e.message || e).slice(0, 400);
      state.updated_at = new Date().toISOString();
      try { await saveBaselineState(supabase, state); } catch { /* nothing more */ }
    }
  }
  return { statusCode: 202 };
}
