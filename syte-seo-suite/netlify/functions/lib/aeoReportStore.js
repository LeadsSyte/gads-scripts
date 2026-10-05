// Persistence, probe grounding and engine keys for the AEO Report Autopilot,
// on the tables the Monthly Report page uses — so a server-built AEO report
// opens there as the month's generated AEO report.

import { AEO_REPORT_STATE_PREFIX, AEO_REPORT_CARRY_PREFIX } from './aeoReportScan.js';
import { fetchGscForClient } from './serverGsc.js';
import { claudeCompleteServer } from './serverAi.js';
import { activeEngines } from '../../../src/modules/reports/aeoEngines.js';
import { extractRun } from '../../../src/modules/reports/aeoExtract.js';
import { groundClientForAeo } from '../../../src/modules/reports/grounding.js';
import { buildGoldProbesForClient } from '../../../src/modules/reports/gridProfile.js';
import { probeCandidatesFromGSC, groundedProbeSet } from '../../../src/modules/reports/keywordBuckets.js';
import { insertDroppingUnknownColumns } from '../../../src/modules/reports/aeoHistoryInsert.js';

// The engines call their providers directly with the deployment's keys
// (see aeoEngines.js). Returns the engines that have a key.
export function serverEngines(env = process.env) {
  globalThis.__SYTE_AEO_KEYS = {
    openai: String(env.OPENAI_API_KEY || '').trim(),
    google: String(env.GOOGLE_AI_KEY || '').trim(),
    anthropic: String(env.ANTHROPIC_API_KEY || '').trim()
  };
  return activeEngines();
}

export const serverExtract = args => extractRun(args, claudeCompleteServer);

// Same grounding as groundClientGold in MonthlyReport.jsx: the gold grid from
// the website + Search Console + competitors, with a Search Console fallback.
export async function groundClientServer(supabase, client) {
  let queries = [];
  try { queries = (await fetchGscForClient(supabase, client)).queries || []; } catch { /* no Search Console: the website alone */ }
  const kws = queries.map(q => String(q.query || '').trim()).filter(Boolean);
  const competitors = String(client.competitors || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  let fallbackSet = [];
  try {
    if (kws.length) fallbackSet = groundedProbeSet(probeCandidatesFromGSC(queries, client.name, { limit: 40 }), { geo: client.location || client.market, competitors, limit: 24 });
  } catch { fallbackSet = []; }
  return groundClientForAeo(client, {
    gscQueries: kws, fallbackSet,
    buildGold: (c, opts) => buildGoldProbesForClient(c, { ...opts, complete: claudeCompleteServer })
  });
}

export async function saveClientProbes(supabase, client) {
  const { error } = await supabase.from('syte_suite_clients')
    .update({ aeo_probes: client.aeo_probes, aeo_probe_queries: client.aeo_probe_queries ?? null }).eq('id', client.id);
  if (error) throw new Error(error.message);
}

export async function loadExistingAeoReport(supabase, client, month) {
  const { data } = await supabase.from('syte_suite_report_generated_log')
    .select('id, generated_at').eq('client_id', client.id).eq('month', month).eq('report_type', 'aeo').limit(1);
  return data?.[0] || null;
}

// The latest earlier month's AEO report carries that month's measured
// results — the baseline for month-on-month.
export async function loadPreviousAeo(supabase, client, month) {
  const { data } = await supabase.from('syte_suite_report_generated_log')
    .select('month, aeo_probe').eq('client_id', client.id).eq('report_type', 'aeo').lt('month', month)
    .order('month', { ascending: false }).limit(3);
  const row = (data || []).find(r => r.aeo_probe && (r.aeo_probe.queries_count || r.aeo_probe.per_query?.length));
  return row ? { month: row.month, snapshot: row.aeo_probe } : null;
}

export async function saveGeneratedAeoReport(supabase, row) {
  const payload = { ...row, generated_at: new Date().toISOString() };
  const existing = await loadExistingAeoReport(supabase, { id: row.client_id }, row.month);
  const { error } = existing
    ? await supabase.from('syte_suite_report_generated_log').update(payload).eq('id', existing.id)
    : await supabase.from('syte_suite_report_generated_log').insert(payload);
  if (error) throw new Error('Could not save the report: ' + error.message);
}

// Same rows as persistAeoRuns in src/lib/supabase.js.
export async function persistRunsServer(supabase, records, rawEntries) {
  const rows = (records || []).map(r => ({
    client_id: r.client_id, month: r.month, probe_id: r.probeId, engine: r.engine, run_index: r.runIndex, run_mode: r.runMode,
    appeared: r.appeared, position: r.position, list_length: r.listLength, segment_label: r.segmentLabel, reason_phrase: r.reasonPhrase,
    sentiment: r.sentiment, competitors_named: r.competitorsNamed || [], cited_urls: r.citedUrls || [],
    raw_response_hash: r.rawResponseHash, timestamp: r.timestamp
  }));
  for (let i = 0; i < rows.length; i += 200) await supabase.from('syte_suite_aeo_runs').insert(rows.slice(i, i + 200));
  const seen = new Set();
  const raws = [];
  for (const e of rawEntries || []) {
    if (!e.hash || seen.has(e.hash)) continue;
    seen.add(e.hash);
    raws.push({ hash: e.hash, client_id: e.client_id, engine: e.engine, run_mode: e.run_mode, raw_response: e.raw_response });
  }
  for (let i = 0; i < raws.length; i += 100) await supabase.from('syte_suite_aeo_raw').upsert(raws.slice(i, i + 100), { onConflict: 'hash', ignoreDuplicates: true });
}

export async function saveSnapshotToHistory(supabase, snapshot) {
  const { data } = await supabase.from('syte_suite_aeo_history').select('id').eq('client_id', snapshot.client_id).eq('month', snapshot.month).limit(1);
  if (data?.[0]) return;
  try {
    const { dropped } = await insertDroppingUnknownColumns(r => supabase.from('syte_suite_aeo_history').insert(r), snapshot);
    if (dropped.length) console.warn('[aeoreport] AEO History saved without columns missing from the database (run supabase-schema-aeo-history-columns.sql):', dropped.join(', '));
  } catch (e) { throw new Error(e.message); }
}

const row = (prefix) => ({
  load: async (supabase, clientId) => {
    const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', prefix + clientId).maybeSingle();
    return data?.data || null;
  },
  save: async (supabase, clientId, data) => {
    if (data == null) { await supabase.from('syte_suite_settings').delete().eq('id', prefix + clientId); return; }
    const { error } = await supabase.from('syte_suite_settings').upsert({ id: prefix + clientId, data, updated_at: new Date().toISOString() });
    if (error) throw new Error('Could not save AEO report progress: ' + error.message);
  }
});
const stateRow = row(AEO_REPORT_STATE_PREFIX);
const carryRow = row(AEO_REPORT_CARRY_PREFIX);

export const loadAeoReportState = async (supabase, clientId) => { const s = await stateRow.load(supabase, clientId); return s?.client_id ? s : null; };
export const saveAeoReportState = (supabase, state) => stateRow.save(supabase, state.client_id, state);
export const loadAeoCarry = (supabase, clientId) => carryRow.load(supabase, clientId);
export const saveAeoCarry = (supabase, clientId, data) => carryRow.save(supabase, clientId, data);
