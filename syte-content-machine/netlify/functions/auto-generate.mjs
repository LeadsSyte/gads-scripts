/**
 * Scheduled function — runs on the 1st of each month at 6am UTC.
 * Auto-generates content for all clients with auto_generate = true.
 */
import { decryptApiKey } from '../../src/lib/auth.mjs';
import * as db from '../../src/lib/db.mjs';
import { discoverTopics, writeArticleSync } from '../../src/lib/claude.mjs';
import { filterContentUrls, urlsToContentList } from '../../src/lib/sitemap.mjs';
import {
  buildTopicDiscoveryPrompt,
  buildArticleSystemPrompt,
  buildArticlePrompt,
} from '../../src/lib/prompts.mjs';
import { articleToDocx } from '../../src/lib/docx-builder.mjs';
import { sendArticles } from '../../src/lib/email.mjs';

export const config = { schedule: '0 6 1 * *' };

export default async function handler() {
  console.log('Auto-generate triggered:', new Date().toISOString());

  // For scheduled functions, we need the API key from env.
  // The AUTO_GENERATE_PASSWORD env var is used to decrypt it.
  const password = process.env.AUTO_GENERATE_PASSWORD;
  if (!password) {
    console.error('AUTO_GENERATE_PASSWORD not set — cannot auto-generate');
    return;
  }

  let apiKey;
  try {
    apiKey = decryptApiKey(password);
  } catch (err) {
    console.error('Failed to decrypt API key for auto-generation:', err.message);
    return;
  }

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Fetch all clients
  const clients = await db.listClients();
  const autoClients = clients.filter(c => c.auto_generate && c.last_gen_month !== currentMonth);

  console.log(`Found ${autoClients.length} clients for auto-generation`);

  for (const client of autoClients) {
    try {
      console.log(`Auto-generating for: ${client.name}`);
      await runAutoGeneration(apiKey, client, currentMonth);
    } catch (err) {
      console.error(`Auto-generation failed for ${client.name}:`, err);
    }
  }
}

async function runAutoGeneration(apiKey, client, month) {
  const articleCount = client.articles_per_month || 4;

  // Create generation record
  const generation = await db.createGeneration({
    clientId: client.id,
    month,
    articleCount,
  });

  await db.updateGeneration(generation.id, { status: 'generating' });

  // Parse sitemap
  const sitemapUrls = client.sitemap_urls || [];
  const contentUrls = filterContentUrls(sitemapUrls);
  const existingContent = urlsToContentList(contentUrls);

  // Get previous titles
  const previousTitles = await db.getGeneratedTitles(client.id);

  // Discover topics
  const topicPrompt = buildTopicDiscoveryPrompt(client, articleCount, existingContent, previousTitles);
  const topics = await discoverTopics(apiKey, topicPrompt);

  await db.updateGeneration(generation.id, { topics });

  // Write articles
  const systemPrompt = buildArticleSystemPrompt(client);

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    try {
      const articlePrompt = buildArticlePrompt(topic, client);
      const content = await writeArticleSync(apiKey, systemPrompt, articlePrompt);
      const wordCount = content.split(/\s+/).filter(Boolean).length;

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

      await db.addGeneratedTitle(client.id, topic.title);
    } catch (err) {
      console.error(`Error writing article ${i + 1} for ${client.name}:`, err);
    }
  }

  await db.updateGeneration(generation.id, {
    status: 'complete',
    completed_at: new Date().toISOString(),
  });

  await db.updateClient(client.id, { last_gen_month: month });

  // Auto-send email if configured
  if (client.email) {
    try {
      const articles = await db.listArticles({ generationId: generation.id });
      const docxFiles = [];
      for (let i = 0; i < articles.length; i++) {
        const buffer = await articleToDocx(articles[i], client.name);
        docxFiles.push({
          filename: `${client.name.replace(/\s+/g, '-')}-article-${i + 1}.docx`,
          buffer,
        });
      }

      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
      const [year, monthNum] = month.split('-');
      const monthStr = `${monthNames[parseInt(monthNum, 10) - 1]} ${year}`;

      await sendArticles(client.email, client.name, monthStr, docxFiles);
      console.log(`Email sent to ${client.email} for ${client.name}`);
    } catch (err) {
      console.error(`Failed to send email for ${client.name}:`, err);
    }
  }

  console.log(`Auto-generation complete for ${client.name}: ${topics.length} articles`);
}
