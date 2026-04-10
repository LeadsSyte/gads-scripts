import { fetchWithCorsProxy } from '../../lib/cors.js';

export async function detectCms(url) {
  if (!url) return { type: 'unknown' };
  const base = url.replace(/\/$/, '');
  // WordPress REST
  try {
    const res = await fetchWithCorsProxy(`${base}/wp-json/`);
    if (res.ok) return { type: 'wordpress', via: 'wp-json' };
  } catch {
    /* ignore */
  }
  // Headers
  try {
    const res = await fetchWithCorsProxy(base);
    const powered = res.headers.get?.('x-powered-by') || '';
    if (/wordpress|woocommerce/i.test(powered)) return { type: 'wordpress', via: 'header' };
    const html = await res.text();
    if (/name="generator"[^>]*content="WordPress/i.test(html)) {
      return { type: 'wordpress', via: 'meta' };
    }
    if (/cdn\.shopify\.com|Shopify\.theme/i.test(html)) {
      return { type: 'shopify', via: 'meta' };
    }
  } catch {
    /* ignore */
  }
  // Shopify collections
  try {
    const res = await fetchWithCorsProxy(`${base}/collections.json`);
    if (res.ok) return { type: 'shopify', via: 'collections.json' };
  } catch {
    /* ignore */
  }
  return { type: 'custom' };
}
