// Technical fixes and AEO additions on a Shopify store: pages, articles and
// products found from the URL, the search-listing fields written and read
// back, product image alt text, sections inserted in body_html and removed
// again. A fake Shopify Admin API throughout.

import { shopifyPathOf, resolveShopifyObject, planShopifyFix, applyShopifyPlan, undoShopifyResults, shopifyTechOps } from '../netlify/functions/lib/shopifyFix.js';
import { planAeoFixShopify, applyAeoFixShopify, undoAeoFixShopify, shopifyAeoOps } from '../netlify/functions/lib/shopifyAeo.js';
import { runTechFix } from '../netlify/functions/lib/techFixRun.js';
import { runAeoFix, aeoOptKey } from '../netlify/functions/lib/aeoFixRun.js';
import { fixKey } from '../netlify/functions/lib/aeoFix.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
const eq = (a, b, label) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const has = (s, re, label) => { if (!re.test(s)) throw new Error((label || '') + ' missing ' + re); };

const BODY = '<p>Chest of drawers come in many sizes, and the right one depends on the room and what you need to store in it.</p><p>Solid pine drawers last for decades and can be painted or stained to suit the bedroom they live in.</p><p>Measure the space before you order, and leave room for the drawers to open fully without hitting the bed.</p>';

// A small fake store: one page, one blog with one article, one product with two images, one collection.
function fakeShop() {
  const store = {
    pages: [{ id: 11, handle: 'delivery', title: 'Delivery', body_html: BODY }],
    blogs: [{ id: 9, handle: 'news' }],
    articles: [{ id: 600, handle: 'chest-of-drawers', title: 'Chest of Drawers', body_html: BODY, image: { src: 'https://cdn/x/drawers.jpg', alt: '' } }],
    products: [{ id: 77, handle: 'pine-drawers', title: 'Pine Drawers', body_html: BODY, images: [{ id: 1, src: 'https://cdn.shopify.com/s/files/1/pine-drawers_1024x1024.jpg', alt: '' }, { id: 2, src: 'https://cdn.shopify.com/s/files/1/side-view.jpg', alt: 'Side view' }] }],
    collections: [{ id: 5, handle: 'bedroom', title: 'Bedroom', body_html: '' }],
    seo: { 'pages/11': { title_tag: 'Delivery -', description_tag: '' }, 'blogs/9/articles/600': {}, 'products/77': {} }
  };
  const calls = [];
  const sh = async (path, { method = 'GET', body } = {}) => {
    calls.push(method + ' ' + path.split('?')[0]);
    const q = Object.fromEntries(new URLSearchParams(path.split('?')[1] || ''));
    let m;
    if (method === 'GET') {
      if (path.startsWith('pages.json')) return { pages: store.pages.filter(p => p.handle === q.handle) };
      if (path.startsWith('blogs.json')) return { blogs: store.blogs.filter(b => b.handle === q.handle) };
      if ((m = path.match(/^blogs\/(\d+)\/articles\.json/))) return { articles: store.articles.filter(a => a.handle === q.handle) };
      if (path.startsWith('products.json')) return { products: store.products.filter(p => p.handle === q.handle) };
      if (path.startsWith('custom_collections.json')) return { custom_collections: store.collections.filter(c => c.handle === q.handle) };
      if (path.startsWith('smart_collections.json')) return { smart_collections: [] };
      if ((m = path.match(/^(pages\/\d+|blogs\/\d+\/articles\/\d+|products\/\d+)\/metafields\.json/))) {
        return { metafields: Object.entries(store.seo[m[1]] || {}).filter(([, v]) => v).map(([key, value]) => ({ namespace: 'global', key, value })) };
      }
      if ((m = path.match(/^products\/(\d+)\/images\/(\d+)\.json/))) return { image: store.products.find(p => p.id === +m[1]).images.find(i => i.id === +m[2]) };
      if ((m = path.match(/^pages\/(\d+)\.json/))) return { page: store.pages.find(p => p.id === +m[1]) };
      if ((m = path.match(/^blogs\/\d+\/articles\/(\d+)\.json/))) return { article: store.articles.find(a => a.id === +m[1]) };
      if ((m = path.match(/^products\/(\d+)\.json/))) return { product: store.products.find(p => p.id === +m[1]) };
    }
    if (method === 'PUT') {
      if ((m = path.match(/^products\/(\d+)\/images\/(\d+)\.json/))) { store.products.find(p => p.id === +m[1]).images.find(i => i.id === +m[2]).alt = body.image.alt; return {}; }
      const res = path.replace(/\.json$/, '');
      const payload = Object.values(body)[0];
      const obj = res.startsWith('pages/') ? store.pages.find(p => p.id === payload.id) : res.startsWith('blogs/') ? store.articles.find(a => a.id === payload.id) : store.products.find(p => p.id === payload.id);
      if (payload.metafields_global_title_tag !== undefined) (store.seo[res] = store.seo[res] || {}).title_tag = payload.metafields_global_title_tag;
      if (payload.metafields_global_description_tag !== undefined) (store.seo[res] = store.seo[res] || {}).description_tag = payload.metafields_global_description_tag;
      if (payload.body_html !== undefined) obj.body_html = payload.body_html;
      return {};
    }
    throw new Error('unexpected ' + method + ' ' + path);
  };
  const live = async (url) => { const o = await resolveShopifyObject(sh, url); const seo = o ? store.seo[o.resource] || {} : {}; return '<html><head><title>' + (seo.title_tag || o?.title || 'Store') + '</title>' + (seo.description_tag ? '<meta name="description" content="' + seo.description_tag + '">' : '') + '</head><body><main>' + (o?.body_html || '') + '</main></body></html>'; };
  return { sh, store, calls, live };
}
const S = 'https://bamdiy.com';
const task = (fix_type, url, fix) => ({ id: 't', fix_type, page_url: url, copy_paste_fix: fix, title: 'x' });

await t('store URLs are understood, including locale prefixes and collection-scoped products', () => {
  eq(shopifyPathOf(S + '/pages/delivery'), { kind: 'page', handle: 'delivery' });
  eq(shopifyPathOf(S + '/blogs/news/chest-of-drawers/'), { kind: 'article', blogHandle: 'news', handle: 'chest-of-drawers' });
  eq(shopifyPathOf(S + '/en/collections/bedroom/products/pine-drawers'), { kind: 'product', handle: 'pine-drawers' });
  eq(shopifyPathOf(S + '/collections/bedroom'), { kind: 'collection', handle: 'bedroom' });
  eq(shopifyPathOf(S + '/'), null); eq(shopifyPathOf(S + '/collections/all'), null);
});

await t('a page title fix: read the listing field, write it, read it back, see it live, undo it', async () => {
  const { sh, store, live } = fakeShop();
  const plan = await planShopifyFix(task('meta_title', S + '/pages/delivery', '<title>Delivery Across South Africa | BAM DIY</title>'), sh);
  eq(plan.applicable, true); eq(plan.changes[0].from, 'Delivery -'); eq(plan.changes[0].target.resource, 'pages/11');
  const results = await applyShopifyPlan(plan, sh);
  eq(results[0].ok, true); eq(store.seo['pages/11'].title_tag, 'Delivery Across South Africa | BAM DIY');
  has(await live(S + '/pages/delivery'), /<title>Delivery Across South Africa \| BAM DIY<\/title>/);
  const undone = await undoShopifyResults(results, sh);
  eq(undone[0].undone, true); eq(store.seo['pages/11'].title_tag, 'Delivery -');
});

await t('a blog article meta description, through the shared runner with Shopify operations', async () => {
  const { sh, store, live } = fakeShop();
  const rows = []; const log = [];
  const e = { task: task('meta_description', S + '/blogs/news/chest-of-drawers', '<meta name="description" content="How to choose a chest of drawers for a bedroom: sizes, materials and what to measure before you order from BAM DIY.">'), check: { verdict: 'confirmed' } };
  const deps = { wp: sh, ops: shopifyTechOps, fetchHtml: live, save: async s => { rows.push(s); return s; }, recordApplied: async () => { log.push('applied'); return 'impl'; }, recordUndone: async () => { log.push('undone'); } };
  const s = await runTechFix({ entry: e, action: 'auto', by: 'test' }, deps);
  eq(s.status, 'applied'); eq(s.live.status, 'verified');
  has(store.seo['blogs/9/articles/600'].description_tag, /^How to choose a chest/);
  const u = await runTechFix({ entry: e, action: 'undo', prev: s }, deps);
  eq(u.status, 'undone'); eq(store.seo['blogs/9/articles/600'].description_tag, '');
});

await t('product image alt text is matched from a resized CDN URL; other images stay manual', async () => {
  const { sh, store } = fakeShop();
  const plan = await planShopifyFix(task('image_alt', S + '/products/pine-drawers', '<img src="https://cdn.shopify.com/s/files/1/pine-drawers_600x.jpg" alt="Solid pine chest of drawers with four drawers">'), sh);
  eq(plan.applicable, true); eq(plan.changes[0].target.imageId, 1);
  const r = await applyShopifyPlan(plan, sh);
  eq(r[0].ok, true); eq(store.products[0].images[0].alt, 'Solid pine chest of drawers with four drawers');
  await undoShopifyResults(r, sh); eq(store.products[0].images[0].alt, '');
  const art = await planShopifyFix(task('image_alt', S + '/blogs/news/chest-of-drawers', '<img src="https://cdn/x/drawers.jpg" alt="x">'), sh);
  eq(art.applicable, false); has(art.reason, /product images/);
});

await t('what the suite can\'t change on Shopify is said plainly', async () => {
  const { sh } = fakeShop();
  const col = await planShopifyFix(task('meta_title', S + '/collections/bedroom', '<title>Bedroom Furniture | BAM DIY</title>'), sh);
  eq(col.applicable, false); has(col.reason, /Shopify admin/);
  const home = await planShopifyFix(task('meta_title', S + '/', '<title>BAM DIY | Furniture</title>'), sh);
  eq(home.applicable, false); has(home.reason, /home page/);
  const theme = await planShopifyFix(task('heading', S + '/pages/delivery', '<h2>x</h2>'), sh);
  eq(theme.applicable, false);
});

await t('AEO: a section goes into a page\'s body_html between markers, shows live, and undo restores it exactly', async () => {
  const { sh, store, live } = fakeShop();
  const FAQ = { type: 'content', name: 'FAQ — delivery questions', where: 'After the main content', check: { verdict: 'confirmed' },
    implementation: '<h2>Delivery questions</h2><h3>How long does delivery take?</h3><p>Most orders arrive within five working days anywhere in South Africa.</p>' };
  const url = S + '/pages/delivery';
  const before = store.pages[0].body_html;
  const plan = await planAeoFixShopify({ url, opt: FAQ, optKey: aeoOptKey(FAQ) }, sh, live);
  eq(plan.applicable, true); eq(plan.target.resource, 'pages/11'); eq(plan.position, 'end');
  has(plan.renderedPreview, /Delivery questions/);
  const r = await applyAeoFixShopify(plan, sh);
  eq(r.ok, true);
  has(store.pages[0].body_html, /<!-- syte-aeo:[a-z0-9]+ -->\n<h2>Delivery questions/);
  if (!store.pages[0].body_html.startsWith(before)) throw new Error('existing content changed');
  has(await live(url), /Delivery questions/);
  eq((await planAeoFixShopify({ url, opt: FAQ, optKey: aeoOptKey(FAQ) }, sh, live)).reason, 'Already added to this page.');
  const u = await undoAeoFixShopify(plan, sh);
  eq(u.ok, true); eq(store.pages[0].body_html, before);
});

await t('AEO through the shared runner on a product; a collection stays manual', async () => {
  const { sh, store, live } = fakeShop();
  const ANSWER = { type: 'content', name: 'Answer Block — direct answer after H1', where: 'Directly after the H1', check: { verdict: 'confirmed' },
    implementation: '<p><strong>Pine drawers</strong> are a solid-wood chest of drawers that can be painted or stained to match any bedroom.</p>' };
  const url = S + '/products/pine-drawers';
  const rows = new Map();
  const deps = (u, k) => ({ wp: sh, ops: shopifyAeoOps, fetchHtml: live, previewUrlFor: x => 'p:' + x, save: async s => { const row = { ...s, key: fixKey(u, k) }; rows.set(row.key, row); return row; }, recordApplied: async () => 'impl', recordUndone: async () => {} });
  const k = aeoOptKey(ANSWER);
  const s = await runAeoFix({ url, opt: ANSWER, optKey: k, action: 'auto', by: 'test' }, deps(url, k));
  eq([s.status, s.live.status, s.plan.position], ['applied', 'verified', 'top']);
  has(store.products[0].body_html, /^<!-- syte-aeo:[a-z0-9]+ -->\n<p><strong>Pine drawers/);
  const col = await runAeoFix({ url: S + '/collections/bedroom', opt: ANSWER, optKey: k, action: 'plan' }, deps(S + '/collections/bedroom', k));
  eq(col.status, 'manual'); has(col.reason, /Collection pages/);
});

console.log(`\nshopifyFix: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
