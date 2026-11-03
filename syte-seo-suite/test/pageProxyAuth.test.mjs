// page-proxy and the provider proxies refuse strangers and private
// addresses (security brief §1.5–1.6). The handlers run in-process; no
// network is reached because every request is refused before a fetch.

import { handler as pageProxy } from '../netlify/functions/page-proxy.js';
import { handler as openaiProxy } from '../netlify/functions/openai-proxy.js';
import { handler as geminiProxy } from '../netlify/functions/gemini-proxy.js';
import { handler as webceoProxy } from '../netlify/functions/webceo-proxy.js';
import { handler as wpProxy } from '../netlify/functions/wp-proxy.js';
import { handler as shopifyProxy } from '../netlify/functions/shopify-proxy.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };

process.env.WP_PROXY_AUTH = 'testhash';
delete process.env.INTERNAL_FN_SECRET;
delete process.env.LEGACY_SUITE_AUTH;
delete process.env.SUPABASE_URL; delete process.env.VITE_SUPABASE_URL; // no DB: JWT lookups unavailable, legacy still works
const post = (body, headers = {}) => ({ httpMethod: 'POST', headers: { origin: 'https://evil.example', ...headers }, body: JSON.stringify(body) });
const okAuth = { 'x-suite-auth': 'testhash' };

await t('every proxy refuses a request with no credentials', async () => {
  for (const [name, fn, body] of [['page', pageProxy, { url: 'https://krost.example/' }], ['openai', openaiProxy, { endpoint: 'responses', body: {} }], ['gemini', geminiProxy, { model: 'gemini-2.5-flash', payload: {} }], ['webceo', webceoProxy, { raw: {} }], ['wp', wpProxy, { wpUrl: 'https://x', path: 'wp/v2/posts' }], ['shopify', shopifyProxy, { store: 'x', path: 'blogs.json' }]]) {
    const r = await fn(post(body));
    eq(r.statusCode, 401, name);
    eq(r.headers['Access-Control-Allow-Origin'] === 'https://evil.example', false, name + ' must not echo a stranger origin');
  }
});

await t('a wrong hash is refused too; a GET probe is not a run', async () => {
  eq((await pageProxy(post({ url: 'https://krost.example/' }, { 'x-suite-auth': 'nope' }))).statusCode, 401);
  eq((await pageProxy({ httpMethod: 'GET', headers: okAuth })).statusCode, 405);
});

await t('page-proxy: private, loopback, metadata and non-http addresses are refused before any fetch', async () => {
  for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://localhost:8888/', 'http://127.0.0.1/', 'http://10.1.2.3/', 'http://192.168.0.1/', 'file:///etc/passwd', 'ftp://krost.example/', 'http://[::1]/']) {
    const r = await pageProxy(post({ url }, okAuth));
    eq(r.statusCode, 400, url);
    const body = JSON.parse(r.body);
    if (!/private|reserved|Local|http and https/i.test(body.error)) throw new Error(url + ': ' + body.error);
  }
});

await t('page-proxy: a missing or non-string url is a 400, not a crash', async () => {
  eq((await pageProxy(post({}, okAuth))).statusCode, 400);
  eq((await pageProxy(post({ url: 42 }, okAuth))).statusCode, 400);
});

await t('openai/gemini proxies ignore a key in the body and use only the server key', async () => {
  delete process.env.OPENAI_API_KEY; delete process.env.GOOGLE_AI_KEY;
  const o = await openaiProxy(post({ apiKey: 'sk-from-browser', endpoint: 'responses', body: {} }, okAuth));
  eq(o.statusCode, 400); if (!/OPENAI_API_KEY/.test(o.body)) throw new Error(o.body);
  const g = await geminiProxy(post({ apiKey: 'AIza-from-browser', model: 'gemini-2.5-flash', payload: {} }, okAuth));
  eq(g.statusCode, 400); if (!/GOOGLE_AI_KEY/.test(g.body)) throw new Error(g.body);
});

console.log(`\npageProxyAuth: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
