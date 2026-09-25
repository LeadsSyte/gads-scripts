// Connections overview — one row per client saying whether the suite can
// push to its site, and what has been pushed. Pure so it is node-testable;
// CMSPush renders it.

import { getPublishingProfile } from './publishingProfile.js';

// Order the overview reads in: what needs attention first, then what works,
// then the clients deliberately left out.
const STATE_ORDER = { incomplete: 0, not_connected: 1, connected: 2, custom: 3, skipped: 4 };

export function connectionState(client) {
  const profile = getPublishingProfile(client);
  if (profile.cms_skip_reason) return { state: 'skipped', detail: profile.cms_skip_reason };
  const type = client?.cms_type || '';
  if (type === 'WordPress') {
    const have = [client.wp_url, client.wp_username, client.wp_app_password].filter(Boolean).length;
    if (have === 3) return { state: 'connected', detail: 'WordPress' };
    return have ? { state: 'incomplete', detail: 'WordPress: login details incomplete' }
                : { state: 'not_connected', detail: 'WordPress: no login saved' };
  }
  if (type === 'Shopify') {
    if (client.shopify_store && client.shopify_token) return { state: 'connected', detail: 'Shopify' };
    return client.shopify_store ? { state: 'incomplete', detail: 'Shopify: store set, app not installed' }
                                : { state: 'not_connected', detail: 'Shopify: no store saved' };
  }
  // Custom Site pushes download a ZIP for a developer — nothing reaches the site.
  if (type === 'Custom Site') return { state: 'custom', detail: 'Custom site: ZIP export only' };
  return { state: 'not_connected', detail: 'No CMS set' };
}

// clients: syte_suite_clients rows; queue: syte_suite_cms_queue rows (any client).
export function buildConnectionRows(clients, queue) {
  const byClient = new Map();
  for (const row of queue || []) {
    const s = byClient.get(row.client_id) || { pushes: 0, last: null, published: 0, failed: 0 };
    s.pushes++;
    const at = row.pushed_at || row.created_at;
    if (at && (!s.last || at > s.last)) s.last = at;
    if (row.status === 'published') s.published++;
    if (row.status === 'failed' || row.status === 'publish_failed') s.failed++;
    byClient.set(row.client_id, s);
  }
  return (clients || [])
    .map(c => ({
      id: c.id,
      name: c.name || '(unnamed)',
      url: c.wp_url || c.shopify_store || c.url || '',
      ...connectionState(c),
      ...(byClient.get(c.id) || { pushes: 0, last: null, published: 0, failed: 0 })
    }))
    .sort((a, b) => (STATE_ORDER[a.state] - STATE_ORDER[b.state]) || a.name.localeCompare(b.name));
}

export function summarizeConnections(rows) {
  const out = { connected: 0, incomplete: 0, not_connected: 0, custom: 0, skipped: 0 };
  for (const r of rows) out[r.state]++;
  return out;
}
