// Node versions of the brand scan's browser helpers, so the Autopilot can
// ground a client in its own website the same way Auto Write does
// (src/lib/brandScan.js scanBrandFromWebsite, with these passed in).

import { handler as pageProxy } from '../page-proxy.js';

// Same fetch the browser uses first: the page-proxy (browser-like headers,
// JS-rendered fallback), called in-process instead of over HTTP.
export async function fetchHtmlServer(url) {
  try {
    const res = await pageProxy({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ url }) });
    const data = JSON.parse(res.body || '{}');
    if (data.html && data.html.length > 300) return data.html;
  } catch { /* fall through */ }
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SyteSEOSuite/1.0)' }, signal: AbortSignal.timeout(20000) });
    if (r.ok) return await r.text();
  } catch { /* unreachable */ }
  return '';
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

// Visible text of a page: drop script/style/etc., then all tags.
export function htmlToTextServer(html) {
  if (!html) return '';
  const body = (html.match(/<body[\s\S]*<\/body>/i) || [html])[0];
  return body
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#39|[a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? (e.startsWith('#') ? String.fromCharCode(+e.slice(1)) : ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// First same-site link that looks like an About / company page.
export function findAboutUrlServer(html, baseUrl) {
  try {
    const origin = new URL(baseUrl).origin;
    for (const m of String(html || '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
      const href = m[1];
      if (!/about|our-story|who-we-are|company|meet-the-team/i.test(href)) continue;
      try {
        const full = new URL(href, baseUrl).href;
        if (full.startsWith(origin)) return full.split('#')[0].split('?')[0];
      } catch { /* bad href */ }
    }
  } catch { /* bad base */ }
  return null;
}
