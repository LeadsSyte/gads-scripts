// End-to-end "Connect with Shopify" flow through both Netlify functions, with
// Shopify and Supabase replaced by a fake fetch. The point is the negative
// cases: every check in the callback must stop the flow BEFORE a code is
// exchanged or anything is written to a client record.

import crypto from 'node:crypto';

process.env.WP_PROXY_AUTH = 'a'.repeat(64);
process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_KEY = 'service-key';

const { handler: start } = await import('../netlify/functions/shopify-oauth-start.js');
const { handler: callback } = await import('../netlify/functions/shopify-oauth-callback.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const SHOP = 'dibq1k-dq.myshopify.com';
const APP_ID = 'app-client-id';
const APP_SECRET = 'shpss_app_secret_do_not_store';
const SUITE_CLIENT = '00000000-0000-0000-0000-00000000b4d1';

// ---- fake network ----
let calls = [];
let scopeGranted = 'write_content,read_content';
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const body = typeof opts.body === 'string' ? opts.body : opts.body?.toString?.() || '';
  calls.push({ url: u, method: opts.method || 'GET', body });
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.endsWith('/admin/oauth/access_token')) return json({ access_token: 'shpat_new_token', scope: scopeGranted });
  if (u.startsWith('https://sb.test/rest/v1/syte_suite_clients')) return json([{ id: SUITE_CLIENT, name: 'bamdiy.com' }]);
  if (u.includes('/shop.json')) return json({ shop: { name: 'BAM DIY' } });
  return json({ error: 'unexpected ' + u }, 500);
};

async function begin(overrides = {}) {
  const res = await start({
    httpMethod: 'POST',
    headers: { host: 'syte-seo-suite.netlify.app', 'x-forwarded-proto': 'https', 'x-suite-auth': process.env.WP_PROXY_AUTH },
    body: JSON.stringify({ clientId: SUITE_CLIENT, shop: 'dibq1k-dq', appClientId: APP_ID, appClientSecret: APP_SECRET, ...overrides })
  });
  const out = JSON.parse(res.body);
  const cookie = (res.headers['Set-Cookie'] || '').split(';')[0];
  const state = out.url ? new URL(out.url).searchParams.get('state') : null;
  return { res, out, cookie, state, attempt: out.attempt };
}

// What Shopify sends back, signed with the app secret.
function shopifyCallbackQuery(state, { shop = SHOP, secret = APP_SECRET } = {}) {
  const params = { code: 'auth-code-123', host: 'YWRtaW4uc2hvcGlmeS5jb20', shop, state, timestamp: String(Math.floor(Date.now() / 1000)) };
  const message = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => k + '=' + v).join('&');
  return { ...params, hmac: crypto.createHmac('sha256', secret).update(message).digest('hex') };
}

const finish = (query, cookie) =>
  callback({ httpMethod: 'GET', queryStringParameters: query, headers: { cookie } });

const exchanged = () => calls.some(c => c.url.endsWith('/admin/oauth/access_token'));
const wroteDb = () => calls.some(c => c.url.startsWith('https://sb.test/'));

// ---- start step ----

await t('start refuses without the suite auth header', async () => {
  const res = await start({ httpMethod: 'POST', headers: { host: 'x' }, body: '{}' });
  assert(res.statusCode === 401, 'expected 401, got ' + res.statusCode);
});

await t('start rejects a public website address instead of the myshopify one', async () => {
  const { res, out } = await begin({ shop: 'bamdiy.com' });
  assert(res.statusCode === 400 && /myshopify/.test(out.error), 'expected a myshopify hint');
});

await t('start returns an authorize URL for the right store, and never puts the secret in it', async () => {
  const { res, out, cookie } = await begin();
  assert(res.statusCode === 200, 'status ' + res.statusCode);
  const url = new URL(out.url);
  assert(url.host === SHOP, 'wrong host ' + url.host);
  assert(url.searchParams.get('client_id') === APP_ID, 'wrong client id');
  assert(!out.url.includes(APP_SECRET), 'SECRET LEAKED INTO THE URL');
  assert(out.redirectUri === 'https://syte-seo-suite.netlify.app/.netlify/functions/shopify-oauth-callback', 'redirect ' + out.redirectUri);
  assert(/^syte_shopify_oauth=[0-9a-f]{32}$/.test(cookie), 'nonce cookie missing: ' + cookie);
  assert(/HttpOnly/.test(res.headers['Set-Cookie']) && /Secure/.test(res.headers['Set-Cookie']), 'cookie not locked down');
});

// ---- callback: every check stops the flow before exchange ----

await t('callback rejects a request from a browser that did not start it', async () => {
  calls = [];
  const { state } = await begin();
  const res = await finish(shopifyCallbackQuery(state), 'syte_shopify_oauth=' + 'f'.repeat(32));
  assert(/did not start in this browser/.test(res.body), 'wrong message');
  assert(!exchanged() && !wroteDb(), 'exchanged or wrote despite a bad cookie');
});

await t('callback rejects Shopify answering for a different store', async () => {
  calls = [];
  const { state, cookie } = await begin();
  const res = await finish(shopifyCallbackQuery(state, { shop: 'someone-else.myshopify.com' }), cookie);
  assert(/different store/.test(res.body), 'wrong message');
  assert(!exchanged() && !wroteDb(), 'exchanged or wrote for the wrong store');
});

await t('callback rejects a forged signature', async () => {
  calls = [];
  const { state, cookie } = await begin();
  const res = await finish(shopifyCallbackQuery(state, { secret: 'attacker-secret' }), cookie);
  assert(/signature did not match/.test(res.body), 'wrong message');
  assert(!exchanged() && !wroteDb(), 'exchanged or wrote with a forged signature');
});

await t('callback rejects a tampered state', async () => {
  calls = [];
  const { state, cookie } = await begin();
  const bad = state.slice(0, -2) + (state.endsWith('A') ? 'BB' : 'AA');
  const res = await finish(shopifyCallbackQuery(bad), cookie);
  assert(/altered|incomplete/.test(res.body), 'wrong message');
  assert(!exchanged() && !wroteDb(), 'proceeded with a tampered state');
  assert(res.body.includes('"attempt":""'), 'an unverified failure must not name an attempt any tab would act on');
});

await t('callback refuses to save a token that cannot write blog posts', async () => {
  calls = []; scopeGranted = 'read_content';
  const { state, cookie } = await begin();
  const res = await finish(shopifyCallbackQuery(state), cookie);
  scopeGranted = 'write_content,read_content';
  assert(/missing the write_content permission/.test(res.body), 'wrong message');
  assert(!wroteDb(), 'saved a token that cannot write');
});

// ---- the happy path ----

await t('a genuine approval saves the token on the right client and never stores the secret', async () => {
  calls = [];
  const { state, cookie, attempt } = await begin();
  assert(/^[0-9a-f]{16}$/.test(attempt || ''), 'start did not return an attempt id');
  const res = await finish(shopifyCallbackQuery(state), cookie);
  assert(res.statusCode === 200 && />Connected</.test(res.body), 'not connected: ' + res.body.slice(0, 300));
  assert(res.body.includes('"attempt":"' + attempt + '"'), 'success signal not tagged with this attempt');
  assert(/BAM DIY is now connected to bamdiy\.com/.test(res.body), 'confirmation missing store/client names');

  const exchange = calls.find(c => c.url.endsWith('/admin/oauth/access_token'));
  assert(exchange.url === 'https://' + SHOP + '/admin/oauth/access_token', 'exchanged with the wrong host');
  assert(!/expiring=1/.test(exchange.body), 'asked for an expiring token the suite cannot renew');

  const db = calls.find(c => c.url.startsWith('https://sb.test/rest/v1/syte_suite_clients'));
  assert(db && db.method === 'PATCH', 'no update issued');
  assert(db.url.includes('id=eq.' + SUITE_CLIENT), 'updated the wrong client: ' + db.url);
  const saved = JSON.parse(db.body);
  assert(saved.shopify_token === 'shpat_new_token' && saved.shopify_store === SHOP && saved.cms_type === 'Shopify', 'wrong fields ' + db.body);
  assert(!db.body.includes(APP_SECRET), 'SECRET WRITTEN TO THE DATABASE');
  assert(/Max-Age=0/.test(res.headers['Set-Cookie']), 'nonce cookie not cleared');
});

await t('the same approval cannot be replayed once the cookie is cleared', async () => {
  const { state } = await begin();
  const res = await finish(shopifyCallbackQuery(state), '');
  assert(/did not start in this browser/.test(res.body), 'replay was accepted');
});

await t('a Shopify-side cancel shows a readable message, not a crash', async () => {
  const res = await finish({ error: 'access_denied', error_description: '<script>alert(1)</script>' }, '');
  assert(/Connection failed/.test(res.body), 'no failure page');
  assert(!res.body.includes('<script>alert(1)'), 'unescaped HTML from the query string');
});

console.log('shopifyOAuthFlow: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
