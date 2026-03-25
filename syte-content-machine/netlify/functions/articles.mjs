import { requireAuth } from '../../src/lib/auth.mjs';
import * as db from '../../src/lib/db.mjs';

export default async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return respond(204);
  }

  if (event.httpMethod !== 'GET') {
    return respond(405, { error: 'Method not allowed' });
  }

  try {
    requireAuth(event);
  } catch {
    return respond(401, { error: 'Unauthorized' });
  }

  try {
    const path = event.path
      .replace(/^\/\.netlify\/functions\/articles\/?/, '')
      .replace(/^\/api\/articles\/?/, '');
    const articleId = path || null;
    const params = event.queryStringParameters || {};

    if (articleId) {
      const article = await db.getArticle(articleId);
      if (!article) return respond(404, { error: 'Article not found' });
      return respond(200, article);
    }

    const articles = await db.listArticles({
      clientId: params.clientId,
      month: params.month,
      generationId: params.generationId,
    });

    return respond(200, articles);
  } catch (err) {
    console.error('Articles error:', err);
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
    body: body ? JSON.stringify(body) : '',
  };
}
