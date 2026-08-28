// WordPress push logic — ALL calls now go via the Netlify wp-proxy function
// so Wordfence, Cloudflare, and CORS never block them.
// CRITICAL: every created post uses status=draft. NEVER publish.

import { wpRequest, findBySlug, findEditablePostByTitle, updatePostMeta, createDraftPost, updateDraftPost, uploadMedia } from './wpApi.js';
import { generateHeroImage } from '../content/imageGen.js';
import { loadSettings } from '../../lib/settings.js';
import { markdownToHtml } from '../content/articleParser.js';
import { parseArticleBody, slugifyTitle } from './parseArticle.js';
import { getPublishingProfile } from './publishingProfile.js';

function slugFromUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  } catch { return ''; }
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
  const profile = getPublishingProfile(client);

  // Parse the raw output to extract just the article body (no meta/schema/QA)
  // and convert from markdown to clean HTML.
  const rawContent = p.html || p.code || p.fix || '';
  const parsed = parseArticleBody(rawContent, { stripH1: profile.strip_leading_h1 });
  let cleanHtml = markdownToHtml(parsed.body);

  // Post title: the article's own H1 (now stripped from the body so themes
  // don't render a double title). Meta title is the SEO <title>, which is
  // usually different (has the brand suffix) — don't conflate them.
  const title = parsed.articleTitle || parsed.metaTitle || item.page_title || 'Syte SEO draft';
  const metaTitle = parsed.metaTitle || p.meta_title || title;
  const metaDesc = parsed.metaDesc || p.meta_description || '';
  const keyword = p.primary_keyword || '';

  // Auto-generate and upload a featured image if an image API key is set.
  let featuredMediaId = null;
  let inlineHeroHtml = '';
  const settings = loadSettings();
  const heroWanted = profile.hero_mode !== 'none';
  const hasImageApi = heroWanted && !!(settings.openaiKey || settings.googleAiKey);
  if (hasImageApi) {
    try {
      // Auto flow on CMS push — try whichever provider works, since the
      // user isn't watching to pick.
      const img = await generateHeroImage(title, keyword, client, { allowFallback: true });
      const base64 = img.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const safeName = (title || 'hero').replace(/[^a-z0-9]+/gi, '-').slice(0, 50) + '.png';
      const attachment = await uploadMedia(client, base64, safeName);
      // hero_mode decides placement: featured image, inline at the top of
      // the body (for themes that don't render featured images), or both.
      if (profile.hero_mode === 'featured-only' || profile.hero_mode === 'both') {
        featuredMediaId = attachment.id;
      }
      if (profile.hero_mode === 'inline-only' || profile.hero_mode === 'both') {
        const src = attachment.source_url || '';
        if (src) inlineHeroHtml = '<img src="' + src + '" alt="' + (title || '').replace(/"/g, '&quot;') + '" />\n';
      }
    } catch (e) {
      console.warn('Featured image generation/upload failed (post still created):', e.message);
    }
  }
  if (inlineHeroHtml) cleanHtml = inlineHeroHtml + cleanHtml;

  // Re-push protection: if a draft with this title's slug already exists,
  // update it in place instead of creating a duplicate.
  const restBase = profile.post_type_rest_base || 'posts';
  // Match on title, not slug: WordPress leaves a draft's slug empty until it
  // is published, so a slug lookup silently found nothing and every re-push
  // created another draft.
  let existing = null;
  try { existing = await findEditablePostByTitle(client, title, restBase); } catch { /* lookup is best-effort */ }

  // Create (or update) the draft post with clean HTML content. Meta fields
  // are set in a SEPARATE follow-up call because WordPress 403s if the meta
  // keys aren't registered for REST yet (requires the PHP snippet on the WP side).
  const postFields = {
    title,
    content: cleanHtml,
    status: 'draft', // HARD CONSTRAINT — never publish
    featured_media: featuredMediaId || undefined,
    categories: profile.default_category_id ? [profile.default_category_id] : undefined,
    author: profile.default_author_id || undefined
  };
  const created = existing
    ? await updateDraftPost(client, existing.id, postFields, restBase)
    : await createDraftPost(client, postFields, restBase);

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
  // updatePostMeta already wraps its argument in { meta: ... }. Passing
  // { meta: metaFields } therefore sent { meta: { meta: {...} } }, and
  // WordPress silently ignores meta keys it does not recognise — returning
  // 200 while writing nothing. The SEO fields looked set for months and
  // were empty on the page. Send the flat object, then read it back:
  // a 200 from WordPress is not evidence the value stuck.
  let metaStatus = 'skipped';
  try {
    await updatePostMeta(client, restBase, created.id, metaFields);
    const check = await wpRequest(client, { path: 'wp/v2/' + restBase + '/' + created.id + '?context=edit' });
    const stored = check?.meta || {};
    const titleStored = !!(stored._yoast_wpseo_title || stored.rank_math_title);
    const descStored = !metaDesc || !!(stored._yoast_wpseo_metadesc || stored.rank_math_description);
    metaStatus = (titleStored && descStored)
      ? 'set'
      : 'ignored by WordPress — the SEO meta keys are not registered for the REST API on this site (needs the PHP snippet)';
  } catch (e) {
    console.warn('SEO meta update failed (post still created):', e.message);
    metaStatus = 'failed — ' + e.message;
  }

  const adminUrl = client.wp_url.replace(/\/+$/, '') + '/wp-admin/post.php?post=' + created.id + '&action=edit';

  // WordPress drafts return `link` as a preview URL (?p=123), not the
  // real permalink. Build the actual URL from the slug WordPress assigned
  // so downstream verification checks the right page.
  const baseUrl = client.wp_url.replace(/\/+$/, '');
  const realLink = created.slug
    ? baseUrl + '/' + created.slug + '/'
    : created.link || '';

  // Surface degradations instead of swallowing them — an unattended batch
  // run must never look "green" when SEO meta or the hero image failed.
  const warnings = [];
  if (metaStatus !== 'set') warnings.push('SEO meta not set: ' + metaStatus);
  if (hasImageApi && !featuredMediaId) warnings.push('featured image failed — draft has no hero image');

  return {
    ok: true,
    admin_url: adminUrl,
    link: realLink,
    wp_id: created.id,
    wp_slug: created.slug,
    rest_base: restBase,
    meta_title: metaTitle,
    meta_desc: metaDesc,
    updated_existing: !!existing,
    meta_status: metaStatus,
    warnings
  };
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
