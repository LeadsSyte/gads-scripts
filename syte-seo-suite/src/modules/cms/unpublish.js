// Take a published article down again — back to a draft on the site, and
// back to "awaiting review" in Push History, so it can be fixed and approved
// once more. Nothing is deleted. The reverse of publish-approved.js.
//
// deps are injected for tests: { wpRequest, shopifyRequest, updateQueue }.

import { wpRequest as wpReq } from './wpApi.js';
import { shopifyRequest as shopReq } from './shopifyApi.js';
import { updateCmsQueueItem } from '../../lib/supabase.js';

export function canUnpublish(item) {
  return item?.status === 'published' && !!(item.payload?.wp_id || (item.payload?.shopify_article_id && item.payload?.shopify_blog_id));
}

export async function unpublishItem(client, item, deps = {}) {
  const wpRequest = deps.wpRequest || wpReq;
  const shopifyRequest = deps.shopifyRequest || shopReq;
  const updateQueue = deps.updateQueue || updateCmsQueueItem;
  if (!client) throw new Error('No client for this article');
  if (!canUnpublish(item)) throw new Error('This article is not live, or has no post reference to take down.');
  const p = item.payload || {};

  if (client.cms_type === 'WordPress') {
    const restBase = p.rest_base || 'posts';
    const post = await wpRequest(client, { method: 'POST', path: 'wp/v2/' + restBase + '/' + p.wp_id, body: { status: 'draft' } });
    if (post?.status && post.status !== 'draft') throw new Error('WordPress did not change the status (still "' + post.status + '")');
  } else if (client.cms_type === 'Shopify') {
    const path = 'blogs/' + p.shopify_blog_id + '/articles/' + p.shopify_article_id + '.json';
    const r = await shopifyRequest(client, { method: 'PUT', path, body: { article: { id: p.shopify_article_id, published: false } } });
    if (r?.article && r.article.published_at) throw new Error('Shopify did not hide the article');
  } else {
    throw new Error('Taking down is not supported for cms_type: ' + (client.cms_type || 'none'));
  }

  return updateQueue(item.id, {
    status: 'pushed',
    payload: { ...p, unpublished_at: new Date().toISOString(), was_live_url: p.live_url || '', published_at: null }
  });
}
