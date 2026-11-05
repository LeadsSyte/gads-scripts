// All Shopify Admin API calls route through the Netlify shopify-proxy
// function — the Admin API blocks browser-origin requests, and the token
// should never appear in a browser call to a third-party host.

import { proxyAuthHash } from './proxyAuth.js';
import { fnUrl } from '../../lib/fnUrl.js';

// Saved clients go by id; the proxy reads the token server-side
// (netlify/functions/lib/cmsCreds.js). Raw store + token only for a store
// being tested before it is saved, or details marked `__typedCreds`.
export function shopifyCredsFor(client) {
  if (client.id && !client.__typedCreds) return { clientId: client.id };
  return { store: client.shopify_store, token: client.shopify_token };
}

export async function shopifyRequest(client, { method = 'GET', path, body } = {}) {
  if (!client.shopify_store) throw new Error('Client has no Shopify store set.');
  const creds = shopifyCredsFor(client);
  if (!creds.clientId && !client.shopify_token) throw new Error('Client has no Shopify token set.');

  const res = await fetch(fnUrl('shopify-proxy'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
    body: JSON.stringify({ ...creds, method, path, body })
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    const msg = typeof data === 'object' ? (JSON.stringify(data.errors || data.error || data)) : text;
    throw new Error('Shopify ' + res.status + ': ' + msg);
  }
  return data;
}

export function storeHandle(client) {
  return (client.shopify_store || '').replace(/^https?:\/\//, '').replace(/\/+$/, '').replace('.myshopify.com', '');
}

export async function listBlogs(client) {
  const j = await shopifyRequest(client, { path: 'blogs.json' });
  return j.blogs || [];
}

export async function findArticleByHandle(client, blogId, handle) {
  if (!handle) return null;
  const j = await shopifyRequest(client, {
    path: 'blogs/' + blogId + '/articles.json?handle=' + encodeURIComponent(handle)
  });
  const list = j.articles || [];
  return list.length > 0 ? list[0] : null;
}
