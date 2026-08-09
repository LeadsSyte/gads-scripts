/**
 * Sitemap parser — extracts URLs from XML sitemap content.
 */

const EXCLUDE_PATTERNS = [
  /\/cart\b/i,
  /\/checkout\b/i,
  /\/account\b/i,
  /\/login\b/i,
  /\/register\b/i,
  /\/my-account\b/i,
  /\/wishlist\b/i,
  /\/privacy-policy\b/i,
  /\/terms/i,
  /\/cookie/i,
  /\/wp-admin/i,
  /\/wp-json/i,
  /\/feed\b/i,
  /\/tag\//i,
  /\/author\//i,
  /\/page\/\d+/i,
  /\.(jpg|jpeg|png|gif|svg|pdf|zip|mp4|mp3)$/i,
];

/**
 * Parse sitemap XML and extract content URLs.
 * Supports both regular sitemaps and sitemap indexes.
 */
export function parseSitemap(xml) {
  if (!xml || typeof xml !== 'string') return [];

  const urls = [];

  // Extract all <loc> tags
  const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    const url = match[1].trim();
    if (url) urls.push(url);
  }

  return urls;
}

/**
 * Filter out non-content URLs (cart, checkout, account pages, etc.)
 */
export function filterContentUrls(urls) {
  return urls.filter(url => {
    return !EXCLUDE_PATTERNS.some(pattern => pattern.test(url));
  });
}

/**
 * Convert URLs to a content list string for the Claude prompt.
 * Groups by path segments for readability.
 */
export function urlsToContentList(urls) {
  if (!urls || urls.length === 0) return 'No existing content found.';

  const items = urls.map(url => {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname
        .replace(/\/$/, '')
        .split('/')
        .filter(Boolean)
        .map(seg => seg.replace(/-/g, ' '))
        .join(' > ');
      return path || parsed.hostname;
    } catch {
      return url;
    }
  });

  // Limit to 500 items as per spec
  const limited = items.slice(0, 500);
  return limited.map((item, i) => `${i + 1}. ${item}`).join('\n');
}

/**
 * Fetch a sitemap from a URL (for server-side use).
 */
export async function fetchSitemap(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    return parseSitemap(xml);
  } catch (err) {
    throw new Error(`Failed to fetch sitemap from ${url}: ${err.message}`);
  }
}
