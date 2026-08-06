// Publishing profile — per-client CMS settings with safe defaults.
// An empty profile must behave exactly like pre-profile behavior.

import { getPublishingProfile, PROFILE_DEFAULTS } from '../src/modules/cms/publishingProfile.js';
import { parseArticleBody } from '../src/modules/cms/parseArticle.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

await t('missing profile → all defaults', () => {
  const p = getPublishingProfile({ name: 'X' });
  assertEq(p.strip_leading_h1, true);
  assertEq(p.hero_mode, 'featured-only');
  assertEq(p.post_type_rest_base, 'posts');
  assertEq(p.default_category_id, null);
});

await t('null client is safe', () => {
  const p = getPublishingProfile(null);
  assertEq(p.strip_leading_h1, true);
});

await t('overrides win, unset keys keep defaults', () => {
  const p = getPublishingProfile({ publishing_profile: { hero_mode: 'inline-only', default_category_id: 7 } });
  assertEq(p.hero_mode, 'inline-only');
  assertEq(p.default_category_id, 7);
  assertEq(p.strip_leading_h1, true, 'untouched default');
  assertEq(p.post_type_rest_base, 'posts', 'untouched default');
});

await t('JSON-string profile parsed', () => {
  const p = getPublishingProfile({ publishing_profile: '{"post_type_rest_base":"news"}' });
  assertEq(p.post_type_rest_base, 'news');
});

await t('garbage profile values fall back to defaults', () => {
  assertEq(getPublishingProfile({ publishing_profile: 'not json' }).hero_mode, 'featured-only');
  assertEq(getPublishingProfile({ publishing_profile: [1, 2] }).hero_mode, 'featured-only');
});

await t('parseArticleBody stripH1:false keeps H1 in body but still extracts title', () => {
  const p = parseArticleBody('# Kept Title\n\nBody.', { stripH1: false });
  assertEq(p.articleTitle, 'Kept Title');
  if (!/# Kept Title/.test(p.body)) throw new Error('H1 should remain in body');
});

await t('every PROFILE_DEFAULTS key survives the merge', () => {
  const p = getPublishingProfile({ publishing_profile: {} });
  for (const k of Object.keys(PROFILE_DEFAULTS)) {
    if (!(k in p)) throw new Error('missing key ' + k);
  }
});

console.log(`\npublishingProfile: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
