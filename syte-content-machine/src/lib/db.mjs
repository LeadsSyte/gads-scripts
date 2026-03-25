import { createClient } from '@supabase/supabase-js';

let supabase = null;

export function getDb() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

// ─── Clients ───────────────────────────────────────────

export async function listClients() {
  const { data, error } = await getDb()
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getClient(id) {
  const { data, error } = await getDb()
    .from('clients')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function createClient(client) {
  const id = `client-${Date.now()}`;
  const row = { id, ...client, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const { data, error } = await getDb()
    .from('clients')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateClient(id, updates) {
  const { data, error } = await getDb()
    .from('clients')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteClient(id) {
  const { error } = await getDb()
    .from('clients')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ─── Generations ───────────────────────────────────────

export async function createGeneration({ clientId, month, articleCount }) {
  const id = `gen-${Date.now()}`;
  const row = {
    id,
    client_id: clientId,
    month,
    status: 'pending',
    article_count: articleCount,
    topics: [],
    created_at: new Date().toISOString(),
  };
  const { data, error } = await getDb()
    .from('generations')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getGeneration(id) {
  const { data, error } = await getDb()
    .from('generations')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function updateGeneration(id, updates) {
  const { data, error } = await getDb()
    .from('generations')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Articles ──────────────────────────────────────────

export async function createArticle(article) {
  const id = `art-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const row = {
    id,
    generation_id: article.generationId,
    client_id: article.clientId,
    title: article.title,
    primary_keyword: article.primaryKeyword || '',
    secondary_keywords: article.secondaryKeywords || [],
    search_intent: article.searchIntent || '',
    content: article.content,
    word_count: article.wordCount || 0,
    topic_data: article.topicData || {},
    created_at: new Date().toISOString(),
  };
  const { data, error } = await getDb()
    .from('articles')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getArticle(id) {
  const { data, error } = await getDb()
    .from('articles')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function listArticles({ clientId, month, generationId }) {
  let query = getDb().from('articles').select('*');
  if (clientId) query = query.eq('client_id', clientId);
  if (generationId) query = query.eq('generation_id', generationId);
  if (month) {
    // Filter articles created in the given month (YYYY-MM)
    query = query.gte('created_at', `${month}-01T00:00:00Z`)
      .lt('created_at', `${nextMonth(month)}-01T00:00:00Z`);
  }
  query = query.order('created_at', { ascending: true });
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// ─── Generated Titles (deduplication) ──────────────────

export async function addGeneratedTitle(clientId, title) {
  const { error } = await getDb()
    .from('generated_titles')
    .insert({ client_id: clientId, title, created_at: new Date().toISOString() });
  if (error) throw error;
}

export async function getGeneratedTitles(clientId) {
  const { data, error } = await getDb()
    .from('generated_titles')
    .select('title')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data.map(r => r.title);
}

// ─── History ───────────────────────────────────────────

export async function listGenerations({ clientId } = {}) {
  let query = getDb()
    .from('generations')
    .select('*, clients(name)')
    .order('created_at', { ascending: false });
  if (clientId) query = query.eq('client_id', clientId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function deleteGeneration(id) {
  // Articles cascade-delete via FK
  const { error } = await getDb()
    .from('generations')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ─── Helpers ───────────────────────────────────────────

function nextMonth(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}
