import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseAvailable =
  !!SUPABASE_URL &&
  !!SUPABASE_KEY &&
  !SUPABASE_URL.includes('[project]') &&
  !SUPABASE_KEY.includes('[anon key]');

export const supabase = supabaseAvailable
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

// ---------- Local fallback helpers ----------
const LS_PREFIX = 'syte-suite:';

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key, val) {
  localStorage.setItem(LS_PREFIX + key, JSON.stringify(val));
}

function uuid() {
  return (
    crypto.randomUUID?.() ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    })
  );
}

// ---------- Clients ----------
export async function fetchClients() {
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_clients')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  return lsGet('clients', []);
}

export async function upsertClient(client) {
  const now = new Date().toISOString();
  if (supabase) {
    const payload = { ...client, updated_at: now };
    if (client.id) {
      const { data, error } = await supabase
        .from('syte_suite_clients')
        .update(payload)
        .eq('id', client.id)
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
  const clients = lsGet('clients', []);
  if (client.id) {
    const idx = clients.findIndex((c) => c.id === client.id);
    if (idx >= 0) clients[idx] = { ...clients[idx], ...client, updated_at: now };
  } else {
    clients.push({ ...client, id: uuid(), created_at: now, updated_at: now });
  }
  lsSet('clients', clients);
  return clients[clients.length - 1];
}

export async function deleteClient(id) {
  if (supabase) {
    await supabase.from('syte_suite_clients').delete().eq('id', id);
    return;
  }
  lsSet(
    'clients',
    lsGet('clients', []).filter((c) => c.id !== id)
  );
}

// ---------- Progress ----------
export async function addProgress(entry) {
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_progress')
      .insert(entry)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const arr = lsGet('progress', []);
  arr.push({ ...entry, id: uuid(), created_at: new Date().toISOString() });
  lsSet('progress', arr);
  return arr[arr.length - 1];
}

// ---------- CMS Queue ----------
export async function addToCmsQueue(items) {
  const list = Array.isArray(items) ? items : [items];
  const now = new Date().toISOString();
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_cms_queue')
      .insert(list)
      .select();
    if (error) throw error;
    return data;
  }
  const existing = lsGet('cms_queue', []);
  const newItems = list.map((i) => ({
    ...i,
    id: uuid(),
    status: i.status || 'pending',
    created_at: now,
  }));
  lsSet('cms_queue', [...existing, ...newItems]);
  return newItems;
}

export async function fetchCmsQueue(clientId) {
  if (supabase) {
    const { data, error } = await supabase
      .from('syte_suite_cms_queue')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  return lsGet('cms_queue', []).filter((q) => q.client_id === clientId);
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
  const arr = lsGet('cms_queue', []);
  const idx = arr.findIndex((i) => i.id === id);
  if (idx >= 0) arr[idx] = { ...arr[idx], ...patch };
  lsSet('cms_queue', arr);
  return arr[idx];
}
