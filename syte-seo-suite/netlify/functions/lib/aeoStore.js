// Persistence for the AEO Autopilot on the tables the AEO Engine page uses,
// so its optimisations show up there like any other run.
import { AEO_STATE_PREFIX } from './aeoScan.js';

const IMPL_COLS = 'id, client_id, module, change_type, page_url, title, description, implemented_by, implemented_at, verification_status, verified_at, created_at';

export async function loadAeoPrior(supabase, client) {
  const [results, impls, rejections] = await Promise.all([
    supabase.from('syte_suite_aeo_results').select('*').eq('client_id', client.id),
    supabase.from('syte_suite_implementations').select(IMPL_COLS).eq('client_id', client.id),
    supabase.from('syte_suite_aeo_rejections').select('client_id, page_url, opt_key').eq('client_id', client.id)
  ]);
  // Same shape the AEO Engine builds: clientId::pageUrl → Set(opt_key).
  const rejectionsByPage = new Map();
  for (const r of rejections.data || []) {
    const k = (r.client_id || '') + '::' + r.page_url;
    if (!rejectionsByPage.has(k)) rejectionsByPage.set(k, new Set());
    rejectionsByPage.get(k).add(r.opt_key);
  }
  return { results: results.data || [], impls: impls.data || [], rejectionsByPage };
}

// Upsert by (client_id, url) — same as saveAeoResult in src/lib/supabase.js,
// including its retry without prior_keys on projects missing that column.
export async function saveAeoRow(supabase, row, existing) {
  const write = payload => existing?.id
    ? supabase.from('syte_suite_aeo_results').update(payload).eq('id', existing.id)
    : supabase.from('syte_suite_aeo_results').insert(payload);
  let { error } = await write(row);
  if (error && /prior_keys/i.test(error.message || '')) {
    const { prior_keys, ...legacy } = row;
    ({ error } = await write(legacy));
  }
  if (error) throw new Error('Could not save AEO results: ' + error.message);
}

export async function loadAeoState(supabase, clientId) {
  const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', AEO_STATE_PREFIX + clientId).maybeSingle();
  return data?.data?.client_id ? data.data : null;
}

export async function saveAeoState(supabase, state) {
  const { error } = await supabase.from('syte_suite_settings')
    .upsert({ id: AEO_STATE_PREFIX + state.client_id, data: state, updated_at: new Date().toISOString() });
  if (error) throw new Error('Could not save AEO Autopilot state: ' + error.message);
}

// Search Console page clicks as the traffic ranking (the browser uses GA4
// sessions; the server has Search Console access already).
export function trafficFromGsc(rows) {
  return (rows || []).map(r => {
    let path = '';
    try { path = new URL(r.keys?.[0]).pathname; } catch { return null; }
    return { path, sessions: r.clicks || 0 };
  }).filter(r => r && r.sessions > 0).sort((a, b) => b.sessions - a.sessions);
}
