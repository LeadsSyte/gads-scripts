// wordpressPush.js end-to-end flow tests. The push pipeline:
//   1. Decide meta-only vs content (pushToWordPress router)
//   2. parseArticleBody strips meta/schema/QA from the article body
//   3. markdownToHtml converts to HTML
//   4. Optional hero image generation + upload (skipped if no image API key)
//   5. createDraftPost (HARD CONSTRAINT: status='draft', never publish)
//   6. updatePostMeta sets Yoast + RankMath fields
//
// Pins every step so a refactor that breaks "draft only" or that pushes
// the raw markdown body to WP fails the gate.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/cms/wordpressPush.js'), 'utf8');

// Stub every dependency the module imports.
globalThis.__wpRequest = async () => ({});
globalThis.__findBySlug = async () => null;
globalThis.__updatePostMeta = async () => ({});
globalThis.__createDraftPost = async () => ({ id: 1, slug: 'x' });
globalThis.__uploadMedia = async () => ({ id: 1 });
globalThis.__generateHeroImage = async () => ({ dataUrl: 'data:image/png;base64,AAAA' });
globalThis.__loadSettings = () => ({});
globalThis.__markdownToHtml = (md) => '<p>' + (md || '') + '</p>';

const PATCHED = SRC
  .replace(
    "import { wpRequest, findBySlug, updatePostMeta, createDraftPost, uploadMedia } from './wpApi.js';",
    `const wpRequest = (...a) => globalThis.__wpRequest(...a);
     const findBySlug = (...a) => globalThis.__findBySlug(...a);
     const updatePostMeta = (...a) => globalThis.__updatePostMeta(...a);
     const createDraftPost = (...a) => globalThis.__createDraftPost(...a);
     const uploadMedia = (...a) => globalThis.__uploadMedia(...a);`
  )
  .replace(
    "import { generateHeroImage } from '../content/imageGen.js';",
    "const generateHeroImage = (...a) => globalThis.__generateHeroImage(...a);"
  )
  .replace(
    "import { loadSettings } from '../../lib/settings.js';",
    "const loadSettings = () => globalThis.__loadSettings();"
  )
  .replace(
    "import { markdownToHtml, parseOutputSections } from '../content/articleParser.js';",
    `const markdownToHtml = (md) => globalThis.__markdownToHtml(md);
     const parseOutputSections = (raw) => globalThis.__parseOutputSections(raw);`
  );

// Real parseOutputSections from the source — we want the test to exercise
// the real body-extraction logic (that's the bug we're guarding against),
// while keeping markdownToHtml as a thin stub so we can assert on what
// HTML the push pipeline sends to WP.
const parserSrc = fs.readFileSync(path.join(__dirname, '../src/modules/content/articleParser.js'), 'utf8');
const parserTmp = path.join(os.tmpdir(), 'parser-' + Date.now() + '.mjs');
fs.writeFileSync(parserTmp, parserSrc);
const parserMod = await import(parserTmp);
fs.unlinkSync(parserTmp);
globalThis.__parseOutputSections = parserMod.parseOutputSections;

const tmp = path.join(os.tmpdir(), 'wpPushFlow-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
function reset() {
  globalThis.__loadSettings = () => ({}); // no image keys
  globalThis.__createDraftPost = async () => ({ id: 1, slug: 'my-post' });
  globalThis.__updatePostMeta = async () => ({});
  globalThis.__uploadMedia = async () => ({ id: 99 });
  globalThis.__generateHeroImage = async () => ({ dataUrl: 'data:image/png;base64,AAAA' });
  globalThis.__findBySlug = async () => null;
  globalThis.__wpRequest = async () => ({});
}
async function t(name, fn) {
  reset();
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
async function expectThrow(fn, regex, label) {
  try { await fn(); }
  catch (e) {
    if (regex && !regex.test(e.message)) throw new Error((label || '') + ' wrong error: ' + e.message);
    return;
  }
  throw new Error((label || '') + ' expected throw, did not throw');
}

const CLIENT = { wp_url: 'https://blog.test/', wp_username: 'admin', wp_app_password: 'pw' };

// ============================================================================
// pushToWordPress — router
// ============================================================================
await t('pushToWordPress: meta-only item routes to pushMetaToWordPress', async () => {
  let metaCalled = false;
  globalThis.__findBySlug = async () => { metaCalled = true; return { type: 'pages', record: { id: 5, slug: 'about' } }; };
  await mod.pushToWordPress(CLIENT, {
    change_type: 'meta_title',
    page_url: 'https://blog.test/about',
    payload: { meta_title: 'New Title' }
  });
  eq(metaCalled, true);
});

await t('pushToWordPress: content item with payload.html routes to pushContentToWordPress', async () => {
  let createCalled = false;
  globalThis.__createDraftPost = async (client, opts) => { createCalled = true; return { id: 1, slug: 's' }; };
  await mod.pushToWordPress(CLIENT, {
    change_type: 'article',
    page_title: 'New Article',
    payload: { html: '# Heading\n\nBody.' }
  });
  eq(createCalled, true);
});

await t('pushToWordPress: meta-only payload (no html, no code) → meta path even if change_type generic', async () => {
  let metaCalled = false;
  globalThis.__findBySlug = async () => { metaCalled = true; return { type: 'pages', record: { id: 5, slug: 'x' } }; };
  await mod.pushToWordPress(CLIENT, {
    change_type: 'other',
    page_url: 'https://blog.test/x',
    payload: { meta_title: 'T', meta_description: 'D' }
  });
  eq(metaCalled, true);
});

// ============================================================================
// pushMetaToWordPress
// ============================================================================
await t('pushMetaToWordPress: throws when slug not found in WP', async () => {
  globalThis.__findBySlug = async () => null;
  await expectThrow(
    () => mod.pushMetaToWordPress(CLIENT, { page_url: 'https://blog.test/missing' }),
    /not found for slug/i
  );
});

await t('pushMetaToWordPress: writes both Yoast AND RankMath meta keys', async () => {
  globalThis.__findBySlug = async () => ({ type: 'posts', record: { id: 42, slug: 'post' } });
  let lastMeta;
  globalThis.__updatePostMeta = async (client, type, id, meta) => { lastMeta = meta; return {}; };
  await mod.pushMetaToWordPress(CLIENT, {
    page_url: 'https://blog.test/post',
    payload: { meta_title: 'T', meta_description: 'D', primary_keyword: 'kw' }
  });
  // Both Yoast + RankMath fields must be set so whichever plugin the
  // client uses gets the values.
  eq(lastMeta._yoast_wpseo_title, 'T');
  eq(lastMeta.rank_math_title, 'T');
  eq(lastMeta._yoast_wpseo_metadesc, 'D');
  eq(lastMeta.rank_math_description, 'D');
  eq(lastMeta._yoast_wpseo_focuskw, 'kw');
  eq(lastMeta.rank_math_focus_keyword, 'kw');
});

await t('pushMetaToWordPress: returns admin_url + link', async () => {
  globalThis.__findBySlug = async () => ({ type: 'posts', record: { id: 42, slug: 'post' } });
  const out = await mod.pushMetaToWordPress(CLIENT, {
    page_url: 'https://blog.test/post',
    payload: { meta_title: 'T' }
  });
  eq(out.admin_url, 'https://blog.test/wp-admin/post.php?post=42&action=edit');
  eq(out.link, 'https://blog.test/post/');
});

// ============================================================================
// pushContentToWordPress — the big one
// ============================================================================
await t('pushContentToWordPress: ALWAYS creates as status=draft (HARD CONSTRAINT)', async () => {
  let lastOpts;
  globalThis.__createDraftPost = async (client, opts) => { lastOpts = opts; return { id: 1, slug: 's' }; };
  await mod.pushContentToWordPress(CLIENT, {
    page_title: 'X',
    payload: { html: '# Body' }
  });
  eq(lastOpts.status, 'draft', 'NEVER publish — drafts only');
});

await t('pushContentToWordPress: parses + converts markdown body before sending to WP', async () => {
  let lastOpts;
  globalThis.__createDraftPost = async (client, opts) => { lastOpts = opts; return { id: 1, slug: 's' }; };
  globalThis.__markdownToHtml = (md) => '<HTML_OF[' + (md || '') + ']>';
  const REAL = '**Meta Title:** Best Widgets\n**Meta Description:** Buy them.\n# H1\n## Body\n\n```json\n{"a":1}\n```';
  await mod.pushContentToWordPress(CLIENT, {
    payload: { html: REAL }
  });
  // Body sent to WP must NOT contain the QA JSON or meta lines.
  if (/Meta Title|"a":1/.test(lastOpts.content)) {
    throw new Error('raw output leaked into WP body: ' + lastOpts.content.slice(0, 200));
  }
  // Title comes from the parsed Meta Title.
  eq(lastOpts.title, 'Best Widgets');
});

await t('pushContentToWordPress: skips hero image when no image API keys configured', async () => {
  let imageCalled = false;
  globalThis.__loadSettings = () => ({}); // no openai or googleAi keys
  globalThis.__generateHeroImage = async () => { imageCalled = true; return { dataUrl: 'data:x' }; };
  await mod.pushContentToWordPress(CLIENT, { payload: { html: '# x' } });
  eq(imageCalled, false);
});

await t('pushContentToWordPress: generates + uploads hero image when image API key set', async () => {
  globalThis.__loadSettings = () => ({ openaiKey: 'sk' });
  let uploaded = false, attached = null;
  globalThis.__generateHeroImage = async () => ({ dataUrl: 'data:image/png;base64,AAAA' });
  globalThis.__uploadMedia = async () => { uploaded = true; return { id: 777 }; };
  globalThis.__createDraftPost = async (client, opts) => { attached = opts.featured_media; return { id: 1, slug: 's' }; };
  await mod.pushContentToWordPress(CLIENT, { payload: { html: '# x' } });
  eq(uploaded, true);
  eq(attached, 777, 'featured_media set to uploaded attachment id');
});

await t('pushContentToWordPress: image upload failure does NOT block draft creation', async () => {
  globalThis.__loadSettings = () => ({ openaiKey: 'sk' });
  globalThis.__generateHeroImage = async () => { throw new Error('OpenAI quota'); };
  let createCalled = false;
  globalThis.__createDraftPost = async () => { createCalled = true; return { id: 1, slug: 's' }; };
  await mod.pushContentToWordPress(CLIENT, { payload: { html: '# x' } });
  eq(createCalled, true, 'draft still created even when image fails');
});

await t('pushContentToWordPress: meta update failure leaves draft created (post still exists)', async () => {
  globalThis.__createDraftPost = async () => ({ id: 1, slug: 's' });
  globalThis.__updatePostMeta = async () => { throw new Error('meta keys not registered'); };
  // Function must NOT throw — the draft is the important artifact.
  const out = await mod.pushContentToWordPress(CLIENT, { payload: { html: '# x' } });
  eq(out.ok, true);
});

await t('pushContentToWordPress: builds real permalink from slug, not the WP `link` field', async () => {
  // WP draft `link` is a preview URL like ?p=123. Tests pin that we use
  // the slug-built URL instead so verification checks the right page.
  globalThis.__createDraftPost = async () => ({ id: 42, slug: 'best-widgets', link: 'https://blog.test/?p=42' });
  const out = await mod.pushContentToWordPress(CLIENT, { payload: { html: '# x' } });
  eq(out.link, 'https://blog.test/best-widgets/');
});

await t('pushContentToWordPress: returns admin_url + slug + post id', async () => {
  globalThis.__createDraftPost = async () => ({ id: 42, slug: 'best-widgets' });
  const out = await mod.pushContentToWordPress(CLIENT, { payload: { html: '# x' } });
  eq(out.admin_url, 'https://blog.test/wp-admin/post.php?post=42&action=edit');
  eq(out.wp_id, 42);
  eq(out.wp_slug, 'best-widgets');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
