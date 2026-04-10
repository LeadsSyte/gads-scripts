// WebCEO API proxy — avoids browser CORS and keeps the API key server-side.
// Set WEBCEO_API_KEY in your Netlify site environment variables.

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.WEBCEO_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'WEBCEO_API_KEY not set in Netlify environment.' })
    };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const endpoint = payload.endpoint;
  const params = payload.params || {};
  if (!endpoint) return { statusCode: 400, body: 'Missing endpoint' };

  const body = new URLSearchParams();
  body.set('key', apiKey);
  body.set('method', endpoint);
  for (const [k, v] of Object.entries(params)) {
    body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }

  try {
    const res = await fetch('https://online.webceo.com/api/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: text
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
}
