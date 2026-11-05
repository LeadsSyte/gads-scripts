// Shopify Admin API proxy — the Admin API rejects browser-origin requests
// (CORS) and the access token must never ride in a browser-visible call to
// a third-party host, so all Shopify calls route through this function.
//
// Request body:
//   { clientId, method, path, body? }   token read server-side (lib/cmsCreds.js)
//   { store, token, … }                 staff only — testing an unsaved store
// `path` is relative to /admin/api/2024-01/, e.g. "blogs.json" or
// "blogs/123/articles.json".

import { authorize, fromEvent, deny } from './lib/requireAuth.js';
import { resolveShopify, cleanApiPath, liveCredDeps, guardedFetch, CredsError } from './lib/cmsCreds.js';
import { getServerSupabase } from './lib/serverSupabase.js';

export async function handler(event, { credDeps } = {}) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  const auth = await authorize(fromEvent(event));
  if (!auth.ok) return deny(auth.status, corsHeaders(), auth.reason);

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: corsHeaders(), body: 'Invalid JSON' }; }

  let creds, path;
  try {
    path = cleanApiPath(payload.path);
    creds = await resolveShopify(payload, auth.actor, credDeps || liveCredDeps(getServerSupabase()));
  } catch (e) {
    return deny(e instanceof CredsError ? e.status : 500, corsHeaders(), e.message);
  }

  const fullUrl = 'https://' + creds.store + '/admin/api/2024-01/' + path;
  const { method, body } = payload;

  try {
    const res = await guardedFetch(fullUrl, {
      method: method || 'GET',
      headers: {
        'X-Shopify-Access-Token': creds.token,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    }, { lookup: credDeps?.lookup, fetchImpl: credDeps?.fetchImpl });
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'application/json',
        ...corsHeaders()
      },
      body: text
    };
  } catch (e) {
    if (e instanceof CredsError) return deny(e.status, corsHeaders(), e.message);
    return {
      statusCode: 502,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Shopify proxy fetch failed: ' + e.message })
    };
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://syte-seo-suite.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Suite-Auth, X-Internal-Auth',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
