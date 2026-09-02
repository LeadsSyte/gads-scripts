import { createClient } from '@supabase/supabase-js';

// `import.meta.env` is injected by Vite in the browser build but is undefined
// under plain Node (the test runner), where this module is now reachable via
// settings.js → supabase.js. Fall back to an empty object so importing the
// module never throws outside Vite; hasSupabase is simply false there.
const env = import.meta.env || {};
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;

export const hasSupabase = !!(url && key && !url.includes('[project]'));

export const supabase = hasSupabase
  ? createClient(url, key, { auth: { persistSession: false } })
  : null;

// localStorage fallback wrappers so every module keeps working offline
const LS_PREFIX = 'syte-suite-';

// Guard against writing rows with a null/undefined client_id. We saw
// orphaned rows with client_id=null in syte_suite_aeo_history and the
// report cache — almost always caused by a flow firing before
// useClients had selected a client, or by an old record passed to a
// save fn after the client was deleted from local state. Throwing here
// surfaces the problem at the call site instead of silently polluting
// the database.
function assertClientId(clientId, context) {
  if (clientId == null || clientId === '') {
    throw new Error(
      `${context}: missing client_id (got ${clientId === null ? 'null' : typeof clientId}). ` +
      'Pick a client first or pass a valid client.id.'
    );
  }
}

export async function listClients() {
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_clients')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  return JSON.parse(localStorage.getItem(LS_PREFIX + 'clients') || '[]');
}

export async function upsertClient(client) {
  if (supabase) {
    const payload = { ...client, updated_at: new Date().toISOString() };
    if (payload.id) {
      const { data, error } = await supabase
        .from('syte_suite_clients')
        .update(payload)
        .eq('id', payload.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await supabase
      .from('syte_suite_clients')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'clients') || '[]');
  if (client.id) {
    const idx = list.findIndex(c => c.id === client.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...client };
  } else {
    client.id = crypto.randomUUID();
    client.created_at = new Date().toISOString();
    list.push(client);
  }
  localStorage.setItem(LS_PREFIX + 'clients', JSON.stringify(list));
  return client;
}

// Partial update: writes ONLY the given fields on a client row and leaves
// every other column untouched. Use this for inline / single-field edits
// (assigning a person, toggling a service, refreshing a WebCEO mapping) so a
// save built from a stale in-memory copy can't silently revert unrelated
// fields. That full-row overwrite is exactly what reset the per-service
// account-manager assignments: an action that meant to change one field
// rewrote the whole record from a snapshot taken before the reassignment.
// The full-object upsertClient stays for the client editor form, which
// intentionally rewrites a freshly-loaded record (and can clear fields).
export async function updateClientFields(id, fields) {
  assertClientId(id, 'updateClientFields');
  if (supabase) {
    const payload = { ...fields, updated_at: new Date().toISOString() };
    const { data, error } = await supabase
      .from('syte_suite_clients')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'clients') || '[]');
  const idx = list.findIndex(c => c.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...fields };
  localStorage.setItem(LS_PREFIX + 'clients', JSON.stringify(list));
  return list[idx];
}

export async function deleteClient(id) {
  if (supabase) {
    const { error } = await supabase.from('syte_suite_clients').delete().eq('id', id);
    if (error) throw error;
    return;
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'clients') || '[]');
  localStorage.setItem(LS_PREFIX + 'clients', JSON.stringify(list.filter(c => c.id !== id)));
}

export async function queueCmsChange(item) {
  assertClientId(item?.client_id, 'queueCmsChange');
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_cms_queue')
      .insert(item)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'cms_queue') || '[]');
  item.id = crypto.randomUUID();
  item.created_at = new Date().toISOString();
  item.status = item.status || 'pending';
  list.push(item);
  localStorage.setItem(LS_PREFIX + 'cms_queue', JSON.stringify(list));
  return item;
}

export async function listCmsQueue(clientId) {
  if (supabase) {
    let q = supabase
      .from('syte_suite_cms_queue')
      .select('*')
      .order('created_at', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'cms_queue') || '[]');
  return clientId ? list.filter(i => i.client_id === clientId) : list;
}

export async function updateCmsQueueItem(id, patch) {
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_cms_queue')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'cms_queue') || '[]');
  const idx = list.findIndex(i => i.id === id);
  if (idx >= 0) list[idx] = { ...list[idx], ...patch };
  localStorage.setItem(LS_PREFIX + 'cms_queue', JSON.stringify(list));
  return list[idx];
}

export async function logProgress(entry) {
  if (supabase) {
    await supabase.from('syte_suite_progress').insert(entry);
  }
}

// ── Suite-wide settings sync (syte_suite_settings) ─────────────────────────
// One shared row (id='global') holding suite-wide settings — currently the
// external AI-engine API keys. Lets the keys follow the operator to any
// device instead of living only in per-device localStorage (which is why the
// AEO probe silently dropped to Claude-only when a browser had no keys).
const SETTINGS_ROW_ID = 'global';

// Returns the stored settings object, or null when Supabase isn't configured
// or the row doesn't exist yet. Never throws — a sync failure must not break
// the local-first settings flow.
export async function loadRemoteSettings() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('syte_suite_settings')
      .select('data')
      .eq('id', SETTINGS_ROW_ID)
      .maybeSingle();
    if (error) return null;
    return data?.data || null;
  } catch { return null; }
}

// Merge `patch` into the shared settings row (read-modify-write so we never
// clobber keys this device didn't touch). Fire-and-forget from the caller.
export async function saveRemoteSettings(patch) {
  if (!supabase || !patch || typeof patch !== 'object') return;
  // Only push non-empty values. The settings modal saves all fields at once
  // (including blanks a device hasn't filled in); without this filter a device
  // that opens settings before remote hydration lands could overwrite a good
  // remote key with an empty string. Biasing toward never losing a key means
  // an intentional clear won't propagate — an acceptable trade for a
  // don't-lose-my-keys sync.
  const clean = {};
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === 'string' ? v.trim() : v) clean[k] = v;
  }
  if (!Object.keys(clean).length) return;
  try {
    const existing = (await loadRemoteSettings()) || {};
    const merged = { ...existing, ...clean };
    const { error } = await supabase
      .from('syte_suite_settings')
      .upsert({ id: SETTINGS_ROW_ID, data: merged, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw error;
  } catch { /* best-effort — localStorage remains the source of truth locally */ }
}

// Connection diagnostic — pings the clients table with a HEAD count and
// returns the first real error (or a 'no-supabase' marker if env vars
// aren't set). Used by the master Clients view to show a live banner.
export async function diagnoseSupabase() {
  const url = import.meta.env.VITE_SUPABASE_URL || '';
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  if (!supabase) {
    return {
      ok: false,
      reason: 'no-supabase',
      detail: 'VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set. Running on localStorage fallback.',
      url,
      keyPreview: key ? key.slice(0, 12) + '…' : '(empty)'
    };
  }

  // Table-level check only — this is what actually matters. The new
  // `sb_publishable_*` API keys return 401 on the /rest/v1/ root endpoint
  // even when regular table access works fine, so we skip the root ping
  // and go straight to a count HEAD against the actual table we use.
  try {
    const { error } = await supabase
      .from('syte_suite_clients')
      .select('id', { count: 'exact', head: true });
    if (error) {
      return {
        ok: false,
        reason: 'table-error',
        detail: 'Supabase table query failed: ' + error.message + '. Did you run both supabase-schema.sql and supabase-schema-reports.sql?',
        url,
        keyPreview: key.slice(0, 12) + '…'
      };
    }
  } catch (e) {
    return {
      ok: false,
      reason: 'network',
      detail: 'Network fetch to Supabase failed: ' + (e.message || String(e)) + '. Most likely the URL is wrong, the project is paused, or a browser extension is blocking it.',
      url,
      keyPreview: key.slice(0, 12) + '…'
    };
  }

  return { ok: true, url, keyPreview: key.slice(0, 12) + '…' };
}

// ---------------------------------------------------------------------------
// Reporting module — AEO snapshot history + monthly report log.
// Both fall back to localStorage so the module works offline.
// ---------------------------------------------------------------------------

export async function saveAeoSnapshot(row) {
  assertClientId(row?.client_id, 'saveAeoSnapshot');
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_aeo_history')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'aeo_history') || '[]');
  row.id = crypto.randomUUID();
  row.created_at = new Date().toISOString();
  list.push(row);
  localStorage.setItem(LS_PREFIX + 'aeo_history', JSON.stringify(list));
  return row;
}

export async function listAeoSnapshots(clientId) {
  if (supabase) {
    let q = supabase
      .from('syte_suite_aeo_history')
      .select('*')
      .order('month', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'aeo_history') || '[]');
  return clientId ? list.filter(r => r.client_id === clientId) : list;
}

export async function deleteAeoSnapshot(id) {
  if (supabase) {
    const { error } = await supabase.from('syte_suite_aeo_history').delete().eq('id', id);
    if (error) throw error;
    return;
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'aeo_history') || '[]');
  localStorage.setItem(LS_PREFIX + 'aeo_history', JSON.stringify(list.filter(r => r.id !== id)));
}

// ---------------------------------------------------------------------------
// AEO v2 — per-run result capture + raw-response storage (90-day retention).
// Runs are append-only; raw bodies are deduped by content hash. Both fall
// back to localStorage so the runner keeps working offline.
// ---------------------------------------------------------------------------

const AEO_RUNS_KEY = LS_PREFIX + 'aeo_runs';
const AEO_RAW_KEY = LS_PREFIX + 'aeo_raw';

export async function saveAeoRuns(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  for (const r of rows) assertClientId(r?.client_id, 'saveAeoRuns');
  if (supabase) {
    try {
      const { error } = await supabase.from('syte_suite_aeo_runs').insert(rows);
      if (error) throw error;
      return;
    } catch (e) {
      console.warn('[aeo] saveAeoRuns DB write failed, using localStorage:', e.message);
    }
  }
  const list = JSON.parse(localStorage.getItem(AEO_RUNS_KEY) || '[]');
  for (const r of rows) list.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r });
  localStorage.setItem(AEO_RUNS_KEY, JSON.stringify(list));
}

// Convenience: persist a snapshot's per-run records + deduped raw bodies.
// Wired to runSnapshot's onRuns callback. Maps camelCase runner records to the
// snake_case aeo_runs columns.
export async function persistAeoRuns(records, rawEntries) {
  const rows = (records || []).map(r => ({
    client_id: r.client_id,
    month: r.month,
    probe_id: r.probeId,
    engine: r.engine,
    run_index: r.runIndex,
    run_mode: r.runMode,
    appeared: r.appeared,
    position: r.position,
    list_length: r.listLength,
    segment_label: r.segmentLabel,
    reason_phrase: r.reasonPhrase,
    sentiment: r.sentiment,
    competitors_named: r.competitorsNamed || [],
    cited_urls: r.citedUrls || [],
    raw_response_hash: r.rawResponseHash,
    timestamp: r.timestamp
  }));
  await saveAeoRuns(rows);
  // Dedupe raw bodies by hash and write them in ONE bulk upsert. The old
  // per-hash SELECT+INSERT loop made ~2 round-trips per response (hundreds
  // per run), which blocked the end of every snapshot for minutes.
  const seen = new Set();
  const rawRows = [];
  for (const e of (rawEntries || [])) {
    if (!e.hash || seen.has(e.hash)) continue;
    seen.add(e.hash);
    rawRows.push({ hash: e.hash, client_id: e.client_id, engine: e.engine, run_mode: e.run_mode, raw_response: e.raw_response });
  }
  if (!rawRows.length) return;
  if (supabase) {
    try {
      await supabase.from('syte_suite_aeo_raw').upsert(rawRows, { onConflict: 'hash', ignoreDuplicates: true });
      return;
    } catch (e) {
      console.warn('[aeo] bulk raw upsert failed, using localStorage:', e.message);
    }
  }
  try {
    const store = JSON.parse(localStorage.getItem(AEO_RAW_KEY) || '{}');
    for (const r of rawRows) if (!store[r.hash]) store[r.hash] = { engine: r.engine, run_mode: r.run_mode, raw_response: r.raw_response, created_at: new Date().toISOString() };
    localStorage.setItem(AEO_RAW_KEY, JSON.stringify(store));
  } catch {}
}

export async function listAeoRuns(clientId, month) {
  if (supabase) {
    try {
      let q = supabase.from('syte_suite_aeo_runs').select('*').order('timestamp', { ascending: false });
      if (clientId) q = q.eq('client_id', clientId);
      if (month) q = q.eq('month', month);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    } catch { /* fall through */ }
  }
  const list = JSON.parse(localStorage.getItem(AEO_RUNS_KEY) || '[]');
  return list.filter(r =>
    (!clientId || r.client_id === clientId) && (!month || r.month === month));
}

// Store a raw response body keyed by hash. Deduped: if the hash already exists
// we skip the write. Retention (90 days) is enforced by a scheduled SQL delete
// (see supabase-schema-aeo-v2.sql).
export async function saveRawResponse({ hash, client_id, engine, run_mode, raw_response }) {
  if (!hash) return;
  if (supabase) {
    try {
      const { data: existing } = await supabase
        .from('syte_suite_aeo_raw').select('hash').eq('hash', hash).limit(1);
      if (existing?.length) return;
      await supabase.from('syte_suite_aeo_raw')
        .insert({ hash, client_id, engine, run_mode, raw_response });
      return;
    } catch (e) {
      console.warn('[aeo] saveRawResponse DB write failed, using localStorage:', e.message);
    }
  }
  try {
    const store = JSON.parse(localStorage.getItem(AEO_RAW_KEY) || '{}');
    if (!store[hash]) {
      store[hash] = { engine, run_mode, raw_response, created_at: new Date().toISOString() };
      localStorage.setItem(AEO_RAW_KEY, JSON.stringify(store));
    }
  } catch {}
}

export async function getRawResponse(hash) {
  if (!hash) return null;
  if (supabase) {
    try {
      const { data } = await supabase
        .from('syte_suite_aeo_raw').select('raw_response').eq('hash', hash).limit(1).single();
      return data?.raw_response || null;
    } catch { /* fall through */ }
  }
  try {
    const store = JSON.parse(localStorage.getItem(AEO_RAW_KEY) || '{}');
    return store[hash]?.raw_response || null;
  } catch { return null; }
}

const SENT_LOG_KEY = LS_PREFIX + 'report_log';

// Sent-reports list columns. The heavy `report_pdf` (a base64 proof PDF, only
// present on manually-logged sends) is deliberately EXCLUDED — pulling it for
// every row would bloat History. It's fetched on demand via getSentReportPdf.
const SENT_LIST_COLS_FULL = 'id, client_id, month, sent_date, qa_score, aeo_snapshot_score, email_subject, created_at, manual, pdf_filename, notes';
// Base columns for projects that haven't migrated the proof columns in yet.
const SENT_LIST_COLS_BASE = 'id, client_id, month, sent_date, qa_score, aeo_snapshot_score, email_subject, created_at';

// Append a sent-report row to the localStorage mirror. `report_pdf` is dropped
// unless explicitly kept — a base64 PDF would quickly blow the localStorage
// quota. Returns the stored (lightweight) row.
function appendSentLocal(row, { keepPdf = false } = {}) {
  const { report_pdf, ...rest } = row;
  const saved = {
    id: row.id || crypto.randomUUID(),
    ...rest,
    ...(keepPdf && report_pdf ? { report_pdf } : {}),
    sent_date: row.sent_date || new Date().toISOString(),
    created_at: row.created_at || new Date().toISOString()
  };
  try {
    const list = JSON.parse(localStorage.getItem(SENT_LOG_KEY) || '[]');
    list.push(saved);
    localStorage.setItem(SENT_LOG_KEY, JSON.stringify(list));
  } catch {
    // Quota exceeded (usually a large PDF with no Supabase configured). Retry
    // once without the PDF so at least the send is recorded locally.
    if (keepPdf) return appendSentLocal(row, { keepPdf: false });
  }
  return saved;
}

export async function logReportSent(row) {
  assertClientId(row?.client_id, 'logReportSent');
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('syte_suite_report_log')
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      // Mirror a lightweight copy locally (no PDF — the DB holds it) so the
      // Sent bucket and History still resolve offline. Keyed by the DB id.
      appendSentLocal({ ...row, id: data.id });
      return data;
    } catch (e) {
      console.warn('[reports] logReportSent DB write failed, using localStorage:', e.message);
    }
  }
  // No Supabase, or the DB write failed — keep the full record (incl. PDF)
  // locally so the proof isn't lost.
  return appendSentLocal(row, { keepPdf: true });
}

export async function listSentReports(clientId) {
  let dbRows = [];
  if (supabase) {
    try {
      const run = (cols) => {
        let q = supabase
          .from('syte_suite_report_log')
          .select(cols)
          .order('sent_date', { ascending: false });
        if (clientId) q = q.eq('client_id', clientId);
        return q;
      };
      let { data, error } = await run(SENT_LIST_COLS_FULL);
      if (error) {
        // Proof columns not migrated yet — retry with the base column set.
        ({ data, error } = await run(SENT_LIST_COLS_BASE));
        if (error) throw error;
      }
      dbRows = data || [];
    } catch (e) {
      console.warn('[reports] listSentReports DB read failed, using localStorage:', e.message);
    }
  }
  // Merge the localStorage mirror (deduped by id, DB wins). Strip any PDF that
  // lives in a local row so the list stays lean.
  let localRows = [];
  try { localRows = JSON.parse(localStorage.getItem(SENT_LOG_KEY) || '[]'); } catch {}
  if (clientId) localRows = localRows.filter(r => r.client_id === clientId);
  const dbIds = new Set(dbRows.map(r => r.id));
  const merged = [
    ...dbRows,
    ...localRows.filter(r => !dbIds.has(r.id)).map(({ report_pdf, ...r }) => r)
  ].sort((a, b) => (b.sent_date || '').localeCompare(a.sent_date || ''));
  return merged;
}

// Fetch the uploaded proof PDF (base64 data URL) for a single sent report, on
// demand. Kept out of listSentReports so the heavy blob never bloats History.
export async function getSentReportPdf(id) {
  if (!id) return null;
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('syte_suite_report_log')
        .select('report_pdf, pdf_filename')
        .eq('id', id)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data?.report_pdf) return data;
    } catch (e) {
      console.warn('[reports] getSentReportPdf DB read failed, using localStorage:', e.message);
    }
  }
  try {
    const list = JSON.parse(localStorage.getItem(SENT_LOG_KEY) || '[]');
    const found = list.find(r => r.id === id);
    return found?.report_pdf ? { report_pdf: found.report_pdf, pdf_filename: found.pdf_filename } : null;
  } catch { return null; }
}

// Generation tracking — records when a report microsite has been built
// (regardless of whether it has been sent yet). Used by the Reports module
// to surface "Generated" cards distinct from "Sent" cards.
//
// Storage is deliberately split in two:
//   GEN_LOG_KEY      — one lean status row per (client, month, report_type).
//                      Small enough that it always fits, so the "Generated"
//                      card survives even when everything else fails.
//   GEN_CONTENT_KEY  — the heavy payload (microsite JSON, saved report data,
//                      an edited HTML override that can run to megabytes),
//                      one localStorage entry per report, written
//                      best-effort and pruned when the quota is hit.
//
// They used to share one array. A single report could carry a ~2MB HTML
// override, so after a few clients the array blew past the ~5MB localStorage
// quota, setItem threw, and the catch swallowed it — losing the status row
// too. Combined with a failing DB write that made generated reports vanish
// completely.
const GEN_LOG_KEY = LS_PREFIX + 'report_generated_log';
const GEN_CONTENT_KEY = LS_PREFIX + 'report_generated_content:';

// Status-only columns that exist on the base table even when the heavy
// content columns (microsite_json, report_data, qa, …) haven't been migrated
// in yet (supabase-schema-persistence.sql). Used as a fallback write so the
// "Generated" flag still reaches the shared DB when the full payload write
// fails on a project that only ran supabase-schema-reports.sql.
const GEN_LOG_STATUS_COLS = ['client_id', 'month', 'generated_at', 'qa_score', 'email_subject', 'report_type'];

// Heavy columns — everything needed to re-render a saved report. Kept out of
// the status row and out of the list queries.
const GEN_LOG_CONTENT_COLS = ['email_body', 'microsite_json', 'qa', 'aeo_probe', 'report_data', 'microsite_html_override'];

// Run supabase-schema-report-type.sql to fix. Named in the operator-facing
// warning so the failure says what to do about it.
const GEN_TYPE_MIGRATION = 'supabase-schema-report-type.sql';

function pickKeys(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function omitKeys(obj, keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

// The SEO and AEO reports are separate deliverables that coexist for a
// month, so every lookup is keyed by all three fields. Rows logged before
// the split carry report_type 'full'.
function generatedKey(r) {
  return (r.client_id || '') + '|' + (r.month || '') + '|' + (r.report_type || 'full');
}

function readGeneratedIndex() {
  try { return JSON.parse(localStorage.getItem(GEN_LOG_KEY) || '[]'); } catch { return []; }
}

// Store the heavy half of a report on its own key. Best-effort: on a quota
// error, drop the oldest stored payloads (other reports keep their status
// rows and can be regenerated) and retry once.
function writeGeneratedContent(payload) {
  const content = pickKeys(payload, GEN_LOG_CONTENT_COLS);
  if (Object.keys(content).length === 0) return true;
  const key = GEN_CONTENT_KEY + generatedKey(payload);
  const body = JSON.stringify(content);
  try {
    localStorage.setItem(key, body);
    return true;
  } catch {}
  // Quota. Evict other reports' content, oldest generation first.
  const index = readGeneratedIndex()
    .filter(r => generatedKey(r) !== generatedKey(payload))
    .sort((a, b) => String(a.generated_at || '').localeCompare(String(b.generated_at || '')));
  for (const stale of index) {
    try { localStorage.removeItem(GEN_CONTENT_KEY + generatedKey(stale)); } catch {}
    try {
      localStorage.setItem(key, body);
      return true;
    } catch {}
  }
  // Still no room — the status row below is what matters; the report content
  // lives in the DB (or can be regenerated).
  try { localStorage.removeItem(key); } catch {}
  return false;
}

function readGeneratedContent(row) {
  try {
    const raw = localStorage.getItem(GEN_CONTENT_KEY + generatedKey(row));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Upsert the generated-log row into the localStorage mirror by
// (client, month, report_type). Generating one report must never overwrite
// the record of the other.
function upsertGeneratedLocal(payload) {
  const status = omitKeys(payload, GEN_LOG_CONTENT_COLS);
  try {
    const list = readGeneratedIndex();
    const idx = list.findIndex(r => generatedKey(r) === generatedKey(payload));
    if (idx >= 0) list[idx] = { ...list[idx], ...status };
    else list.push({ id: crypto.randomUUID(), ...status });
    localStorage.setItem(GEN_LOG_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[reports] generated-report status mirror write failed:', e.message);
  }
  writeGeneratedContent(payload);
  return payload;
}

// Postgres unique-violation. Raised when the generated log still carries the
// pre-split `unique (client_id, month)` constraint and a client already has
// the other report type logged for that month.
function isUniqueViolation(e) {
  return e?.code === '23505' || /duplicate key value|unique constraint/i.test(e?.message || '');
}

async function dbUpsertGenerated(payload) {
  // Keyed by report_type too: the SEO and AEO reports coexist for a month.
  const { data: existing } = await supabase
    .from('syte_suite_report_generated_log')
    .select('id')
    .eq('client_id', payload.client_id)
    .eq('month', payload.month)
    .eq('report_type', payload.report_type || 'full')
    .limit(1);
  if (existing?.length > 0) {
    const { data, error } = await supabase
      .from('syte_suite_report_generated_log')
      .update(payload).eq('id', existing[0].id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from('syte_suite_report_generated_log')
    .insert(payload).select().single();
  if (error) {
    if (isUniqueViolation(error)) {
      const e = new Error(
        'The reports table still allows only one report per client per month, so this ' +
        (payload.report_type || 'full').toUpperCase() +
        ' report could not be saved alongside the other one. Run ' + GEN_TYPE_MIGRATION + ' in Supabase.'
      );
      e.needsTypeMigration = true;
      throw e;
    }
    throw error;
  }
  return data;
}

// Log a generated report. Never throws: the return value carries where the
// row actually landed so the caller can tell the operator when a report is
// only on this device.
//   saved_to      'db' | 'local'
//   save_warning  operator-facing reason the shared copy failed, if it did
export async function logReportGenerated(row) {
  const payload = {
    ...row,
    // Rows are keyed by report type; default keeps pre-split callers working.
    report_type: row.report_type || 'full',
    generated_at: row.generated_at || new Date().toISOString()
  };
  // Always mirror locally FIRST so the just-generated status survives a
  // refresh even if every DB write below fails — e.g. the content columns
  // were never migrated in, so the full insert errors with "column … does not
  // exist". listGeneratedReports / getGeneratedReport merge this back in.
  upsertGeneratedLocal(payload);
  if (!supabase) return { ...payload, saved_to: 'local' };

  let warning = '';
  try {
    return { ...(await dbUpsertGenerated(payload)), saved_to: 'db' };
  } catch (e) {
    warning = e.message;
    console.warn('[reports] logReportGenerated full write failed, retrying with status-only columns:', e.message);
    // A unique violation is about the row's identity, not its columns —
    // retrying with fewer columns hits exactly the same constraint.
    if (e.needsTypeMigration) return { ...payload, saved_to: 'local', save_warning: warning };
    // The heavy content columns may not exist on this project. Retry with
    // just the status columns so the "Generated" card still shows on every
    // device (the full content stays available from the local mirror).
    try {
      const data = await dbUpsertGenerated(pickKeys(payload, GEN_LOG_STATUS_COLS));
      return {
        ...payload, ...data, saved_to: 'db',
        save_warning: 'Saved the report status, but its content stayed on this device only ' +
          '(the report content columns are missing — run supabase-schema-persistence.sql). Cause: ' + warning
      };
    } catch (e2) {
      warning = e2.message;
      console.warn('[reports] logReportGenerated status-only write also failed, using localStorage only:', e2.message);
    }
  }
  return {
    ...payload,
    saved_to: 'local',
    save_warning: 'This report was saved on this device only — it will not show for anyone else. Cause: ' + warning
  };
}

// Newest-first status rows for the Generated dashboard. Content columns are
// left out: the dashboard only needs status, and the payloads are large.
export async function listGeneratedReports(clientId) {
  let dbRows = [];
  if (supabase) {
    try {
      const run = (cols) => {
        let q = supabase
          .from('syte_suite_report_generated_log')
          .select(cols)
          .order('generated_at', { ascending: false });
        if (clientId) q = q.eq('client_id', clientId);
        return q;
      };
      let { data, error } = await run(GEN_LOG_STATUS_COLS.concat('id').join(', '));
      if (error) {
        // report_type not migrated in yet — retry without it.
        ({ data, error } = await run('id, client_id, month, generated_at, qa_score, email_subject'));
        if (error) throw error;
      }
      dbRows = data || [];
    } catch (e) {
      // Table may not exist — merge falls back to localStorage only.
      console.warn('[reports] listGeneratedReports DB read failed, using localStorage:', e.message);
    }
  }
  // Merge the localStorage mirror so a row that only made it to the local
  // cache (DB write failed / offline) still surfaces. The DB wins on
  // conflict, keyed by (client_id, month, report_type) — keying it by
  // (client_id, month) alone dropped a locally-saved AEO report whenever the
  // SEO report for that month had reached the DB.
  let localRows = readGeneratedIndex();
  if (clientId) localRows = localRows.filter(r => r.client_id === clientId);
  const dbKeys = new Set(dbRows.map(generatedKey));
  return [...dbRows, ...localRows.filter(r => !dbKeys.has(generatedKey(r)))]
    .sort((a, b) => String(b.generated_at || '').localeCompare(String(a.generated_at || '')));
}

// Fetch the full saved content (email body + microsite JSON + QA + probe +
// reportData snapshot) for a single client/month so the report can be
// re-rendered without regenerating it. Returns null when nothing is saved.
//
// A month can now hold both an SEO and an AEO report. Pass reportType to
// pick one; without it the most recently generated of the two is returned,
// which is the one the operator was last working on.
export async function getGeneratedReport(clientId, month, reportType) {
  assertClientId(clientId, 'getGeneratedReport');
  if (supabase) {
    try {
      let q = supabase
        .from('syte_suite_report_generated_log')
        .select('*')
        .eq('client_id', clientId)
        .eq('month', month);
      if (reportType) q = q.eq('report_type', reportType);
      const { data, error } = await q
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      // Only return the DB row when there IS one. A missing row (data null)
      // falls through to the local mirror below, so a report whose full write
      // failed and only landed in localStorage still rehydrates review mode.
      if (data) {
        // A status-only row — written when the content columns aren't
        // migrated in — has no microsite to render. The device that
        // generated it still holds the content, so fill it back in rather
        // than showing an empty review screen.
        if (!data.microsite_json) {
          const local = readGeneratedContent({ ...data, report_type: data.report_type || reportType || 'full' });
          if (local) return { ...data, ...local };
        }
        return data;
      }
    } catch (e) {
      console.warn('[reports] getGeneratedReport DB read failed, using localStorage:', e.message);
    }
  }
  const matches = readGeneratedIndex()
    .filter(r => r.client_id === clientId && r.month === month)
    .filter(r => !reportType || (r.report_type || 'full') === reportType)
    .sort((a, b) => String(b.generated_at || '').localeCompare(String(a.generated_at || '')));
  const found = matches[0];
  if (!found) return null;
  return { ...found, ...(readGeneratedContent(found) || {}) };
}

// ---------------------------------------------------------------------------
// Implementation tracking — cross-module change verification.
// ---------------------------------------------------------------------------

export async function logImplementation(row) {
  assertClientId(row?.client_id, 'logImplementation');
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_implementations')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'implementations') || '[]');
  row.id = crypto.randomUUID();
  row.created_at = new Date().toISOString();
  row.implemented_at = row.implemented_at || new Date().toISOString();
  row.verification_status = 'pending';
  list.push(row);
  localStorage.setItem(LS_PREFIX + 'implementations', JSON.stringify(list));
  return row;
}

export async function updateImplementation(id, patch) {
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_implementations')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'implementations') || '[]');
  const idx = list.findIndex(r => r.id === id);
  if (idx >= 0) list[idx] = { ...list[idx], ...patch };
  localStorage.setItem(LS_PREFIX + 'implementations', JSON.stringify(list));
  return list[idx];
}

// Columns safe to pull in bulk. Deliberately EXCLUDES verification_detail —
// the "Upload screenshot" verification path embeds a base64 image inside that
// column ([SCREENSHOT]…[/SCREENSHOT]), so selecting it for every row made
// listAllImplementations() balloon to multiple MB and time out server-side
// (HTTP 500: "…/syte_suite_implementations?select=*&order=created_at.desc").
// The dashboards only need status + dates; the explanation/screenshot is
// fetched per row, on demand, via getImplementationDetail().
const IMPL_LIST_COLS =
  'id, client_id, module, change_type, page_url, title, description, ' +
  'implemented_by, implemented_at, verification_status, verified_at, created_at';

export async function listImplementations(clientId) {
  if (supabase) {
    let q = supabase
      .from('syte_suite_implementations')
      .select(IMPL_LIST_COLS)
      .order('created_at', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'implementations') || '[]');
  return clientId ? list.filter(r => r.client_id === clientId) : list;
}

export async function listAllImplementations() {
  return listImplementations(null);
}

// Fetch the heavy verification_detail (Claude's explanation + any embedded
// base64 proof screenshot) for a SINGLE implementation, on demand. Kept out
// of the bulk list query above so screenshots never bloat the dashboard read.
export async function getImplementationDetail(id) {
  if (!id) return null;
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_implementations')
      .select('id, verification_detail')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data?.verification_detail || '';
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'implementations') || '[]');
  return (list.find(r => r.id === id) || {}).verification_detail || '';
}

// ---------------------------------------------------------------------------
// External work log — work done OUTSIDE the suite (WebCEO, Google Search
// Console, Screaming Frog, Ahrefs, etc.). Manually logged with an optional
// screenshot as proof, so it counts toward the client's progress record.
// ---------------------------------------------------------------------------

const EXTERNAL_WORK_KEY = LS_PREFIX + 'external_work';

export async function logExternalWork(row) {
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_external_work')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const list = JSON.parse(localStorage.getItem(EXTERNAL_WORK_KEY) || '[]');
  const saved = {
    id: crypto.randomUUID(),
    ...row,
    work_date: row.work_date || new Date().toISOString().slice(0, 10),
    created_at: new Date().toISOString()
  };
  list.unshift(saved);
  localStorage.setItem(EXTERNAL_WORK_KEY, JSON.stringify(list));
  return saved;
}

export async function listExternalWork(clientId) {
  if (supabase) {
    let q = supabase
      .from('syte_suite_external_work')
      .select('*')
      .order('work_date', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  const list = JSON.parse(localStorage.getItem(EXTERNAL_WORK_KEY) || '[]');
  return clientId ? list.filter(r => r.client_id === clientId) : list;
}

export async function deleteExternalWork(id) {
  if (supabase) {
    const { error } = await supabase.from('syte_suite_external_work').delete().eq('id', id);
    if (error) throw error;
    return;
  }
  const list = JSON.parse(localStorage.getItem(EXTERNAL_WORK_KEY) || '[]');
  localStorage.setItem(EXTERNAL_WORK_KEY, JSON.stringify(list.filter(r => r.id !== id)));
}

// ---------------------------------------------------------------------------
// Technical SEO tasks — persisted to Supabase so scans survive page reloads.
// Falls back to localStorage if Supabase isn't configured.
// ---------------------------------------------------------------------------

const TSEO_KEY = LS_PREFIX + 'tseo_tasks';

// Build the Supabase row shape from a task object.
function tseoTaskRow(t) {
  return {
    id: t.id,
    client_id: t.client_id,
    client_name: t.client_name,
    title: t.title,
    description: t.description,
    priority: t.priority,
    page_url: t.page_url,
    fix_type: t.fix_type,
    copy_paste_fix: t.copy_paste_fix,
    impact: t.impact,
    effort: t.effort,
    status: t.status || 'open',
    assignee: t.assignee,
    data_source: t.data_source,
    impl_id: t.impl_id || null,
    created_at: t.created_at || new Date().toISOString()
  };
}

// Non-destructive upsert of task rows, keyed on id. Never deletes anything —
// updates rows that exist, inserts the rest.
async function upsertTseoRows(tasks) {
  if (!supabase || !tasks || tasks.length === 0) return;
  const { error } = await supabase
    .from('syte_suite_tseo_tasks')
    .upsert(tasks.map(tseoTaskRow), { onConflict: 'id' });
  if (error) console.error('saveTseoTasks error:', error);
}

export async function saveTseoTasks(tasks) {
  // Non-destructive upsert keyed on the task id. Each task row carries a
  // stable uuid, so this updates rows that already exist and inserts new
  // ones WITHOUT deleting anything.
  //
  // The previous implementation deleted every row for a client and
  // re-inserted from the caller's in-memory snapshot. Because this ran on
  // every task change and the app is multi-user, one browser's stale snapshot
  // could wipe assignees/statuses that teammates had set — the "all assigned
  // tasks were reset" bug. Upsert never removes rows another user added, and
  // callers now pass only the rows they actually changed (see TechnicalSEO).
  await upsertTseoRows(tasks);
  // Always keep localStorage in sync as fallback. The cache can blow past
  // the per-origin quota when tasks carry large copy_paste_fix payloads
  // (full JSON-LD, meta descriptions, etc.); drop the cache rather than
  // throwing — Supabase is authoritative.
  const json = JSON.stringify(tasks);
  try {
    localStorage.setItem(TSEO_KEY, json);
  } catch {
    try { localStorage.removeItem(TSEO_KEY); } catch {}
    try { localStorage.setItem(TSEO_KEY, json); } catch {}
  }
}

// Re-scan replace: swap ONE client's OPEN tasks for a fresh set, leaving
// done/verified history and every OTHER client's tasks untouched. This is the
// only destructive task write, and it is scoped + deliberate (a user-triggered
// scan) — unlike the old blanket delete+insert that ran on every state change
// and reset the whole team's assignments. localStorage is refreshed by the
// caller's full-state persist effect, so we don't rewrite it here.
export async function replaceClientOpenTasks(clientId, newTasks) {
  if (supabase && clientId) {
    await supabase.from('syte_suite_tseo_tasks')
      .delete().eq('client_id', clientId).eq('status', 'open');
  }
  await upsertTseoRows(newTasks);
}

export async function loadTseoTasks() {
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_tseo_tasks')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data?.length > 0) {
      // Sync to localStorage as cache (best-effort — may exceed quota).
      try { localStorage.setItem(TSEO_KEY, JSON.stringify(data)); } catch {}
      return data;
    }
  }
  // Fallback to localStorage (also handles the old key migration)
  const legacy = localStorage.getItem('syte-suite-tseo-tasks');
  if (legacy) {
    try { return JSON.parse(legacy); } catch { return []; }
  }
  return [];
}

export async function updateTseoTask(id, patch) {
  if (supabase) {
    await supabase.from('syte_suite_tseo_tasks').update(patch).eq('id', id);
  }
}

// ---------------------------------------------------------------------------
// AEO optimization results — persisted to Supabase.
// ---------------------------------------------------------------------------

const AEO_RESULTS_KEY = LS_PREFIX + 'aeo_results';

export async function saveAeoResult(result) {
  if (supabase) {
    // Upsert by client_id + url
    const row = {
      client_id: result.client_id,
      url: result.url,
      path: result.path,
      sessions: result.sessions || 0,
      priority: result.priority,
      optimizations: result.optimizations || [],
      // Append-only ledger of every optimization this page has ever been
      // given ("type::name"). `optimizations` is replaced on each run, so
      // without this the next run has no memory of what it already shipped
      // and hands the client the same items again.
      prior_keys: result.prior_keys || [],
      error: result.error,
      generated_at: result.generated_at || new Date().toISOString()
    };
    // Try to find existing
    const { data: existing } = await supabase
      .from('syte_suite_aeo_results')
      .select('id')
      .eq('client_id', result.client_id)
      .eq('url', result.url)
      .limit(1);
    const write = (payload) => existing?.length > 0
      ? supabase.from('syte_suite_aeo_results').update(payload).eq('id', existing[0].id)
      : supabase.from('syte_suite_aeo_results').insert(payload);
    const { error } = await write(row);
    // supabase-schema-aeo-prior-keys.sql may not have been run yet on this
    // project. Losing the run's optimizations over a missing ledger column
    // would be far worse than losing the ledger, so retry without it.
    if (error && /prior_keys/i.test(error.message || '')) {
      const { prior_keys, ...legacy } = row;
      console.warn('[aeo] prior_keys column missing — run supabase-schema-aeo-prior-keys.sql. Saving without the ledger.');
      await write(legacy);
    }
  }
}

export async function loadAeoResults() {
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_aeo_results')
      .select('*')
      .order('generated_at', { ascending: false });
    if (!error && data?.length > 0) {
      // Convert to the keyed object format the UI expects
      const obj = {};
      for (const r of data) {
        obj[r.client_id + '::' + r.url] = r;
      }
      // Best-effort offline mirror — Supabase is the source of truth, so
      // it's fine if the browser quota rejects this once it gets large.
      try { localStorage.setItem(AEO_RESULTS_KEY, JSON.stringify(obj)); } catch {}
      return obj;
    }
  }
  try { return JSON.parse(localStorage.getItem(AEO_RESULTS_KEY) || '{}'); } catch { return {}; }
}

export async function deleteAeoResult(clientId, url) {
  if (supabase) {
    await supabase.from('syte_suite_aeo_results')
      .delete().eq('client_id', clientId).eq('url', url);
  }
  // Also clean localStorage
  try {
    const obj = JSON.parse(localStorage.getItem(AEO_RESULTS_KEY) || '{}');
    const key = clientId + '::' + url;
    delete obj[key];
    localStorage.setItem(AEO_RESULTS_KEY, JSON.stringify(obj));
  } catch {}
}

// ---------------------------------------------------------------------------
// Rejected optimizations — operator-driven blocklist so a task or AEO
// snippet that's been explicitly rejected doesn't reappear when the next
// month's audit re-discovers the same underlying issue.
// ---------------------------------------------------------------------------

const TSEO_REJECTIONS_KEY = LS_PREFIX + 'tseo_rejections';
const AEO_REJECTIONS_KEY = LS_PREFIX + 'aeo_rejections';

export async function saveTseoRejection(clientId, dedupKey, reason = '') {
  assertClientId(clientId, 'saveTseoRejection');
  const row = { client_id: clientId, dedup_key: dedupKey, reason, rejected_at: new Date().toISOString() };
  if (supabase) {
    const { error } = await supabase
      .from('syte_suite_tseo_rejections')
      .upsert(row, { onConflict: 'client_id,dedup_key' });
    if (error) throw error;
  }
  try {
    const list = JSON.parse(localStorage.getItem(TSEO_REJECTIONS_KEY) || '[]');
    const idx = list.findIndex(r => r.client_id === clientId && r.dedup_key === dedupKey);
    if (idx >= 0) list[idx] = row; else list.push(row);
    localStorage.setItem(TSEO_REJECTIONS_KEY, JSON.stringify(list));
  } catch {}
  return row;
}

export async function listTseoRejections() {
  if (supabase) {
    const { data, error } = await supabase.from('syte_suite_tseo_rejections').select('*');
    if (!error && data) {
      try { localStorage.setItem(TSEO_REJECTIONS_KEY, JSON.stringify(data)); } catch {}
      return data;
    }
  }
  try { return JSON.parse(localStorage.getItem(TSEO_REJECTIONS_KEY) || '[]'); } catch { return []; }
}

export async function deleteTseoRejection(clientId, dedupKey) {
  if (supabase) {
    await supabase.from('syte_suite_tseo_rejections')
      .delete().eq('client_id', clientId).eq('dedup_key', dedupKey);
  }
  try {
    const list = JSON.parse(localStorage.getItem(TSEO_REJECTIONS_KEY) || '[]');
    localStorage.setItem(TSEO_REJECTIONS_KEY, JSON.stringify(
      list.filter(r => !(r.client_id === clientId && r.dedup_key === dedupKey))
    ));
  } catch {}
}

export async function saveAeoRejection(clientId, pageUrl, optKey, reason = '') {
  assertClientId(clientId, 'saveAeoRejection');
  const row = { client_id: clientId, page_url: pageUrl, opt_key: optKey, reason, rejected_at: new Date().toISOString() };
  if (supabase) {
    const { error } = await supabase
      .from('syte_suite_aeo_rejections')
      .upsert(row, { onConflict: 'client_id,page_url,opt_key' });
    if (error) throw error;
  }
  try {
    const list = JSON.parse(localStorage.getItem(AEO_REJECTIONS_KEY) || '[]');
    const idx = list.findIndex(r => r.client_id === clientId && r.page_url === pageUrl && r.opt_key === optKey);
    if (idx >= 0) list[idx] = row; else list.push(row);
    localStorage.setItem(AEO_REJECTIONS_KEY, JSON.stringify(list));
  } catch {}
  return row;
}

export async function listAeoRejections() {
  if (supabase) {
    const { data, error } = await supabase.from('syte_suite_aeo_rejections').select('*');
    if (!error && data) {
      try { localStorage.setItem(AEO_REJECTIONS_KEY, JSON.stringify(data)); } catch {}
      return data;
    }
  }
  try { return JSON.parse(localStorage.getItem(AEO_REJECTIONS_KEY) || '[]'); } catch { return []; }
}

export async function deleteAeoRejection(clientId, pageUrl, optKey) {
  if (supabase) {
    await supabase.from('syte_suite_aeo_rejections')
      .delete().eq('client_id', clientId).eq('page_url', pageUrl).eq('opt_key', optKey);
  }
  try {
    const list = JSON.parse(localStorage.getItem(AEO_REJECTIONS_KEY) || '[]');
    localStorage.setItem(AEO_REJECTIONS_KEY, JSON.stringify(
      list.filter(r => !(r.client_id === clientId && r.page_url === pageUrl && r.opt_key === optKey))
    ));
  } catch {}
}

// ---------------------------------------------------------------------------
// AEO Deep Optimizations — full-page rewrites with FAQ + changes log.
// Stored per (client, url). Upsert on save so re-running overwrites.
// ---------------------------------------------------------------------------

const AEO_DEEP_KEY = LS_PREFIX + 'aeo_deep';

// Convert UI-shape (camelCase) to db-shape (snake_case) and back.
function deepToRow(r) {
  return {
    client_id: r.client_id,
    client_name: r.client_name,
    page_url: r.pageUrl || r.page_url,
    page_title: r.pageTitle || r.page_title,
    description: r.description || '',
    faq: r.faq || '',
    changes_description: r.changesDescription || r.changes_description || [],
    changes_faq: r.changesFaq || r.changes_faq || [],
    product_schema: r.productSchema || r.product_schema || '',
    faq_schema: r.faqSchema || r.faq_schema || '',
    internal_links: r.internalLinks || r.internal_links || [],
    generated_at: r.generated_at || new Date().toISOString()
  };
}

function rowToDeep(row) {
  return {
    id: row.id,
    client_id: row.client_id,
    client_name: row.client_name,
    pageUrl: row.page_url,
    pageTitle: row.page_title,
    description: row.description || '',
    faq: row.faq || '',
    changesDescription: row.changes_description || [],
    changesFaq: row.changes_faq || [],
    productSchema: row.product_schema || '',
    faqSchema: row.faq_schema || '',
    internalLinks: row.internal_links || [],
    generated_at: row.generated_at
  };
}

export async function saveDeepResult(result) {
  const row = deepToRow(result);
  if (supabase) {
    const { data: existing } = await supabase
      .from('syte_suite_aeo_deep')
      .select('id')
      .eq('client_id', row.client_id)
      .eq('page_url', row.page_url)
      .limit(1);
    if (existing?.length > 0) {
      const { data, error } = await supabase
        .from('syte_suite_aeo_deep')
        .update(row).eq('id', existing[0].id).select().single();
      if (error) throw error;
      return rowToDeep(data);
    }
    const { data, error } = await supabase
      .from('syte_suite_aeo_deep').insert(row).select().single();
    if (error) throw error;
    return rowToDeep(data);
  }
  // localStorage fallback
  const list = JSON.parse(localStorage.getItem(AEO_DEEP_KEY) || '[]');
  const idx = list.findIndex(x => x.client_id === row.client_id && x.page_url === row.page_url);
  const saved = { id: crypto.randomUUID(), ...row, created_at: new Date().toISOString() };
  if (idx >= 0) list[idx] = { ...list[idx], ...row };
  else list.unshift(saved);
  localStorage.setItem(AEO_DEEP_KEY, JSON.stringify(list));
  return rowToDeep(idx >= 0 ? list[idx] : saved);
}

export async function listDeepResults(clientId) {
  if (supabase) {
    let q = supabase
      .from('syte_suite_aeo_deep')
      .select('*')
      .order('generated_at', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    if (error) throw error;
    const mapped = (data || []).map(rowToDeep);
    localStorage.setItem(AEO_DEEP_KEY, JSON.stringify(data || []));
    return mapped;
  }
  const list = JSON.parse(localStorage.getItem(AEO_DEEP_KEY) || '[]');
  const filtered = clientId ? list.filter(r => r.client_id === clientId) : list;
  return filtered.map(rowToDeep);
}

export async function deleteDeepResult(id) {
  if (supabase) {
    await supabase.from('syte_suite_aeo_deep').delete().eq('id', id);
  }
  try {
    const list = JSON.parse(localStorage.getItem(AEO_DEEP_KEY) || '[]');
    localStorage.setItem(AEO_DEEP_KEY, JSON.stringify(list.filter(r => r.id !== id)));
  } catch {}
}

// ---------------------------------------------------------------------------
// Content Engine — Quick Blog generations (topic-driven, persisted).
// ---------------------------------------------------------------------------

const BLOGS_KEY = LS_PREFIX + 'content_blogs';

export async function saveBlogResult(blog) {
  const row = {
    client_id: blog.client_id,
    client_name: blog.client_name,
    topic: blog.topic,
    keyword: blog.keyword || '',
    length: blog.length || 1500,
    output: blog.output || '',
    tab: blog.tab || 'New Article',
    opportunity_type: blog.opportunity_type || null,
    generated_at: blog.generated_at || new Date().toISOString()
  };
  // Natural key: (client_id, topic, generated_at month). Re-running Auto
  // Write for the same opportunity — whether by accidental double-click,
  // a re-research that surfaces the same topic, or a regeneration after
  // edits — must NOT produce duplicate rows in the Articles Written list.
  // Update the existing row instead.
  const monthKey = (row.generated_at || '').slice(0, 7);

  // ALWAYS write to localStorage first as a durable backup. If the
  // Supabase write below fails (RLS, schema mismatch, network), the
  // article is still recoverable from local cache and loadContentHistory
  // will surface it via the merge path. Previously a Supabase failure
  // silently dropped the article — the user generated, saw the output
  // in the plan view, navigated away, and the article was gone.
  saveBlogToLocal(row, monthKey);

  if (!supabase) return getLocalById(row, monthKey);

  if (row.client_id && row.topic) {
    const { data: existing } = await supabase
      .from('syte_suite_content_blogs')
      .select('id, generated_at')
      .eq('client_id', row.client_id)
      .eq('topic', row.topic)
      .order('generated_at', { ascending: false })
      .limit(50);
    const sameMonth = (existing || []).find(
      e => (e.generated_at || '').slice(0, 7) === monthKey
    );
    if (sameMonth) {
      const { data, error } = await supabase
        .from('syte_suite_content_blogs')
        .update(row)
        .eq('id', sameMonth.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  }
  const { data, error } = await supabase
    .from('syte_suite_content_blogs').insert(row).select().single();
  if (error) throw error;
  return data;
}

// Internal: upsert a blog row into the localStorage cache by natural key.
function saveBlogToLocal(row, monthKey) {
  try {
    const list = JSON.parse(localStorage.getItem(BLOGS_KEY) || '[]');
    const idx = list.findIndex(
      e => e.client_id === row.client_id &&
           e.topic === row.topic &&
           (e.generated_at || '').slice(0, 7) === monthKey
    );
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...row };
    } else {
      list.unshift({ id: crypto.randomUUID(), ...row, created_at: new Date().toISOString() });
    }
    localStorage.setItem(BLOGS_KEY, JSON.stringify(list));
  } catch {}
}
function getLocalById(row, monthKey) {
  try {
    const list = JSON.parse(localStorage.getItem(BLOGS_KEY) || '[]');
    return list.find(
      e => e.client_id === row.client_id &&
           e.topic === row.topic &&
           (e.generated_at || '').slice(0, 7) === monthKey
    ) || row;
  } catch { return row; }
}

export async function listBlogResults(clientId) {
  if (supabase) {
    let q = supabase
      .from('syte_suite_content_blogs').select('*')
      .order('generated_at', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    if (error) throw error;
    localStorage.setItem(BLOGS_KEY, JSON.stringify(data || []));
    return data || [];
  }
  const list = JSON.parse(localStorage.getItem(BLOGS_KEY) || '[]');
  return clientId ? list.filter(r => r.client_id === clientId) : list;
}

// Shared content history — used by the pipeline status to count articles
// written per client per month AND by the per-client expanded card to
// render the inline preview / Copy buttons / Delete control. The output
// column is included because AutoWrite needs the full body to:
//   • Detect "stub" rows with no actual content (e.g. legacy duplicates
//     or LogExternalWork rows where output was never populated).
//   • Render the parsed-output preview (Meta Title / Description /
//     Article Body / FAQ / QA) without an extra round trip.
// Cached in localStorage for offline fallback.
export async function loadContentHistory() {
  // Merge Supabase + localStorage so any article that survived in local
  // cache (e.g. because the Supabase write failed) still appears in
  // Articles Written. Dedupe by (client_id, topic, month).
  let supaRows = [];
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_content_blogs')
      .select('id,client_id,client_name,topic,keyword,length,tab,opportunity_type,output,generated_at,created_at')
      .order('generated_at', { ascending: false })
      .limit(500);
    if (!error && data) supaRows = data;
  }
  let localRows = [];
  try { localRows = JSON.parse(localStorage.getItem(BLOGS_KEY) || '[]'); } catch {}

  // Supabase wins on conflict (it's the source of truth) — only fall back
  // to a local row if the same (client_id, topic, month) isn't in Supabase.
  const key = (r) => (r.client_id || '') + '|' + (r.topic || '') + '|' +
    ((r.generated_at || r.created_at || '').slice(0, 7));
  const supaKeys = new Set(supaRows.map(key));
  const merged = [
    ...supaRows,
    ...localRows.filter(r => !supaKeys.has(key(r)))
  ].sort((a, b) =>
    (b.generated_at || b.created_at || '').localeCompare(a.generated_at || a.created_at || '')
  );

  // Re-cache the merged view so subsequent offline reads see everything.
  try { localStorage.setItem(BLOGS_KEY, JSON.stringify(merged.slice(0, 500))); } catch {}
  return merged;
}

// ---------------------------------------------------------------------------
// Report data cache — saves fetched GA4/GSC data per client per month
// so it doesn't re-fetch every time the report page opens.
// ---------------------------------------------------------------------------

export async function getCachedReportData(clientId, month) {
  if (supabase) {
    // maybeSingle() (not single()) — a missing cache row is the normal
    // first-run case, and single() answers "no rows" with an HTTP 406 that
    // shows up as a scary console error. maybeSingle() returns null instead.
    const { data } = await supabase
      .from('syte_suite_report_cache')
      .select('data, fetched_at')
      .eq('client_id', clientId)
      .eq('month', month)
      .limit(1)
      .maybeSingle();
    return data || null;
  }
  try {
    const cache = JSON.parse(localStorage.getItem(LS_PREFIX + 'report_cache') || '{}');
    return cache[clientId + '::' + month] || null;
  } catch { return null; }
}

export async function setCachedReportData(clientId, month, reportData) {
  assertClientId(clientId, 'setCachedReportData');
  if (supabase) {
    const { data: existing } = await supabase
      .from('syte_suite_report_cache')
      .select('id')
      .eq('client_id', clientId)
      .eq('month', month)
      .limit(1);
    if (existing?.length > 0) {
      await supabase.from('syte_suite_report_cache')
        .update({ data: reportData, fetched_at: new Date().toISOString() })
        .eq('id', existing[0].id);
    } else {
      await supabase.from('syte_suite_report_cache')
        .insert({ client_id: clientId, month, data: reportData });
    }
  }
  try {
    const cache = JSON.parse(localStorage.getItem(LS_PREFIX + 'report_cache') || '{}');
    cache[clientId + '::' + month] = { data: reportData, fetched_at: new Date().toISOString() };
    localStorage.setItem(LS_PREFIX + 'report_cache', JSON.stringify(cache));
  } catch {}
}

// ---------------------------------------------------------------------------
// Client baselines — a one-time snapshot of a client's rankings + organic
// traffic captured at onboarding. Immutable reference data (one row per
// client), separate from the recurring monthly report cache. Falls back to
// localStorage so it works offline.
// ---------------------------------------------------------------------------

export async function saveBaseline(clientId, month, reportData, capturedBy) {
  assertClientId(clientId, 'saveBaseline');
  if (supabase) {
    const { data: existing } = await supabase
      .from('syte_suite_baselines')
      .select('id')
      .eq('client_id', clientId)
      .limit(1);
    if (existing?.length > 0) {
      const { data, error } = await supabase
        .from('syte_suite_baselines')
        .update({ month, data: reportData, captured_by: capturedBy || null, captured_at: new Date().toISOString() })
        .eq('id', existing[0].id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await supabase
      .from('syte_suite_baselines')
      .insert({ client_id: clientId, month, data: reportData, captured_by: capturedBy || null })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const map = JSON.parse(localStorage.getItem(LS_PREFIX + 'baselines') || '{}');
  const row = {
    id: map[clientId]?.id || crypto.randomUUID(),
    client_id: clientId,
    month,
    data: reportData,
    captured_by: capturedBy || null,
    captured_at: new Date().toISOString(),
    created_at: map[clientId]?.created_at || new Date().toISOString()
  };
  map[clientId] = row;
  localStorage.setItem(LS_PREFIX + 'baselines', JSON.stringify(map));
  return row;
}

export async function getBaseline(clientId) {
  if (supabase) {
    const { data } = await supabase
      .from('syte_suite_baselines')
      .select('*')
      .eq('client_id', clientId)
      .limit(1)
      .single();
    return data || null;
  }
  try {
    const map = JSON.parse(localStorage.getItem(LS_PREFIX + 'baselines') || '{}');
    return map[clientId] || null;
  } catch { return null; }
}

export async function listBaselines() {
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_baselines')
      .select('*')
      .order('captured_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  try {
    const map = JSON.parse(localStorage.getItem(LS_PREFIX + 'baselines') || '{}');
    return Object.values(map);
  } catch { return []; }
}

export async function deleteBaseline(clientId) {
  if (supabase) {
    const { error } = await supabase.from('syte_suite_baselines').delete().eq('client_id', clientId);
    if (error) throw error;
    return;
  }
  try {
    const map = JSON.parse(localStorage.getItem(LS_PREFIX + 'baselines') || '{}');
    delete map[clientId];
    localStorage.setItem(LS_PREFIX + 'baselines', JSON.stringify(map));
  } catch {}
}

export async function deleteBlogResult(id) {
  if (supabase) {
    await supabase.from('syte_suite_content_blogs').delete().eq('id', id);
  }
  try {
    const list = JSON.parse(localStorage.getItem(BLOGS_KEY) || '[]');
    localStorage.setItem(BLOGS_KEY, JSON.stringify(list.filter(r => r.id !== id)));
  } catch {}
}

