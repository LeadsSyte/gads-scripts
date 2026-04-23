// Generic page proxy — fetches any URL server-side with browser-like
// headers so verification can see the same HTML a user sees. Bypasses
// both CORS restrictions and most basic Cloudflare/WAF "bot" filters.
//
// POST body: { url: "https://..." }
// Returns: { status, html, finalUrl, contentType } or { error }

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: corsHeaders(), body: 'Invalid JSON' }; }

  const url = payload.url;
  if (!url || typeof url !== 'string') {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing url parameter' }) };
  }

  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  };

  // TIER 1: Direct fetch with browser headers.
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: browserHeaders });
    const html = await res.text();
    // Detect bot-blocked responses (404 shells, Cloudflare challenges, captchas).
    const looksBlocked = res.status === 403 ||
      (res.status === 404 && html.length < 5000) ||
      /Attention Required|Cloudflare|Just a moment|captcha|403 Forbidden|Access Denied/i.test(html.slice(0, 2000));
    if (!looksBlocked && html.length > 500) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json', ...corsHeaders() },
        body: JSON.stringify({ status: res.status, html, finalUrl: res.url, source: 'direct' })
      };
    }
    // Fall through to tier 2 if blocked.
  } catch {}

  // TIER 2: Jina AI Reader — free service that renders pages with a real
  // browser engine and bypasses most bot detection. URL format:
  //   https://r.jina.ai/https://example.com
  // Returns clean markdown of the rendered page.
  try {
    const jinaUrl = 'https://r.jina.ai/' + url;
    const res = await fetch(jinaUrl, {
      method: 'GET',
      headers: { 'Accept': 'text/html', 'X-Return-Format': 'html' }
    });
    if (res.ok) {
      let content = await res.text();
      if (content.length > 300) {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders() },
          body: JSON.stringify({ status: 200, html: content, finalUrl: url, source: 'jina-reader' })
        };
      }
    }
    // Jina might return markdown — try again without HTML format request.
    const res2 = await fetch(jinaUrl, { method: 'GET' });
    if (res2.ok) {
      const content = await res2.text();
      if (content.length > 300) {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders() },
          body: JSON.stringify({ status: 200, html: content, finalUrl: url, source: 'jina-markdown' })
        };
      }
    }
  } catch {}

  // TIER 3: AllOrigins as last-resort CORS proxy.
  try {
    const res = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url));
    if (res.ok) {
      const html = await res.text();
      if (html.length > 500) {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders() },
          body: JSON.stringify({ status: 200, html, finalUrl: url, source: 'allorigins' })
        };
      }
    }
  } catch {}

  return {
    statusCode: 502,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
    body: JSON.stringify({ error: 'All fetch tiers failed (direct, jina-reader, allorigins). Site may require authentication or have strong anti-bot protection.', stage: 'all-tiers-failed' })
  };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
