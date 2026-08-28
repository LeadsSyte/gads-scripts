// End-to-end test for the in-house crawler. The crawler replaced
// WebCEO; if it stops detecting issues correctly the entire Technical
// SEO module silently produces zero tasks. Uses linkedom for DOMParser
// (browser API not available in Node) and mocks fetch + corsFetchText
// + discoverSiteUrls so the test exercises the real crawler logic.
//
// Run: npm test  (from syte-seo-suite/)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/technical/crawler.js'), 'utf8');

// linkedom gives us a real DOMParser-compatible parser in Node.
class FakeDOMParser {
  parseFromString(html /*, type*/) {
    const { document } = parseHTML(html);
    return document;
  }
}
globalThis.DOMParser = FakeDOMParser;

// Patch the source: replace the two external imports with global stubs.
globalThis.__corsFetchText = async () => { throw new Error('corsFetchText not configured'); };
globalThis.__discoverSiteUrls = async () => { throw new Error('discoverSiteUrls not configured'); };

const PATCHED = SRC
  .replace("import { corsFetchText } from '../../lib/corsProxy.js';",
           "const corsFetchText = (...a) => globalThis.__corsFetchText(...a);")
  .replace("import { discoverSiteUrls } from '../aeo/sitemap.js';",
           "const discoverSiteUrls = (...a) => globalThis.__discoverSiteUrls(...a);");

// Discovery is exercised in sitemap.test.mjs; here we only need it to hand
// the crawler a URL list, so express each case as the list it should return.
function stubUrls(urls, source = 'test') {
  globalThis.__discoverSiteUrls = async () => ({ urls, source, total: urls.length });
}

const tmp = path.join(os.tmpdir(), 'crawler-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let fetchCalls = [];
let fetchHandler = () => { throw new Error('fetch not configured'); };
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), body: init?.body });
  return fetchHandler(String(url), init);
};
function jsonRes(obj, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) };
}

let pass = 0, fail = 0;
async function t(name, fn) {
  fetchCalls = [];
  fetchHandler = () => { throw new Error('fetch not configured for ' + name); };
  globalThis.__corsFetchText = async () => { throw new Error('corsFetchText not configured for ' + name); };
  globalThis.__discoverSiteUrls = async () => { throw new Error('discoverSiteUrls not configured for ' + name); };
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function assertContains(arr, predicate, label) {
  if (!arr.some(predicate)) throw new Error((label || '') + ' no match found');
}

// ============================================================================
// summarizeCrawlForAI — pure function, sanity check
// ============================================================================
await t('summarizeCrawlForAI: skips error pages (no Claude tasks for 404s)', () => {
  const summary = mod.summarizeCrawlForAI({
    totalCrawled: 2, withIssues: 1, withErrors: 1,
    pages: [
      { url: 'https://x/', error: '404', skipped: true },
      { url: 'https://x/about', title: 'About', issueCount: 1,
        issues: [{ type: 'meta_title', severity: 'high', detail: 'missing', fix: '<title>About | X</title>' }] }
    ]
  });
  if (summary.includes('404')) throw new Error('error page should not appear in Claude prompt');
  if (!summary.includes('https://x/about')) throw new Error('valid page missing');
  if (!summary.includes('meta_title')) throw new Error('issue type missing');
});

await t('summarizeCrawlForAI: skips pages with zero issues', () => {
  const summary = mod.summarizeCrawlForAI({
    totalCrawled: 1, withIssues: 0, withErrors: 0,
    pages: [{ url: 'https://x/clean', title: 'Clean', issueCount: 0, issues: [] }]
  });
  if (summary.includes('https://x/clean')) throw new Error('clean page should not appear');
});

// ============================================================================
// crawlSiteForIssues — sitemap path
// ============================================================================
// Helper: pad HTML so it clears the crawler's length thresholds. The
// real crawler skips pages under 200 chars (suspected non-content). We
// add a body of lorem-ipsum filler.
const FILLER = '<p>' + 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(10) + '</p>';

await t('crawlSiteForIssues: walks sitemap URLs and detects missing meta', async () => {
  stubUrls(['https://example.test/about', 'https://example.test/contact']);
  fetchHandler = (url, init) => {
    const target = JSON.parse(init.body).url;
    const html = target.endsWith('/about')
      ? '<html><head><title>About Us</title></head><body><h1>About</h1>' + FILLER + '</body></html>'
      // /contact is missing meta description and canonical entirely.
      : '<html><head><title>Contact Us</title></head><body><h1>Contact</h1>' + FILLER + '</body></html>';
    return jsonRes({ status: 200, html, source: 'jina-reader' });
  };
  const result = await mod.crawlSiteForIssues({ url: 'https://example.test/', sitemap_url: 'https://example.test/sitemap.xml' });
  assertEq(result.totalCrawled, 2, 'totalCrawled');
  assertContains(result.pages, p => p.url.endsWith('/about') && p.issueCount > 0, 'about has issues');
  assertContains(result.pages, p => p.url.endsWith('/contact') && p.issues.some(i => i.type === 'meta_description'), 'contact missing desc');
});

await t('crawlSiteForIssues: throws when no urls discovered', async () => {
  stubUrls([], 'none');
  globalThis.__corsFetchText = async () => { throw new Error('not reachable'); };
  fetchHandler = (url, init) => jsonRes({ html: '', source: 'none' });
  let caught;
  try {
    await mod.crawlSiteForIssues({ url: '', sitemap_url: '' });
  } catch (e) { caught = e; }
  if (!caught || !/No URLs to crawl/.test(caught.message)) {
    throw new Error('expected throw with "No URLs to crawl", got: ' + (caught && caught.message));
  }
});

// The scan must audit the whole site, not the first page discovery hands
// back — this is the regression that produced homepage-only fix lists.
await t('crawlSiteForIssues: crawls every discovered page, not just the first', async () => {
  const site = ['https://example.test/', 'https://example.test/about', 'https://example.test/services',
                'https://example.test/pricing', 'https://example.test/contact', 'https://example.test/blog/post-1'];
  stubUrls(site, 'auto-discovered sitemap');
  fetchHandler = (url, init) => jsonRes({
    status: 200, source: 'direct',
    html: '<html><head><title>Page</title></head><body><h1>Page</h1>' + FILLER + '</body></html>'
  });
  const result = await mod.crawlSiteForIssues({ url: 'https://example.test/' });
  assertEq(result.totalCrawled, site.length, 'totalCrawled');
  for (const u of site) assertContains(result.pages, p => p.url === u, 'crawled ' + u);
  assertEq(result.discoverySource, 'auto-discovered sitemap', 'discoverySource surfaced');
});

await t('crawlSiteForIssues: maxPages caps the crawl but reports the true site size', async () => {
  const site = Array.from({ length: 12 }, (_, i) => 'https://example.test/page-' + i);
  stubUrls(site, 'configured sitemap');
  fetchHandler = () => jsonRes({
    status: 200, source: 'direct',
    html: '<html><head><title>Page</title></head><body><h1>Page</h1>' + FILLER + '</body></html>'
  });
  const result = await mod.crawlSiteForIssues({ url: 'https://example.test/' }, { maxPages: 5 });
  assertEq(result.urlsAttempted, 5, 'urlsAttempted');
  assertEq(result.urlsDiscovered, 12, 'urlsDiscovered');
});

// ============================================================================
// summarizeCrawlForAI — breadth over depth under the character budget
// ============================================================================
await t('summarizeCrawlForAI: every page gets a line before any page gets two', () => {
  const pages = Array.from({ length: 40 }, (_, i) => ({
    url: 'https://x.test/page-' + i,
    title: 'Page ' + i,
    issueCount: 4,
    issues: [
      { type: 'meta_title', severity: 'high', detail: 'x'.repeat(120), fix: 'y'.repeat(120) },
      { type: 'h1', severity: 'medium', detail: 'x'.repeat(120), fix: 'y'.repeat(120) },
      { type: 'image_alt', severity: 'low', detail: 'x'.repeat(120), fix: 'y'.repeat(120) },
      { type: 'open_graph', severity: 'low', detail: 'x'.repeat(120), fix: 'y'.repeat(120) }
    ]
  }));
  // A budget too small for everything — breadth must win over depth.
  const summary = mod.summarizeCrawlForAI(
    { totalCrawled: 40, withIssues: 40, withErrors: 0, pages },
    { maxChars: 14000 }
  );
  const listed = pages.filter(p => summary.includes('PAGE: ' + p.url)).length;
  if (listed !== 40) throw new Error('expected all 40 pages represented, got ' + listed);
  if (summary.length > 14000) throw new Error('budget exceeded: ' + summary.length);
  if (!/Trimmed to fit/.test(summary)) throw new Error('trimming must be disclosed');
});

await t('summarizeCrawlForAI: worst issue on a page is the one that survives', () => {
  const summary = mod.summarizeCrawlForAI({
    totalCrawled: 1, withIssues: 1, withErrors: 0,
    pages: [{
      url: 'https://x.test/a', title: 'A', issueCount: 2,
      issues: [
        { type: 'open_graph', severity: 'low', detail: 'low one', fix: null },
        { type: 'robots', severity: 'critical', detail: 'noindex', fix: null }
      ]
    }]
  }, { maxIssuesPerPage: 1 });
  if (!summary.includes('noindex')) throw new Error('critical issue dropped');
  if (summary.includes('low one')) throw new Error('low issue kept over critical');
});

// ============================================================================
// Issue detection — specific rules
// ============================================================================
async function crawlOne(html) {
  // Pad to clear the crawler's 200-char minimum.
  const padded = html.includes('</body>') ? html.replace('</body>', FILLER + '</body>') : html + FILLER;
  stubUrls(['https://x.test/page']);
  fetchHandler = () => jsonRes({ status: 200, html: padded, source: 'test' });
  const r = await mod.crawlSiteForIssues({ url: 'https://x.test/', sitemap_url: 'https://x.test/sitemap.xml' });
  return r.pages[0];
}

await t('detects missing <title>', async () => {
  const p = await crawlOne('<html><head></head><body><h1>Hi</h1></body></html>');
  assertContains(p.issues, i => i.type === 'meta_title' && i.severity === 'high');
});

await t('detects missing meta description', async () => {
  const p = await crawlOne('<html><head><title>Some title that is the right length</title></head><body><h1>H</h1></body></html>');
  assertContains(p.issues, i => i.type === 'meta_description');
});

await t('detects missing H1', async () => {
  const p = await crawlOne('<html><head><title>Long enough title for a real page</title></head><body><p>just text</p></body></html>');
  assertContains(p.issues, i => i.type === 'h1');
});

await t('detects missing canonical', async () => {
  const p = await crawlOne('<html><head><title>Long enough title for a real page</title><meta name="description" content="A reasonable meta description that is long enough to be valid."></head><body><h1>H</h1></body></html>');
  assertContains(p.issues, i => i.type === 'canonical');
});

await t('skips a soft 404 (200 status, content says "not found")', async () => {
  const p = await crawlOne('<html><head><title>Page Not Found</title></head><body><h1>Not Found</h1></body></html>');
  if (!p.skipped) throw new Error('soft-404 page should be skipped');
});

await t('skips real 404 by HTTP status', async () => {
  stubUrls(['https://x.test/dead']);
  fetchHandler = () => jsonRes({ status: 404, html: '<html><body>x</body></html>'.repeat(50), source: 'test' });
  const r = await mod.crawlSiteForIssues({ url: 'https://x.test/', sitemap_url: 'https://x.test/sitemap.xml' });
  if (!r.pages[0].skipped) throw new Error('404 page should be skipped');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
