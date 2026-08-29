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

  // Auth gate: when WP_PROXY_AUTH is set (SHA-256 hex of the suite key),
  // require the matching X-Suite-Auth header. Without it this function is
  // an open relay anyone on the internet can push WP requests through.
  // Enforcement is opt-in via the env var so deploys stay backwards-
  // compatible until the frontend that sends the header is live.
  const requiredAuth = process.env.WP_PROXY_AUTH;
  if (requiredAuth) {
    const given = event.headers['x-suite-auth'] || event.headers['X-Suite-Auth'] || '';
    if (given !== requiredAuth) {
      return { statusCode: 401, headers: corsHeaders(), body: JSON.stringify({ error: 'Unauthorized' }) };
    }
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
  const reqHeaders = {};
  if (username && appPassword) {
    reqHeaders['Authorization'] = 'Basic ' + Buffer.from(username + ':' + appPassword).toString('base64');
  }

  // Handle media uploads: decode base64 and send as binary.
  const { isMediaUpload, mediaBase64, mediaFilename } = payload;

  try {
    let res;
    if (isMediaUpload && mediaBase64) {
      const imageBuffer = Buffer.from(mediaBase64, 'base64');
      reqHeaders['Content-Type'] = 'image/png';
      reqHeaders['Content-Disposition'] = 'attachment; filename="' + (mediaFilename || 'image.png') + '"';
      res = await fetch(fullUrl, {
        method: 'POST',
        headers: reqHeaders,
        body: imageBuffer
      });
    } else {
      reqHeaders['Content-Type'] = 'application/json';
      res = await fetch(fullUrl, {
        method: method || 'GET',
        headers: reqHeaders,
        body: body ? JSON.stringify(body) : undefined
      });
    }

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
  // Restrict browsers to the suite's own origin (overridable via env for
  // local dev). Server-to-server callers are unaffected by CORS; the
  // WP_PROXY_AUTH gate above is what actually blocks them.
  return {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://syte-seo-suite.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type, X-Suite-Auth',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
