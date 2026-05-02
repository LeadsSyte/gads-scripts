import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

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

export async function logReportSent(row) {
  assertClientId(row?.client_id, 'logReportSent');
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_report_log')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'report_log') || '[]');
  row.id = crypto.randomUUID();
  row.sent_date = row.sent_date || new Date().toISOString();
  row.created_at = new Date().toISOString();
  list.push(row);
  localStorage.setItem(LS_PREFIX + 'report_log', JSON.stringify(list));
  return row;
}

export async function listSentReports(clientId) {
  if (supabase) {
    let q = supabase
      .from('syte_suite_report_log')
      .select('*')
      .order('sent_date', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'report_log') || '[]');
  return clientId ? list.filter(r => r.client_id === clientId) : list;
}

// Generation tracking — records when a report microsite has been built
// (regardless of whether it has been sent yet). Used by the Reports module
// to surface "Generated" cards distinct from "Sent" cards.
export async function logReportGenerated(row) {
  const payload = { ...row, generated_at: row.generated_at || new Date().toISOString() };
  if (supabase) {
    try {
      const { data: existing } = await supabase
        .from('syte_suite_report_generated_log')
        .select('id')
        .eq('client_id', payload.client_id)
        .eq('month', payload.month)
        .limit(1);
      if (existing?.length > 0) {
        const { data, error } = await supabase
          .from('syte_suite_report_generated_log')
          .update(payload)
          .eq('id', existing[0].id)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from('syte_suite_report_generated_log')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (e) {
      // Fall through to localStorage if the table doesn't exist yet.
      console.warn('[reports] logReportGenerated DB write failed, using localStorage:', e.message);
    }
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'report_generated_log') || '[]');
  const idx = list.findIndex(r => r.client_id === payload.client_id && r.month === payload.month);
  if (idx >= 0) list[idx] = { ...list[idx], ...payload };
  else list.push({ id: crypto.randomUUID(), ...payload });
  localStorage.setItem(LS_PREFIX + 'report_generated_log', JSON.stringify(list));
  return payload;
}

export async function listGeneratedReports(clientId) {
  if (supabase) {
    try {
      let q = supabase
        .from('syte_suite_report_generated_log')
        .select('*')
        .order('generated_at', { ascending: false });
      if (clientId) q = q.eq('client_id', clientId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    } catch {
      // Table may not exist — fall back to localStorage.
    }
  }
  const list = JSON.parse(localStorage.getItem(LS_PREFIX + 'report_generated_log') || '[]');
  return clientId ? list.filter(r => r.client_id === clientId) : list;
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

export async function listImplementations(clientId) {
  if (supabase) {
    let q = supabase
      .from('syte_suite_implementations')
      .select('*')
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

// ---------------------------------------------------------------------------
// Technical SEO tasks — persisted to Supabase so scans survive page reloads.
// Falls back to localStorage if Supabase isn't configured.
// ---------------------------------------------------------------------------

const TSEO_KEY = LS_PREFIX + 'tseo_tasks';

export async function saveTseoTasks(tasks) {
  // Bulk upsert: clear old tasks for clients in this batch, insert new ones.
  if (supabase && tasks.length > 0) {
    // Get unique client IDs in this batch
    const clientIds = [...new Set(tasks.map(t => t.client_id).filter(Boolean))];
    for (const cid of clientIds) {
      const clientTasks = tasks.filter(t => t.client_id === cid);
      // Delete existing tasks for this client, then insert fresh
      await supabase.from('syte_suite_tseo_tasks').delete().eq('client_id', cid);
      const { error } = await supabase.from('syte_suite_tseo_tasks').insert(
        clientTasks.map(t => ({
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
          created_at: t.created_at || new Date().toISOString()
        }))
      );
      if (error) console.error('saveTseoTasks error:', error);
    }
  }
  // Always keep localStorage in sync as fallback
  localStorage.setItem(TSEO_KEY, JSON.stringify(tasks));
}

export async function loadTseoTasks() {
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_tseo_tasks')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data?.length > 0) {
      // Sync to localStorage as cache
      localStorage.setItem(TSEO_KEY, JSON.stringify(data));
      return data;
    }
  }
  // Read from the same key saveTseoTasks writes to (TSEO_KEY uses an
  // underscore: 'syte-suite-tseo_tasks'). Then fall back to the legacy
  // hyphen-keyed entry for old installs. Without this, the localStorage-
  // only mode would silently lose every task — the save path wrote to
  // TSEO_KEY but the load path only read the legacy key.
  const current = localStorage.getItem(TSEO_KEY);
  if (current) {
    try { return JSON.parse(current); } catch {}
  }
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
  // Build the row once, used for both Supabase upsert and the
  // localStorage fallback. The fallback was missing entirely — without
  // Supabase configured, AEO optimization runs persisted nothing and
  // loadAeoResults returned {} on the next page load.
  const row = {
    client_id: result.client_id,
    url: result.url,
    path: result.path,
    sessions: result.sessions || 0,
    priority: result.priority,
    optimizations: result.optimizations || [],
    error: result.error,
    generated_at: result.generated_at || new Date().toISOString()
  };
  if (supabase) {
    const { data: existing } = await supabase
      .from('syte_suite_aeo_results')
      .select('id')
      .eq('client_id', result.client_id)
      .eq('url', result.url)
      .limit(1);
    if (existing?.length > 0) {
      await supabase.from('syte_suite_aeo_results').update(row).eq('id', existing[0].id);
    } else {
      await supabase.from('syte_suite_aeo_results').insert(row);
    }
  }
  // Always mirror to localStorage so loadAeoResults works without
  // Supabase AND so a refresh has something to render before the cloud
  // round-trip completes.
  try {
    const obj = JSON.parse(localStorage.getItem(AEO_RESULTS_KEY) || '{}');
    obj[result.client_id + '::' + result.url] = row;
    localStorage.setItem(AEO_RESULTS_KEY, JSON.stringify(obj));
  } catch {}
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
      localStorage.setItem(AEO_RESULTS_KEY, JSON.stringify(obj));
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
  if (supabase) {
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
  const list = JSON.parse(localStorage.getItem(BLOGS_KEY) || '[]');
  const idx = list.findIndex(
    e => e.client_id === row.client_id &&
         e.topic === row.topic &&
         (e.generated_at || '').slice(0, 7) === monthKey
  );
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...row };
    localStorage.setItem(BLOGS_KEY, JSON.stringify(list));
    return list[idx];
  }
  const saved = { id: crypto.randomUUID(), ...row, created_at: new Date().toISOString() };
  list.unshift(saved);
  localStorage.setItem(BLOGS_KEY, JSON.stringify(list));
  return saved;
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
// written per client per month. Returns ALL content entries (Auto Write +
// Quick Blog + New Article + Rewrite etc.). Cached in localStorage for
// offline fallback.
export async function loadContentHistory() {
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_content_blogs').select('id,client_id,client_name,topic,keyword,tab,opportunity_type,generated_at,created_at')
      .order('generated_at', { ascending: false })
      .limit(500);
    if (!error && data) {
      localStorage.setItem(BLOGS_KEY, JSON.stringify(data));
      return data;
    }
  }
  return JSON.parse(localStorage.getItem(BLOGS_KEY) || '[]');
}

// ---------------------------------------------------------------------------
// Report data cache — saves fetched GA4/GSC data per client per month
// so it doesn't re-fetch every time the report page opens.
// ---------------------------------------------------------------------------

export async function getCachedReportData(clientId, month) {
  if (supabase) {
    const { data } = await supabase
      .from('syte_suite_report_cache')
      .select('data, fetched_at')
      .eq('client_id', clientId)
      .eq('month', month)
      .limit(1)
      .single();
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

export async function deleteBlogResult(id) {
  if (supabase) {
    await supabase.from('syte_suite_content_blogs').delete().eq('id', id);
  }
  try {
    const list = JSON.parse(localStorage.getItem(BLOGS_KEY) || '[]');
    localStorage.setItem(BLOGS_KEY, JSON.stringify(list.filter(r => r.id !== id)));
  } catch {}
}

