// Shopify OAuth helpers — the security checks behind "Connect with Shopify".
// A mistake here either leaks an app secret or lets a forged callback write a
// token into the wrong client, so each check gets a test that proves it
// rejects the bad case, not just that the happy path works.

import crypto from 'node:crypto';
import {
  REQUIRED_SCOPES, isValidShopDomain, normalizeShop, stateKeyFromEnv,
  sealState, openState, verifyCallbackHmac, buildAuthorizeUrl, missingScopes, parseCookies, callbackUrlFor
} from '../netlify/functions/lib/shopifyOAuth.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function assertThrows(fn, match, label) {
  try { fn(); } catch (e) {
    if (match && !match.test(e.message)) throw new Error((label || '') + ' threw the wrong error: ' + e.message);
    return;
  }
  throw new Error((label || '') + ' did not throw');
}

const KEY = stateKeyFromEnv({ WP_PROXY_AUTH: 'a'.repeat(64) });
const SECRET = 'shpss_test_secret_value';

// Build a callback query the way Shopify does, signed with the app secret.
function signedQuery(params, secret = SECRET) {
  const message = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => k + '=' + v).join('&');
  return { ...params, hmac: crypto.createHmac('sha256', secret).update(message).digest('hex') };
}

// ---- shop address handling ----

await t('accepts a myshopify address and rejects everything else', () => {
  assertEq(isValidShopDomain('dibq1k-dq.myshopify.com'), true);
  assertEq(isValidShopDomain('bamdiy.com'), false, 'custom domain');
  assertEq(isValidShopDomain('evil.com/x.myshopify.com'), false, 'path smuggling');
  assertEq(isValidShopDomain('-bad.myshopify.com'), false, 'leading hyphen');
  assertEq(isValidShopDomain('shop.myshopify.com.evil.com'), false, 'suffix smuggling');
});

await t('normalizes the ways people paste a store address', () => {
  assertEq(normalizeShop('dibq1k-dq'), 'dibq1k-dq.myshopify.com');
  assertEq(normalizeShop('https://DIBQ1K-DQ.myshopify.com/admin'), 'dibq1k-dq.myshopify.com');
  assertEq(normalizeShop('admin.shopify.com/store/dibq1k-dq'), 'dibq1k-dq.myshopify.com');
  assertEq(normalizeShop('bamdiy.com'), '', 'custom domain cannot reach the Admin API');
  assertEq(normalizeShop(''), '');
});

// ---- sealing the client secret into state ----

await t('state round-trips the payload', () => {
  const token = sealState({ c: 'client-uuid', s: 'x.myshopify.com', id: 'cid', sec: SECRET, n: 'nonce' }, KEY);
  const back = openState(token, KEY);
  assertEq(back.c, 'client-uuid'); assertEq(back.sec, SECRET); assertEq(back.n, 'nonce');
});

await t('the client secret is not readable in the state string', () => {
  const token = sealState({ sec: SECRET }, KEY);
  if (token.includes(SECRET) || Buffer.from(token, 'base64url').toString('latin1').includes(SECRET)) {
    throw new Error('secret visible in state');
  }
});

await t('a tampered state is rejected', () => {
  const token = sealState({ c: 'client-uuid', sec: SECRET }, KEY);
  const raw = Buffer.from(token, 'base64url');
  raw[raw.length - 1] ^= 0x01;
  assertThrows(() => openState(raw.toString('base64url'), KEY), /altered/);
});

await t('a state sealed with a different key is rejected', () => {
  const other = stateKeyFromEnv({ WP_PROXY_AUTH: 'b'.repeat(64) });
  assertThrows(() => openState(sealState({ c: 'x' }, other), KEY), /altered/);
});

await t('an expired state is rejected', () => {
  const token = sealState({ c: 'x' }, KEY, Date.now() - 16 * 60 * 1000);
  assertThrows(() => openState(token, KEY), /expired/);
});

await t('garbage state is rejected, not crashed on', () => {
  assertThrows(() => openState('', KEY), /incomplete/);
  assertThrows(() => openState('not-a-real-state', KEY), /incomplete|altered/);
});

await t('no key is available without configuration outside netlify dev', () => {
  assertEq(stateKeyFromEnv({}), null, 'production with nothing set');
  if (!stateKeyFromEnv({ CONTEXT: 'dev' })) throw new Error('netlify dev should get a local key');
  if (stateKeyFromEnv({ CONTEXT: 'production' }) !== null) throw new Error('production must not fall back');
});

// ---- Shopify's callback signature ----

await t('a genuine Shopify callback verifies', () => {
  const q = signedQuery({ code: 'abc', shop: 'x.myshopify.com', state: 'st', timestamp: '1700000000' });
  assertEq(verifyCallbackHmac(q, SECRET), true);
});

await t('a callback signed with another secret fails', () => {
  const q = signedQuery({ code: 'abc', shop: 'x.myshopify.com', state: 'st', timestamp: '1' }, 'wrong');
  assertEq(verifyCallbackHmac(q, SECRET), false);
});

await t('changing any parameter after signing fails', () => {
  const q = signedQuery({ code: 'abc', shop: 'x.myshopify.com', state: 'st', timestamp: '1' });
  assertEq(verifyCallbackHmac({ ...q, shop: 'attacker.myshopify.com' }, SECRET), false, 'shop swapped');
  assertEq(verifyCallbackHmac({ ...q, code: 'other' }, SECRET), false, 'code swapped');
});

await t('a missing or malformed hmac fails rather than throwing', () => {
  assertEq(verifyCallbackHmac({ code: 'abc' }, SECRET), false);
  assertEq(verifyCallbackHmac({ code: 'abc', hmac: 'short' }, SECRET), false);
  assertEq(verifyCallbackHmac({ code: 'abc', hmac: 'x' }, ''), false, 'no secret');
});

// ---- authorize URL and scopes ----

await t('authorize URL asks for offline content access only', () => {
  const url = new URL(buildAuthorizeUrl({ shop: 'x.myshopify.com', appClientId: 'cid', redirectUri: 'https://s/cb', state: 'st' }));
  assertEq(url.host, 'x.myshopify.com');
  assertEq(url.pathname, '/admin/oauth/authorize');
  assertEq(url.searchParams.get('scope'), REQUIRED_SCOPES.join(','));
  assertEq(url.searchParams.get('redirect_uri'), 'https://s/cb');
  assertEq(url.searchParams.has('grant_options[]'), false, 'online token would expire with the session');
  if (/order|customer|product/.test(url.searchParams.get('scope'))) throw new Error('asks for more than content');
});

await t('scope check spots an app configured without write access', () => {
  assertEq(missingScopes('read_content,write_content').length, 0);
  assertEq(missingScopes('write_content').length, 0, 'write implies read');
  assertEq(missingScopes('read_content').join(), 'write_content');
  assertEq(missingScopes('').length, 2);
});

await t('callback URL matches what the page tells you to register', () => {
  const cb = '/.netlify/functions/shopify-oauth-callback';
  assertEq(callbackUrlFor({ headers: { host: 'syte-seo-suite.netlify.app', 'x-forwarded-proto': 'https' } }), 'https://syte-seo-suite.netlify.app' + cb);
  assertEq(callbackUrlFor({ headers: { host: 'syte-seo-suite.netlify.app' } }), 'https://syte-seo-suite.netlify.app' + cb, 'production without the header');
  assertEq(callbackUrlFor({ headers: { host: 'localhost:8888' } }), 'http://localhost:8888' + cb, 'netlify dev is plain http');
});

await t('cookie parsing finds the nonce among others', () => {
  const c = parseCookies('a=1; syte_shopify_oauth=abc123; b=2');
  assertEq(c.syte_shopify_oauth, 'abc123');
  assertEq(parseCookies('').syte_shopify_oauth, undefined);
});

console.log('shopifyOAuth: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
