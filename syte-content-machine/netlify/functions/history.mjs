import { requireAuth } from '../../src/lib/auth.mjs';
import * as db from '../../src/lib/db.mjs';

export default async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return respond(204);
  }

  try {
    requireAuth(event);
  } catch {
    return respond(401, { error: 'Unauthorized' });
  }

  const path = event.path
    .replace(/^\/\.netlify\/functions\/history\/?/, '')
    .replace(/^\/api\/history\/?/, '');
  const historyId = path || null;
  const params = event.queryStringParameters || {};

  try {
    switch (event.httpMethod) {
      case 'GET': {
        const generations = await db.listGenerations({ clientId: params.clientId });
        return respond(200, generations);
      }

      case 'DELETE': {
        if (!historyId) return respond(400, { error: 'History ID required' });
        await db.deleteGeneration(historyId);
        return respond(200, { success: true });
      }

      default:
        return respond(405, { error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('History error:', err);
    return respond(500, { error: err.message });
  }
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
    },
    body: body ? JSON.stringify(body) : '',
  };
}
