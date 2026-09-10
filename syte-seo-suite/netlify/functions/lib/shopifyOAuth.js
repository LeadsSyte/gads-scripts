// Shopify OAuth helpers shared by shopify-oauth-start and shopify-oauth-callback.
// Lives in a subfolder without an index.js, so Netlify does not deploy it as a
// function of its own. Pure and node-testable: test/shopifyOAuth.test.mjs.
//
// WHY THIS FLOW EXISTS
// Since 2026-01-01 Shopify no longer lets anyone create the old admin "custom
// apps" that showed an access token to copy. New apps live in the Dev Dashboard,
// never display a token, and a custom-distribution app installs on ONE store
// (or stores in one Plus organization). So each client store gets its own app,
// and we obtain its token with the OAuth authorization code grant. Custom apps
// still receive a non-expiring offline token that way, so everything downstream
// (shopify-proxy, shopifyPush, publish-approved) keeps working with a plain
// `shopify_token`, unchanged.
//
// THE CLIENT SECRET IS NEVER STORED
// The callback needs the app's client secret to verify Shopify's HMAC and to
// exchange the code. Rather than persisting it (the clients table is readable
// with the anon key, and we cannot add columns without dashboard access), the
// start step seals it into the OAuth `state` with AES-256-GCM. Shopify hands
// `state` back untouched; the callback opens it, uses the secret once, and
// drops it. A nonce cookie binds the round trip to the browser that started it.

import crypto from 'node:crypto';

// Articles and blogs need content access. write_content implies read_content;
// asking for both keeps the approval screen explicit about what we touch.
// Nothing about orders, customers or products — keep the ask minimal.
export const REQUIRED_SCOPES = ['read_content', 'write_content'];

export const NONCE_COOKIE = 'syte_shopify_oauth';
export const STATE_TTL_MS = 15 * 60 * 1000;

// Shopify's own validation pattern for the shop parameter.
export function isValidShopDomain(shop) {
  return typeof shop === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

// Accepts "bam-diy", "bam-diy.myshopify.com", "https://bam-diy.myshopify.com/admin"
// and returns "bam-diy.myshopify.com", or '' if it isn't a myshopify address.
// A custom domain (bamdiy.com) is deliberately rejected: the Admin API and the
// OAuth endpoints only answer on the myshopify.com host.
export function normalizeShop(input) {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^admin\.shopify\.com\/store\//, '');
  s = s.split(/[/?#]/)[0];
  if (s && !s.includes('.')) s += '.myshopify.com';
  return isValidShopDomain(s) ? s : '';
}

// The sealing key. Derived rather than used raw so the value that gates the
// proxies is never itself an encryption key. CONTEXT === 'dev' is `netlify dev`
// on a laptop, where the production env vars are absent.
export function stateKeyFromEnv(env = process.env) {
  const material = env.SHOPIFY_STATE_KEY || env.WP_PROXY_AUTH
    || (env.CONTEXT === 'dev' ? 'syte-local-dev-only' : '');
  if (!material) return null;
  return Buffer.from(crypto.hkdfSync('sha256', material, 'syte-shopify-oauth', 'state-v1', 32));
}

const b64url = buf => Buffer.from(buf).toString('base64url');

export function sealState(payload, key, now = Date.now()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + STATE_TTL_MS }), 'utf8');
  const enc = Buffer.concat([cipher.update(body), cipher.final()]);
  return b64url(Buffer.concat([iv, cipher.getAuthTag(), enc]));
}

// Returns the payload, or throws with a reason safe to show the operator.
export function openState(token, key, now = Date.now()) {
  let raw;
  try { raw = Buffer.from(String(token || ''), 'base64url'); } catch { raw = Buffer.alloc(0); }
  if (raw.length < 12 + 16 + 1) throw new Error('The connection link is incomplete. Start again from the suite.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  let payload;
  try {
    payload = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
  } catch {
    throw new Error('The connection link was altered or did not come from this suite. Start again from the suite.');
  }
  if (!payload.exp || now > payload.exp) throw new Error('The connection took longer than 15 minutes and expired. Start again from the suite.');
  return payload;
}

// Shopify signs every callback: HMAC-SHA256 over the other query parameters,
// sorted by key and joined as k=v&k=v, keyed with the app's client secret.
export function verifyCallbackHmac(query, clientSecret) {
  if (!query || !query.hmac || !clientSecret) return false;
  const message = Object.entries(query)
    .filter(([k]) => k !== 'hmac' && k !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => k + '=' + v)
    .join('&');
  const digest = Buffer.from(crypto.createHmac('sha256', clientSecret).update(message).digest('hex'));
  const given = Buffer.from(String(query.hmac));
  return digest.length === given.length && crypto.timingSafeEqual(digest, given);
}

export function buildAuthorizeUrl({ shop, appClientId, redirectUri, state }) {
  // No grant_options[] → offline access, the token our background publisher needs.
  return 'https://' + shop + '/admin/oauth/authorize?' + new URLSearchParams({
    client_id: appClientId,
    scope: REQUIRED_SCOPES.join(','),
    redirect_uri: redirectUri,
    state
  }).toString();
}

// Shopify reports what was actually granted, which can be less than asked for
// if the app's configured scopes don't include them. A write_* grant covers the
// matching read_*.
export function missingScopes(grantedScopeString) {
  const granted = new Set(String(grantedScopeString || '').split(',').map(s => s.trim()).filter(Boolean));
  return REQUIRED_SCOPES.filter(s =>
    !granted.has(s) && !(s.startsWith('read_') && granted.has('write_' + s.slice(5))));
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Must match, character for character, the redirect URL registered in the Dev
// Dashboard — which the suite page shows from window.location.origin. Netlify
// sets x-forwarded-proto in production; `netlify dev` does not, and defaulting
// to https there made the callback https://localhost while the page said
// http://localhost, so a locally registered app would be rejected.
export function callbackUrlFor(event) {
  const host = event.headers.host || '';
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = event.headers['x-forwarded-proto'] || (local ? 'http' : 'https');
  return proto + '://' + host + '/.netlify/functions/shopify-oauth-callback';
}
