import { corsFetch, corsFetchText } from '../../lib/corsProxy.js';

function trimUrl(u) { return (u || '').replace(/\/$/, ''); }

export async function detectCms(url) {
  const base = trimUrl(url);
  if (!base) throw new Error('No URL');

  // 1. /wp-json/
  try {
    const res = await corsFetch(base + '/wp-json/');
    if (res.ok) {
      const powered = res.headers.get('x-powered-by') || '';
      if (/wordpress/i.test(powered)) return 'WordPress';
      const j = await res.json().catch(() => null);
      if (j && (j.namespaces || j.name)) return 'WordPress';
    }
  } catch {}

  // 2. /collections.json → Shopify
  try {
    const res = await corsFetch(base + '/collections.json');
    if (res.ok) {
      const j = await res.json().catch(() => null);
      if (j && j.collections) return 'Shopify';
    }
  } catch {}

  // 3. HTML meta generator + headers
  try {
    const html = await corsFetchText(base + '/');
    if (/wp-content|wp-includes|wordpress/i.test(html)) return 'WordPress';
    if (/cdn\.shopify\.com|shopify\.theme/i.test(html)) return 'Shopify';
    const gen = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i);
    if (gen) {
      const g = gen[1];
      if (/wordpress/i.test(g)) return 'WordPress';
      if (/shopify/i.test(g)) return 'Shopify';
      if (/wix|squarespace|webflow|drupal|joomla/i.test(g)) return g.split(' ')[0];
    }
  } catch {}

  return 'Custom Site';
}

export async function testWordPress(wpUrl, username, appPassword) {
  // Route through the Netlify wp-proxy to bypass Wordfence/Cloudflare/CORS.
  const res = await fetch('/.netlify/functions/wp-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wpUrl: trimUrl(wpUrl),
      username,
      appPassword,
      method: 'GET',
      path: 'wp/v2/users/me'
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('WordPress auth failed: ' + res.status + ' ' + txt.slice(0, 200));
  }
  const j = await res.json();
  return j.name || j.slug || 'connected';
}

export async function testShopify(store, token) {
  // Route through the Netlify shopify-proxy — the Admin API blocks
  // browser-origin requests, so a direct fetch always failed here.
  const { shopifyRequest } = await import('./shopifyApi.js');
  const j = await shopifyRequest({ shopify_store: store, shopify_token: token }, { path: 'shop.json' });
  return j.shop?.name || 'connected';
}
