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
