// cmsDetect.js contract tests. Drives the "What CMS is this?" probe used
// when a user adds a client. Tries 3 signals in order: /wp-json/, /
// collections.json (Shopify), and HTML meta generator + signature strings.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/cms/cmsDetect.js'), 'utf8');

// Stub corsFetch + corsFetchText.
globalThis.__corsFetch = async () => { throw new Error('corsFetch not configured'); };
globalThis.__corsFetchText = async () => { throw new Error('corsFetchText not configured'); };
const PATCHED = SRC.replace(
  "import { corsFetch, corsFetchText } from '../../lib/corsProxy.js';",
  `const corsFetch = (...a) => globalThis.__corsFetch(...a);
   const corsFetchText = (...a) => globalThis.__corsFetchText(...a);`
);

const tmp = path.join(os.tmpdir(), 'cmsDetect-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let fetchCalls = [];
let fetchHandler = () => { throw new Error('fetch not configured'); };
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  return fetchHandler(String(url), init);
};

let pass = 0, fail = 0;
async function t(name, fn) {
  fetchCalls = [];
  globalThis.__corsFetch = async () => { throw new Error('not configured'); };
  globalThis.__corsFetchText = async () => { throw new Error('not configured'); };
  fetchHandler = () => { throw new Error('not configured'); };
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
async function expectThrow(fn, regex, label) {
  try { await fn(); }
  catch (e) {
    if (regex && !regex.test(e.message)) throw new Error((label || '') + ' wrong error: ' + e.message);
    return;
  }
  throw new Error((label || '') + ' expected throw, did not throw');
}
function jsonOk(obj, headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: true, status: 200,
    headers: { get: k => h.get(k.toLowerCase()) || null },
    json: async () => obj
  };
}
function notFound() {
  return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
}

// ============================================================================
// detectCms — order of probes matters (cheap signals first)
// ============================================================================
await t('detectCms: throws when URL is empty', async () => {
  await expectThrow(() => mod.detectCms(''), /No URL/);
});

await t('detectCms: WordPress detected via /wp-json/ namespaces', async () => {
  globalThis.__corsFetch = async (url) => {
    if (url.endsWith('/wp-json/')) return jsonOk({ namespaces: ['wp/v2'], name: 'Acme Blog' });
    return notFound();
  };
  eq(await mod.detectCms('https://example.com'), 'WordPress');
});

await t('detectCms: WordPress detected via x-powered-by header (when JSON missing)', async () => {
  globalThis.__corsFetch = async (url) => {
    if (url.endsWith('/wp-json/')) {
      return {
        ok: true, status: 200,
        headers: { get: k => k.toLowerCase() === 'x-powered-by' ? 'WordPress 6.4' : null },
        json: async () => ({}) // no namespaces, no name
      };
    }
    return notFound();
  };
  eq(await mod.detectCms('https://example.com'), 'WordPress');
});

await t('detectCms: Shopify detected via /collections.json', async () => {
  globalThis.__corsFetch = async (url) => {
    if (url.endsWith('/wp-json/')) return notFound();
    if (url.endsWith('/collections.json')) return jsonOk({ collections: [{ id: 1 }] });
    return notFound();
  };
  eq(await mod.detectCms('https://shop.example.com'), 'Shopify');
});

await t('detectCms: WordPress detected via HTML signature when API blocked', async () => {
  globalThis.__corsFetch = async () => notFound();
  globalThis.__corsFetchText = async () => '<html><body class="wp-includes"><script src="/wp-content/themes/x.js"></script></body></html>';
  eq(await mod.detectCms('https://locked.example.com'), 'WordPress');
});

await t('detectCms: Shopify detected via cdn.shopify.com signature in HTML', async () => {
  globalThis.__corsFetch = async () => notFound();
  globalThis.__corsFetchText = async () => '<html><head><link href="https://cdn.shopify.com/s/files/x.css"></head></html>';
  eq(await mod.detectCms('https://shop.example.com'), 'Shopify');
});

await t('detectCms: detects via meta generator (Wix)', async () => {
  globalThis.__corsFetch = async () => notFound();
  globalThis.__corsFetchText = async () => '<html><head><meta name="generator" content="Wix.com Website Builder"></head></html>';
  eq(await mod.detectCms('https://example.wixsite.com'), 'Wix.com');
});

await t('detectCms: detects via meta generator (WordPress)', async () => {
  globalThis.__corsFetch = async () => notFound();
  globalThis.__corsFetchText = async () => '<html><head><meta name="generator" content="WordPress 6.4.2"></head></html>';
  eq(await mod.detectCms('https://example.com'), 'WordPress');
});

await t('detectCms: returns "Custom Site" when no signal matches', async () => {
  globalThis.__corsFetch = async () => notFound();
  globalThis.__corsFetchText = async () => '<html><head><title>Bare</title></head><body></body></html>';
  eq(await mod.detectCms('https://example.com'), 'Custom Site');
});

await t('detectCms: returns "Custom Site" when every fetch throws', async () => {
  globalThis.__corsFetch = async () => { throw new Error('blocked'); };
  globalThis.__corsFetchText = async () => { throw new Error('blocked'); };
  eq(await mod.detectCms('https://example.com'), 'Custom Site');
});

// ============================================================================
// testWordPress
// ============================================================================
await t('testWordPress: routes through wp-proxy with credentials envelope', async () => {
  fetchHandler = (url, init) => {
    const env = JSON.parse(init.body);
    eq(env.wpUrl, 'https://blog.test', 'trailing slash stripped');
    eq(env.username, 'admin');
    eq(env.appPassword, 'pw');
    eq(env.path, 'wp/v2/users/me');
    return { ok: true, status: 200, json: async () => ({ name: 'Mike' }), text: async () => '' };
  };
  const out = await mod.testWordPress('https://blog.test/', 'admin', 'pw');
  eq(out, 'Mike');
});

await t('testWordPress: 401 surfaces "auth failed: 401 ..."', async () => {
  fetchHandler = () => ({ ok: false, status: 401, text: async () => 'Bad creds', json: async () => ({}) });
  await expectThrow(() => mod.testWordPress('https://x.test', 'a', 'b'), /auth failed: 401.*Bad creds/);
});

await t('testWordPress: returns "connected" when no name/slug present', async () => {
  fetchHandler = () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  eq(await mod.testWordPress('https://x.test', 'a', 'b'), 'connected');
});

// ============================================================================
// testShopify
// ============================================================================
await t('testShopify: hits /admin/api/<v>/shop.json with token header', async () => {
  fetchHandler = (url, init) => {
    if (!/admin\/api\/.*\/shop\.json$/.test(url)) throw new Error('wrong endpoint: ' + url);
    eq(init.headers['X-Shopify-Access-Token'], 'shpat_x');
    return { ok: true, status: 200, json: async () => ({ shop: { name: 'Acme Shop' } }) };
  };
  eq(await mod.testShopify('acme.myshopify.com', 'shpat_x'), 'Acme Shop');
});

await t('testShopify: strips https:// + trailing / from store before fetch', async () => {
  fetchHandler = (url) => {
    if (url.startsWith('https://https://')) throw new Error('double protocol: ' + url);
    if (!url.startsWith('https://acme.myshopify.com/')) throw new Error('store malformed: ' + url);
    return { ok: true, json: async () => ({ shop: { name: 'X' } }) };
  };
  await mod.testShopify('https://acme.myshopify.com/', 'shpat_x');
});

await t('testShopify: 401 surfaces auth failed error', async () => {
  fetchHandler = () => ({ ok: false, status: 401, json: async () => ({}) });
  await expectThrow(() => mod.testShopify('acme.myshopify.com', 'bad'), /auth failed: 401/);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
