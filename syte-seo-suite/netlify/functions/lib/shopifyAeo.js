// AEO additions on a client's Shopify store — the Shopify side of aeoFix.js,
// same plan shape so aeoFixRun.js, the panel, the preview and undo work
// unchanged. Pages, blog articles and products keep their content in
// body_html, which the theme renders as the page's main content; the
// addition is inserted there between markers (see aeoFix.js). Collections
// and the home page stay manual.

import { resolveShopifyObject } from './shopifyFix.js';
import { planInsertion, contentIsRendered, wrapInsertion, insertInto, removeInsertion, hasInsertion, fixKey } from './aeoFix.js';

const WRAP = { product: 'product', page: 'page', article: 'article' };

function simpleHash(s) {
  let h = 5381;
  for (const ch of String(s || '')) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h.toString(36) + ':' + String(s || '').length;
}

async function readBody(sh, obj) {
  const wrap = WRAP[obj.kind];
  const j = await sh(obj.resource + '.json?fields=id,body_html');
  return j?.[wrap]?.body_html ?? '';
}

export async function planAeoFixShopify({ url, opt, optKey }, sh, fetchLive) {
  const ins = planInsertion(opt);
  if (!ins.ok) return { applicable: false, reason: ins.reason };
  const obj = await resolveShopifyObject(sh, url);
  if (!obj) return { applicable: false, reason: 'Could not match this URL to a page, product or blog article in Shopify (the home page and collections are built in the theme).' };
  if (!WRAP[obj.kind]) return { applicable: false, reason: 'Collection pages are laid out by the theme — add this in the Shopify admin (or with a Grok Bot).' };
  const raw = obj.body_html || '';
  const key = fixKey(url, optKey);
  if (hasInsertion(raw, key)) return { applicable: false, reason: 'Already added to this page.' };
  const live = await fetchLive(url);
  if (!contentIsRendered(raw, live)) {
    return { applicable: false, reason: 'This page\'s visible content comes from the theme\'s sections, not the page content — adding it through the connection wouldn\'t show. Add it in the theme editor (or with a Grok Bot).' };
  }
  return {
    applicable: true, target: { kind: obj.kind, id: obj.id, resource: obj.resource, blogId: obj.blogId || null }, position: ins.position, html: ins.html, key,
    rawHash: simpleHash(raw),
    renderedPreview: insertInto(raw, ins.html, ins.position)
  };
}

export async function applyAeoFixShopify(plan, sh) {
  const obj = { kind: plan.target.kind, resource: plan.target.resource };
  const raw = await readBody(sh, obj);
  if (simpleHash(raw) !== plan.rawHash) return { ok: false, changed: true, reason: 'The page was edited since the preview — preview again before applying.' };
  const next = insertInto(raw, wrapInsertion(plan.key, plan.html, raw), plan.position);
  await sh(plan.target.resource + '.json', { method: 'PUT', body: { [WRAP[obj.kind]]: { id: plan.target.id, body_html: next } } });
  return { ok: hasInsertion(await readBody(sh, obj), plan.key), originalHash: plan.rawHash };
}

export async function undoAeoFixShopify(plan, sh) {
  const obj = { kind: plan.target.kind, resource: plan.target.resource };
  const raw = await readBody(sh, obj);
  if (!hasInsertion(raw, plan.key)) return { ok: true, note: 'It was not on the page any more.' };
  await sh(plan.target.resource + '.json', { method: 'PUT', body: { [WRAP[obj.kind]]: { id: plan.target.id, body_html: removeInsertion(raw, plan.key) } } });
  return { ok: !hasInsertion(await readBody(sh, obj), plan.key) };
}

export const shopifyAeoOps = { plan: planAeoFixShopify, apply: applyAeoFixShopify, undo: undoAeoFixShopify };
