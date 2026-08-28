// Google Gemini (Generative Language API) proxy — routes browser calls to
// Google through a Netlify serverless function so they happen server-side.
// This keeps the API key OFF the client: the built-in GOOGLE_AI_KEY env var
// stays in this function and never reaches the browser, so ChatGPT/Gemini work
// for every operator without anyone pasting a key. (A user's personal key, if
// supplied, still wins as an override.)
//
// Request body from the browser:
//   { apiKey, model, payload }
// where `model` is a generateContent model id (e.g. 'gemini-2.5-flash') and
// `payload` is the generateContent request body (object or JSON string).

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  let parsed;
  try { parsed = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: corsHeaders(), body: 'Invalid JSON' }; }

  const { apiKey, model, payload } = parsed;
  if (!model) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing model' }) };
  }

  // A browser-supplied key (personal override) wins; otherwise use the
  // deployment's built-in GOOGLE_AI_KEY env var. Never sent back to the client.
  const browserKey = String(apiKey || '').trim();
  const cleanKey = browserKey || String(process.env.GOOGLE_AI_KEY || '').trim();
  if (!cleanKey) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'No Gemini key: neither a personal key nor the built-in GOOGLE_AI_KEY env var is set.' }) };
  }

  const safeModel = String(model).replace(/[^a-zA-Z0-9._-]/g, '');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    safeModel + ':generateContent?key=' + encodeURIComponent(cleanKey);
  const upstreamBody = typeof payload === 'string' ? payload : JSON.stringify(payload || {});

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: upstreamBody
    });
    const text = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { ...corsHeaders(), 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
      body: text
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Proxy fetch failed: ' + (e.message || String(e)) })
    };
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
