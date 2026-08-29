// Shared "push this item to the connected CMS" action used inline by
// Content Engine, Technical SEO, and AEO Engine. Replaces the old Push
// Queue flow — pushes happen immediately, but every push is still logged
// to the syte_suite_cms_queue table for history/audit.

import { queueCmsChange, updateCmsQueueItem } from '../../lib/supabase.js';
import { pushToWordPress } from './wordpressPush.js';
import { pushToShopify } from './shopifyPush.js';
import { buildAndDownloadZip } from './customZip.js';
import { verifyPushedDraft } from './verifyDraft.js';

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

    // Step 2b — read the draft back out of the CMS and check what
    // actually landed there. Profiles prevent the formatting problems we
    // know about; this catches the ones we don't, before a human opens
    // the draft. Verification never fails a push.
    let verification = { level: 'unchecked', problems: [] };
    if (client.cms_type === 'WordPress' || client.cms_type === 'Shopify') {
      try { verification = await verifyPushedDraft(client, result); }
      catch (e) { verification = { level: 'unchecked', problems: ['Verification did not run: ' + e.message] }; }
    }
    const allWarnings = [...(result.warnings || []), ...(verification.problems || [])];

    await updateCmsQueueItem(row.id, {
      status: 'pushed',
      pushed_at: new Date().toISOString(),
      // Store BOTH the admin edit URL and the actual public permalink so
      // downstream verification uses the real WordPress URL, not a re-derived slug.
      page_url: result.link || row.page_url,
      payload: {
        ...(row.payload || {}),
        admin_url: result.admin_url || '',
        live_url: result.link || '',
        // The publish-approved scheduled function needs these to flip the
        // draft live after approval — without an id it can't publish.
        wp_id: result.wp_id || null,
        rest_base: result.rest_base || 'posts',
        shopify_article_id: result.shopify_article_id || null,
        shopify_blog_id: result.shopify_blog_id || null,
        meta_status: result.meta_status || '',
        verification: verification.level,
        warnings: allWarnings
      }
    });
    // Fire-and-forget draft-ready notification (internal email, or the
    // client approval email when the profile says approval_mode 'client').
    // A notification failure must never fail the push itself.
    try {
      fetch('/.netlify/functions/notify-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId: row.id })
      }).catch(() => {});
    } catch { /* ignore */ }

    return {
      ok: true,
      admin_url: result.admin_url || '',
      live_url: result.link || '',
      id: row.id,
      verification: verification.level,
      warnings: allWarnings
    };
  } catch (e) {
    await updateCmsQueueItem(row.id, { status: 'failed', error_msg: e.message });
    throw e;
  }
}
