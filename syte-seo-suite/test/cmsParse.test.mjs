// parseArticleBody + slugifyTitle — the formatting layer of CMS pushes.
// The H1 extraction here is what prevents the "double title" bug where a
// theme renders the post title AND the body's own <h1>.

import { parseArticleBody, slugifyTitle } from '../src/modules/cms/parseArticle.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function assertMatch(s, re, label) {
  if (!re.test(s || '')) throw new Error((label || '') + ' "' + s + '" did not match ' + re);
}
function assertNotMatch(s, re, label) {
  if (re.test(s || '')) throw new Error((label || '') + ' "' + s + '" unexpectedly matched ' + re);
}

const MD_ARTICLE = `# The Complete Guide to Widgets

Widgets are great.

## Why widgets

Because reasons.

**Meta Title:** Widgets Guide | Acme

**Meta Description:** Everything about widgets.`;

await t('markdown H1 becomes articleTitle and leaves the body', () => {
  const p = parseArticleBody(MD_ARTICLE);
  assertEq(p.articleTitle, 'The Complete Guide to Widgets', 'articleTitle');
  assertNotMatch(p.body, /The Complete Guide to Widgets/, 'body no H1');
  assertMatch(p.body, /## Why widgets/, 'H2 kept');
});

await t('meta title/desc parsed and separated from body', () => {
  const p = parseArticleBody(MD_ARTICLE);
  assertEq(p.metaTitle, 'Widgets Guide | Acme', 'metaTitle');
  assertEq(p.metaDesc, 'Everything about widgets.', 'metaDesc');
  assertNotMatch(p.body, /Meta Title/i, 'meta stripped from body');
});

await t('html H1 extracted too', () => {
  const p = parseArticleBody('<h1>Hello World</h1>\n<p>Body text.</p>');
  assertEq(p.articleTitle, 'Hello World');
  assertNotMatch(p.body, /<h1/i);
  assertMatch(p.body, /Body text/);
});

await t('H1 mid-document is NOT treated as the title', () => {
  const p = parseArticleBody('Intro paragraph first.\n\n# Late Heading\n\nMore.');
  assertEq(p.articleTitle, '', 'no articleTitle');
  assertMatch(p.body, /# Late Heading/, 'body keeps it');
});

await t('code fences stripped', () => {
  const p = parseArticleBody('```html\n# Fenced Title\n\nContent here.\n```');
  assertEq(p.articleTitle, 'Fenced Title');
  assertMatch(p.body, /Content here/);
  assertNotMatch(p.body, /```/);
});

await t('empty input safe', () => {
  const p = parseArticleBody('');
  assertEq(p.body, ''); assertEq(p.articleTitle, ''); assertEq(p.metaTitle, '');
});

await t('slugifyTitle matches WP-style slugs', () => {
  assertEq(slugifyTitle('The Complete Guide to Widgets'), 'the-complete-guide-to-widgets');
  assertEq(slugifyTitle("What's New: SEO & AEO in 2026!"), 'whats-new-seo-aeo-in-2026');
  assertEq(slugifyTitle('  Spaced   Out — Title  '), 'spaced-out-title');
  assertEq(slugifyTitle(''), '');
});

console.log(`\ncmsParse: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
