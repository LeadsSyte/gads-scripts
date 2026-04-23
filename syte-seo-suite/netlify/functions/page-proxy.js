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

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        // Mimic a real Chrome browser so Cloudflare/WAFs don't flag us.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    const html = await res.text();
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', ...corsHeaders() },
      body: JSON.stringify({
        status: res.status,
        html,
        finalUrl: res.url,
        contentType: res.headers.get('content-type') || ''
      })
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json', ...corsHeaders() },
      body: JSON.stringify({ error: e.message, stage: 'upstream fetch' })
    };
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
