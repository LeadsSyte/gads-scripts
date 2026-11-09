// Hero images for drafts pushed without one (lib/heroBackfill.js): only
// drafts, only rows that lack an image, and the warning is cleared after.

import { backfillHeroImages, rowsNeedingHero } from '../netlify/functions/lib/heroBackfill.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };

const WARN = ['Hero image: No featured image on the draft', 'featured image failed — draft has no hero image'];
const row = (id, extra = {}) => ({ id, status: 'pushed', page_title: 'Title ' + id, payload: { wp_id: 100 + id, rest_base: 'posts', warnings: [...WARN, 'Meta OK'], ...extra } });

function wpDeps(posts) {
  const calls = { upload: 0, featured: [], saved: {} };
  return {
    calls,
    deps: {
      generate: async () => ({ b64: 'AAAA', mime: 'image/png' }),
      saveRow: async (id, payload) => { calls.saved[id] = payload; },
      wp: {
        getPost: async (_b, id) => posts[id] || null,
        uploadMedia: async () => { calls.upload++; return { id: 900 + calls.upload }; },
        setFeatured: async (_b, id, mediaId) => { calls.featured.push([id, mediaId]); }
      }
    }
  };
}

await t('only pushed rows with a hero warning and a post id are picked', () => {
  const rows = [row(1), row(2, { warnings: ['Meta OK'] }), { ...row(3), status: 'published' }, row(4, { wp_id: null }), row(5, { hero_backfilled_at: 'x' })];
  eq(rowsNeedingHero(rows).map(r => r.id), [1]);
});

await t('a WordPress draft gets an uploaded featured image and its warning cleared', async () => {
  const { calls, deps } = wpDeps({ 101: { id: 101, status: 'draft', featured_media: 0 } });
  const out = await backfillHeroImages({ client: { name: 'Krost', cms_type: 'WordPress' }, rows: [row(1)] }, deps);
  eq(out.map(o => o.result), ['added']);
  eq(calls.featured, [[101, 901]]);
  eq(calls.saved[1].warnings, ['Meta OK'], 'only the hero warnings removed');
  if (!calls.saved[1].hero_backfilled_at) throw new Error('not marked');
});

await t('published posts are never touched; posts that already have an image are just marked', async () => {
  const { calls, deps } = wpDeps({ 101: { id: 101, status: 'publish', featured_media: 0 }, 102: { id: 102, status: 'draft', featured_media: 55 } });
  const out = await backfillHeroImages({ client: { name: 'K', cms_type: 'WordPress' }, rows: [row(1), row(2)] }, deps);
  eq(out.map(o => o.result), ['skipped', 'skipped']);
  eq([calls.upload, calls.featured.length], [0, 0]);
  if (calls.saved[1]) throw new Error('published row must not be changed');
  eq(calls.saved[2].warnings, ['Meta OK']);
});

await t('hero mode none or inline-only is respected', async () => {
  const { calls, deps } = wpDeps({ 101: { id: 101, status: 'draft', featured_media: 0 } });
  const a = await backfillHeroImages({ client: { name: 'K', cms_type: 'WordPress' }, profile: { hero_mode: 'none' }, rows: [row(1)] }, deps);
  const b = await backfillHeroImages({ client: { name: 'K', cms_type: 'WordPress' }, profile: { hero_mode: 'inline-only' }, rows: [row(1)] }, deps);
  eq([a[0].result, b[0].result, calls.upload], ['skipped', 'skipped', 0]);
});

await t('Shopify: hidden articles get an image; published ones are left alone', async () => {
  const set = [];
  const deps = {
    generate: async () => ({ b64: 'BBBB', mime: 'image/png' }),
    saveRow: async () => {},
    shopify: {
      getArticle: async (_blog, id) => id === 1 ? { id: 1, published_at: null, image: null } : { id: 2, published_at: '2026-11-01', image: null },
      setImage: async (blog, id, b64, alt) => { set.push([blog, id, b64, alt]); }
    }
  };
  const rows = [{ id: 'a', status: 'pushed', page_title: 'TV stands', payload: { shopify_article_id: 1, shopify_blog_id: 9, warnings: WARN } }, { id: 'b', status: 'pushed', page_title: 'Live one', payload: { shopify_article_id: 2, shopify_blog_id: 9, warnings: WARN } }];
  const out = await backfillHeroImages({ client: { name: 'BAM', cms_type: 'Shopify' }, rows }, deps);
  eq(out.map(o => o.result), ['added', 'skipped']);
  eq(set, [[9, 1, 'BBBB', 'TV stands']]);
});

await t('a failure on one draft is reported and the rest carry on', async () => {
  const { deps } = wpDeps({ 102: { id: 102, status: 'draft', featured_media: 0 } });
  const out = await backfillHeroImages({ client: { name: 'K', cms_type: 'WordPress' }, rows: [row(1), row(2)] }, deps);
  eq(out.map(o => o.result), ['failed', 'added']);
});

console.log(`\nheroBackfill: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
