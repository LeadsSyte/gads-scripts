// Taking a live article down: back to a draft on the site, back to
// "awaiting review" in Push History, nothing deleted. Fakes throughout.

import { unpublishItem, canUnpublish } from '../src/modules/cms/unpublish.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
const eq = (a, b, label) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };

const WP = { id: 'c1', name: 'Krost', cms_type: 'WordPress', wp_url: 'https://k.example' };
const SHOP = { id: 'c2', name: 'BAM DIY', cms_type: 'Shopify', shopify_store: 's.myshopify.com', shopify_token: 't' };
const wpRow = { id: 'q1', status: 'published', page_title: 'Racking Guide', payload: { wp_id: 42, rest_base: 'posts', live_url: 'https://k.example/racking-guide/', published_at: '2026-09-30T08:00:00Z' } };
const shopRow = { id: 'q2', status: 'published', payload: { shopify_article_id: 600, shopify_blog_id: 9, live_url: 'https://bamdiy.com/blogs/news/drawers' } };

await t('only a live article with a post reference can be taken down', () => {
  eq(canUnpublish(wpRow), true); eq(canUnpublish(shopRow), true);
  eq(canUnpublish({ ...wpRow, status: 'pushed' }), false);
  eq(canUnpublish({ status: 'published', payload: {} }), false);
});

await t('WordPress: the post goes back to draft and the row back to awaiting review, keeping the old address', async () => {
  const calls = []; let patch = null;
  await unpublishItem(WP, wpRow, {
    wpRequest: async (c, o) => { calls.push(o); return { id: 42, status: 'draft' }; },
    updateQueue: async (id, p) => { patch = { id, ...p }; return patch; }
  });
  eq(calls, [{ method: 'POST', path: 'wp/v2/posts/42', body: { status: 'draft' } }]);
  eq(patch.status, 'pushed'); eq(patch.payload.was_live_url, 'https://k.example/racking-guide/'); eq(patch.payload.published_at, null);
  if (!patch.payload.unpublished_at) throw new Error('no unpublished_at');
});

await t('Shopify: the article is hidden, not deleted', async () => {
  let call = null;
  await unpublishItem(SHOP, shopRow, {
    shopifyRequest: async (c, o) => { call = o; return { article: { id: 600, published_at: null } }; },
    updateQueue: async () => ({})
  });
  eq(call, { method: 'PUT', path: 'blogs/9/articles/600.json', body: { article: { id: 600, published: false } } });
});

await t('if the site does not change the status, Push History is left as it was', async () => {
  let updated = false; let msg = '';
  try { await unpublishItem(WP, wpRow, { wpRequest: async () => ({ id: 42, status: 'publish' }), updateQueue: async () => { updated = true; } }); }
  catch (e) { msg = e.message; }
  if (!/did not change/.test(msg)) throw new Error('got ' + msg);
  eq(updated, false);
});

console.log(`\nunpublish: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
