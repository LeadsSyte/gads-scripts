// Persistence and Google access for the Report Autopilot, on the tables the
// Monthly Report page uses — so a server-built report opens there as the
// month's generated report.
import { REPORT_STATE_PREFIX } from './reportScan.js';
import { accessTokenFor } from './serverGsc.js';

// Direct Google API calls with a token minted from the stored refresh token.
// Installed as globalThis.__SYTE_GOOGLE_FETCH so src/modules/reports/
// reportData.js (and gsc.js) run unchanged on the server
// (see src/lib/googleServerAuth.js).
export function installServerGoogleFetch(supabase) {
  const tokens = new Map();
  globalThis.__SYTE_GOOGLE_FETCH = async (url, { method = 'GET', body = null } = {}, email) => {
    if (!tokens.has(email)) tokens.set(email, accessTokenFor(supabase, email));
    const token = await tokens.get(email);
    return fetch(url, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      signal: AbortSignal.timeout(45000)
    });
  };
}

// The month's work, from Supabase (the page reads the browser's copies).
export async function loadWork(supabase, client) {
  const [articles, tasks, aeo, impls] = await Promise.all([
    supabase.from('syte_suite_content_blogs').select('client_id, topic, keyword, output, generated_at, created_at').eq('client_id', client.id),
    supabase.from('syte_suite_tseo_tasks').select('client_id, status, priority, created_at').eq('client_id', client.id),
    supabase.from('syte_suite_aeo_results').select('client_id, url, optimizations, generated_at').eq('client_id', client.id),
    supabase.from('syte_suite_implementations').select('client_id, verification_status, implemented_at, created_at').eq('client_id', client.id)
  ]);
  return {
    // Only articles with content count as written.
    articles: (articles.data || []).filter(a => String(a.output || '').trim()).map(({ output, ...a }) => a),
    tasks: tasks.data || [], aeoResults: aeo.data || [], impls: impls.data || []
  };
}

export async function loadExistingReport(supabase, client, month) {
  const { data } = await supabase.from('syte_suite_report_generated_log')
    .select('id, generated_at').eq('client_id', client.id).eq('month', month).eq('report_type', 'seo').limit(1);
  return data?.[0] || null;
}

// Same upsert as dbUpsertGenerated in src/lib/supabase.js: one row per
// (client, month, report_type).
export async function saveGeneratedReport(supabase, row) {
  const payload = { ...row, generated_at: new Date().toISOString() };
  const existing = await loadExistingReport(supabase, { id: row.client_id }, row.month);
  const { error } = existing
    ? await supabase.from('syte_suite_report_generated_log').update(payload).eq('id', existing.id)
    : await supabase.from('syte_suite_report_generated_log').insert(payload);
  if (error) throw new Error('Could not save the report: ' + error.message);
}

export async function saveReportCache(supabase, client, month, data) {
  const { data: rows } = await supabase.from('syte_suite_report_cache').select('id').eq('client_id', client.id).eq('month', month).limit(1);
  const payload = { client_id: client.id, month, data, fetched_at: new Date().toISOString() };
  if (rows?.[0]) await supabase.from('syte_suite_report_cache').update(payload).eq('id', rows[0].id);
  else await supabase.from('syte_suite_report_cache').insert(payload);
}

export async function loadReportState(supabase, clientId) {
  const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', REPORT_STATE_PREFIX + clientId).maybeSingle();
  return data?.data?.client_id ? data.data : null;
}

export async function saveReportState(supabase, state) {
  const { error } = await supabase.from('syte_suite_settings')
    .upsert({ id: REPORT_STATE_PREFIX + state.client_id, data: state, updated_at: new Date().toISOString() });
  if (error) throw new Error('Could not save Report Autopilot state: ' + error.message);
}
