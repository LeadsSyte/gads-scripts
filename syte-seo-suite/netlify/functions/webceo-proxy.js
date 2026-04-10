// WebCEO API proxy — ported verbatim from the previous working Technical
// SEO tool on the claude/syte-seo-suite-rEwKM branch. Avoids browser CORS
// and keeps the API key server-side.
//
// Incoming request body: { endpoint: "get_project_overview", body: {...} }
// Outgoing call:           POST https://api.webceo.com/{endpoint}/
// Outgoing body:           { key, ...body }
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

  const { endpoint, body = {} } = payload;
  if (!endpoint) {
    return { statusCode: 400, headers: corsHeaders(), body: 'Missing endpoint' };
  }

  const url = `https://api.webceo.com/${endpoint}/`;
  const requestBody = { key, ...body };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody)
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
