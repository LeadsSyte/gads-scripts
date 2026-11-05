// CMS credentials are read server-side by client id (security brief §1.2):
// the resolver, the guarded redirects, and the proxies end to end, plus the
// three functions that had no auth check (notify-draft, shopify-oauth-start,
// google-proxy).

import { resolveWordPress, resolveShopify, cleanApiPath, guardedFetch, CredsError } from '../netlify/functions/lib/cmsCreds.js';
import { handler as wpProxy } from '../netlify/functions/wp-proxy.js';
import { handler as shopifyProxy } from '../netlify/functions/shopify-proxy.js';
import { handler as notifyDraft } from '../netlify/functions/notify-draft.js';
import { handler as oauthStart } from '../netlify/functions/shopify-oauth-start.js';
import { handler as googleProxy } from '../netlify/functions/google-proxy.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
async function rejects(p, status, re) {
  try { await p; } catch (e) {
    if (!(e instanceof CredsError)) throw new Error('not a CredsError: ' + e.message);
    if (status && e.status !== status) throw new Error('status ' + e.status + ' (' + e.message + ')');
    if (re && !re.test(e.message)) throw new Error('message: ' + e.message);
    return;
  }
  throw new Error('did not reject');
}

process.env.WP_PROXY_AUTH = 'gate';
delete process.env.INTERNAL_FN_SECRET; delete process.env.LEGACY_SUITE_AUTH;
delete process.env.SUPABASE_URL; delete process.env.VITE_SUPABASE_URL;

const CLIENTS = {
  c1: { id: 'c1', wp_url: 'https://krost.example/', wp_username: 'syte', wp_app_password: 'abcd efgh', shopify_store: null, shopify_token: null },
  c2: { id: 'c2', wp_url: null, shopify_store: 'bam.myshopify.com', shopify_token: 'shpat_x' },
  evil: { id: 'evil', wp_url: 'http://169.254.169.254', wp_username: 'a', wp_app_password: 'b' },
  rebound: { id: 'rebound', wp_url: 'https://rebind.example', wp_username: 'a', wp_app_password: 'b' }
};
const lookup = async host => ({ 'krost.example': ['41.76.1.10'], 'www.krost.example': ['41.76.1.10'], 'bam.myshopify.com': ['23.227.38.65'], 'rebind.example': ['10.0.0.9'], 'other.example': ['8.8.8.8'] }[host] || (() => { throw new Error('ENOTFOUND'); })());
const deps = { loadClient: async id => CLIENTS[id] || null, lookup };
const staff = { kind: 'legacy' }, bot = { kind: 'api_key', id: 'k1' };

await t('by client id: credentials and address come from the record', async () => {
  eq(await resolveWordPress({ clientId: 'c1' }, bot, deps), { wpUrl: 'https://krost.example', username: 'syte', appPassword: 'abcd efgh', clientId: 'c1' });
  eq(await resolveShopify({ clientId: 'c2' }, bot, deps), { store: 'bam.myshopify.com', token: 'shpat_x', clientId: 'c2' });
  await rejects(resolveWordPress({ clientId: 'nope' }, staff, deps), 404);
  await rejects(resolveWordPress({ clientId: 'c2' }, staff, deps), 400, /no WordPress/);
  await rejects(resolveShopify({ clientId: 'c1' }, staff, deps), 400, /no Shopify/);
});

await t('raw credentials: staff only; a bot key must send clientId', async () => {
  eq((await resolveWordPress({ wpUrl: 'krost.example', username: 'u', appPassword: 'p' }, staff, deps)).wpUrl, 'https://krost.example');
  await rejects(resolveWordPress({ wpUrl: 'https://krost.example', username: 'u', appPassword: 'p' }, bot, deps), 403, /clientId/);
  await rejects(resolveShopify({ store: 'bam.myshopify.com', token: 't' }, bot, deps), 403);
  eq((await resolveShopify({ store: 'https://bam.myshopify.com/', token: 't' }, staff, deps)).store, 'bam.myshopify.com');
});

await t('private addresses are refused whether typed or stored on the client', async () => {
  await rejects(resolveWordPress({ clientId: 'evil' }, staff, deps), 400, /refused/);
  await rejects(resolveWordPress({ clientId: 'rebound' }, staff, deps), 400, /private/);
  await rejects(resolveWordPress({ wpUrl: 'http://localhost:8080', username: 'u', appPassword: 'p' }, staff, deps), 400);
  await rejects(resolveShopify({ store: '127.0.0.1', token: 't' }, staff, deps), 400);
});

await t('API paths stay inside the API', () => {
  eq(cleanApiPath('/wp/v2/posts?search=x'), 'wp/v2/posts?search=x');
  for (const bad of ['', 'https://evil.example/x', '../../wp-admin', 'wp/v2/../../x']) {
    let threw = false; try { cleanApiPath(bad); } catch { threw = true; }
    if (!threw) throw new Error('accepted ' + bad);
  }
});

const resp = (status, body = '', headers = {}) => ({ status, headers: { get: n => headers[n.toLowerCase()] ?? null }, text: async () => body });

await t('redirects: followed with each hop checked; POST→GET on 301/302; credentials dropped off-origin', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([url, init.method, Object.keys(init.headers || {}).join(',')]);
    if (url === 'https://krost.example/wp-json/wp/v2/posts') return resp(301, '', { location: 'https://www.krost.example/wp-json/wp/v2/posts' });
    if (url === 'https://www.krost.example/wp-json/wp/v2/posts') return resp(302, '', { location: 'https://other.example/x' });
    if (url === 'https://krost.example/same') return resp(308, '', { location: '/same2' });
    return resp(200, 'ok');
  };
  const r = await guardedFetch('https://krost.example/wp-json/wp/v2/posts', { method: 'POST', headers: { Authorization: 'Basic x', 'Content-Type': 'application/json' }, body: '{}' }, { lookup, fetchImpl });
  eq(r.status, 200);
  eq(seen, [
    ['https://krost.example/wp-json/wp/v2/posts', 'POST', 'Authorization,Content-Type'],
    // www is another origin: the credential is dropped, as Node's own fetch did before.
    ['https://www.krost.example/wp-json/wp/v2/posts', 'GET', ''],
    ['https://other.example/x', 'GET', '']
  ]);
  seen.length = 0;
  await guardedFetch('https://krost.example/same', { method: 'POST', headers: { Authorization: 'Basic x' }, body: '{}' }, { lookup, fetchImpl });
  eq(seen[1], ['https://krost.example/same2', 'POST', 'Authorization'], '308 on the same origin keeps method and credential');
  const toPrivate = async url => url.includes('krost') ? resp(302, '', { location: 'http://10.0.0.1/admin' }) : resp(200);
  await rejects(guardedFetch('https://krost.example/', {}, { lookup, fetchImpl: toPrivate }), 400, /private/);
  const loop = async () => resp(307, '', { location: 'https://krost.example/again' });
  await rejects(guardedFetch('https://krost.example/', {}, { lookup, fetchImpl: loop }), 502, /Too many/);
});

const post = (body, headers = { 'x-suite-auth': 'gate' }) => ({ httpMethod: 'POST', headers, body: JSON.stringify(body) });

await t('wp-proxy end to end: the app password is added server-side and never needed from the caller', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = { url, auth: init.headers.Authorization }; return resp(200, '[]', { 'content-type': 'application/json' }); };
  const r = await wpProxy(post({ clientId: 'c1', path: 'wp/v2/users/me' }), { credDeps: { ...deps, fetchImpl } });
  eq(r.statusCode, 200);
  eq(sent, { url: 'https://krost.example/wp-json/wp/v2/users/me', auth: 'Basic ' + Buffer.from('syte:abcd efgh').toString('base64') });
  eq((await wpProxy(post({ clientId: 'c1', path: 'x' }, {}), { credDeps: deps })).statusCode, 401, 'still needs the suite credential');
  eq((await wpProxy(post({ clientId: 'evil', path: 'x' }), { credDeps: deps })).statusCode, 400);
  eq((await wpProxy(post({ clientId: 'c1', path: '../x' }), { credDeps: deps })).statusCode, 400);
});

await t('shopify-proxy end to end: token read by client id', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = { url, token: init.headers['X-Shopify-Access-Token'] }; return resp(200, '{}'); };
  eq((await shopifyProxy(post({ clientId: 'c2', path: 'shop.json' }), { credDeps: { ...deps, fetchImpl } })).statusCode, 200);
  eq(sent, { url: 'https://bam.myshopify.com/admin/api/2024-01/shop.json', token: 'shpat_x' });
});

await t('notify-draft, shopify-oauth-start and google-proxy refuse callers without a suite credential', async () => {
  eq((await notifyDraft(post({ queueId: 'q1' }, {}))).statusCode, 401, 'notify-draft');
  eq((await oauthStart(post({ clientId: 'c2', shop: 'bam', appClientId: 'a', appClientSecret: 'b' }, {}))).statusCode, 401, 'shopify-oauth-start');
  for (const action of ['list', 'revoke', 'request']) {
    const r = await googleProxy(post({ action, accountEmail: 'x@syte.co.za', url: 'https://searchconsole.googleapis.com/x' }, { origin: 'https://evil.example' }));
    eq(r.statusCode, 401, 'google-proxy ' + action);
    eq(r.headers['Access-Control-Allow-Origin'] === 'https://evil.example' || r.headers['Access-Control-Allow-Origin'] === '*', false, 'google-proxy must not allow any origin');
  }
  eq((await googleProxy(post({ action: 'health' }, {}))).statusCode, 200, 'the yes/no setup diagnostic stays public');
});

console.log(`\ncmsCreds: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
