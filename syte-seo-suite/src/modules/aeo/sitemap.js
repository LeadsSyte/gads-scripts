// Sitemap fetching — ported from the old Syte AEO Engine v2.
// Tries multiple CORS proxies, handles sitemap indexes, falls back
// to pasted XML stored on the client record (sitemap_raw).

const PROXIES = [
  (u) => u, // direct
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  (u) => 'https://corsproxy.io/?' + encodeURIComponent(u)
];

// Try to fetch a URL through the CORS proxy chain.
async function fetchWithProxies(url) {
  for (const build of PROXIES) {
    try {
      const res = await fetch(build(url));
      if (res.ok) {
        const text = await res.text();
        if (text.length > 50) return text;
      }
    } catch {}
  }
  return null;
}

// Parse <loc> entries from sitemap XML. Also handles plain-text URL lists.
function parseLocs(xml) {
  if (!xml) return [];
  const urls = [];
  // Try XML <loc> tags first
  const matches = [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)];
  for (const m of matches) {
    const u = m[1].trim();
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

// Content-type pages we want to optimize (skip carts, logins, feeds, etc.)
const SKIP_PATTERNS = [
  '/cart', '/checkout', '/account', '/login', '/wp-admin', '/feed',
  '/search', '/404', 'xmlrpc', '.xml', '.json', '/tag/', '/author/',
  '/wp-content/', '/cdn-cgi/', '?', '#'
];

function isContentUrl(url) {
  const lower = url.toLowerCase();
  return !SKIP_PATTERNS.some(p => lower.includes(p));
}

// Fetch sitemap URLs with multi-proxy fallback + pasted XML fallback.
// Handles sitemap indexes by recursing into child sitemaps (max depth 2).
export async function fetchSitemapUrls(sitemapUrl, sitemapRaw, depth = 0) {
  if (depth > 2) return [];

  // 1. Try live fetch from URL
  let xml = null;
  if (sitemapUrl) {
    xml = await fetchWithProxies(sitemapUrl);
  }

  // 2. Fall back to pasted raw XML
  if (!xml && sitemapRaw) {
    xml = sitemapRaw;
  }

  if (!xml) return [];

  const locs = parseLocs(xml);

  // Check if this is a sitemap index (contains child sitemaps)
  if (/<sitemapindex/i.test(xml)) {
    const nested = [];
    for (const child of locs) {
      try {
        const childUrls = await fetchSitemapUrls(child, null, depth + 1);
        nested.push(...childUrls);
      } catch {}
    }
    return nested.filter(isContentUrl);
  }

  return locs.filter(isContentUrl);
}
