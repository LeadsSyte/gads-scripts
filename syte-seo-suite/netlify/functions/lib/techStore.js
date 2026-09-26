// Persistence for the Tech Autopilot, on the tables the Technical SEO page
// already uses — so its fixes appear on the normal task board.
import { TECH_STATE_PREFIX } from './techScan.js';
import { handler as pageProxy } from '../page-proxy.js';

// Same columns as src/lib/supabase.js (IMPL_LIST_COLS / tseoTaskRow).
const IMPL_COLS = 'id, client_id, module, change_type, page_url, title, description, implemented_by, implemented_at, verification_status, verified_at, created_at';

function taskRow(t) {
  return {
    id: t.id, client_id: t.client_id, client_name: t.client_name, title: t.title, description: t.description,
    priority: t.priority, page_url: t.page_url, fix_type: t.fix_type, copy_paste_fix: t.copy_paste_fix,
    impact: t.impact, effort: t.effort, status: t.status || 'open', assignee: t.assignee || '',
    data_source: t.data_source, impl_id: t.impl_id || null, created_at: t.created_at || new Date().toISOString()
  };
}

export async function loadTechHistory(supabase, client) {
  const [tasks, impls, rejections] = await Promise.all([
    supabase.from('syte_suite_tseo_tasks').select('*').eq('client_id', client.id),
    supabase.from('syte_suite_implementations').select(IMPL_COLS).eq('client_id', client.id),
    supabase.from('syte_suite_tseo_rejections').select('client_id, dedup_key').eq('client_id', client.id)
  ]);
  return {
    tasks: tasks.data || [],
    impls: impls.data || [],
    rejectedKeys: new Set((rejections.data || []).map(r => (r.client_id || '') + '|' + r.dedup_key))
  };
}

// A re-scan replaces the client's OPEN tasks and keeps done/verified work —
// exactly what a scan from the Technical SEO page does (replaceClientOpenTasks).
export async function replaceOpenTasks(supabase, client, tasks) {
  const del = await supabase.from('syte_suite_tseo_tasks').delete().eq('client_id', client.id).eq('status', 'open');
  if (del.error) throw new Error('Could not clear old open tasks: ' + del.error.message);
  if (!tasks.length) return;
  const { error } = await supabase.from('syte_suite_tseo_tasks').upsert(tasks.map(taskRow), { onConflict: 'id' });
  if (error) throw new Error('Could not save tasks: ' + error.message);
}

export async function loadTechState(supabase, clientId) {
  const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', TECH_STATE_PREFIX + clientId).maybeSingle();
  return data?.data?.client_id ? data.data : null;
}

export async function saveTechState(supabase, state) {
  const { error } = await supabase.from('syte_suite_settings')
    .upsert({ id: TECH_STATE_PREFIX + state.client_id, data: state, updated_at: new Date().toISOString() });
  if (error) throw new Error('Could not save Tech Autopilot state: ' + error.message);
}

// Live page HTML the way the crawler sees it (raw, no reader rewriting).
export async function fetchLiveHtml(url) {
  try {
    const res = await pageProxy({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ url, raw: true }) });
    const data = JSON.parse(res.body || '{}');
    if (data.status && (data.status === 404 || data.status === 410 || data.status >= 500)) return '';
    return data.html || '';
  } catch { return ''; }
}

export async function fetchPlainText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SyteSEOSuite/1.0)' }, signal: AbortSignal.timeout(15000) });
  return r.ok ? (await r.text()).slice(0, 20000) : '';
}
