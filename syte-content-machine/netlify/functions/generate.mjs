/**
 * Background function — content generation pipeline.
 * Netlify background functions can run up to 15 minutes.
 *
 * POST /api/generate
 * Body: { clientId, articleCount }
 * Returns: { generationId } immediately, generation runs in background.
 */
import { requireAuth, getApiKeyFromRequest } from '../../src/lib/auth.mjs';
import * as db from '../../src/lib/db.mjs';
import { discoverTopics, writeArticleSync } from '../../src/lib/claude.mjs';
import { filterContentUrls, urlsToContentList } from '../../src/lib/sitemap.mjs';
import {
  buildTopicDiscoveryPrompt,
  buildArticleSystemPrompt,
  buildArticlePrompt,
} from '../../src/lib/prompts.mjs';

export default async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return respond(204);
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let apiKey;
  try {
    ({ apiKey } = requireAuth(event));
  } catch {
    return respond(401, { error: 'Unauthorized' });
  }

  try {
    const { clientId, articleCount } = JSON.parse(event.body || '{}');

    if (!clientId) return respond(400, { error: 'clientId required' });

    const client = await db.getClient(clientId);
    if (!client) return respond(404, { error: 'Client not found' });

    const count = articleCount || client.articles_per_month || 4;
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Create generation record
    const generation = await db.createGeneration({
      clientId: client.id,
      month,
      articleCount: count,
    });

    // Run the pipeline (this is a background function, so it won't timeout)
    await runPipeline(apiKey, client, generation, count, month);

    return respond(200, { generationId: generation.id });
  } catch (err) {
    console.error('Generate error:', err);
    return respond(500, { error: err.message });
  }
}

async function runPipeline(apiKey, client, generation, articleCount, month) {
  try {
    // Update status to generating
    await db.updateGeneration(generation.id, { status: 'generating' });

    // Step 1: Parse sitemap content
    const sitemapUrls = client.sitemap_urls || [];
    const contentUrls = filterContentUrls(sitemapUrls);
    const existingContent = urlsToContentList(contentUrls);

    // Step 2: Get previously generated titles for deduplication
    const previousTitles = await db.getGeneratedTitles(client.id);

    // Step 3: Discover topics
    const topicPrompt = buildTopicDiscoveryPrompt(client, articleCount, existingContent, previousTitles);
    const topics = await discoverTopics(apiKey, topicPrompt);

    // Store topics in generation
    await db.updateGeneration(generation.id, { topics });

    // Step 4: Write articles
    const systemPrompt = buildArticleSystemPrompt(client);

    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];

      try {
        const articlePrompt = buildArticlePrompt(topic, client);
        const content = await writeArticleSync(apiKey, systemPrompt, articlePrompt);

        // Count words
        const wordCount = content.split(/\s+/).filter(Boolean).length;

        // Save article
        await db.createArticle({
          generationId: generation.id,
          clientId: client.id,
          title: topic.title,
          primaryKeyword: topic.keyword,
          secondaryKeywords: topic.secondaryKeywords || [],
          searchIntent: topic.intent || '',
          content,
          wordCount,
          topicData: topic,
        });

        // Track title for deduplication
        await db.addGeneratedTitle(client.id, topic.title);
      } catch (err) {
        console.error(`Error writing article ${i + 1} (${topic.title}):`, err);
        // Continue with remaining articles
      }
    }

    // Step 5: Mark complete
    await db.updateGeneration(generation.id, {
      status: 'complete',
      completed_at: new Date().toISOString(),
    });

    // Update client's last_gen_month
    await db.updateClient(client.id, { last_gen_month: month });

  } catch (err) {
    console.error('Pipeline error:', err);
    await db.updateGeneration(generation.id, {
      status: 'failed',
    });
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
