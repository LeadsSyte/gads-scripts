// Preview / apply / undo ONE AEO optimisation on a client's WordPress page.
// POST { clientId, url, optKey, action: 'plan' | 'apply' | 'undo' } with
// X-Suite-Auth. The optimisation is read from syte_suite_aeo_results (so it
// works for suite runs and Autopilot runs alike). Status is written to its own
// row, syte_suite_settings 'aeofix:<clientId>:<key>', which the panel polls
// and draft-preview reads for the in-theme preview. See lib/aeoFix.js.

import { getServerSupabase } from './lib/serverSupabase.js';
import { loadClient } from './lib/autopilotStore.js';
import { fetchLiveHtml } from './lib/techStore.js';
import { planAeoFix, applyAeoFix, undoAeoFix, aeoLiveCheck, fixKey } from './lib/aeoFix.js';
import { previewUrl } from './lib/previewSig.js';

export const aeoFixRowId = (clientId, key) => 'aeofix:' + clientId + ':' + key;
const optKeyOf = o => (o.type || '') + '::' + (o.name || o.title || ''); // = aeoOptKey in AEOEngine.jsx

function wpClient(client) {
  const base = client.wp_url.replace(/\/+$/, '') + '/wp-json/';
  const auth = 'Basic ' + Buffer.from(client.wp_username + ':' + client.wp_app_password).toString('base64');
  return async (path, body) => {
    const r = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000)
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = text; try { msg = JSON.parse(text).message || text; } catch { /* raw */ }
      throw new Error('WordPress ' + r.status + ': ' + String(msg).slice(0, 160));
    }
    try { return JSON.parse(text); } catch { return text; }
  };
}

export async function handler(event) {
  const required = process.env.WP_PROXY_AUTH;
  const given = event.headers['x-suite-auth'] || event.headers['X-Suite-Auth'] || '';
  if (!required || given !== required) return { statusCode: 401 };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
  const { clientId, url, optKey, action } = body;
  if (!clientId || !url || !optKey || !['plan', 'apply', 'undo'].includes(action)) return { statusCode: 400 };

  const supabase = getServerSupabase();
  const key = fixKey(url, optKey);
  const rowId = aeoFixRowId(clientId, key);
  const { data: prevRow } = await supabase.from('syte_suite_settings').select('data').eq('id', rowId).maybeSingle();
  let status = prevRow?.data || null;
  const save = async (next) => {
    status = { ...next, client_id: clientId, url, opt_key: optKey, key, at: new Date().toISOString() };
    const { error } = await supabase.from('syte_suite_settings').upsert({ id: rowId, data: status, updated_at: status.at });
    if (error) throw new Error('Could not save the status: ' + error.message);
  };

  try {
    const client = await loadClient(supabase, clientId);
    if (client.cms_type !== 'WordPress' || !client.wp_url || !client.wp_app_password) {
      await save({ status: 'manual', reason: 'Adding it automatically needs a working WordPress connection for ' + client.name + '.' });
      return { statusCode: 202 };
    }
    const { data: rows } = await supabase.from('syte_suite_aeo_results').select('url, optimizations').eq('client_id', clientId).eq('url', url);
    const opt = (rows?.[0]?.optimizations || []).find(o => optKeyOf(o) === optKey);
    if (!opt) { await save({ status: 'manual', reason: 'This optimisation is no longer in the AEO Engine for that page.' }); return { statusCode: 202 }; }
    if (opt.check && opt.check.verdict !== 'confirmed') {
      await save({ status: 'manual', reason: 'Only optimisations the independent check confirmed are added automatically.' });
      return { statusCode: 202 };
    }
    const wp = wpClient(client);

    if (action === 'plan') {
      await save({ status: 'planning' });
      const plan = await planAeoFix({ url, opt, optKey }, wp, fetchLiveHtml);
      if (!plan.applicable) { await save({ status: 'manual', reason: plan.reason }); return { statusCode: 202 }; }
      await save({ status: 'planned', plan, preview_url: previewUrl('f', clientId + '-' + key) });
      return { statusCode: 202 };
    }

    if (action === 'apply') {
      const plan = status?.plan;
      if (status?.status !== 'planned' || !plan) { await save({ ...(status || {}), error: 'Preview it before adding it to the page.' }); return { statusCode: 202 }; }
      await save({ ...status, status: 'applying', error: '' });
      const r = await applyAeoFix(plan, wp);
      if (!r.ok) { await save({ ...status, status: r.changed ? 'planned' : 'failed', error: r.reason || 'WordPress did not keep the change.' }); return { statusCode: 202 }; }
      const live = aeoLiveCheck(await fetchLiveHtml(url), plan);
      const { data: impl } = await supabase.from('syte_suite_implementations').insert({
        client_id: clientId, module: 'aeo', change_type: opt.type || 'content', page_url: url,
        title: opt.name || 'AEO optimisation', description: ('Added (' + plan.position + ' of the page) by the AEO Autopilot, approved in the suite.\n\n' + plan.html).slice(0, 2000),
        implemented_by: 'AEO Autopilot (approved in the suite)',
        verification_status: live.status === 'verified' ? 'verified' : 'pending', verification_detail: live.detail,
        verified_at: live.status === 'verified' ? new Date().toISOString() : null
      }).select('id').single();
      await save({ ...status, status: 'applied', live, impl_id: impl?.id || null });
      return { statusCode: 202 };
    }

    // undo
    const plan = status?.plan;
    if (!plan || status?.status !== 'applied') { await save({ ...(status || {}), error: 'Nothing to undo.' }); return { statusCode: 202 }; }
    await save({ ...status, status: 'undoing' });
    const r = await undoAeoFix(plan, wp);
    if (!r.ok) { await save({ ...status, status: 'applied', error: 'Could not remove it — remove it in WordPress by hand.' }); return { statusCode: 202 }; }
    if (status.impl_id) {
      await supabase.from('syte_suite_implementations').update({ verification_status: 'failed', verification_detail: 'Removed from the page (undo in the suite).' }).eq('id', status.impl_id);
    }
    await save({ status: 'removed', plan });
  } catch (e) {
    await save({ ...(status || {}), status: 'failed', error: String(e.message || e).slice(0, 300) });
  }
  return { statusCode: 202 };
}
