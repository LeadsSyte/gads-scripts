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
    // Extract generation ID from path
    const path = event.path
      .replace(/^\/\.netlify\/functions\/generate-status\/?/, '')
      .replace(/^\/api\/generate\/?/, '')
      .replace(/\/status$/, '');
    const generationId = path || event.queryStringParameters?.generationId;

    if (!generationId) {
      return respond(400, { error: 'generationId required' });
    }

    const generation = await db.getGeneration(generationId);
    if (!generation) {
      return respond(404, { error: 'Generation not found' });
    }

    // Count completed articles
    const articles = await db.listArticles({ generationId });

    return respond(200, {
      id: generation.id,
      status: generation.status,
      month: generation.month,
      articleCount: generation.article_count,
      completedArticles: articles.length,
      topics: generation.topics,
      createdAt: generation.created_at,
      completedAt: generation.completed_at,
    });
  } catch (err) {
    console.error('Generate status error:', err);
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
