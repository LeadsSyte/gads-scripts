// WebCEO API proxy — correct base URL is https://online.webceo.com/api/
// (not api.webceo.com, which doesn't resolve). The public API takes a JSON
// POST body of { key, method, ...params } and responds with a batch-format
// array: [{ method, result, errormsg }].
//
// Env var: WEBCEO_KEY (falls back to WEBCEO_API_KEY for backwards compat).

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  const key = process.env.WEBCEO_KEY || process.env.WEBCEO_API_KEY;
  if (!key) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'WEBCEO_KEY env var not set in Netlify environment.' })
    };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: corsHeaders(), body: 'Invalid JSON' }; }

  // Accept both the old-tool contract { endpoint, body } and my previous
  // contract { endpoint, params } so existing call sites keep working.
  const method = payload.endpoint || payload.method;
  const bodyFields = payload.body || payload.params || {};
  if (!method) {
    return { statusCode: 400, headers: corsHeaders(), body: 'Missing endpoint/method' };
  }

  const outgoing = { key, method, ...bodyFields };

  try {
    const res = await fetch('https://online.webceo.com/api/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(outgoing)
    });
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: {
        'content-type': 'application/json',
        ...corsHeaders()
      },
      body: text
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: corsHeaders(),
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
