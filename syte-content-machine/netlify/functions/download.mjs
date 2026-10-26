import { requireAuth } from '../../src/lib/auth.mjs';
import * as db from '../../src/lib/db.mjs';
import { articleToDocx } from '../../src/lib/docx-builder.mjs';
import archiver from 'archiver';
import { PassThrough } from 'stream';

export default async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(),
    };
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
      .replace(/^\/\.netlify\/functions\/download\/?/, '')
      .replace(/^\/api\/download\/?/, '');

    // Check if it's a single article docx download
    if (path.endsWith('/docx')) {
      const articleId = path.replace(/\/docx$/, '');
      return await downloadSingleDocx(articleId);
    }

    // Otherwise it's a generation zip download
    const generationId = path;
    if (!generationId) {
      return respond(400, { error: 'generationId or articleId required' });
    }

    return await downloadZip(generationId);
  } catch (err) {
    console.error('Download error:', err);
    return respond(500, { error: err.message });
  }
}

async function downloadSingleDocx(articleId) {
  const article = await db.getArticle(articleId);
  if (!article) return respond(404, { error: 'Article not found' });

  const client = await db.getClient(article.client_id);
  const clientName = client?.name || 'Article';

  const buffer = await articleToDocx(article, clientName);
  const filename = sanitizeFilename(`${clientName}-${article.title}.docx`);

  return {
    statusCode: 200,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: buffer.toString('base64'),
    isBase64Encoded: true,
  };
}

async function downloadZip(generationId) {
  const generation = await db.getGeneration(generationId);
  if (!generation) return respond(404, { error: 'Generation not found' });

  const articles = await db.listArticles({ generationId });
  if (articles.length === 0) return respond(404, { error: 'No articles found' });

  const client = await db.getClient(generation.client_id);
  const clientName = client?.name || 'Content';

  // Build zip in memory
  const chunks = [];
  const passthrough = new PassThrough();
  passthrough.on('data', (chunk) => chunks.push(chunk));

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(passthrough);

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const buffer = await articleToDocx(article, clientName);
    const filename = sanitizeFilename(`${clientName}-article-${i + 1}-${article.title}.docx`);
    archive.append(buffer, { name: filename });
  }

  await archive.finalize();

  // Wait for stream to finish
  await new Promise((resolve) => passthrough.on('end', resolve));

  const zipBuffer = Buffer.concat(chunks);
  const zipFilename = sanitizeFilename(`${clientName}-${generation.month}-content.zip`);

  return {
    statusCode: 200,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipFilename}"`,
    },
    body: zipBuffer.toString('base64'),
    isBase64Encoded: true,
  };
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 200);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}
