// WordPress push logic — ALL calls now go via the Netlify wp-proxy function
// so Wordfence, Cloudflare, and CORS never block them.
// CRITICAL: every created post uses status=draft. NEVER publish.

import { wpRequest, findBySlug, updatePostMeta, createDraftPost, uploadMedia } from './wpApi.js';
import { generateHeroImage } from '../content/imageGen.js';
import { loadSettings } from '../../lib/settings.js';
import { markdownToHtml } from '../content/articleParser.js';

function slugFromUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  } catch { return ''; }
}

// Parse the raw Claude output into body vs metadata sections so we only
// push clean article HTML to WordPress, not the meta/schema/QA blocks.
function parseArticleBody(raw) {
  if (!raw) return { body: '', metaTitle: '', metaDesc: '' };

  let text = raw;

  // Strip code fences: ```html ... ``` or ``` ... ```
  text = text.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  // If the whole thing is wrapped in a single code fence, strip it.
  if (/^```/.test(text)) {
    text = text.replace(/^```(?:html)?\s*\n/i, '');
    const lastFence = text.lastIndexOf('```');
    if (lastFence > 0) text = text.slice(0, lastFence);
  }

  const metaTitleMatch = text.match(/\*?\*?Meta Title\*?\*?:?\s*(.+)/i);
  const metaDescMatch  = text.match(/\*?\*?Meta Description\*?\*?:?\s*(.+)/i);

  // The article body is everything before the first **Meta Title or ```json.
  const bodyEnd = text.search(/\*?\*?Meta Title\*?\*?:|```json/i);
  let body = bodyEnd > 0 ? text.slice(0, bodyEnd).trim() : text.trim();

  // Strip any remaining code fences inside the body.
  body = body.replace(/```(?:html)?\s*\n?/gi, '').replace(/\n?```/g, '');

  return {
    body,
    metaTitle: metaTitleMatch ? metaTitleMatch[1].trim().replace(/\*+/g, '') : '',
    metaDesc:  metaDescMatch  ? metaDescMatch[1].trim().replace(/\*+/g, '') : '',
  };
}

// markdownToHtml lives in ../content/articleParser.js so the CMS push,
// AutoWrite "Copy as HTML" button, and the .docx export all share the
// same converter — including GFM table support, which this file's
// previous local copy was missing.

export async function testWordPress(client) {
  const user = await wpRequest(client, { path: 'wp/v2/users/me' });
  return user.name || user.slug || 'connected';
}

export async function pushMetaToWordPress(client, item) {
  const slug = slugFromUrl(item.page_url);
  const found = await findBySlug(client, slug);
  if (!found) throw new Error('Page/post not found for slug: ' + slug);

  const { type, record } = found;
  const p = item.payload || {};

  const meta = {
    _yoast_wpseo_title:       p.meta_title || '',
    _yoast_wpseo_metadesc:    p.meta_description || '',
    _yoast_wpseo_focuskw:     p.primary_keyword || '',
    rank_math_title:           p.meta_title || '',
    rank_math_description:     p.meta_description || '',
    rank_math_focus_keyword:   p.primary_keyword || ''
  };

  await updatePostMeta(client, type, record.id, meta);
  const adminUrl = client.wp_url.replace(/\/+$/, '') + '/wp-admin/post.php?post=' + record.id + '&action=edit';
  const baseUrl = client.wp_url.replace(/\/+$/, '');
  const realLink = record.slug ? baseUrl + '/' + record.slug + '/' : record.link || '';
  return { ok: true, admin_url: adminUrl, link: realLink };
}

export async function pushContentToWordPress(client, item) {
  const p = item.payload || {};

  // Parse the raw output to extract just the article body (no meta/schema/QA)
  // and convert from markdown to clean HTML.
  const rawContent = p.html || p.code || p.fix || '';
  const parsed = parseArticleBody(rawContent);
  const cleanHtml = markdownToHtml(parsed.body);

  // Use parsed meta title if available, fall back to item title.
  const title = parsed.metaTitle || item.page_title || 'Syte SEO draft';
  const metaTitle = parsed.metaTitle || p.meta_title || title;
  const metaDesc = parsed.metaDesc || p.meta_description || '';
  const keyword = p.primary_keyword || '';

  // Auto-generate and upload a featured image if an image API key is set.
  let featuredMediaId = null;
  const settings = loadSettings();
  const hasImageApi = !!(settings.openaiKey || settings.googleAiKey);
  if (hasImageApi) {
    try {
      // Auto flow on CMS push — try whichever provider works, since the
      // user isn't watching to pick.
      const img = await generateHeroImage(title, keyword, client, { allowFallback: true });
      const base64 = img.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const safeName = (title || 'hero').replace(/[^a-z0-9]+/gi, '-').slice(0, 50) + '.png';
      const attachment = await uploadMedia(client, base64, safeName);
      featuredMediaId = attachment.id;
    } catch (e) {
      console.warn('Featured image generation/upload failed (post still created):', e.message);
    }
  }

  // Create the draft post with clean HTML content. Meta fields are set
  // in a SEPARATE follow-up call because WordPress 403s if the meta keys
  // aren't registered for REST yet (requires the PHP snippet on the WP side).
  const created = await createDraftPost(client, {
    title,
    content: cleanHtml,
    status: 'draft', // HARD CONSTRAINT — never publish
    featured_media: featuredMediaId || undefined
  });

  // Follow-up: set Yoast + RankMath fields. If this fails (meta keys
  // not registered), we log a warning but the draft is already created.
  const metaFields = {
    rank_math_focus_keyword:   keyword,
    rank_math_title:           metaTitle,
    rank_math_description:     metaDesc,
    _yoast_wpseo_title:       metaTitle,
    _yoast_wpseo_metadesc:    metaDesc,
    _yoast_wpseo_focuskw:     keyword
  };
  let metaStatus = 'skipped';
  try {
    await updatePostMeta(client, 'posts', created.id, { meta: metaFields });
    metaStatus = 'set';
  } catch (e) {
    // Try without the wrapper — some WP versions want flat meta, some want nested.
    try {
      await updatePostMeta(client, 'posts', created.id, metaFields);
      metaStatus = 'set';
    } catch (e2) {
      console.warn('RankMath/Yoast meta update failed (post still created):', e2.message);
      metaStatus = 'failed — add the PHP snippet to WordPress (see suite docs)';
    }
  }

  const adminUrl = client.wp_url.replace(/\/+$/, '') + '/wp-admin/post.php?post=' + created.id + '&action=edit';

  // WordPress drafts return `link` as a preview URL (?p=123), not the
  // real permalink. Build the actual URL from the slug WordPress assigned
  // so downstream verification checks the right page.
  const baseUrl = client.wp_url.replace(/\/+$/, '');
  const realLink = created.slug
    ? baseUrl + '/' + created.slug + '/'
    : created.link || '';

  return { ok: true, admin_url: adminUrl, link: realLink, wp_id: created.id, wp_slug: created.slug };
}

export async function pushToWordPress(client, item) {
  if (['meta', 'meta_title', 'meta_description'].includes(item.change_type)) {
    return pushMetaToWordPress(client, item);
  }
  if (item.payload && (item.payload.meta_title || item.payload.meta_description) &&
      !item.payload.html && !item.payload.code) {
    return pushMetaToWordPress(client, item);
  }
  return pushContentToWordPress(client, item);
}
