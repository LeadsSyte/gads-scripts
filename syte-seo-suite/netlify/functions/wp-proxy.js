// WordPress API proxy — routes all WP REST API calls through a Netlify
// serverless function so they happen server-side. This bypasses:
//   - Wordfence WAF blocking cross-origin API requests
//   - Cloudflare browser challenges
//   - Hosting providers stripping the Authorization header (WP Engine, Kinsta)
//   - CORS issues on wp-json endpoints
//
// Request body from the browser:
//   { wpUrl, username, appPassword, method, path, body? }
//
// The function constructs the full WP REST URL, adds Basic Auth, forwards
// the request, and returns the response verbatim.

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

  const { wpUrl, username, appPassword, method, path, body } = payload;

  if (!wpUrl || !path) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Missing wpUrl or path' })
    };
  }

  // Build the full URL: wpUrl + /wp-json/ + path
  const base = wpUrl.replace(/\/+$/, '');
  const fullUrl = base + '/wp-json/' + path.replace(/^\/+/, '');

  // Build auth header if credentials provided.
  const reqHeaders = { 'Content-Type': 'application/json' };
  if (username && appPassword) {
    reqHeaders['Authorization'] = 'Basic ' + Buffer.from(username + ':' + appPassword).toString('base64');
  }

  try {
    const res = await fetch(fullUrl, {
      method: method || 'GET',
      headers: reqHeaders,
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await res.text();

    return {
      statusCode: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'application/json',
        ...corsHeaders()
      },
      body: text
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'WP proxy fetch failed: ' + e.message })
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
