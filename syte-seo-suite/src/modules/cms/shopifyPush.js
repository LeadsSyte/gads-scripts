// Shopify push logic — same pipeline shape as WordPress: parse the raw
// article, convert markdown to HTML, respect the client's publishing
// profile, protect against duplicate pushes, and surface warnings.
// All calls go via the Netlify shopify-proxy (Admin API blocks browsers).
// CRITICAL: articles are always created with published=false.

import { shopifyRequest, listBlogs, findArticleByHandle, storeHandle } from './shopifyApi.js';
import { parseArticleBody, slugifyTitle } from './parseArticle.js';
import { getPublishingProfile } from './publishingProfile.js';
import { markdownToHtml } from '../content/articleParser.js';
import { generateHeroImage } from '../content/imageGen.js';
import { loadSettings } from '../../lib/settings.js';

async function resolveBlog(client, profile) {
  const blogs = await listBlogs(client);
  if (blogs.length === 0) throw new Error('No blogs found on this Shopify store.');
  if (profile.shopify_blog_id) {
    const match = blogs.find(b => String(b.id) === String(profile.shopify_blog_id));
    if (match) return match;
  }
  return blogs[0];
}

export async function pushMetaToShopify(client, item) {
  // SEO title/description on Shopify are the global title_tag /
  // description_tag metafields on the resource. Without a target article
  // there is nothing meaningful to attach shop-level SEO to — report that
  // instead of creating orphaned metafields.
  throw new Error('Standalone SEO-meta pushes are not supported on Shopify — push the article itself (its SEO fields ride along).');
}

export async function pushArticleToShopify(client, item) {
  const p = item.payload || {};
  const profile = getPublishingProfile(client);

  const rawContent = p.html || p.code || p.fix || '';
  const parsed = parseArticleBody(rawContent, { stripH1: profile.strip_leading_h1 });
  let bodyHtml = markdownToHtml(parsed.body);

  const title = parsed.articleTitle || parsed.metaTitle || item.page_title || 'Syte draft article';
  const metaTitle = parsed.metaTitle || p.meta_title || title;
  const metaDesc = parsed.metaDesc || p.meta_description || '';

  const blog = await resolveBlog(client, profile);
  const blogId = blog.id;

  // Hero image: generated client-side, attached base64. Shopify's article
  // `image` is its featured image; inline placement is a body <img> added
  // after create (the CDN URL only exists once Shopify stores the image).
  const warnings = [];
  let imageAttachment = null;
  const settings = loadSettings();
  const heroWanted = profile.hero_mode !== 'none';
  const hasImageApi = heroWanted && !!(settings.openaiKey || settings.googleAiKey);
  if (hasImageApi) {
    try {
      const img = await generateHeroImage(title, p.primary_keyword || '', client, { allowFallback: true });
      imageAttachment = img.dataUrl.replace(/^data:image\/\w+;base64,/, '');
    } catch (e) {
      warnings.push('hero image generation failed — article has no image');
    }
  }

  // Duplicate protection: Shopify derives the handle from the title the
  // same way WP derives slugs. Update the existing draft instead of
  // stacking copies.
  const handle = slugifyTitle(title);
  let existing = null;
  try { existing = await findArticleByHandle(client, blogId, handle); } catch { /* best effort */ }

  const articleFields = {
    title,
    body_html: bodyHtml,
    published: false, // HARD CONSTRAINT — never publish here; publish-approved flips it after approval
    tags: 'syte-draft',
    metafields: [
      { namespace: 'global', key: 'title_tag', value: metaTitle, type: 'single_line_text_field' },
      ...(metaDesc ? [{ namespace: 'global', key: 'description_tag', value: metaDesc, type: 'single_line_text_field' }] : [])
    ]
  };
  if (imageAttachment && (profile.hero_mode === 'featured-only' || profile.hero_mode === 'both')) {
    articleFields.image = { attachment: imageAttachment, alt: title };
  }

  let article;
  if (existing) {
    const j = await shopifyRequest(client, {
      method: 'PUT',
      path: 'blogs/' + blogId + '/articles/' + existing.id + '.json',
      body: { article: { id: existing.id, ...articleFields } }
    });
    article = j.article;
  } else {
    const j = await shopifyRequest(client, {
      method: 'POST',
      path: 'blogs/' + blogId + '/articles.json',
      body: { article: articleFields }
    });
    article = j.article;
  }

  // Inline hero: now that Shopify hosts the image, prepend it to the body.
  if (imageAttachment && (profile.hero_mode === 'inline-only' || profile.hero_mode === 'both')) {
    const src = article.image?.src || '';
    if (src) {
      const inline = '<img src="' + src + '" alt="' + title.replace(/"/g, '&quot;') + '" />\n' + bodyHtml;
      const j2 = await shopifyRequest(client, {
        method: 'PUT',
        path: 'blogs/' + blogId + '/articles/' + article.id + '.json',
        body: { article: { id: article.id, body_html: inline, ...(profile.hero_mode === 'inline-only' ? { image: null } : {}) } }
      });
      article = j2.article;
    } else {
      warnings.push('inline hero requested but Shopify returned no image URL');
    }
  }

  const handleStore = storeHandle(client);
  const publicDomain = (client.url || client.shopify_store || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return {
    ok: true,
    admin_url: 'https://admin.shopify.com/store/' + handleStore + '/content/articles/' + article.id,
    link: article.handle ? 'https://' + publicDomain + '/blogs/' + blog.handle + '/' + article.handle : '',
    shopify_article_id: article.id,
    shopify_blog_id: blogId,
    meta_title: metaTitle,
    meta_desc: metaDesc,
    updated_existing: !!existing,
    meta_status: 'set',
    warnings
  };
}

export async function pushToShopify(client, item) {
  if (item.payload && (item.payload.meta_title || item.payload.meta_description) &&
      !item.payload.html && !item.payload.code) {
    return pushMetaToShopify(client, item);
  }
  return pushArticleToShopify(client, item);
}
