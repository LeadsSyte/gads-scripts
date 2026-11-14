// Tech Autopilot run for ONE client (background function, ~15 min).
// POST { clientId, restart? } with header X-Suite-Auth (same gate as the
// content Autopilot). See lib/techScan.js. Writes the confirmed fixes to the
// Technical SEO task board. Then either emails the summary, or — when the
// client has publishing_profile.techfix_auto on — hands over to
// techfix-background, which applies the safe fixes and emails what it did.

import { runTechScan, newTechState, realCrawl } from './lib/techScan.js';
import { claudeCompleteServer, openaiJson } from './lib/serverAi.js';
import { getServerSupabase } from './lib/serverSupabase.js';
import { installServerAuthGlobals, authorize, fromEvent } from './lib/requireAuth.js';
import { fetchGscPages } from './lib/serverGsc.js';
import { loadClient } from './lib/autopilotStore.js';
import { loadTechHistory, replaceOpenTasks, loadTechState, saveTechState, fetchLiveHtml, fetchPlainText } from './lib/techStore.js';
import { emailTechSummary, startAutoFixes } from './lib/runNotify.js';
import { autoSendToBot } from './lib/grokQueue.js';
import { loadTechFixes } from './lib/techStore.js';
import { hasWordPress } from './lib/wpClient.js';
import { hasShopify } from './lib/shopifyClient.js';
import { getPublishingProfile } from '../../src/modules/cms/publishingProfile.js';

const BUDGET_MS = 14 * 60 * 1000;
const MAX_HOPS = 6;
const STALE_MS = 20 * 60 * 1000;
const CRAWL_PAGES = 100;

export async function handler(event) {
  const auth = await authorize(fromEvent(event));
  if (!auth.ok) { console.error('[techscan-run-background] unauthorized call'); return { statusCode: auth.status }; }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
  const { clientId, restart = false, hop = 0 } = body;
  if (!clientId) return { statusCode: 400 };

  const started = Date.now();
  const supabase = getServerSupabase();
  const base = (process.env.URL || 'https://syte-seo-suite.netlify.app').replace(/\/+$/, '');
  globalThis.__SYTE_FN_BASE = base; // the crawler calls page-proxy by URL
  installServerAuthGlobals();
  let state = null;
  let client = null;
  try {
    client = await loadClient(supabase, clientId);
    state = await loadTechState(supabase, clientId);
    const running = state && ['queued', 'scanning', 'triaging', 'checking', 'saving'].includes(state.status);
    const fresh = state && Date.now() - new Date(state.updated_at).getTime() < STALE_MS;
    if (hop === 0 && running && fresh) return { statusCode: 202 };
    if (hop === 0 || !state) state = newTechState(client);
    state.hops = hop;
    await saveTechState(supabase, state);

    const { more } = await runTechScan(client, state, {
      crawl: realCrawl(CRAWL_PAGES),
      gscPages: c => fetchGscPages(supabase, c),
      complete: claudeCompleteServer,
      checkTask: ({ system, user }) => openaiJson({ system, user, max_tokens: 400 }),
      fetchHtml: fetchLiveHtml,
      fetchText: fetchPlainText,
      loadHistory: c => loadTechHistory(supabase, c),
      saveTasks: (c, tasks) => replaceOpenTasks(supabase, c, tasks),
      saveState: s => saveTechState(supabase, s),
      timeLeftMs: () => BUDGET_MS - (Date.now() - started)
    });

    if (more) {
      if (hop + 1 > MAX_HOPS) throw new Error('Stopped after ' + MAX_HOPS + ' continuations');
      await fetch(base + '/.netlify/functions/techscan-run-background', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': required },
        body: JSON.stringify({ clientId, hop: hop + 1 })
      });
    } else {
      const auto = state.status === 'done' && getPublishingProfile(client).techfix_auto;
      if (!auto || !(await startAutoFixes('techfix-background', clientId, base, required))) {
        // No automatic suite fixes: what the suite can't do goes to the Grok bot now
        // (techgrok_auto); with them, techfix-background does this when it finishes.
        if (await autoSendToBot(supabase, client, 'tech', state, { getPublishingProfile, loadFixes: loadTechFixes, hasSite: c => hasWordPress(c) || hasShopify(c) })) await saveTechState(supabase, state).catch(() => {});
        await emailTechSummary(supabase, client, state, base);
      }
    }
  } catch (e) {
    console.error('[techscan] failed:', e.message);
    if (state) {
      state.status = 'failed';
      state.error = String(e.message || e).slice(0, 400);
      state.updated_at = new Date().toISOString();
      try { await saveTechState(supabase, state); } catch { /* nothing more */ }
      await emailTechSummary(supabase, client || { id: clientId, name: state.client_name || 'Client' }, state, base);
    }
  }
  return { statusCode: 202 };
}
