// Persistence for the automatic Onboarding Baseline, on existing tables:
//   run state → syte_suite_settings, id 'baseline:<clientId>', data = state
//   baseline  → syte_suite_baselines (one row per client — the same row the
//               Reports → Baseline page reads and writes)
import { BASELINE_STATE_PREFIX } from './baselineScan.js';

export async function loadBaselineRow(supabase, clientId) {
  const { data } = await supabase.from('syte_suite_baselines').select('id, month, captured_at').eq('client_id', clientId).limit(1);
  return data?.[0] || null;
}

// Same upsert as saveBaseline in src/lib/supabase.js.
export async function saveBaselineRow(supabase, clientId, month, reportData) {
  const existing = await loadBaselineRow(supabase, clientId);
  const payload = { month, data: reportData, captured_by: 'auto', captured_at: new Date().toISOString() };
  const { error } = existing
    ? await supabase.from('syte_suite_baselines').update(payload).eq('id', existing.id)
    : await supabase.from('syte_suite_baselines').insert({ client_id: clientId, ...payload });
  if (error) throw new Error('Could not save the baseline: ' + error.message);
}

export async function loadBaselineState(supabase, clientId) {
  const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', BASELINE_STATE_PREFIX + clientId).maybeSingle();
  return data?.data?.client_id ? data.data : null;
}

export async function saveBaselineState(supabase, state) {
  const { error } = await supabase.from('syte_suite_settings')
    .upsert({ id: BASELINE_STATE_PREFIX + state.client_id, data: state, updated_at: new Date().toISOString() });
  if (error) throw new Error('Could not save baseline state: ' + error.message);
}
