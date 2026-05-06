// OpenAI API proxy — routes browser calls to OpenAI through a Netlify
// serverless function so they happen server-side. This bypasses:
//   - CORS: api.openai.com does not include Access-Control-Allow-Origin
//     for browser-origin requests, so a direct fetch() throws
//     "Failed to fetch" before ever getting a response.
//   - The user's API key being exposed in the browser network tab to
//     anything other than the proxy hop.
//
// Request body from the browser:
//   { apiKey, endpoint, body }
// where endpoint is the path under api.openai.com/v1, e.g.
// 'images/generations' or 'chat/completions'.

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

  const { apiKey, endpoint, body } = payload;
  if (!apiKey) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing apiKey' }) };
  }
  if (!endpoint) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing endpoint' }) };
  }

  // HTTP header values are ByteStrings — every character must be 0-255.
  // Pasted API keys frequently arrive with autocorrected punctuation
  // (em dash `—` for `-`, smart quotes, NBSP) which throws a confusing
  // "Cannot convert argument to a ByteString" deep in undici. Detect
  // and return a precise, actionable error so the operator knows the
  // key needs re-pasting from the original source rather than chasing
  // a phantom 502.
  const cleanKey = String(apiKey).trim();
  const badIdx = [...cleanKey].findIndex(ch => ch.charCodeAt(0) > 255);
  if (badIdx !== -1) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: 'API key contains a non-ASCII character at position ' + badIdx +
               ' (char code ' + cleanKey.charCodeAt(badIdx) + '). This is usually an autocorrected hyphen ' +
               '(— instead of -) or a smart quote — re-copy the key from your OpenAI dashboard and re-paste.'
      })
    };
  }

  const safeEndpoint = String(endpoint).replace(/^\/+/, '');
  const url = 'https://api.openai.com/v1/' + safeEndpoint;

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cleanKey
      },
      body: JSON.stringify(body || {})
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
