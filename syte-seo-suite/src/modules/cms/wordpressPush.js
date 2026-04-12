// WordPress push logic — ALL calls now go via the Netlify wp-proxy function
// so Wordfence, Cloudflare, and CORS never block them.
// CRITICAL: every created post uses status=draft. NEVER publish.

import { wpRequest, findBySlug, updatePostMeta, createDraftPost } from './wpApi.js';

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
  if (!raw) return { body: '', metaTitle: '', metaDesc: '', keyword: '' };

  const metaTitleMatch = raw.match(/\*?\*?Meta Title\*?\*?:?\s*(.+)/i);
  const metaDescMatch  = raw.match(/\*?\*?Meta Description\*?\*?:?\s*(.+)/i);

  // The article body is everything before the first **Meta Title or ```json.
  const bodyEnd = raw.search(/\*?\*?Meta Title\*?\*?:|```json/i);
  const body = bodyEnd > 0 ? raw.slice(0, bodyEnd).trim() : raw;

  return {
    body,
    metaTitle: metaTitleMatch ? metaTitleMatch[1].trim().replace(/\*+/g, '') : '',
    metaDesc:  metaDescMatch  ? metaDescMatch[1].trim().replace(/\*+/g, '') : '',
  };
}

// Convert Markdown → HTML so WordPress renders headings, bold, lists properly.
function markdownToHtml(md) {
  if (!md) return '';
  return md
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/gm, (m) => '<ul>' + m + '</ul>')
    .replace(/<\/ul>\s*<ul>/g, '')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/```[\s\S]*?```/g, m => '<pre>' + m.slice(3, -3).trim() + '</pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hluop])(.+)$/gm, '<p>$1</p>')
    .replace(/<p><\/p>/g, '');
}

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
  return { ok: true, admin_url: adminUrl, link: record.link };
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

  // Create the draft post with clean HTML content only.
  const created = await createDraftPost(client, {
    title,
    content: cleanHtml,
    status: 'draft' // HARD CONSTRAINT — never publish
  });

  // Set Yoast + RankMath meta fields on the newly created post.
  try {
    await updatePostMeta(client, 'posts', created.id, {
      _yoast_wpseo_title:       metaTitle,
      _yoast_wpseo_metadesc:    metaDesc,
      _yoast_wpseo_focuskw:     keyword,
      rank_math_title:           metaTitle,
      rank_math_description:     metaDesc,
      rank_math_focus_keyword:   keyword
    });
  } catch (e) {
    // Meta update failing shouldn't block the draft creation.
    console.warn('Meta update failed (post still created):', e.message);
  }

  const adminUrl = client.wp_url.replace(/\/+$/, '') + '/wp-admin/post.php?post=' + created.id + '&action=edit';
  return { ok: true, admin_url: adminUrl, link: created.link };
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
