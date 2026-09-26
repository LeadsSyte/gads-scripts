// Preview or apply ONE Tech Autopilot fix on a client's WordPress site.
// POST { clientId, taskId, action: 'plan' | 'apply' } with X-Suite-Auth.
// Background function: the result is written to its own row,
// syte_suite_settings 'techfix:<clientId>:<taskId>', which the panel polls.
// (One row per fix: several previews run at once, and writing into the
// shared scan state made them overwrite each other.) 'apply' only runs for
// a fix that was previewed first, and only changes what that preview
// showed. See lib/techFix.js.

import { getServerSupabase } from './lib/serverSupabase.js';
import { loadClient } from './lib/autopilotStore.js';
import { loadTechState, fetchLiveHtml } from './lib/techStore.js';
import { planFix, applyPlan, checkLive } from './lib/techFix.js';

export const fixRowId = (clientId, taskId) => 'techfix:' + clientId + ':' + taskId;

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
  const { clientId, taskId, action } = body;
  if (!clientId || !taskId || !['plan', 'apply'].includes(action)) return { statusCode: 400 };

  const supabase = getServerSupabase();
  const state = await loadTechState(supabase, clientId);
  const entry = state?.tasks?.find(e => e.task?.id === taskId);
  if (!entry) return { statusCode: 404 };
  const rowId = fixRowId(clientId, taskId);
  const { data: prev } = await supabase.from('syte_suite_settings').select('data').eq('id', rowId).maybeSingle();
  entry.apply = prev?.data || null;
  const save = async (apply) => {
    entry.apply = { ...apply, client_id: clientId, task_id: taskId, at: new Date().toISOString() };
    const { error } = await supabase.from('syte_suite_settings').upsert({ id: rowId, data: entry.apply, updated_at: entry.apply.at });
    if (error) throw new Error('Could not save the fix status: ' + error.message);
  };

  try {
    const client = await loadClient(supabase, clientId);
    if (client.cms_type !== 'WordPress' || !client.wp_url || !client.wp_app_password) {
      await save({ status: 'manual', reason: 'Automatic fixes need a working WordPress connection for ' + client.name + '.' });
      return { statusCode: 202 };
    }
    if (entry.check?.verdict !== 'confirmed') {
      await save({ status: 'manual', reason: 'Only fixes the independent check confirmed are applied automatically.' });
      return { statusCode: 202 };
    }
    const wp = wpClient(client);

    if (action === 'plan') {
      await save({ status: 'planning' });
      const plan = await planFix(entry.task, wp);
      await save(plan.applicable ? { status: 'planned', plan } : { status: 'manual', reason: plan.reason });
      return { statusCode: 202 };
    }

    // apply — re-plan and refuse if anything differs from what was approved.
    const approved = entry.apply?.plan;
    if (entry.apply?.status !== 'planned' || !approved) { await save({ ...entry.apply, error: 'Preview the change before applying it.' }); return { statusCode: 202 }; }
    await save({ status: 'applying', plan: approved });
    const fresh = await planFix(entry.task, wp);
    const same = fresh.applicable && JSON.stringify(fresh.changes.map(c => [c.target, c.to])) === JSON.stringify(approved.changes.map(c => [c.target, c.to]));
    if (!same) { await save({ status: 'planned', plan: fresh.applicable ? fresh : approved, error: 'The page changed since the preview — check the new preview and apply again.' }); return { statusCode: 202 }; }

    const results = await applyPlan(approved, wp);
    const allOk = results.every(r => r.ok);
    const live = allOk ? checkLive(await fetchLiveHtml(entry.task.page_url), results) : { status: 'failed', detail: 'WordPress did not keep the change.' };

    // Record it like any implemented fix, so the pipeline and reports count it.
    if (allOk) {
      const { data: impl } = await supabase.from('syte_suite_implementations').insert({
        client_id: client.id, module: 'technical', change_type: entry.task.fix_type, page_url: entry.task.page_url,
        title: entry.task.title, description: results.map(r => r.label + ': "' + r.from + '" → "' + r.to + '"').join('\n').slice(0, 2000),
        implemented_by: 'Tech Autopilot (approved in the suite)',
        verification_status: live.status === 'verified' ? 'verified' : 'pending',
        verification_detail: live.detail, verified_at: live.status === 'verified' ? new Date().toISOString() : null
      }).select('id').single();
      await supabase.from('syte_suite_tseo_tasks')
        .update({ status: live.status === 'verified' ? 'verified' : 'done', impl_id: impl?.id || null })
        .eq('id', taskId);
    }
    await save({ status: allOk ? 'applied' : 'failed', plan: approved, results, live });
  } catch (e) {
    await save({ status: 'failed', reason: String(e.message || e).slice(0, 300) });
  }
  return { statusCode: 202 };
}
