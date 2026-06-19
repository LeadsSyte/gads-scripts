import { requireAuth } from '../../src/lib/auth.mjs';
import * as db from '../../src/lib/db.mjs';
import { articleToDocx } from '../../src/lib/docx-builder.mjs';
import { sendArticles } from '../../src/lib/email.mjs';

export default async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return respond(204);
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  try {
    requireAuth(event);
  } catch {
    return respond(401, { error: 'Unauthorized' });
  }

  try {
    const { generationId, recipientEmail } = JSON.parse(event.body || '{}');

    if (!generationId) return respond(400, { error: 'generationId required' });

    const generation = await db.getGeneration(generationId);
    if (!generation) return respond(404, { error: 'Generation not found' });

    const articles = await db.listArticles({ generationId });
    if (articles.length === 0) return respond(400, { error: 'No articles to send' });

    const client = await db.getClient(generation.client_id);
    const clientName = client?.name || 'Client';
    const email = recipientEmail || client?.email;

    if (!email) return respond(400, { error: 'No recipient email provided' });

    // Generate .docx buffers
    const docxFiles = [];
    for (let i = 0; i < articles.length; i++) {
      const buffer = await articleToDocx(articles[i], clientName);
      docxFiles.push({
        filename: `${clientName.replace(/\s+/g, '-')}-article-${i + 1}.docx`,
        buffer,
      });
    }

    // Format month for email subject
    const [year, monthNum] = generation.month.split('-');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthStr = `${monthNames[parseInt(monthNum, 10) - 1]} ${year}`;

    // Send email
    const result = await sendArticles(email, clientName, monthStr, docxFiles);

    return respond(200, { success: true, emailId: result?.data?.id || null });
  } catch (err) {
    console.error('Email error:', err);
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: body ? JSON.stringify(body) : '',
  };
}
