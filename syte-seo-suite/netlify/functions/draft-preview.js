// In-theme preview of an article, rebuilt from one of the client's own
// published posts (src/modules/cms/themePreview.js). No client login needed,
// so Chris, a reviewer bot or anyone with the link can see how a draft will
// look in the client's design.
//
// GET ?a=<content_blogs id>&sig=…   an article written in the suite (not pushed yet)
// GET ?q=<cms_queue id>&sig=…       a draft already pushed to WordPress / Shopify
//
// sig = hex HMAC-SHA256 of "a:<id>" / "q:<id>" keyed with WP_PROXY_AUTH, so
// only links made inside an unlocked suite (or by the server) work. Links are
// unguessable but shareable, like a CMS preview link.

import crypto from 'node:crypto';
import { getServerSupabase } from './lib/serverSupabase.js';
import { previewSig } from './lib/previewSig.js';
import { handler as pageProxy } from './page-proxy.js';
import { buildThemePreview, pickTemplate } from '../../src/modules/cms/themePreview.js';
import { learnHouseStyle, applyHouseStyle } from '../../src/modules/cms/houseStyle.js';
import { parseArticleBody, cleanPushHtml } from '../../src/modules/cms/parseArticle.js';
import { markdownToHtml } from '../../src/modules/content/articleParser.js';
import { getPublishingProfile } from '../../src/modules/cms/publishingProfile.js';

export { previewSig };

const page = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' },
  body
});
const message = (status, text) => page(status,
  '<!doctype html><meta name="robots" content="noindex"><body style="font:15px Arial,sans-serif;padding:40px;color:#333">'
  + String(text).replace(/</g, '&lt;') + '</body>');

async function fetchPublicHtml(url) {
  const res = await pageProxy({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ url, raw: true }) });
  const data = JSON.parse(res.body || '{}');
  return data.html || '';
}

// --- WordPress ---------------------------------------------------------------
function wp(client) {
  const base = client.wp_url.replace(/\/+$/, '') + '/wp-json/';
  const auth = 'Basic ' + Buffer.from(client.wp_username + ':' + client.wp_app_password).toString('base64');
  return async (path) => {
    const r = await fetch(base + path, { headers: { Authorization: auth }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error('WordPress ' + r.status + ' on ' + path.split('?')[0]);
    return r.json();
  };
}

async function wpTemplates(get, restBase) {
  const posts = await get('wp/v2/' + restBase + '?status=publish&per_page=5&_fields=id,link,title,content,featured_media');
  return (Array.isArray(posts) ? posts : []).map(p => ({
    link: p.link, content: p.content?.rendered || '', title: p.title?.rendered || '', media: p.featured_media || 0
  }));
}

async function wpMediaUrl(get, id) {
  if (!id) return '';
  try { return (await get('wp/v2/media/' + id + '?_fields=source_url')).source_url || ''; } catch { return ''; }
}

// --- Shopify -----------------------------------------------------------------
function shop(client) {
  const store = client.shopify_store.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return async (path) => {
    const r = await fetch('https://' + store + '/admin/api/2024-01/' + path, {
      headers: { 'X-Shopify-Access-Token': client.shopify_token }, signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) throw new Error('Shopify ' + r.status + ' on ' + path.split('?')[0]);
    return r.json();
  };
}

async function shopifyTemplates(get, client, blogId) {
  const [{ blog }, { articles }] = await Promise.all([
    get('blogs/' + blogId + '.json?fields=handle'),
    get('blogs/' + blogId + '/articles.json?published_status=published&limit=5&fields=handle,title,body_html,image')
  ]);
  const origin = new URL(/^https?:/.test(client.url || '') ? client.url : 'https://' + client.url).origin;
  return (articles || []).map(a => ({
    link: origin + '/blogs/' + blog.handle + '/' + a.handle, content: a.body_html || '', title: a.title || '', image: a.image?.src || ''
  }));
}

async function shopifyBlogId(get, profile) {
  if (profile.shopify_blog_id) return profile.shopify_blog_id;
  const { blogs } = await get('blogs.json?limit=1&fields=id');
  if (!blogs?.length) throw new Error('This store has no blog');
  return blogs[0].id;
}

// -----------------------------------------------------------------------------
export async function handler(event) {
  const key = process.env.WP_PROXY_AUTH;
  const qs = event.queryStringParameters || {};
  const kind = qs.a ? 'a' : qs.q ? 'q' : '';
  const id = String(qs.a || qs.q || '').replace(/[^a-zA-Z0-9-]/g, '');
  if (!key || !kind || !id) return message(400, 'Missing or invalid preview link.');
  const want = previewSig(kind, id, key);
  const got = String(qs.sig || '');
  if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return message(403, 'This preview link is not valid.');
  }

  try {
    const supabase = getServerSupabase();
    let clientId, draftTitle, draftContent = null, draftImage = '', pushedRef = null;

    if (kind === 'a') {
      const { data: row } = await supabase.from('syte_suite_content_blogs').select('client_id, topic, output').eq('id', id).maybeSingle();
      if (!row) return message(404, 'Article not found.');
      clientId = row.client_id;
      const parsed = parseArticleBody(row.output || '', { stripH1: true });
      draftTitle = parsed.articleTitle || row.topic || 'Article';
      draftContent = cleanPushHtml(markdownToHtml(parsed.body)); // house style added below
    } else {
      const { data: row } = await supabase.from('syte_suite_cms_queue').select('client_id, page_title, payload').eq('id', id).maybeSingle();
      if (!row) return message(404, 'Draft not found.');
      clientId = row.client_id;
      draftTitle = row.page_title;
      pushedRef = row.payload || {};
    }

    const { data: client } = await supabase.from('syte_suite_clients').select('*').eq('id', clientId).maybeSingle();
    if (!client) return message(404, 'Client not found.');
    const profile = getPublishingProfile(client);

    let candidates = [];
    if (client.cms_type === 'WordPress' && client.wp_url && client.wp_app_password) {
      const get = wp(client);
      const restBase = pushedRef?.rest_base || profile.post_type_rest_base || 'posts';
      const [tpl, draft] = await Promise.all([
        wpTemplates(get, restBase),
        pushedRef?.wp_id ? get('wp/v2/' + restBase + '/' + pushedRef.wp_id + '?context=edit&_fields=title,content,featured_media') : null
      ]);
      candidates = tpl;
      if (draft) {
        draftTitle = draft.title?.rendered || draft.title?.raw || draftTitle;
        draftContent = draft.content?.rendered || draft.content?.raw || '';
        draftImage = await wpMediaUrl(get, draft.featured_media);
      }
      const chosen = await pickTemplate(candidates, fetchPublicHtml);
      if (!chosen) return message(502, 'Could not load one of ' + client.name + '\'s published posts to use as the design.');
      chosen.image = await wpMediaUrl(get, chosen.media);
      return render(client, profile, chosen, candidates, { draftTitle, draftContent, draftImage, pushed: !!pushedRef });
    }

    if (client.cms_type === 'Shopify' && client.shopify_store && client.shopify_token) {
      const get = shop(client);
      const blogId = pushedRef?.shopify_blog_id || await shopifyBlogId(get, profile);
      const [tpl, draft] = await Promise.all([
        shopifyTemplates(get, client, blogId),
        pushedRef?.shopify_article_id ? get('blogs/' + blogId + '/articles/' + pushedRef.shopify_article_id + '.json') : null
      ]);
      candidates = tpl;
      if (draft?.article) {
        draftTitle = draft.article.title || draftTitle;
        draftContent = draft.article.body_html || '';
        draftImage = draft.article.image?.src || '';
      }
      const chosen = await pickTemplate(candidates, fetchPublicHtml);
      if (!chosen) return message(502, 'Could not load one of ' + client.name + '\'s published articles to use as the design.');
      return render(client, profile, chosen, candidates, { draftTitle, draftContent, draftImage, pushed: !!pushedRef });
    }

    return message(422, client.name + ' has no working WordPress or Shopify connection, so there is no design to preview in.');
  } catch (e) {
    console.error('[draft-preview]', e.message);
    return message(502, 'Preview failed: ' + e.message);
  }
}

function render(client, profile, chosen, candidates, { draftTitle, draftContent, draftImage, pushed }) {
  // An article not yet pushed gets the same house style the push would add.
  let content = draftContent || '';
  if (!pushed && profile.house_style !== 'off') {
    content = applyHouseStyle(content, learnHouseStyle(candidates.map(c => c.content)));
  }
  const note = pushed
    ? 'Showing the draft as stored in ' + (client.cms_type || 'the CMS') + '.'
    : 'Not pushed yet' + (draftImage ? '.' : ' — the hero image shown belongs to an existing post.');
  const r = buildThemePreview({
    pageHtml: chosen.pageHtml, templateContent: chosen.content, templateTitle: chosen.title,
    draftContent: content, draftTitle, templateImage: chosen.image || '', draftImage, pageUrl: chosen.link, note
  });
  if (!r.ok) return message(502, 'Could not rebuild the page: ' + r.reason);
  return page(200, r.html);
}
