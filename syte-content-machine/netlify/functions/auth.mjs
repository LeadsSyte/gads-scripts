import { decryptApiKey, createSessionToken } from '../../src/lib/auth.mjs';

export default async function handler(event) {
  // CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  try {
    const { password } = JSON.parse(event.body || '{}');
    if (!password) {
      return respond(400, { error: 'Password required' });
    }

    const apiKey = decryptApiKey(password);
    const token = createSessionToken(apiKey);

    return respond(200, { token });
  } catch (err) {
    return respond(401, { error: err.message || 'Invalid password' });
  }
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
