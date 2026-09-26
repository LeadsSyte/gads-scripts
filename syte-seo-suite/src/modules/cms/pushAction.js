// Shared "push this item to the connected CMS" action used inline by
// Content Engine, Technical SEO, and AEO Engine. Replaces the old Push
// Queue flow — pushes happen immediately, but every push is still logged
// to the syte_suite_cms_queue table for history/audit.

import { queueCmsChange, updateCmsQueueItem } from '../../lib/supabase.js';
import { pushToWordPress } from './wordpressPush.js';
import { pushToShopify } from './shopifyPush.js';
import { verifyPushedDraft } from './verifyDraft.js';
import { fnUrl } from '../../lib/fnUrl.js';

// Browser default: the queue lives in Supabase via the browser client, and
// the draft-ready email is a fire-and-forget call. The server-side
// Autopilot passes its own `deps` (netlify/functions/lib/serverPush.js).
const BROWSER_DEPS = {
  queue: queueCmsChange,
  update: updateCmsQueueItem,
  notify: (queueId) => {
    fetch(fnUrl('notify-draft'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queueId })
    }).catch(() => {});
  }
};

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
// Technical SEO and AEO fixes change an EXISTING page. The CMS push only
// knows how to create a draft post, so these used to become a separate draft
// containing the fix text, and a meta_title / meta_description task went to
// the SEO-meta path with no value and would have blanked the live page's
// Yoast / RankMath fields. Refused until in-place page editing exists.
export function unsupportedPushReason(item) {
  if (item && (item.module === 'technical' || item.module === 'aeo')) {
    return 'Technical and AEO fixes can\'t be applied to a page automatically yet — a push would create a separate draft post instead of changing ' +
      (item.page_url || 'the page') + '. Copy the fix and apply it on the page by hand for now.';
  }
  return '';
}

export async function pushItemInline(client, item, deps = BROWSER_DEPS) {
  if (!client) throw new Error('No client selected.');
  if (!item)   throw new Error('Nothing to push.');
  const unsupported = unsupportedPushReason(item);
  if (unsupported) throw new Error(unsupported);

  // Step 1 — log the pending row.
  const row = await deps.queue({
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
      // Loaded on demand: the ZIP download is browser-only (file-saver).
      const { buildAndDownloadZip } = await import('./customZip.js');
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

    await deps.update(row.id, {
      status: 'pushed',
      pushed_at: new Date().toISOString(),
      // Store BOTH the admin edit URL and the actual public permalink so
      // downstream verification uses the real WordPress URL, not a re-derived slug.
      page_url: result.link || row.page_url,
      payload: {
        ...(row.payload || {}),
        admin_url: result.admin_url || '',
        preview_url: result.preview_url || '',
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
    try { await deps.notify(row.id); } catch { /* ignore */ }

    return {
      ok: true,
      admin_url: result.admin_url || '',
      live_url: result.link || '',
      id: row.id,
      verification: verification.level,
      warnings: allWarnings
    };
  } catch (e) {
    await deps.update(row.id, { status: 'failed', error_msg: e.message });
    throw e;
  }
}
