// Applying Technical SEO fixes on WordPress: only SEO title / description
// and image alt text, only what the preview showed, and read back after.

import { parseFixValues, planFix, applyPlan, checkLive, resolveWpObject } from '../netlify/functions/lib/techFix.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

// A small fake WordPress: one post with Yoast registered, one media item.
function fakeWp({ yoast = true } = {}) {
  const post = { id: 7, link: 'https://www.krost.example/mezzanine-floors-benefits-warehouse/', title: { raw: 'Mezzanine Floors' },
    meta: yoast ? { _yoast_wpseo_title: 'Mezzanine Floors Benefits –', _yoast_wpseo_metadesc: '' } : { footnotes: '' } };
  const media = { id: 55, source_url: 'https://www.krost.example/wp-content/uploads/2026/01/long-shelves.jpg', alt_text: '',
    media_details: { sizes: { large: { source_url: 'https://www.krost.example/wp-content/uploads/2026/01/long-shelves-1024x512.jpg' } } } };
  const writes = [];
  const wp = async (path, body) => {
    if (body) {
      writes.push({ path, body });
      if (path.startsWith('wp/v2/media/55')) media.alt_text = body.alt_text;
      if (path.startsWith('wp/v2/posts/7') && yoast) Object.assign(post.meta, body.meta);
      return {};
    }
    if (path.startsWith('wp/v2/pages?slug=')) return [];
    if (path.startsWith('wp/v2/posts?slug=mezzanine-floors-benefits-warehouse')) return [post];
    if (path.startsWith('wp/v2/posts?slug=')) return [];
    if (path.startsWith('wp/v2/posts/7')) return { meta: post.meta };
    if (path.startsWith('wp/v2/media?search=long-shelves')) return [media];
    if (path.startsWith('wp/v2/media?search=')) return [];
    if (path.startsWith('wp/v2/media/55')) return { alt_text: media.alt_text };
    throw new Error('unexpected ' + path);
  };
  return { wp, writes, post, media };
}

const TITLE_TASK = { fix_type: 'meta_title', page_url: 'https://krost.example/mezzanine-floors-benefits-warehouse/',
  copy_paste_fix: '<title>Mezzanine Floor Benefits for Warehouses | Krost Shelving</title>' };

await t('reads the new value out of the fix in the shapes triage writes', () => {
  assertEq(parseFixValues(TITLE_TASK).value, 'Mezzanine Floor Benefits for Warehouses | Krost Shelving');
  assertEq(parseFixValues({ fix_type: 'meta_description', copy_paste_fix: '<meta name="description" content="Learn how a mezzanine floor doubles warehouse space without moving premises.">' }).value,
    'Learn how a mezzanine floor doubles warehouse space without moving premises.');
  assertEq(parseFixValues({ fix_type: 'meta_title', copy_paste_fix: '<title>[PAGE NAME] | Brand</title>' }), null, 'placeholder refused');
  const imgs = parseFixValues({ fix_type: 'image_alt', copy_paste_fix: 'Image 1: <img src="https://www.krost.example/wp-content/uploads/2026/01/long-shelves-1024x512.jpg" alt="Long warehouse shelves stacked with boxes">' }).images;
  assertEq(imgs.length, 1); assertEq(imgs[0].alt, 'Long warehouse shelves stacked with boxes');
});

await t('preview shows current → new on the right post, matched by its full URL', async () => {
  const { wp, writes } = fakeWp();
  const plan = await planFix(TITLE_TASK, wp);
  assertEq(plan.applicable, true);
  assertEq(plan.changes[0].from, 'Mezzanine Floors Benefits –');
  assertEq(plan.changes[0].to, 'Mezzanine Floor Benefits for Warehouses | Krost Shelving');
  assertEq(plan.changes[0].fields.join(), '_yoast_wpseo_title', 'only fields the site exposes');
  assertEq(writes.length, 0, 'a preview writes nothing');
});

await t('apply writes only the previewed field and reads it back', async () => {
  const { wp, writes, post } = fakeWp();
  const plan = await planFix(TITLE_TASK, wp);
  const results = await applyPlan(plan, wp);
  assertEq(results[0].ok, true);
  assertEq(writes.length, 1);
  assertEq(JSON.stringify(writes[0].body), JSON.stringify({ meta: { _yoast_wpseo_title: 'Mezzanine Floor Benefits for Warehouses | Krost Shelving' } }));
  assertEq(post.meta._yoast_wpseo_metadesc, '', 'description untouched');
});

await t('a site that hides the SEO fields is left for a person, with the reason', async () => {
  const { wp } = fakeWp({ yoast: false });
  const plan = await planFix(TITLE_TASK, wp);
  assertEq(plan.applicable, false);
  if (!/PHP snippet/.test(plan.reason)) throw new Error(plan.reason);
});

await t('image alt text is set on the media item found from a resized image URL', async () => {
  const { wp, media } = fakeWp();
  const task = { fix_type: 'image_alt', page_url: 'https://krost.example/news/', copy_paste_fix: '<img src="https://www.krost.example/wp-content/uploads/2026/01/long-shelves-1024x512.jpg" alt="Long warehouse shelves">' };
  const plan = await planFix(task, wp);
  assertEq(plan.applicable, true); assertEq(plan.changes[0].target.id, 55);
  const results = await applyPlan(plan, wp);
  assertEq(results[0].ok, true); assertEq(media.alt_text, 'Long warehouse shelves');
});

await t('theme / template / redirect fixes are never applied automatically', async () => {
  const { wp, writes } = fakeWp();
  for (const fix_type of ['h1', 'robots', 'redirect', 'schema', 'canonical']) {
    const plan = await planFix({ fix_type, page_url: TITLE_TASK.page_url, copy_paste_fix: 'x' }, wp);
    assertEq(plan.applicable, false, fix_type);
  }
  assertEq(writes.length, 0);
  assertEq(await resolveWpObject(wp, 'https://krost.example/'), null, 'homepage is not guessed');
});

await t('live check: verified when visible, pending (not failed) when the cache lags', () => {
  const ok = [{ ok: true, kind: 'meta_title', to: 'Mezzanine Floor Benefits for Warehouses | Krost Shelving' }];
  assertEq(checkLive('<title>Mezzanine Floor Benefits for Warehouses | Krost Shelving</title>', ok).status, 'verified');
  assertEq(checkLive('<title>Old title</title>', ok).status, 'pending');
  assertEq(checkLive('', ok).status, 'pending');
});

console.log(`\ntechFix: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
