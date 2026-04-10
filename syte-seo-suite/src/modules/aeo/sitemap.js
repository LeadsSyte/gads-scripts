import { corsFetchText } from '../../lib/corsProxy.js';

// Parse <loc>…</loc> entries out of a sitemap XML string.
// Handles sitemap indexes by recursing into child sitemaps.
export async function fetchSitemapUrls(url, depth = 0) {
  if (depth > 2) return [];
  const xml = await corsFetchText(url);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
  if (/<sitemapindex/i.test(xml)) {
    const nested = [];
    for (const child of locs) {
      try { nested.push(...await fetchSitemapUrls(child, depth + 1)); } catch {}
    }
    return nested;
  }
  return locs;
}
