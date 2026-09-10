// Shopify OAuth — step 1 of 2: build the store's approval link.
//
// The suite POSTs { clientId, shop, appClientId, appClientSecret } for ONE
// client store. We seal the secret into `state` (see lib/shopifyOAuth.js for
// why it is never stored), set a nonce cookie that binds the round trip to
// this browser, and return the Shopify authorize URL for the suite to open in
// a popup. POST rather than a GET redirect like google-oauth-start, because
// the client secret must never appear in a URL.
//
// Auth gate + CORS mirror shopify-proxy.js: when WP_PROXY_AUTH is set, the
// matching X-Suite-Auth header is required.

import crypto from 'node:crypto';
import {
  NONCE_COOKIE, STATE_TTL_MS, normalizeShop, stateKeyFromEnv, sealState,
  buildAuthorizeUrl, callbackUrlFor
} from './lib/shopifyOAuth.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const requiredAuth = process.env.WP_PROXY_AUTH;
  if (requiredAuth) {
    const given = event.headers['x-suite-auth'] || event.headers['X-Suite-Auth'] || '';
    if (given !== requiredAuth) return json(401, { error: 'Unauthorized' });
  }

  const key = stateKeyFromEnv();
  if (!key) return json(500, { error: 'Shopify connect is not configured on the server (WP_PROXY_AUTH is not set).' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const shop = normalizeShop(body.shop);
  const clientId = String(body.clientId || '').trim();
  const appClientId = String(body.appClientId || '').trim();
  const appClientSecret = String(body.appClientSecret || '').trim();

  if (!clientId) return json(400, { error: 'No suite client selected.' });
  if (!shop) {
    return json(400, { error: 'Use the store\'s myshopify address (for example bam-diy.myshopify.com), not its public website address.' });
  }
  if (!appClientId || !appClientSecret) {
    return json(400, { error: 'Both the Client ID and the Client secret from the Shopify Dev Dashboard are needed.' });
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  // Public id for this attempt. The callback broadcasts it with the outcome
  // so the suite tab that started THIS connection is the only one that acts
  // on it — not another tab connecting a different store. (The nonce stays
  // secret; this id is safe to expose.)
  const attempt = crypto.randomBytes(8).toString('hex');
  const redirectUri = callbackUrlFor(event);
  const state = sealState({ c: clientId, s: shop, id: appClientId, sec: appClientSecret, n: nonce, a: attempt }, key);

  const cookie = NONCE_COOKIE + '=' + nonce
    + '; Path=/.netlify/functions/shopify-oauth-callback'
    + '; Max-Age=' + Math.floor(STATE_TTL_MS / 1000)
    + '; HttpOnly; Secure; SameSite=Lax';

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie, ...corsHeaders() },
    // redirectUri is returned so the suite can show exactly what must be
    // registered in the Dev Dashboard if Shopify rejects it.
    body: JSON.stringify({ url: buildAuthorizeUrl({ shop, appClientId, redirectUri, state }), redirectUri, shop, attempt })
  };
}

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json', ...corsHeaders() }, body: JSON.stringify(obj) };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://syte-seo-suite.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type, X-Suite-Auth',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
