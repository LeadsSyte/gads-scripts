// Shared "push this item to the connected CMS" action used inline by
// Content Engine, Technical SEO, and AEO Engine. Replaces the old Push
// Queue flow — pushes happen immediately, but every push is still logged
// to the syte_suite_cms_queue table for history/audit.

import { queueCmsChange, updateCmsQueueItem } from '../../lib/supabase.js';
import { pushToWordPress } from './wordpressPush.js';
import { pushToShopify } from './shopifyPush.js';
import { buildAndDownloadZip } from './customZip.js';

export function clientIsConnected(client) {
  if (!client) return false;
  if (client.cms_type === 'WordPress') return !!(client.wp_url && client.wp_username && client.wp_app_password);
  if (client.cms_type === 'Shopify')   return !!(client.shopify_store && client.shopify_token);
  if (client.cms_type === 'Custom Site') return true;
  return false;
}

// Accepts a "virtual" queue item (not yet in Supabase) and does:
//  1. insert into syte_suite_cms_queue as pending (so there's a history row)
//  2. dispatch to WP / Shopify / Custom
//  3. update the row with status=pushed|failed + admin_url
export async function pushItemInline(client, item) {
  if (!client) throw new Error('No client selected.');
  if (!item)   throw new Error('Nothing to push.');

  // Step 1 — log the pending row.
  const row = await queueCmsChange({
    client_id: client.id,
    module: item.module || 'unknown',
    page_url: item.page_url || client.url || '',
    page_title: item.page_title || 'Untitled',
    change_type: item.change_type || 'other',
    payload: item.payload || {},
    status: 'pending'
  });

  // Step 2 — actually push.
  try {
    let result;
    if (client.cms_type === 'WordPress')      result = await pushToWordPress(client, row);
    else if (client.cms_type === 'Shopify')   result = await pushToShopify(client, row);
    else if (client.cms_type === 'Custom Site') {
      await buildAndDownloadZip(client, [row]);
      result = { ok: true, admin_url: '' };
    } else {
      throw new Error('CMS not connected. Open the CMS module to connect WordPress, Shopify, or pick Custom Site.');
    }

    await updateCmsQueueItem(row.id, {
      status: 'pushed',
      pushed_at: new Date().toISOString(),
      payload: { ...(row.payload || {}), admin_url: result.admin_url || '' }
    });
    return { ok: true, admin_url: result.admin_url || '', id: row.id };
  } catch (e) {
    await updateCmsQueueItem(row.id, { status: 'failed', error_msg: e.message });
    throw e;
  }
}
