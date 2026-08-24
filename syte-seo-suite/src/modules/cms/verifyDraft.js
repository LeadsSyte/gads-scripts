// Post-push verification — the second safety net behind publishing
// profiles. Profiles PREVENT the formatting problems we know about;
// this CATCHES the ones we don't, per client, before a human ever opens
// the draft.
//
// After a draft is created we fetch it back from the CMS and check what
// actually landed there. Findings are recorded on the queue row so a
// reviewer sees "pushed with warnings" instead of a silently broken post.
//
// checkDraftContent() is pure (no network, no DOM) so it is fully
// testable — see test/verifyDraft.test.mjs.

import { wpRequest } from './wpApi.js';
import { shopifyRequest } from './shopifyApi.js';
import { getPublishingProfile } from './publishingProfile.js';

// severity 'error'   — the draft is visibly wrong; a human must look
// severity 'warning' — worth a glance, publishing it wouldn't embarrass us
export function checkDraftContent({ html, profile = {}, hasFeaturedImage = false, metaTitle = '', metaDesc = '' } = {}) {
  const body = String(html || '');
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const findings = [];
  const add = (name, ok, severity, detail) => findings.push({ name, ok, severity, detail });

  // 1. Something actually arrived.
  add('Content present', text.length >= 100, 'error',
    text.length >= 100 ? text.length + ' characters of body text'
      : (text.length ? 'Only ' + text.length + ' characters — the body looks truncated' : 'The draft body is empty'));

  // 2. Raw markdown that never got converted. This is the classic
  //    "why does the blog show ## and **" complaint.
  const artifacts = [];
  if (/^[ \t]{0,3}#{1,6}[ \t]+\S/m.test(body)) artifacts.push('heading markers (#)');
  if (/\*\*[^*\n]{2,}\*\*/.test(body)) artifacts.push('bold markers (**)');
  if (/```/.test(body)) artifacts.push('code fences (```)');
  if (/\[[^\]\n]{2,}\]\((?:https?:\/\/|\/)[^)\s]+\)/.test(body)) artifacts.push('markdown links');
  add('No raw markdown', artifacts.length === 0, 'error',
    artifacts.length ? 'Visible on the page: ' + artifacts.join(', ') : 'Converted cleanly to HTML');

  // 3. Double-escaped HTML — tags rendering as literal text.
  add('HTML not escaped', !/&lt;\s*\/?\s*(p|h[1-6]|ul|ol|li|strong|em|a|img|blockquote)\b/i.test(body), 'error',
    'Markup showing as visible text means the CMS escaped our HTML');

  // 4. Heading structure — the double-title trap.
  const h1s = (body.match(/<h1[\s>]/gi) || []).length;
  if (profile.strip_leading_h1 === false) {
    add('Heading structure', h1s === 1, 'warning',
      h1s === 1 ? 'One H1 in the body, as this client is configured'
        : h1s + ' H1 headings in the body (this client expects exactly one)');
  } else {
    add('No duplicate title', h1s === 0, 'error',
      h1s === 0 ? 'Title rendered once, by the theme'
        : h1s + ' H1 in the body — the theme renders the title too, so it will appear twice');
  }
  const h2s = (body.match(/<h2[\s>]/gi) || []).length;
  add('Subheadings present', h2s >= 1, 'warning',
    h2s >= 1 ? h2s + ' section headings' : 'No H2 headings — the article may have lost its structure');

  // 5. Hero image, per this client's configured placement.
  const mode = profile.hero_mode || 'featured-only';
  const hasInlineImage = /<img[\s>]/i.test(body);
  if (mode === 'inline-only') {
    add('Hero image', hasInlineImage, 'warning', hasInlineImage ? 'Image in the body, as configured' : 'No image in the body (this client expects an inline hero)');
  } else if (mode === 'both') {
    add('Hero image', hasFeaturedImage && hasInlineImage, 'warning',
      hasFeaturedImage && hasInlineImage ? 'Featured and inline image set'
        : 'Expected both a featured image and an inline one' + (hasFeaturedImage ? ' (inline missing)' : hasInlineImage ? ' (featured missing)' : ' (both missing)'));
  } else if (mode !== 'none') {
    add('Hero image', hasFeaturedImage, 'warning', hasFeaturedImage ? 'Featured image set' : 'No featured image on the draft');
  }

  // 6. SEO fields — the silent failure we made loud earlier.
  add('SEO title', !!String(metaTitle || '').trim(), 'warning', metaTitle ? 'Set' : 'Missing — the post will use the plain title');
  add('SEO description', !!String(metaDesc || '').trim(), 'warning', metaDesc ? 'Set' : 'Missing — search engines will invent a snippet');

  return summarize(findings);
}

function summarize(findings) {
  const failed = findings.filter(f => !f.ok);
  const errors = failed.filter(f => f.severity === 'error');
  const level = errors.length ? 'failed' : (failed.length ? 'warnings' : 'verified');
  return {
    level,
    ok: level === 'verified',
    findings,
    // Short human-readable lines for the queue row / emails.
    problems: failed.map(f => f.name + ': ' + f.detail)
  };
}

// Fetch what actually landed in the CMS and check it. Returns the same
// shape as checkDraftContent, plus level 'unchecked' when the draft
// could not be re-fetched (never fail a push over verification).
export async function verifyPushedDraft(client, result) {
  const profile = getPublishingProfile(client);
  try {
    if (client.cms_type === 'WordPress' && result?.wp_id) {
      const restBase = result.rest_base || 'posts';
      const post = await wpRequest(client, { path: 'wp/v2/' + restBase + '/' + result.wp_id });
      const html = post?.content?.rendered ?? post?.content?.raw ?? '';
      return checkDraftContent({
        html,
        profile,
        hasFeaturedImage: !!post?.featured_media,
        metaTitle: result.meta_title || '',
        metaDesc: result.meta_desc || ''
      });
    }

    if (client.cms_type === 'Shopify' && result?.shopify_article_id && result?.shopify_blog_id) {
      const j = await shopifyRequest(client, {
        path: 'blogs/' + result.shopify_blog_id + '/articles/' + result.shopify_article_id + '.json'
      });
      const article = j?.article || {};
      return checkDraftContent({
        html: article.body_html || '',
        profile,
        hasFeaturedImage: !!article.image?.src,
        metaTitle: result.meta_title || '',
        metaDesc: result.meta_desc || ''
      });
    }
  } catch (e) {
    return { level: 'unchecked', ok: false, findings: [], problems: ['Could not re-read the draft to check it: ' + e.message] };
  }

  return { level: 'unchecked', ok: false, findings: [], problems: ['No draft reference to check'] };
}
