import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabase = !!(url && key && !url.includes('[project]'));

export const supabase = hasSupabase
  ? createClient(url, key, { auth: { persistSession: false } })
  : null;

// localStorage fallback wrappers so every module keeps working offline
const LS_PREFIX = 'syte-suite-';

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
