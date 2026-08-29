// Shopify article push — locks the request shapes we send to the Admin
// API. The Shopify path cannot be exercised against a real store yet (no
// client tokens), so these tests are what stand between "wired right" and
// "wired wrong" until the first pilot store lands.
//
// The network layer (shopifyApi), image generation and settings are
// stubbed; markdown conversion, article parsing and publishing profiles
// run for real, because that is exactly the formatting we care about.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CMS_DIR = path.join(__dirname, '../src/modules/cms');
const SRC = fs.readFileSync(path.join(CMS_DIR, 'shopifyPush.js'), 'utf8');

// Patch the imports that need network / browser APIs. The temp module is
// written beside the original so its other relative imports still resolve.
const PATCHED = SRC
  .replace(/import \{[^}]*\} from '\.\/shopifyApi\.js';/,
    `const shopifyRequest = (...a) => globalThis.__shopify.request(...a);
     const listBlogs = async () => globalThis.__shopify.blogs;
     const findArticleByHandle = async () => globalThis.__shopify.existing;
     const storeHandle = c => (c.shopify_store || '').replace('.myshopify.com', '');`)
  .replace("import { generateHeroImage } from '../content/imageGen.js';",
    'const generateHeroImage = async () => globalThis.__shopify.image;')
  .replace("import { loadSettings } from '../../lib/settings.js';",
    'const loadSettings = () => globalThis.__shopify.settings;');

const tmp = path.join(CMS_DIR, '__shopifyPush.tmp.test.js');
fs.writeFileSync(tmp, PATCHED);
let mod;
try { mod = await import(pathToFileURL(tmp).href); }
finally { fs.unlinkSync(tmp); }

const CLIENT = {
  name: 'Acme Store',
  url: 'https://acmestore.com',
  cms_type: 'Shopify',
  shopify_store: 'acme-store.myshopify.com',
  shopify_token: 'shpat_test'
};

const ARTICLE = `# Choosing the Right Widget

Widgets matter for South African buyers.

## What to look for

Three things decide it.

**Meta Title:** Widget Buying Guide | Acme

**Meta Description:** How to choose a widget in South Africa.`;

// Default fake Admin API: records every call, answers create/update with
// a plausible article object.
function resetShopify(overrides = {}) {
  const calls = [];
  globalThis.__shopify = {
    calls,
    blogs: [{ id: 11, title: 'News', handle: 'news' }, { id: 22, title: 'Blog', handle: 'blog' }],
    existing: null,
    image: { dataUrl: 'data:image/png;base64,AAAA' },
    settings: {},
    request: async (client, opts) => {
      calls.push(opts);
      const body = opts.body || {};
      if (/articles/.test(opts.path) && (opts.method === 'POST' || opts.method === 'PUT')) {
        const a = body.article || {};
        return {
          article: {
            id: a.id || 999,
            blog_id: 11,
            handle: 'choosing-the-right-widget',
            title: a.title,
            body_html: a.body_html,
            image: a.image ? { src: 'https://cdn.shopify.com/hero.png' } : null
          }
        };
      }
      return {};
    },
    ...overrides
  };
  return globalThis.__shopify;
}

function item(payload = {}) {
  return { page_title: 'Fallback title', payload: { html: ARTICLE, primary_keyword: 'widgets', ...payload } };
}
function createCall() {
  return globalThis.__shopify.calls.find(c => c.method === 'POST' && /articles\.json/.test(c.path));
}
function sentArticle() {
  const c = createCall();
  if (!c) throw new Error('no create call was made');
  return c.body.article;
}

let pass = 0, fail = 0;
async function t(name, fn) {
  resetShopify();
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function assertMatch(s, re, label) {
  if (!re.test(String(s || ''))) throw new Error((label || '') + ' did not match ' + re + ' in: ' + String(s).slice(0, 200));
}
function assertNoMatch(s, re, label) {
  if (re.test(String(s || ''))) throw new Error((label || '') + ' unexpectedly matched ' + re);
}

// --- the hard constraint -------------------------------------------------

await t('articles are ALWAYS created unpublished', async () => {
  await mod.pushToShopify(CLIENT, item());
  assertEq(sentArticle().published, false, 'published');
});

// --- formatting parity with WordPress -----------------------------------

await t('markdown is converted to HTML, no raw markers left', async () => {
  await mod.pushToShopify(CLIENT, item());
  const html = sentArticle().body_html;
  assertMatch(html, /<h2[^>]*>\s*What to look for/i, 'H2 converted');
  assertNoMatch(html, /^##\s/m, 'no raw ## markers');
});

await t('the article H1 becomes the title and leaves the body', async () => {
  await mod.pushToShopify(CLIENT, item());
  const a = sentArticle();
  assertEq(a.title, 'Choosing the Right Widget', 'title from H1');
  assertNoMatch(a.body_html, /<h1/i, 'no H1 left in body');
});

await t('a client configured to keep its H1 keeps it', async () => {
  const client = { ...CLIENT, publishing_profile: { strip_leading_h1: false } };
  await mod.pushToShopify(client, item());
  assertMatch(sentArticle().body_html, /<h1[^>]*>\s*Choosing the Right Widget/i, 'H1 kept in body');
});

await t('meta/schema blocks never reach the article body', async () => {
  await mod.pushToShopify(CLIENT, item());
  assertNoMatch(sentArticle().body_html, /Meta Title|Meta Description/i, 'meta stripped');
});

// --- SEO ----------------------------------------------------------------

await t('SEO title and description ride along as article metafields', async () => {
  await mod.pushToShopify(CLIENT, item());
  const mf = sentArticle().metafields || [];
  const title = mf.find(m => m.key === 'title_tag');
  const desc = mf.find(m => m.key === 'description_tag');
  if (!title) throw new Error('no title_tag metafield');
  if (!desc) throw new Error('no description_tag metafield');
  assertEq(title.namespace, 'global', 'namespace');
  assertEq(title.value, 'Widget Buying Guide | Acme', 'SEO title');
  assertEq(desc.value, 'How to choose a widget in South Africa.', 'SEO description');
});

await t('no SEO description means no empty metafield is sent', async () => {
  await mod.pushToShopify(CLIENT, item({ html: '# T\n\n' + 'Body text here. '.repeat(10) }));
  const mf = sentArticle().metafields || [];
  if (mf.some(m => m.key === 'description_tag')) throw new Error('should omit empty description_tag');
});

// --- blog selection ------------------------------------------------------

await t('defaults to the first blog on the store', async () => {
  const r = await mod.pushToShopify(CLIENT, item());
  assertMatch(createCall().path, /blogs\/11\/articles\.json/, 'first blog');
  assertEq(r.shopify_blog_id, 11, 'returned blog id');
});

await t('honours the blog chosen in the publishing profile', async () => {
  const client = { ...CLIENT, publishing_profile: { shopify_blog_id: 22 } };
  const r = await mod.pushToShopify(client, item());
  assertMatch(createCall().path, /blogs\/22\/articles\.json/, 'chosen blog');
  assertEq(r.shopify_blog_id, 22, 'returned blog id');
});

await t('a stale blog id falls back to the first blog instead of failing', async () => {
  const client = { ...CLIENT, publishing_profile: { shopify_blog_id: 9999 } };
  await mod.pushToShopify(client, item());
  assertMatch(createCall().path, /blogs\/11\/articles\.json/, 'fell back');
});

await t('a store with no blogs gives a clear error', async () => {
  resetShopify({ blogs: [] });
  try {
    await mod.pushToShopify(CLIENT, item());
    throw new Error('should have thrown');
  } catch (e) {
    assertMatch(e.message, /no blogs found/i, 'error message');
  }
});

// --- duplicate protection ------------------------------------------------

await t('re-pushing the same article updates it instead of duplicating', async () => {
  resetShopify({ existing: { id: 555, handle: 'choosing-the-right-widget' } });
  const r = await mod.pushToShopify(CLIENT, item());
  if (createCall()) throw new Error('should not create a second article');
  const put = globalThis.__shopify.calls.find(c => c.method === 'PUT');
  if (!put) throw new Error('expected an update call');
  assertMatch(put.path, /articles\/555\.json/, 'updates the existing article');
  assertEq(put.body.article.published, false, 'update stays unpublished');
  assertEq(r.updated_existing, true, 'flagged as an update');
});

// --- hero image ----------------------------------------------------------

await t('featured-only attaches the image to the article', async () => {
  resetShopify();
  globalThis.__shopify.settings = { openaiKey: 'k' };
  await mod.pushToShopify(CLIENT, item());
  const img = sentArticle().image;
  if (!img || !img.attachment) throw new Error('expected an attached image');
  assertEq(globalThis.__shopify.calls.filter(c => c.method === 'PUT').length, 0, 'no extra update needed');
});

await t('inline-only puts the hosted image in the body', async () => {
  resetShopify({ settings: { openaiKey: 'k' } });
  const client = { ...CLIENT, publishing_profile: { hero_mode: 'inline-only' } };
  await mod.pushToShopify(client, item());
  const put = globalThis.__shopify.calls.find(c => c.method === 'PUT');
  if (!put) throw new Error('expected a follow-up update carrying the inline image');
  assertMatch(put.body.article.body_html, /<img src="https:\/\/cdn\.shopify\.com\/hero\.png"/, 'inline img');
});

await t('hero_mode none skips image generation entirely', async () => {
  resetShopify({ settings: { openaiKey: 'k' } });
  const client = { ...CLIENT, publishing_profile: { hero_mode: 'none' } };
  await mod.pushToShopify(client, item());
  if (sentArticle().image) throw new Error('no image should be attached');
});

await t('an image failure warns but still creates the article', async () => {
  resetShopify({ settings: { openaiKey: 'k' } });
  globalThis.__shopify.image = null; // generateHeroImage resolves to null -> throws on .dataUrl
  const r = await mod.pushToShopify(CLIENT, item());
  if (!createCall()) throw new Error('article should still be created');
  assertEq(r.ok, true, 'push still succeeded');
  if (!r.warnings.some(w => /image/i.test(w))) throw new Error('expected an image warning, got: ' + JSON.stringify(r.warnings));
});

// --- what the rest of the pipeline needs back ---------------------------

await t('returns the ids the auto-publisher and verifier need', async () => {
  const r = await mod.pushToShopify(CLIENT, item());
  assertEq(r.shopify_article_id, 999, 'article id');
  assertEq(r.shopify_blog_id, 11, 'blog id');
  assertEq(r.meta_title, 'Widget Buying Guide | Acme', 'meta title for verification');
  assertEq(r.meta_desc, 'How to choose a widget in South Africa.', 'meta desc for verification');
  assertMatch(r.admin_url, /admin\.shopify\.com\/store\/acme-store\/content\/articles\/999/, 'admin url');
  assertMatch(r.link, /acmestore\.com\/blogs\/news\/choosing-the-right-widget/, 'public link');
});

// --- unsupported operations ---------------------------------------------

await t('a standalone SEO-meta push is refused with a useful message', async () => {
  try {
    await mod.pushToShopify(CLIENT, { page_title: 'x', payload: { meta_title: 'T', meta_description: 'D' } });
    throw new Error('should have thrown');
  } catch (e) {
    assertMatch(e.message, /not supported on Shopify/i, 'explains why');
  }
});

console.log(`\nshopifyPush: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
