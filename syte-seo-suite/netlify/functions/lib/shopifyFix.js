// Technical SEO fixes on a client's Shopify store — the Shopify side of
// techFix.js, same plan / results shape so techFixRun.js, the panel, the
// emails and undo work unchanged:
//
//   meta_title / meta_description → the page's "Search engine listing" fields
//                                   (Shopify stores them as global metafields
//                                   title_tag / description_tag)
//   image_alt                      → a product image's alt text
//
// Pages, blog articles, products and collections are found from the URL.
// The home page and theme-level changes stay manual. `sh` is injected
// (see shopifyClient.js).

import { parseFixValues, AUTO_FIX_TYPES } from './techFix.js';

const decodeHandle = s => { try { return decodeURIComponent(s); } catch { return s; } };

// /products/x, /collections/x, /pages/x, /blogs/news/x → what to ask Shopify for.
export function shopifyPathOf(pageUrl) {
  let path;
  try { path = new URL(pageUrl).pathname.replace(/\/+$/, ''); } catch { return null; }
  const parts = path.split('/').filter(Boolean).map(decodeHandle);
  // Some stores prefix a locale or a collection: /en/products/x, /collections/c/products/x
  const at = (name) => parts.lastIndexOf(name);
  if (at('products') >= 0 && parts[at('products') + 1]) return { kind: 'product', handle: parts[at('products') + 1] };
  if (at('pages') >= 0 && parts[at('pages') + 1]) return { kind: 'page', handle: parts[at('pages') + 1] };
  if (at('blogs') >= 0 && parts[at('blogs') + 2]) return { kind: 'article', blogHandle: parts[at('blogs') + 1], handle: parts[at('blogs') + 2] };
  if (at('collections') >= 0 && parts[at('collections') + 1] && parts[at('collections') + 1] !== 'all') return { kind: 'collection', handle: parts[at('collections') + 1] };
  return null;
}

// The Shopify object behind a URL: { kind, id, resource, title, body_html, images: [{ id, src, alt }], blogId }
export async function resolveShopifyObject(sh, pageUrl) {
  const where = shopifyPathOf(pageUrl);
  if (!where) return null;
  const h = encodeURIComponent(where.handle);
  if (where.kind === 'product') {
    const p = (await sh('products.json?handle=' + h + '&fields=id,handle,title,body_html,images')).products?.[0];
    return p ? { kind: 'product', id: p.id, resource: 'products/' + p.id, title: p.title, body_html: p.body_html || '', images: (p.images || []).map(i => ({ id: i.id, src: i.src, alt: i.alt || '' })) } : null;
  }
  if (where.kind === 'page') {
    const p = (await sh('pages.json?handle=' + h)).pages?.[0];
    return p ? { kind: 'page', id: p.id, resource: 'pages/' + p.id, title: p.title, body_html: p.body_html || '', images: [] } : null;
  }
  if (where.kind === 'collection') {
    const c = (await sh('custom_collections.json?handle=' + h)).custom_collections?.[0]
      || (await sh('smart_collections.json?handle=' + h)).smart_collections?.[0];
    if (!c) return null;
    const res = (c.rules ? 'smart_collections/' : 'custom_collections/') + c.id;
    return { kind: 'collection', id: c.id, resource: res, title: c.title, body_html: c.body_html || '', images: c.image?.src ? [{ id: null, src: c.image.src, alt: c.image.alt || '' }] : [] };
  }
  // article
  const blog = (await sh('blogs.json?handle=' + encodeURIComponent(where.blogHandle))).blogs?.[0];
  if (!blog) return null;
  const a = (await sh('blogs/' + blog.id + '/articles.json?handle=' + h)).articles?.[0];
  return a ? { kind: 'article', id: a.id, blogId: blog.id, resource: 'blogs/' + blog.id + '/articles/' + a.id, title: a.title, body_html: a.body_html || '', images: a.image?.src ? [{ id: null, src: a.image.src, alt: a.image.alt || '' }] : [] } : null;
}

// The "Search engine listing" fields. Shopify only returns them as metafields.
export async function readSeo(sh, resource) {
  const mf = (await sh(resource + '/metafields.json?namespace=global')).metafields || [];
  const get = k => mf.find(m => m.namespace === 'global' && m.key === k)?.value || '';
  return { title: get('title_tag'), description: get('description_tag') };
}

const SEO_FIELD = { meta_title: 'metafields_global_title_tag', meta_description: 'metafields_global_description_tag' };
const SEO_KEY = { meta_title: 'title', meta_description: 'description' };
// What the PUT body is called for each resource: { page: {...} }, { article: {...} } …
const WRAP = { product: 'product', page: 'page', article: 'article', collection: null };

const stemOf = src => { try { return decodeURIComponent(new URL(src, 'https://x').pathname.split('/').pop()).replace(/\.[a-z0-9]+$/i, '').replace(/_\d+x\d*$|_\d*x\d+$/i, '').replace(/_[a-z]+$/i, ''); } catch { return ''; } };
const sameImage = (a, b) => stemOf(a) && stemOf(a) === stemOf(b);

// Dry run — same shape as techFix.planFix.
export async function planShopifyFix(task, sh) {
  if (!AUTO_FIX_TYPES.includes(task.fix_type)) {
    return { applicable: false, reason: 'This kind of fix needs a developer (or a Grok Bot) — it isn\'t a field the suite can change safely.' };
  }
  const values = parseFixValues(task);
  if (!values) return { applicable: false, reason: 'The fix doesn\'t state the new value plainly enough to apply automatically.' };
  const obj = await resolveShopifyObject(sh, task.page_url);
  if (!obj) return { applicable: false, reason: 'Could not match ' + task.page_url + ' to a page, product, collection or blog article in Shopify (the home page\'s title is set in the theme).' };

  if (task.fix_type === 'image_alt') {
    if (obj.kind !== 'product') {
      return { applicable: false, reason: 'Shopify only lets the suite change alt text on product images; this image belongs to a ' + obj.kind + '. Change it in the Shopify admin (' + obj.kind + ' → image → alt text).' };
    }
    const changes = [], missing = [];
    for (const img of values.images) {
      const hit = obj.images.find(i => sameImage(i.src, img.src));
      if (!hit) { missing.push(img.src); continue; }
      changes.push({ kind: 'image_alt', label: 'Image alt text · ' + hit.src.split('/').pop().split('?')[0], target: { kind: 'product_image', productId: obj.id, imageId: hit.id, resource: obj.resource }, from: hit.alt, to: img.alt, src: img.src });
    }
    if (!changes.length) return { applicable: false, reason: 'Could not find ' + (missing.length > 1 ? 'these images' : 'this image') + ' among the product\'s images.' };
    return { applicable: true, changes, note: missing.length ? missing.length + ' image(s) not on this product — left for a person.' : '' };
  }

  if (obj.kind === 'collection' && WRAP[obj.kind] === null) {
    return { applicable: false, reason: 'Collections\' search listing fields can\'t be changed through the connection. Change it in the Shopify admin (Collections → ' + obj.title + ' → Search engine listing).' };
  }
  const seo = await readSeo(sh, obj.resource);
  const from = seo[SEO_KEY[task.fix_type]] || '';
  return {
    applicable: true,
    changes: [{
      kind: task.fix_type, label: (task.fix_type === 'meta_title' ? 'SEO title' : 'Meta description') + ' · ' + obj.title,
      target: { kind: obj.kind, id: obj.id, resource: obj.resource }, fields: [SEO_FIELD[task.fix_type]], from, to: values.value,
      fromFields: { [SEO_FIELD[task.fix_type]]: from }
    }]
  };
}

async function writeSeo(sh, c, value) {
  const wrap = WRAP[c.target.kind];
  await sh(c.target.resource + '.json', { method: 'PUT', body: { [wrap]: { id: c.target.id, [c.fields[0]]: value } } });
  const back = await readSeo(sh, c.target.resource);
  return back[c.kind === 'meta_title' ? 'title' : 'description'] || '';
}

// Apply, then read each value back — Shopify answers 200 whether or not a
// field it doesn't know was stored.
export async function applyShopifyPlan(plan, sh) {
  const results = [];
  for (const c of plan.changes || []) {
    try {
      if (c.kind === 'image_alt') {
        await sh('products/' + c.target.productId + '/images/' + c.target.imageId + '.json', { method: 'PUT', body: { image: { id: c.target.imageId, alt: c.to } } });
        const back = (await sh('products/' + c.target.productId + '/images/' + c.target.imageId + '.json')).image;
        results.push({ ...c, ok: (back?.alt || '') === c.to });
      } else {
        results.push({ ...c, ok: (await writeSeo(sh, c, c.to)) === c.to });
      }
    } catch (e) {
      results.push({ ...c, ok: false, error: String(e.message || e).slice(0, 200) });
    }
  }
  return results;
}

// Put back what was there — only where the value is still ours.
export async function undoShopifyResults(results, sh) {
  const out = [];
  for (const c of (results || []).filter(r => r.ok)) {
    try {
      if (c.kind === 'image_alt') {
        const cur = (await sh('products/' + c.target.productId + '/images/' + c.target.imageId + '.json')).image;
        if ((cur?.alt || '') !== c.to) { out.push({ ...c, undone: false, kept: true }); continue; }
        await sh('products/' + c.target.productId + '/images/' + c.target.imageId + '.json', { method: 'PUT', body: { image: { id: c.target.imageId, alt: c.from || '' } } });
        const back = (await sh('products/' + c.target.productId + '/images/' + c.target.imageId + '.json')).image;
        out.push({ ...c, undone: (back?.alt || '') === (c.from || '') });
      } else {
        const cur = await readSeo(sh, c.target.resource);
        if ((cur[c.kind === 'meta_title' ? 'title' : 'description'] || '') !== c.to) { out.push({ ...c, undone: false, kept: true }); continue; }
        const before = c.from || '';
        out.push({ ...c, undone: (await writeSeo(sh, c, before)) === before });
      }
    } catch (e) {
      out.push({ ...c, undone: false, error: String(e.message || e).slice(0, 200) });
    }
  }
  return out;
}

export const shopifyTechOps = { plan: planShopifyFix, apply: applyShopifyPlan, undo: undoShopifyResults };
