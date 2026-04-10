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
  const base = trimUrl(wpUrl);
  const auth = 'Basic ' + btoa(username + ':' + appPassword);
  const res = await fetch(base + '/wp-json/wp/v2/users/me', {
    headers: { Authorization: auth }
  });
  if (!res.ok) throw new Error('WordPress auth failed: ' + res.status);
  const j = await res.json();
  return j.name || j.slug || 'connected';
}

export async function testShopify(store, token) {
  const cleanStore = store.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const res = await fetch('https://' + cleanStore + '/admin/api/2024-01/shop.json', {
    headers: { 'X-Shopify-Access-Token': token }
  });
  if (!res.ok) throw new Error('Shopify auth failed: ' + res.status);
  const j = await res.json();
  return j.shop?.name || 'connected';
}
