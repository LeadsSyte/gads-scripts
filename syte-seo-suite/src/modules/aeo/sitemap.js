// Site-wide page discovery — the single source of URLs for both the AEO
// Engine and the Technical SEO crawler.
//
// The whole point of this module is that a run covers the WHOLE site, not
// just the homepage. Every earlier "only the homepage got fixes" report
// traced back to one of these four things, so each is handled explicitly:
//
//   1. Fetching failed. The browser-side CORS proxy chain is blocked by most
//      WAFs, so a sitemap that exists in a browser tab came back empty here.
//      We now go through the server-side Netlify page-proxy first (browser
//      headers, no CORS) and only fall back to the browser chain.
//   2. Only the first sitemap was read. Sites without a parent index list one
//      sitemap per content type in robots.txt (Yoast: post-, page-,
//      product-sitemap.xml). Reading the first one gave a single slice of the
//      site. We now aggregate across every sitemap we find.
//   3. No sitemap at all. The old fallback grabbed the homepage's links, and
//      if that single fetch failed it returned the homepage alone. We now BFS
//      internal links a couple of levels deep before giving up.
//   4. Over-eager filtering. Skip patterns were raw substrings, so
//      /accounting-services was dropped as "/account" and /cartridges as
//      "/cart". Filtering is now path-segment aware.

import { corsFetchText } from '../../lib/corsProxy.js';

const PAGE_PROXY = '/.netlify/functions/page-proxy';

// Sitemap indexes may nest; 2 levels covers every real-world layout.
const MAX_SITEMAP_DEPTH = 2;
// Guard against a pathological index listing thousands of children.
const MAX_CHILD_SITEMAPS = 60;
// How many remote fetches to run at once. Sequential fetching through a
// proxy made a 20-child Yoast index take minutes; users gave up mid-run.
const FETCH_CONCURRENCY = 5;

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Run an async mapper over items with bounded concurrency, never rejecting —
// a failed item simply contributes nothing.
async function mapLimited(items, fn) {
  const out = [];
  for (const batch of chunk(items, FETCH_CONCURRENCY)) {
    const settled = await Promise.all(batch.map(item => fn(item).catch(() => null)));
    for (const r of settled) if (r) out.push(r);
  }
  return out;
}

// ---------- fetching ----------

// Fetch a text resource (sitemap XML, robots.txt, an HTML page) from another
// origin. The Netlify page-proxy runs server-side with browser headers, so it
// clears CORS and most bot filters; the browser proxy chain is the fallback
// for local dev and for the rare case the function is unavailable.
export async function fetchRemoteText(url) {
  try {
    const res = await fetch(PAGE_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // raw: true keeps the served markup intact — Jina Reader rewrites
      // documents and would mangle sitemap XML.
      body: JSON.stringify({ url, raw: true })
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.html && data.html.trim()) return data.html;
    }
  } catch {}

  try {
    const text = await corsFetchText(url);
    if (text && text.trim()) return text;
  } catch {}

  return null;
}

// ---------- parsing ----------

// Parse <loc> entries from sitemap XML. Also handles plain-text URL lists.
function parseLocs(xml) {
  if (!xml) return [];
  const urls = [];
  // Try XML <loc> tags first. Namespaced sitemaps use <loc>, <sm:loc>, etc.
  const matches = [...xml.matchAll(/<(?:[a-z0-9]+:)?loc>\s*([\s\S]*?)\s*<\/(?:[a-z0-9]+:)?loc>/gi)];
  for (const m of matches) {
    const u = decodeEntities(m[1].trim());
    if (u) urls.push(u);
  }
  // Fallback: plain text URL list (one per line)
  if (!urls.length) {
    for (const line of xml.split('\n')) {
      const t = line.trim();
      if (t.startsWith('http')) urls.push(t);
    }
  }
  return urls;
}

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// ---------- filtering ----------

// Path segments that are never content pages worth optimizing.
const SKIP_SEGMENTS = new Set([
  'cart', 'checkout', 'basket', 'account', 'my-account', 'login', 'logout',
  'signin', 'sign-in', 'register', 'wp-admin', 'wp-json', 'wp-content',
  'wp-includes', 'feed', 'rss', 'search', '404', 'cdn-cgi', 'tag', 'author',
  'cgi-bin'
]);

// Substrings that always indicate a non-page resource.
const SKIP_SUBSTRINGS = ['xmlrpc', '/wp-content/', '/wp-includes/', '/cdn-cgi/'];

// File extensions that can't carry on-page optimizations.
const SKIP_EXTENSIONS = [
  '.xml', '.json', '.rss', '.atom', '.txt', '.pdf', '.doc', '.docx', '.zip',
  '.gz', '.css', '.js', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
  '.ico', '.mp4', '.mp3'
];

// Is this a real, optimizable content page? Segment-aware so that
// /accounting-services and /cartridges survive (the old substring match
// dropped them as "/account" and "/cart").
export function isContentUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(parsed.protocol)) return false;

  const path = parsed.pathname.toLowerCase();
  if (SKIP_SUBSTRINGS.some(s => path.includes(s))) return false;
  if (SKIP_EXTENSIONS.some(ext => path.endsWith(ext))) return false;

  const segments = path.split('/').filter(Boolean);
  if (segments.some(seg => SKIP_SEGMENTS.has(seg))) return false;

  // Query strings are nearly always filters, sorts or tracking variants of a
  // page we already have.
  if (parsed.search) return false;

  return true;
}

// Identity of a page, ignoring the differences that don't make it a
// different page. Used only for de-duplication — the original URL string is
// what we return, so stored results keep matching across runs.
function dedupeKey(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return u.protocol + '//' + u.hostname.replace(/^www\./, '') + path.toLowerCase();
  } catch {
    return null;
  }
}

function dedupe(urls) {
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    const key = dedupeKey(u);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

// ---------- sitemaps ----------

// Read one sitemap (or sitemap index) and return its content page URLs.
// Recurses through indexes, fetching children in parallel batches.
export async function fetchSitemapUrls(sitemapUrl, sitemapRaw, depth = 0) {
  if (depth > MAX_SITEMAP_DEPTH) return [];

  // 1. Try live fetch from URL
  let xml = null;
  if (sitemapUrl) {
    xml = await fetchRemoteText(sitemapUrl);
  }

  // 2. Fall back to pasted raw XML
  if (!xml && sitemapRaw) {
    xml = sitemapRaw;
  }

  if (!xml) return [];

  const locs = parseLocs(xml);

  // Sitemap index — every <loc> is another sitemap, so recurse into ALL of
  // them and merge. Reading only the first child is how a 12-sitemap site
  // ended up with one content type optimized.
  //
  // Some generators omit the <sitemapindex> wrapper, so also treat a list
  // that is entirely .xml files as an index rather than filtering it away to
  // nothing.
  const looksLikeIndex = locs.length > 0 && locs.every(u => /\.xml(\.gz)?$/i.test(u.split('?')[0]));
  if (/<sitemapindex/i.test(xml) || looksLikeIndex) {
    const children = dedupe(locs).slice(0, MAX_CHILD_SITEMAPS);
    const nested = await mapLimited(children, async child => {
      const urls = await fetchSitemapUrls(child, null, depth + 1);
      return urls.length ? urls : null;
    });
    return dedupe(nested.flat()).filter(isContentUrl);
  }

  return dedupe(locs).filter(isContentUrl);
}

// Sitemap locations declared in robots.txt — the canonical, self-declared
// answer, and often several entries for one site.
async function readRobotsSitemaps(origin) {
  const found = [];
  try {
    const robots = await fetchRemoteText(origin + '/robots.txt');
    if (robots) {
      for (const line of robots.split('\n')) {
        const m = line.match(/^\s*sitemap:\s*(\S+)/i);
        if (m && m[1]) found.push(m[1].trim());
      }
    }
  } catch {}
  return dedupe(found);
}

// Common sitemap locations to probe when robots.txt names none.
const COMMON_SITEMAP_PATHS = [
  '/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml',
  '/wp-sitemap.xml', '/sitemap/sitemap.xml', '/sitemap1.xml',
  '/page-sitemap.xml', '/post-sitemap.xml', '/product-sitemap.xml'
];

// Find and read a site's sitemap(s) with no configuration at all.
//   1. every "Sitemap:" line in robots.txt, merged
//   2. otherwise, a handful of common paths, merged
// Returns the flattened, de-duplicated list of content page URLs.
export async function discoverSitemapUrls(baseUrl) {
  if (!baseUrl) return [];
  let origin;
  try { origin = new URL(baseUrl).origin; } catch { return []; }

  // 1. robots.txt. Sites without a parent index list one sitemap per content
  //    type here, so read every declared sitemap and merge the results.
  const declared = await readRobotsSitemaps(origin);
  if (declared.length) {
    const fromRobots = await mapLimited(declared.slice(0, MAX_CHILD_SITEMAPS), async url => {
      const urls = await fetchSitemapUrls(url, null);
      return urls.length ? urls : null;
    });
    const merged = dedupe(fromRobots.flat());
    if (merged.length) return merged;
  }

  // 2. Probe the common locations in parallel and merge whatever answers.
  //    Aliases (/sitemap.xml and /sitemap_index.xml serving the same set)
  //    collapse in the de-dupe, and a site split across several top-level
  //    sitemaps gets all of them instead of only the first that responded.
  const candidates = COMMON_SITEMAP_PATHS.map(p => origin + p);
  const probed = await mapLimited(candidates, async url => {
    const urls = await fetchSitemapUrls(url, null);
    return urls.length ? urls : null;
  });
  return dedupe(probed.flat());
}

// ---------- link crawling (no sitemap anywhere) ----------

const HREF_RE = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi;

function extractLinks(html, baseUrl, origin) {
  const out = [];
  if (!html) return out;
  for (const m of html.matchAll(HREF_RE)) {
    const href = decodeEntities(m[1]);
    if (!href || /^(#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try {
      const full = new URL(href, baseUrl);
      full.hash = '';
      if (full.origin !== origin) continue;
      out.push(full.href);
    } catch {}
  }
  return out;
}

// Walk the site's internal links breadth-first when there is no sitemap to
// read. Two levels from the homepage reaches the main nav plus everything
// those pages link to, which is the bulk of a typical brochure site — the
// old single-fetch version returned the homepage alone whenever that one
// request failed.
export async function discoverPagesByCrawl(baseUrl, { maxPages = 100, maxDepth = 2, maxFetches = 40 } = {}) {
  if (!baseUrl) return [];
  let origin, start;
  try {
    const u = new URL(baseUrl);
    origin = u.origin;
    start = u.href;
  } catch { return []; }

  const seen = new Set([dedupeKey(start)]);
  const ordered = [start];
  let frontier = [start];
  // Collecting URLs is cheap; fetching pages to read their links is not.
  // Bound the fetches separately so a wide homepage can still contribute its
  // full link list without the run stalling on hundreds of requests.
  let fetched = 0;

  for (let depth = 0; depth < maxDepth && ordered.length < maxPages; depth++) {
    const budget = Math.max(0, maxFetches - fetched);
    if (!budget) break;
    const toFetch = frontier.slice(0, budget);
    fetched += toFetch.length;

    const pages = await mapLimited(toFetch, async url => {
      const html = await fetchRemoteText(url);
      return html ? { url, html } : null;
    });

    const next = [];
    for (const page of pages) {
      for (const link of extractLinks(page.html, page.url, origin)) {
        const key = dedupeKey(link);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (!isContentUrl(link)) continue;
        ordered.push(link);
        next.push(link);
        if (ordered.length >= maxPages) break;
      }
      if (ordered.length >= maxPages) break;
    }
    if (!next.length) break;
    frontier = next;
  }

  return ordered.slice(0, maxPages);
}

// ---------- the entry point everything else should use ----------

function homepageOf(siteUrl) {
  try {
    const u = new URL(siteUrl);
    return u.origin + '/';
  } catch {
    return null;
  }
}

// Discover the pages of a client's site, trying every route in turn so a run
// only ever falls back to the homepage when the site is genuinely
// unreachable. Returns { urls, source } — `source` is a short label for the
// progress UI so it is obvious how wide the run actually went.
export async function discoverSiteUrls(client, { maxPages = 200, onProgress } = {}) {
  const site = (client?.url || '').trim();
  const report = (msg) => { try { onProgress?.(msg); } catch {} };

  // 1. A sitemap configured on the client record wins.
  if (client?.sitemap_url || client?.sitemap_raw) {
    report('Reading the configured sitemap…');
    let urls = [];
    try { urls = await fetchSitemapUrls(client.sitemap_url, client.sitemap_raw); } catch {}
    if (urls.length) {
      return finish(urls, 'configured sitemap', site, maxPages, report);
    }
    report('Configured sitemap returned nothing — auto-discovering…');
  }

  if (!site) return { urls: [], source: 'none' };

  // 2. Auto-discover from robots.txt + common paths.
  report('Looking for a sitemap (robots.txt and common paths)…');
  let urls = [];
  try { urls = await discoverSitemapUrls(site); } catch {}
  if (urls.length) {
    return finish(urls, 'auto-discovered sitemap', site, maxPages, report);
  }

  // 3. No sitemap — crawl internal links.
  report('No sitemap found — crawling internal links…');
  try { urls = await discoverPagesByCrawl(site, { maxPages }); } catch { urls = []; }
  if (urls.length > 1) {
    return finish(urls, 'internal link crawl', site, maxPages, report);
  }

  // 4. Genuinely unreachable — the homepage is all we can offer.
  const home = homepageOf(site);
  return { urls: home ? [home] : [], source: 'homepage only' };
}

function finish(urls, source, site, maxPages, report) {
  let list = dedupe(urls);

  // Keep the homepage in scope even when the sitemap omits it — it is
  // usually the highest-traffic page on the site.
  const home = homepageOf(site);
  if (home && !list.some(u => dedupeKey(u) === dedupeKey(home))) {
    list = [home, ...list];
  }

  const capped = list.slice(0, maxPages);
  report(`${capped.length} page${capped.length === 1 ? '' : 's'} found via ${source}${list.length > capped.length ? ` (of ${list.length})` : ''}`);
  return { urls: capped, source, total: list.length };
}
