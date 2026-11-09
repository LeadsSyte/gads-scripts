// Put a hero image on drafts that were pushed without one.
//
// Why: in Nov 2026 the image providers the suite used (DALL-E 3, Imagen 3)
// stopped working on Syte's accounts, so the 9 Nov Autopilot run pushed 32
// drafts with "featured image failed". imageGen.js now uses Google's
// gemini-2.5-flash-image; this fixes the drafts that already exist, without
// touching anything else on them. Only DRAFTS are touched (WordPress status
// draft/pending, Shopify article not published).
//
// Pure apart from the injected deps; tested in test/heroBackfill.test.mjs.

import { buildImagePrompt } from '../../../src/modules/content/imageGen.js';

export const HERO_WARNING_RE = /featured image|hero image/i;
export const GOOGLE_IMAGE_MODEL = 'gemini-2.5-flash-image';

// Queue rows that still need an image.
export function rowsNeedingHero(rows) {
  return (rows || []).filter(r => {
    const p = r.payload || {};
    if (p.hero_backfilled_at) return false;
    if (!['pushed', 'changes_requested', 'approved'].includes(r.status)) return false;
    if (!(p.wp_id || p.shopify_article_id)) return false;
    return (p.warnings || []).some(w => HERO_WARNING_RE.test(String(w)));
  });
}

// Google image → { b64, mime }. fetchImpl and key injected.
export async function generateGoogleImage(prompt, { key, fetchImpl = fetch }) {
  if (!key) throw new Error('GOOGLE_AI_KEY is not set.');
  const r = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/' + GOOGLE_IMAGE_MODEL + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } } }),
    signal: AbortSignal.timeout(90000)
  });
  const text = await r.text();
  if (!r.ok) throw new Error('Google image ' + r.status + ': ' + text.slice(0, 160));
  const j = JSON.parse(text);
  const part = (j.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
  if (!part) throw new Error('Google returned no image.');
  return { b64: part.inlineData.data, mime: part.inlineData.mimeType || 'image/png' };
}

const slug = s => String(s || 'hero').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'hero';

// deps: { generate(prompt) → {b64,mime}, wp: { getPost(restBase,id), uploadMedia(b64,mime,filename,alt), setFeatured(restBase,id,mediaId) },
//         shopify: { getArticle(blogId,id), setImage(blogId,id,b64,alt) }, saveRow(id, payload), timeLeftMs() }
// → [{ id, title, result: 'added' | 'skipped' | 'failed', reason }]
export async function backfillHeroImages({ client, profile = {}, rows }, deps) {
  const out = [];
  const isShopify = client.cms_type === 'Shopify';
  const mode = profile.hero_mode || 'featured-only';
  for (const row of rowsNeedingHero(rows)) {
    if (deps.timeLeftMs && deps.timeLeftMs() < 120000) { out.push({ id: row.id, title: row.page_title, result: 'skipped', reason: 'out of time; run again' }); continue; }
    const p = row.payload || {};
    const title = row.page_title || p.meta_title || 'Article';
    try {
      if (mode === 'none') { out.push({ id: row.id, title, result: 'skipped', reason: 'this client has hero images switched off' }); continue; }
      if (!isShopify && mode === 'inline-only') { out.push({ id: row.id, title, result: 'skipped', reason: 'inline hero images need a re-push, not a featured image' }); continue; }
      if (isShopify) {
        const art = await deps.shopify.getArticle(p.shopify_blog_id, p.shopify_article_id);
        if (!art) throw new Error('article not found on the store');
        if (art.published_at) { out.push({ id: row.id, title, result: 'skipped', reason: 'already published; not touched' }); continue; }
        if (art.image?.src) { await deps.saveRow(row.id, { ...p, hero_backfilled_at: new Date().toISOString(), warnings: (p.warnings || []).filter(w => !HERO_WARNING_RE.test(String(w))) }); out.push({ id: row.id, title, result: 'skipped', reason: 'already has an image' }); continue; }
        const img = await deps.generate(buildImagePrompt(title, p.primary_keyword || '', client));
        await deps.shopify.setImage(p.shopify_blog_id, p.shopify_article_id, img.b64, title);
      } else {
        const restBase = p.rest_base || 'posts';
        const post = await deps.wp.getPost(restBase, p.wp_id);
        if (!post) throw new Error('draft not found on the site');
        if (!['draft', 'pending'].includes(post.status)) { out.push({ id: row.id, title, result: 'skipped', reason: 'status is ' + post.status + '; only drafts are touched' }); continue; }
        if (post.featured_media) { await deps.saveRow(row.id, { ...p, hero_backfilled_at: new Date().toISOString(), warnings: (p.warnings || []).filter(w => !HERO_WARNING_RE.test(String(w))) }); out.push({ id: row.id, title, result: 'skipped', reason: 'already has a featured image' }); continue; }
        const img = await deps.generate(buildImagePrompt(title, p.primary_keyword || '', client));
        const media = await deps.wp.uploadMedia(img.b64, img.mime, slug(title) + (img.mime === 'image/jpeg' ? '.jpg' : '.png'), title);
        await deps.wp.setFeatured(restBase, p.wp_id, media.id);
      }
      await deps.saveRow(row.id, { ...p, hero_backfilled_at: new Date().toISOString(), warnings: (p.warnings || []).filter(w => !HERO_WARNING_RE.test(String(w))) });
      out.push({ id: row.id, title, result: 'added' });
    } catch (e) {
      out.push({ id: row.id, title, result: 'failed', reason: String(e?.message || e).slice(0, 160) });
    }
  }
  return out;
}
