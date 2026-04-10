// WebCEO API proxy — avoids browser CORS and keeps the API key server-side.
// Set WEBCEO_API_KEY in your Netlify site environment variables.
//
// WebCEO's public API accepts JSON POST at https://online.webceo.com/api/
// with a body of { key, method, ...params }. This proxy forwards the browser's
// { endpoint, params } payload into that shape and passes the response
// straight through.

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  const apiKey = process.env.WEBCEO_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'WEBCEO_API_KEY not set in Netlify environment.' })
    };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: corsHeaders(), body: 'Invalid JSON' }; }

  const endpoint = payload.endpoint;
  const params = payload.params || {};
  if (!endpoint) return { statusCode: 400, headers: corsHeaders(), body: 'Missing endpoint' };

  const outgoing = {
    key: apiKey,
    method: endpoint,
    ...params
  };

  try {
    const res = await fetch('https://online.webceo.com/api/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outgoing)
    });
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders()
      },
      body: text
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: corsHeaders(),
      body: JSON.stringify({ error: e.message })
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
