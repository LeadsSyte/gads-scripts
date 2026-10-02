// AEO additions on a client's WordPress pages.
// POST with X-Suite-Auth:
//   { clientId, url, optKey, action: 'plan' | 'apply' | 'undo' }   one addition
//   { clientId, action: 'auto_all' }    every checked addition from this
//       month's AEO Autopilot run that the suite can add itself, then the
//       summary email. Called by the run when the client has "add
//       automatically" on, and by "Add all" in the panel.
// A single addition is read from syte_suite_aeo_results (so it works for
// suite runs and Autopilot runs alike). Status is written to its own row,
// syte_suite_settings 'aeofix:<clientId>:<key>', which the panel polls and
// draft-preview reads for the in-theme preview. See lib/aeoFixRun.js.

import { getServerSupabase } from './lib/serverSupabase.js';
import { loadClient } from './lib/autopilotStore.js';
import { fetchLiveHtml } from './lib/techStore.js';
import { loadAeoState, saveAeoState, loadAeoFixes, saveAeoFix, aeoFixRowId as rowId } from './lib/aeoStore.js';
import { fixKey } from './lib/aeoFix.js';
import { runAeoFix, runAllAeoFixes, aeoOptKey } from './lib/aeoFixRun.js';
import { wpClient, hasWordPress } from './lib/wpClient.js';
import { shopifyClient, hasShopify } from './lib/shopifyClient.js';
import { shopifyAeoOps } from './lib/shopifyAeo.js';
import { wpAeoOps } from './lib/helperFix.js';
import { previewUrl } from './lib/previewSig.js';
import { emailAeoSummary } from './lib/runNotify.js';
import { visualCheck, visualCheckAvailable } from './lib/visualCheck.js';
import { claudeCompleteServer } from './lib/serverAi.js';

export const aeoFixRowId = rowId;
const BUDGET_MS = 13 * 60 * 1000;

// The site's API and operations: WordPress, or Shopify. null = no connection.
function siteApi(client) {
  if (hasWordPress(client)) return { wp: wpClient(client), ops: wpAeoOps() };
  if (hasShopify(client)) return { wp: shopifyClient(client), ops: shopifyAeoOps };
  return null;
}

function fixDeps(supabase, client, site, url, optKey) {
  const key = fixKey(url, optKey);
  return {
    wp: site.wp, ops: site.ops,
    fetchHtml: fetchLiveHtml,
    save: status => saveAeoFix(supabase, client.id, { url, optKey, key }, status),
    previewUrlFor: k => previewUrl('f', client.id + '-' + k),
    visualCheck: visualCheckAvailable() ? ({ url: u, opt, plan }) => visualCheck({
      url: u,
      what: 'A new section ("' + (opt.name || opt.type) + '") was added at the ' + (plan.position === 'top' ? 'top' : 'end') + ' of this page\'s main content. It should look like part of the page, in the same fonts and colours.'
    }, { complete: claudeCompleteServer }) : undefined,
    recordApplied: async ({ opt, plan, live, by }) => {
      const { data: impl } = await supabase.from('syte_suite_implementations').insert({
        client_id: client.id, module: 'aeo', change_type: opt.type || 'content', page_url: url,
        title: opt.name || 'AEO optimisation', description: ('Added (' + plan.position + ' of the page) by the AEO Autopilot, ' + by + '.\n\n' + plan.html).slice(0, 2000),
        implemented_by: 'AEO Autopilot (' + by + ')',
        verification_status: live.status === 'verified' ? 'verified' : 'pending', verification_detail: live.detail,
        verified_at: live.status === 'verified' ? new Date().toISOString() : null
      }).select('id').single();
      return impl?.id || null;
    },
    recordUndone: async (implId) => {
      if (!implId) return;
      await supabase.from('syte_suite_implementations')
        .update({ verification_status: 'failed', verification_detail: 'Removed from the page (undo in the suite).' }).eq('id', implId);
    }
  };
}

export async function handler(event) {
  const required = process.env.WP_PROXY_AUTH;
  const given = event.headers['x-suite-auth'] || event.headers['X-Suite-Auth'] || '';
  if (!required || given !== required) return { statusCode: 401 };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
  const { clientId, url, optKey, action } = body;
  if (!clientId || !['plan', 'apply', 'undo', 'auto_all'].includes(action)) return { statusCode: 400 };
  if (action !== 'auto_all' && (!url || !optKey)) return { statusCode: 400 };

  const started = Date.now();
  const supabase = getServerSupabase();

  if (action === 'auto_all') {
    const state = await loadAeoState(supabase, clientId);
    if (!state?.rows) return { statusCode: 404 };
    const base = (process.env.URL || 'https://syte-seo-suite.netlify.app').replace(/\/+$/, '');
    const scheduled = body.by === 'schedule';
    let client = null;
    try {
      client = await loadClient(supabase, clientId);
      state.auto = { status: 'applying', started_at: new Date().toISOString(), by: scheduled ? 'schedule' : 'person' };
      await saveAeoState(supabase, state);
      const site = siteApi(client);
      if (site) {
        const items = state.rows.flatMap(r => (r.optimizations || []).map(opt => ({ url: r.url, opt })));
        await runAllAeoFixes(
          { items, fixes: await loadAeoFixes(supabase, clientId), keyOf: fixKey, by: scheduled ? 'added automatically' : 'Add all in the suite' },
          (u, k) => fixDeps(supabase, client, site, u, k),
          { timeLeftMs: () => BUDGET_MS - (Date.now() - started), perFixMs: visualCheckAvailable() ? 120000 : 60000 }
        );
        state.auto = { ...state.auto, status: 'done', finished_at: new Date().toISOString() };
      } else {
        state.auto = { ...state.auto, status: 'skipped', reason: 'No working WordPress or Shopify connection — nothing was changed on the site.' };
      }
    } catch (e) {
      console.error('[aeofix] auto_all failed:', e.message);
      state.auto = { ...(state.auto || {}), status: 'failed', reason: String(e.message || e).slice(0, 300) };
    }
    try { await saveAeoState(supabase, state); } catch { /* the email still goes */ }
    await emailAeoSummary(supabase, client || { id: clientId, name: state.client_name || 'Client' }, state, base);
    return { statusCode: 202 };
  }

  const key = fixKey(url, optKey);
  const prev = (await loadAeoFixes(supabase, clientId)).get(key) || null;
  const target = { url, optKey, key };
  try {
    const client = await loadClient(supabase, clientId);
    const site = siteApi(client);
    if (!site) {
      await saveAeoFix(supabase, clientId, target, { status: 'manual', reason: 'Adding it automatically needs a working WordPress or Shopify connection for ' + client.name + '.' });
      return { statusCode: 202 };
    }
    const { data: rows } = await supabase.from('syte_suite_aeo_results').select('url, optimizations').eq('client_id', clientId).eq('url', url);
    const opt = (rows?.[0]?.optimizations || []).find(o => aeoOptKey(o) === optKey);
    await runAeoFix({ url, opt, optKey, action, prev }, fixDeps(supabase, client, site, url, optKey));
  } catch (e) {
    await saveAeoFix(supabase, clientId, target, { ...(prev || {}), status: 'failed', error: String(e.message || e).slice(0, 300) });
  }
  return { statusCode: 202 };
}
