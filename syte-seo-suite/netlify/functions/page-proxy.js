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

  // raw=true skips Jina Reader entirely. Jina re-renders pages and
  // strips/normalises <meta> tags — including meta robots — so the
  // technical SEO crawler was getting false "noindex" detections on
  // pages that ARE indexed. Anything that needs the real <head> markup
  // (robots, canonical, schema, OG tags) must pass raw: true.
  const raw = !!payload.raw;

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

  // A response is "useful" only if it actually has body content. Pages
  // rendered by Elementor / JS-heavy themes sometimes come back from
  // upstream proxies as head + inline CSS only — Jina's reader in
  // particular can return a CSS stub for some WP sites. Accepting those
  // produces garbage for the AI verifier ("body content not included").
  // We require either a non-trivial <body>...</body> or substantial
  // visible text after stripping markup.
  function hasUsefulBody(html) {
    if (!html || html.length < 200) return false;
    const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    const bodyInner = bodyMatch ? bodyMatch[1] : html;
    const text = bodyInner
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // 60+ chars of visible text cleanly separates head-only stubs
    // (0 body text, or "Loading..."/"Error") from any real page.
    return text.length >= 60;
  }

  // TIER ORDERING: Direct first, then Jina, then AllOrigins. WordPress /
  // Elementor sites (and most static sites) serve full SSR HTML that's
  // perfectly fetchable directly with browser headers — going through
  // Jina first only loses content when Jina's renderer fails to extract
  // a JS-heavy theme. Jina remains available for SPAs (Shopify/React)
  // where the direct response really would be empty.
  const tiers = [
    {
      name: 'direct',
      run: async () => {
        const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: browserHeaders });
        const html = await res.text();
        const blocked = res.status === 403 ||
          (res.status === 404 && html.length < 5000) ||
          /Attention Required|Cloudflare|Just a moment|captcha|403 Forbidden|Access Denied/i.test(html.slice(0, 2000));
        return blocked ? null : { status: res.status, html, finalUrl: res.url };
      }
    },
    {
      name: 'jina-reader',
      run: async () => {
        const r1 = await fetch('https://r.jina.ai/' + url, {
          method: 'GET',
          headers: { 'Accept': 'text/html', 'X-Return-Format': 'html' }
        });
        if (r1.ok) {
          const html = await r1.text();
          if (hasUsefulBody(html)) return { status: 200, html, finalUrl: url };
        }
        const r2 = await fetch('https://r.jina.ai/' + url, { method: 'GET' });
        if (r2.ok) {
          const html = await r2.text();
          if (hasUsefulBody(html)) return { status: 200, html, finalUrl: url };
        }
        return null;
      }
    },
    {
      name: 'allorigins',
      run: async () => {
        const r = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url));
        if (!r.ok) return null;
        const html = await r.text();
        return hasUsefulBody(html) ? { status: 200, html, finalUrl: url } : null;
      }
    }
  ];

  const failures = [];
  for (const tier of tiers) {
    // raw=true needs the real served markup — Jina re-renders pages and
    // strips/normalises <meta> tags, so it must be skipped (see above).
    if (raw && tier.name === 'jina-reader') { failures.push('jina-reader (skipped: raw)'); continue; }
    try {
      const out = await tier.run();
      if (out && hasUsefulBody(out.html)) {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json', ...corsHeaders() },
          body: JSON.stringify({ ...out, source: tier.name })
        };
      }
      failures.push(tier.name + ' (no useful body)');
    } catch (e) {
      failures.push(tier.name + ' (' + (e.message || 'error').slice(0, 60) + ')');
    }
  }

  return {
    statusCode: 502,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
    body: JSON.stringify({
      error: 'All fetch tiers returned empty/blocked HTML. Tried: ' + failures.join('; ') + '.',
      stage: 'all-tiers-failed'
    })
  };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
