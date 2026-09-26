// Persistence for the Autopilot, on existing tables (no schema change):
//   run state        → syte_suite_settings, id 'autopilot:<clientId>', data = state
//   written articles → syte_suite_content_blogs (same rows Auto Write saves)
import { STATE_PREFIX } from './autopilot.js';

export async function loadClient(supabase, clientId) {
  const { data, error } = await supabase.from('syte_suite_clients').select('*').eq('id', clientId).single();
  if (error || !data) throw new Error('Client not found: ' + clientId);
  return data;
}

export async function saveClientFields(supabase, clientId, fields) {
  const { error } = await supabase.from('syte_suite_clients')
    .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', clientId);
  if (error) throw new Error('Could not save client: ' + error.message);
}

export async function loadRunState(supabase, clientId) {
  const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', STATE_PREFIX + clientId).maybeSingle();
  return data?.data && data.data.client_id ? data.data : null;
}

export async function saveRunState(supabase, state) {
  const { error } = await supabase.from('syte_suite_settings')
    .upsert({ id: STATE_PREFIX + state.client_id, data: state, updated_at: new Date().toISOString() });
  if (error) throw new Error('Could not save Autopilot state: ' + error.message);
}

export async function existingTopics(supabase, client, month) {
  const { data } = await supabase.from('syte_suite_content_blogs')
    .select('topic, output, generated_at')
    .eq('client_id', client.id)
    .gte('generated_at', month + '-01T00:00:00Z');
  return new Set((data || [])
    .filter(r => (r.generated_at || '').slice(0, 7) === month && String(r.output || '').trim())
    .map(r => String(r.topic || '').trim().toLowerCase()));
}

export async function saveArticle(supabase, row) {
  const { data, error } = await supabase.from('syte_suite_content_blogs').insert(row).select('id').single();
  if (error) throw new Error('Could not save article: ' + error.message);
  return data;
}
