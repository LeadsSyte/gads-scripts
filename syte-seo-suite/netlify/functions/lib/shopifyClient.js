// Shopify Admin REST for a client store, with its (offline) access token:
// sh(path) GETs, sh(path, { method, body }) writes. Paths are relative to
// /admin/api/<version>/ and end in .json, e.g. 'pages/12.json'.
export const SHOPIFY_API_VERSION = '2024-01';

export function shopifyClient(client) {
  const store = String(client.shopify_store || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const base = 'https://' + store + '/admin/api/' + SHOPIFY_API_VERSION + '/';
  return async (path, { method = 'GET', body } = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'X-Shopify-Access-Token': client.shopify_token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000)
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = text; try { const j = JSON.parse(text); msg = JSON.stringify(j.errors || j.error || j); } catch { /* raw */ }
      throw new Error('Shopify ' + r.status + ': ' + String(msg).slice(0, 160));
    }
    try { return JSON.parse(text); } catch { return text; }
  };
}

export const hasShopify = client => client?.cms_type === 'Shopify' && !!client.shopify_store && !!client.shopify_token;
