// Site-wide page discovery. Every "the fixes only cover the homepage"
// report has traced back to this module, so the cases below are written as
// the specific failures that caused it: a blocked CORS fetch, robots.txt
// listing several sitemaps with no parent index, a site with no sitemap at
// all, and skip patterns eating legitimate pages.
//
// Run: node test/sitemap.test.mjs  (or npm test)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/aeo/sitemap.js'), 'utf8');

// Stub the browser CORS chain; the page-proxy path goes through global fetch.
globalThis.__corsFetchText = async () => { throw new Error('corsFetchText not configured'); };
const PATCHED = SRC.replace(
  "import { corsFetchText } from '../../lib/corsProxy.js';",
  "const corsFetchText = (...a) => globalThis.__corsFetchText(...a);"
);
const tmp = path.join(os.tmpdir(), 'sitemap-' + process.pid + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

// ---------------------------------------------------------------------------
// Harness: a fake site served through the Netlify page-proxy.
// ---------------------------------------------------------------------------
let SITE = {};              // url → body text
let proxyCalls = [];
let proxyEnabled = true;

globalThis.fetch = async (url, init) => {
  if (String(url).includes('page-proxy')) {
    if (!proxyEnabled) throw new Error('function not deployed');
    const target = JSON.parse(init.body).url;
    proxyCalls.push(target);
    const body = SITE[target];
    if (body === undefined) {
      return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    }
    return { ok: true, status: 200, json: async () => ({ status: 200, html: body, source: 'direct' }) };
  }
  throw new Error('unexpected fetch: ' + url);
};

function urlset(urls) {
  return '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    urls.map(u => `<url><loc>${u}</loc></url>`).join('') + '</urlset>';
}
function sitemapindex(urls) {
  return '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    urls.map(u => `<sitemap><loc>${u}</loc></sitemap>`).join('') + '</sitemapindex>';
}
function page(links) {
  return '<html><body>' + links.map(h => `<a href="${h}">link</a>`).join(' ') + '</body></html>';
}

let pass = 0, fail = 0;
async function t(name, fn) {
  SITE = {};
  proxyCalls = [];
  proxyEnabled = true;
  globalThis.__corsFetchText = async () => { throw new Error('corsFetchText not configured for ' + name); };
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function has(list, value, label) {
  if (!list.includes(value)) throw new Error((label || value) + ' missing from [' + list.join(', ') + ']');
}
function lacks(list, value, label) {
  if (list.includes(value)) throw new Error((label || value) + ' should not be present');
}

// ---------------------------------------------------------------------------
// isContentUrl — over-eager substring matching used to eat real pages
// ---------------------------------------------------------------------------
await t('isContentUrl: keeps pages whose slug merely contains a skip word', () => {
  for (const u of [
    'https://x.test/accounting-services',   // contains "account"
    'https://x.test/cartridges',            // contains "cart"
    'https://x.test/research-and-insights', // contains "search"
    'https://x.test/feedback'               // contains "feed"
  ]) {
    if (!mod.isContentUrl(u)) throw new Error('wrongly filtered: ' + u);
  }
});

await t('isContentUrl: still drops genuine non-content URLs', () => {
  for (const u of [
    'https://x.test/cart',
    'https://x.test/my-account/orders',
    'https://x.test/tag/news',
    'https://x.test/wp-admin/admin.php',
    'https://x.test/feed',
    'https://x.test/brochure.pdf',
    'https://x.test/products?colour=red'
  ]) {
    if (mod.isContentUrl(u)) throw new Error('should have been filtered: ' + u);
  }
});

// ---------------------------------------------------------------------------
// fetchSitemapUrls
// ---------------------------------------------------------------------------
await t('fetchSitemapUrls: reads a plain urlset', async () => {
  SITE['https://x.test/sitemap.xml'] = urlset(['https://x.test/', 'https://x.test/about']);
  const urls = await mod.fetchSitemapUrls('https://x.test/sitemap.xml');
  eq(urls.length, 2, 'count');
  has(urls, 'https://x.test/about');
});

await t('fetchSitemapUrls: recurses into EVERY child of a sitemap index', async () => {
  SITE['https://x.test/sitemap_index.xml'] = sitemapindex([
    'https://x.test/page-sitemap.xml',
    'https://x.test/post-sitemap.xml',
    'https://x.test/product-sitemap.xml'
  ]);
  SITE['https://x.test/page-sitemap.xml'] = urlset(['https://x.test/', 'https://x.test/about']);
  SITE['https://x.test/post-sitemap.xml'] = urlset(['https://x.test/blog/one', 'https://x.test/blog/two']);
  SITE['https://x.test/product-sitemap.xml'] = urlset(['https://x.test/shop/widget']);
  const urls = await mod.fetchSitemapUrls('https://x.test/sitemap_index.xml');
  eq(urls.length, 5, 'all children merged');
  has(urls, 'https://x.test/blog/two');
  has(urls, 'https://x.test/shop/widget');
});

await t('fetchSitemapUrls: treats an all-xml list as an index even without the wrapper', async () => {
  SITE['https://x.test/sitemap.xml'] = urlset([
    'https://x.test/a-sitemap.xml', 'https://x.test/b-sitemap.xml'
  ]);
  SITE['https://x.test/a-sitemap.xml'] = urlset(['https://x.test/a']);
  SITE['https://x.test/b-sitemap.xml'] = urlset(['https://x.test/b']);
  const urls = await mod.fetchSitemapUrls('https://x.test/sitemap.xml');
  eq(urls.length, 2, 'children read');
  has(urls, 'https://x.test/b');
});

await t('fetchSitemapUrls: de-dupes trailing-slash and www variants of one page', async () => {
  SITE['https://x.test/sitemap.xml'] = urlset([
    'https://x.test/about', 'https://x.test/about/', 'https://www.x.test/about'
  ]);
  const urls = await mod.fetchSitemapUrls('https://x.test/sitemap.xml');
  eq(urls.length, 1, 'collapsed to one page');
});

await t('fetchSitemapUrls: falls back to pasted XML when the fetch fails', async () => {
  const urls = await mod.fetchSitemapUrls('https://x.test/missing.xml', urlset(['https://x.test/pasted']));
  has(urls, 'https://x.test/pasted');
});

await t('fetchSitemapUrls: falls back to the browser proxy when page-proxy is unavailable', async () => {
  proxyEnabled = false;
  globalThis.__corsFetchText = async (u) =>
    u === 'https://x.test/sitemap.xml' ? urlset(['https://x.test/via-cors']) : (() => { throw new Error('404'); })();
  const urls = await mod.fetchSitemapUrls('https://x.test/sitemap.xml');
  has(urls, 'https://x.test/via-cors');
});

// ---------------------------------------------------------------------------
// discoverSitemapUrls — the "only the first sitemap was read" bug
// ---------------------------------------------------------------------------
await t('discoverSitemapUrls: merges EVERY sitemap robots.txt declares', async () => {
  SITE['https://x.test/robots.txt'] =
    'User-agent: *\nDisallow: /wp-admin/\n' +
    'Sitemap: https://x.test/page-sitemap.xml\n' +
    'Sitemap: https://x.test/post-sitemap.xml\n' +
    'Sitemap: https://x.test/product-sitemap.xml\n';
  SITE['https://x.test/page-sitemap.xml'] = urlset(['https://x.test/', 'https://x.test/about']);
  SITE['https://x.test/post-sitemap.xml'] = urlset(['https://x.test/blog/one']);
  SITE['https://x.test/product-sitemap.xml'] = urlset(['https://x.test/shop/widget', 'https://x.test/shop/gadget']);
  const urls = await mod.discoverSitemapUrls('https://x.test/');
  eq(urls.length, 5, 'every declared sitemap contributed');
  has(urls, 'https://x.test/blog/one');
  has(urls, 'https://x.test/shop/gadget');
});

await t('discoverSitemapUrls: merges the common paths when robots.txt names none', async () => {
  SITE['https://x.test/robots.txt'] = 'User-agent: *\nDisallow:\n';
  SITE['https://x.test/sitemap.xml'] = urlset(['https://x.test/', 'https://x.test/about']);
  SITE['https://x.test/product-sitemap.xml'] = urlset(['https://x.test/shop/widget']);
  const urls = await mod.discoverSitemapUrls('https://x.test/');
  has(urls, 'https://x.test/about');
  has(urls, 'https://x.test/shop/widget', 'sibling common path also merged');
});

await t('discoverSitemapUrls: survives a robots.txt too short for the proxy body check', async () => {
  // Short robots.txt is served over the CORS fallback, not page-proxy.
  proxyEnabled = false;
  globalThis.__corsFetchText = async (u) => {
    if (u === 'https://x.test/robots.txt') return 'Sitemap: https://x.test/sitemap.xml\n';
    if (u === 'https://x.test/sitemap.xml') return urlset(['https://x.test/', 'https://x.test/about']);
    throw new Error('404');
  };
  const urls = await mod.discoverSitemapUrls('https://x.test/');
  has(urls, 'https://x.test/about');
});

// ---------------------------------------------------------------------------
// discoverPagesByCrawl — no sitemap anywhere
// ---------------------------------------------------------------------------
await t('discoverPagesByCrawl: walks internal links two levels deep', async () => {
  SITE['https://x.test/'] = page(['/about', '/services', 'https://other.test/partner']);
  SITE['https://x.test/about'] = page(['/about/team']);
  SITE['https://x.test/services'] = page(['/services/seo', '/services/ppc']);
  const urls = await mod.discoverPagesByCrawl('https://x.test/', { maxPages: 50 });
  has(urls, 'https://x.test/');
  has(urls, 'https://x.test/about');
  has(urls, 'https://x.test/about/team', 'second level reached');
  has(urls, 'https://x.test/services/ppc', 'second level reached');
  lacks(urls, 'https://other.test/partner', 'external link');
});

await t('discoverPagesByCrawl: bounds page fetches while still collecting links', async () => {
  // Homepage links to 60 pages; with maxFetches=1 only the homepage is
  // fetched, but every link it exposes is still collected.
  SITE['https://x.test/'] = page(Array.from({ length: 60 }, (_, i) => '/p-' + i));
  for (let i = 0; i < 60; i++) SITE['https://x.test/p-' + i] = page(['/deep-' + i]);
  const urls = await mod.discoverPagesByCrawl('https://x.test/', { maxPages: 200, maxFetches: 1 });
  eq(urls.length, 61, 'homepage + its 60 links');
  eq(proxyCalls.length, 1, 'only the homepage was fetched');
  lacks(urls, 'https://x.test/deep-0', 'second level not reached within the fetch budget');
});

await t('discoverPagesByCrawl: honours maxPages', async () => {
  SITE['https://x.test/'] = page(Array.from({ length: 30 }, (_, i) => '/p-' + i));
  const urls = await mod.discoverPagesByCrawl('https://x.test/', { maxPages: 10 });
  eq(urls.length, 10, 'capped');
});

// ---------------------------------------------------------------------------
// discoverSiteUrls — the ladder, end to end
// ---------------------------------------------------------------------------
await t('discoverSiteUrls: a configured sitemap wins', async () => {
  SITE['https://x.test/custom.xml'] = urlset(['https://x.test/', 'https://x.test/a', 'https://x.test/b']);
  const { urls, source } = await mod.discoverSiteUrls({ url: 'https://x.test/', sitemap_url: 'https://x.test/custom.xml' });
  eq(source, 'configured sitemap', 'source');
  eq(urls.length, 3, 'count');
});

await t('discoverSiteUrls: auto-discovers when no sitemap is configured', async () => {
  SITE['https://x.test/robots.txt'] = 'User-agent: *\nSitemap: https://x.test/sitemap.xml\n';
  SITE['https://x.test/sitemap.xml'] = urlset(['https://x.test/', 'https://x.test/a', 'https://x.test/b']);
  const { urls, source } = await mod.discoverSiteUrls({ url: 'https://x.test/' });
  eq(source, 'auto-discovered sitemap', 'source');
  eq(urls.length, 3, 'count');
});

await t('discoverSiteUrls: a broken configured sitemap still yields the whole site', async () => {
  SITE['https://x.test/robots.txt'] = 'Sitemap: https://x.test/sitemap.xml\n';
  SITE['https://x.test/sitemap.xml'] = urlset(['https://x.test/', 'https://x.test/a', 'https://x.test/b']);
  const { urls, source } = await mod.discoverSiteUrls({ url: 'https://x.test/', sitemap_url: 'https://x.test/gone.xml' });
  eq(source, 'auto-discovered sitemap', 'fell through to discovery');
  eq(urls.length, 3, 'count');
});

await t('discoverSiteUrls: crawls links when the site has no sitemap at all', async () => {
  SITE['https://x.test/'] = page(['/about', '/services', '/contact']);
  SITE['https://x.test/about'] = page([]);
  SITE['https://x.test/services'] = page([]);
  SITE['https://x.test/contact'] = page([]);
  const { urls, source } = await mod.discoverSiteUrls({ url: 'https://x.test/' });
  eq(source, 'internal link crawl', 'source');
  eq(urls.length, 4, 'homepage + three pages');
});

await t('discoverSiteUrls: adds the homepage when the sitemap omits it', async () => {
  SITE['https://x.test/custom.xml'] = urlset(['https://x.test/a', 'https://x.test/b']);
  const { urls } = await mod.discoverSiteUrls({ url: 'https://x.test/', sitemap_url: 'https://x.test/custom.xml' });
  has(urls, 'https://x.test/', 'homepage kept in scope');
  eq(urls.length, 3, 'count');
});

await t('discoverSiteUrls: homepage-only is the last resort, and says so', async () => {
  // Nothing responds at all.
  const { urls, source } = await mod.discoverSiteUrls({ url: 'https://x.test/' });
  eq(source, 'homepage only', 'source');
  eq(urls.length, 1, 'count');
});

await t('discoverSiteUrls: caps at maxPages but reports the true total', async () => {
  SITE['https://x.test/custom.xml'] = urlset(Array.from({ length: 40 }, (_, i) => 'https://x.test/p-' + i));
  const { urls, total } = await mod.discoverSiteUrls(
    { url: 'https://x.test/', sitemap_url: 'https://x.test/custom.xml' },
    { maxPages: 10 }
  );
  eq(urls.length, 10, 'capped');
  eq(total, 41, 'homepage + 40 discovered');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
