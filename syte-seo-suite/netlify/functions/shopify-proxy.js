// Shopify Admin API proxy — the Admin API rejects browser-origin requests
// (CORS) and the access token must never ride in a browser-visible call to
// a third-party host, so all Shopify calls route through this function.
//
// Request body from the browser:
//   { store, token, method, path, body? }
// `path` is relative to /admin/api/2024-01/, e.g. "blogs.json" or
// "blogs/123/articles.json".
//
// Auth gate + CORS mirror wp-proxy.js: when WP_PROXY_AUTH is set, the
// matching X-Suite-Auth header is required.

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

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

  const { store, token, method, path, body } = payload;
  if (!store || !token || !path) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing store, token, or path' }) };
  }

  const cleanStore = String(store).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const fullUrl = 'https://' + cleanStore + '/admin/api/2024-01/' + String(path).replace(/^\/+/, '');

  try {
    const res = await fetch(fullUrl, {
      method: method || 'GET',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      },
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
      body: JSON.stringify({ error: 'Shopify proxy fetch failed: ' + e.message })
    };
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://syte-seo-suite.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type, X-Suite-Auth',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
