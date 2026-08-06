// Auto-publish: flips approved drafts live. Runs every 15 minutes.
//
// Lifecycle: pushItemInline creates CMS drafts with queue status 'pushed'
// (= awaiting review). A human approves in the suite, which sets status
// 'approved'. This function picks up approved rows and makes the single
// API call that publishes the already-created draft — content never moves
// again, only its visibility flips.
//
// Statuses written here:
//   'published'      — draft is live; payload.published_at recorded
//   'publish_failed' — the publish call failed; error_msg says why
//
// Env vars required (already configured on the Netlify site):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY (falls back to SUPABASE_KEY)

import { createClient } from '@supabase/supabase-js';

export const config = {
  schedule: '*/15 * * * *'
};

export default async function handler() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('[publish-approved] Missing Supabase env vars');
    return new Response('Missing Supabase env vars', { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: rows, error } = await supabase
    .from('syte_suite_cms_queue')
    .select('id, client_id, page_title, payload')
    .eq('status', 'approved')
    .limit(50);
  if (error) {
    console.error('[publish-approved] queue query failed:', error.message);
    return new Response('Queue query failed', { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return new Response('Nothing approved', { status: 200 });
  }

  // Load the clients these rows belong to (credentials live on the client).
  const clientIds = [...new Set(rows.map(r => r.client_id))];
  const { data: clients, error: cErr } = await supabase
    .from('syte_suite_clients')
    .select('id, name, cms_type, wp_url, wp_username, wp_app_password, shopify_store, shopify_token')
    .in('id', clientIds);
  if (cErr) {
    console.error('[publish-approved] client query failed:', cErr.message);
    return new Response('Client query failed', { status: 500 });
  }
  const byId = Object.fromEntries((clients || []).map(c => [c.id, c]));

  let published = 0, failed = 0;
  for (const row of rows) {
    const client = byId[row.client_id];
    try {
      const liveUrl = await publishOne(client, row);
      await supabase.from('syte_suite_cms_queue').update({
        status: 'published',
        payload: { ...(row.payload || {}), published_at: new Date().toISOString(), live_url: liveUrl || row.payload?.live_url || '' }
      }).eq('id', row.id);
      published++;
      console.log('[publish-approved] published:', client?.name, '-', row.page_title);
    } catch (e) {
      await supabase.from('syte_suite_cms_queue').update({
        status: 'publish_failed',
        error_msg: e.message
      }).eq('id', row.id);
      failed++;
      console.error('[publish-approved] FAILED:', client?.name, '-', row.page_title, '->', e.message);
    }
  }

  return new Response(`Published ${published}, failed ${failed}`, { status: 200 });
}

async function publishOne(client, row) {
  if (!client) throw new Error('Client not found for queue row');
  const p = row.payload || {};

  if (client.cms_type === 'WordPress') {
    if (!p.wp_id) throw new Error('No wp_id on queue row — was this draft pushed before the publish pipeline existed? Re-push it.');
    if (!client.wp_url || !client.wp_username || !client.wp_app_password) throw new Error('WordPress credentials missing on client');

    const base = client.wp_url.replace(/\/+$/, '');
    const restBase = p.rest_base || 'posts';
    const res = await fetch(base + '/wp-json/wp/v2/' + restBase + '/' + p.wp_id, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(client.wp_username + ':' + client.wp_app_password).toString('base64')
      },
      body: JSON.stringify({ status: 'publish' })
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message || text; } catch { /* keep raw */ }
      throw new Error('WordPress publish ' + res.status + ': ' + msg);
    }
    try {
      const post = JSON.parse(text);
      return post.link || '';
    } catch { return ''; }
  }

  if (client.cms_type === 'Shopify') {
    // Shopify publish lands with the Shopify push build-out (needs the
    // article id recorded at push time + the shopify-proxy work).
    throw new Error('Shopify auto-publish not built yet — publish manually in the store admin');
  }

  throw new Error('Auto-publish not supported for cms_type: ' + (client.cms_type || 'none'));
}
