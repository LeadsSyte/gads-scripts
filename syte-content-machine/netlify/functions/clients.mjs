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

  const path = event.path.replace(/^\/\.netlify\/functions\/clients\/?/, '').replace(/^\/api\/clients\/?/, '');
  const clientId = path || null;

  try {
    switch (event.httpMethod) {
      case 'GET': {
        if (clientId) {
          const client = await db.getClient(clientId);
          return respond(200, client);
        }
        const clients = await db.listClients();
        return respond(200, clients);
      }

      case 'POST': {
        const body = JSON.parse(event.body || '{}');
        const client = await db.createClient(body);
        return respond(201, client);
      }

      case 'PUT': {
        if (!clientId) return respond(400, { error: 'Client ID required' });
        const body = JSON.parse(event.body || '{}');
        const updated = await db.updateClient(clientId, body);
        return respond(200, updated);
      }

      case 'DELETE': {
        if (!clientId) return respond(400, { error: 'Client ID required' });
        await db.deleteClient(clientId);
        return respond(200, { success: true });
      }

      default:
        return respond(405, { error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('Clients error:', err);
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
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
    body: body ? JSON.stringify(body) : '',
  };
}
