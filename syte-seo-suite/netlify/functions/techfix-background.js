// Tech Autopilot fixes on a client's WordPress site.
// POST with X-Suite-Auth:
//   { clientId, taskId, action: 'plan' | 'apply' | 'undo' }   one fix
//   { clientId, action: 'auto_all' }                          every fix the
//       suite can apply itself, then the summary email. Called by the scan
//       when the client has "apply automatically" on, and by "Apply all" in
//       the panel.
// Background function: each fix's result is written to its own row,
// syte_suite_settings 'techfix:<clientId>:<taskId>', which the panel polls.
// (One row per fix: several previews run at once, and writing into the
// shared scan state made them overwrite each other.) See lib/techFixRun.js.

import { getServerSupabase } from './lib/serverSupabase.js';
import { loadClient } from './lib/autopilotStore.js';
import { loadTechState, saveTechState, fetchLiveHtml, loadTechFixes, saveTechFix, techFixRowId } from './lib/techStore.js';
import { runTechFix, runAllTechFixes } from './lib/techFixRun.js';
import { wpClient, hasWordPress } from './lib/wpClient.js';
import { shopifyClient, hasShopify } from './lib/shopifyClient.js';
import { shopifyTechOps } from './lib/shopifyFix.js';
import { emailTechSummary } from './lib/runNotify.js';

export const fixRowId = techFixRowId;
const BUDGET_MS = 13 * 60 * 1000;

// The site's API and operations: WordPress, or Shopify. null = no connection.
function siteApi(client) {
  if (hasWordPress(client)) return { wp: wpClient(client), ops: undefined };
  if (hasShopify(client)) return { wp: shopifyClient(client), ops: shopifyTechOps };
  return null;
}

function fixDeps(supabase, client, site, entry) {
  return {
    wp: site.wp, ops: site.ops,
    fetchHtml: fetchLiveHtml,
    save: status => saveTechFix(supabase, client.id, entry.task.id, status),
    // Record it like any implemented fix, so the pipeline and reports count it.
    recordApplied: async ({ results, live, by }) => {
      const { data: impl } = await supabase.from('syte_suite_implementations').insert({
        client_id: client.id, module: 'technical', change_type: entry.task.fix_type, page_url: entry.task.page_url,
        title: entry.task.title, description: results.map(r => r.label + ': "' + r.from + '" → "' + r.to + '"').join('\n').slice(0, 2000),
        implemented_by: 'Tech Autopilot (' + by + ')',
        verification_status: live.status === 'verified' ? 'verified' : 'pending',
        verification_detail: live.detail, verified_at: live.status === 'verified' ? new Date().toISOString() : null
      }).select('id').single();
      await supabase.from('syte_suite_tseo_tasks')
        .update({ status: live.status === 'verified' ? 'verified' : 'done', impl_id: impl?.id || null })
        .eq('id', entry.task.id);
      return impl?.id || null;
    },
    recordUndone: async ({ implId }) => {
      if (implId) {
        await supabase.from('syte_suite_implementations')
          .update({ verification_status: 'failed', verification_detail: 'Put back to what it was (undo in the suite).' }).eq('id', implId);
      }
      await supabase.from('syte_suite_tseo_tasks').update({ status: 'open', impl_id: null }).eq('id', entry.task.id);
    }
  };
}

export async function handler(event) {
  const required = process.env.WP_PROXY_AUTH;
  const given = event.headers['x-suite-auth'] || event.headers['X-Suite-Auth'] || '';
  if (!required || given !== required) return { statusCode: 401 };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
  const { clientId, taskId, action } = body;
  if (!clientId || !['plan', 'apply', 'undo', 'auto_all'].includes(action)) return { statusCode: 400 };
  if (action !== 'auto_all' && !taskId) return { statusCode: 400 };

  const started = Date.now();
  const supabase = getServerSupabase();
  const state = await loadTechState(supabase, clientId);
  if (!state?.tasks) return { statusCode: 404 };

  if (action === 'auto_all') {
    const base = (process.env.URL || 'https://syte-seo-suite.netlify.app').replace(/\/+$/, '');
    let client = null;
    try {
      client = await loadClient(supabase, clientId);
      state.auto = { status: 'applying', started_at: new Date().toISOString(), by: body.by === 'schedule' ? 'schedule' : 'person' };
      await saveTechState(supabase, state);
      const site = siteApi(client);
      if (site) {
        await runAllTechFixes(
          { entries: state.tasks, fixes: await loadTechFixes(supabase, clientId), by: body.by === 'schedule' ? 'applied automatically' : 'Apply all in the suite' },
          entry => fixDeps(supabase, client, site, entry),
          { timeLeftMs: () => BUDGET_MS - (Date.now() - started) }
        );
        state.auto = { ...state.auto, status: 'done', finished_at: new Date().toISOString() };
      } else {
        state.auto = { ...state.auto, status: 'skipped', reason: 'No working WordPress or Shopify connection — nothing was changed on the site.' };
      }
    } catch (e) {
      console.error('[techfix] auto_all failed:', e.message);
      state.auto = { ...(state.auto || {}), status: 'failed', reason: String(e.message || e).slice(0, 300) };
    }
    try { await saveTechState(supabase, state); } catch { /* the email still goes */ }
    await emailTechSummary(supabase, client || { id: clientId, name: state.client_name || 'Client' }, state, base);
    return { statusCode: 202 };
  }

  const entry = state.tasks.find(e => e.task?.id === taskId);
  if (!entry) return { statusCode: 404 };
  const prev = (await loadTechFixes(supabase, clientId)).get(taskId) || null;
  try {
    const client = await loadClient(supabase, clientId);
    const site = siteApi(client);
    if (!site) {
      await saveTechFix(supabase, clientId, taskId, { status: 'manual', reason: 'Automatic fixes need a working WordPress or Shopify connection for ' + client.name + '.' });
      return { statusCode: 202 };
    }
    await runTechFix({ entry, action, prev }, fixDeps(supabase, client, site, entry));
  } catch (e) {
    await saveTechFix(supabase, clientId, taskId, { ...(action === 'undo' && prev ? prev : {}), status: action === 'undo' && prev ? prev.status : 'failed', reason: String(e.message || e).slice(0, 300), error: String(e.message || e).slice(0, 300) });
  }
  return { statusCode: 202 };
}
