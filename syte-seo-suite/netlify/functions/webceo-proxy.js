// Netlify function: proxies WebCEO API calls to avoid CORS.
// Expects the WEBCEO_KEY env var to be set in Netlify dashboard.
//
// Request body: { endpoint: "get_project_overview", body: { project_id: 123 } }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const key = process.env.WEBCEO_KEY;
  if (!key) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'WEBCEO_KEY env var not set' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { endpoint, body = {} } = payload;
  if (!endpoint) {
    return { statusCode: 400, body: 'Missing endpoint' };
  }

  const url = `https://api.webceo.com/${endpoint}/`;
  const requestBody = { key, ...body };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
      body: text,
    };
  } catch (e) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
