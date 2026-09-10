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

// Real shape from a Kruger Gate Hotel article: metadata at the TOP, above a
// --- rule. The old parser cut "everything before Meta Title" — which was
// nothing — so the client's draft opened with the words "Meta Title:".
const META_FIRST = `**Meta Title:** Paul Kruger Gate: Times, Location & Tips | Kruger Gate Hotel

**Meta Description:** Opening times, exact location and visitor tips for 2026.

---

# Paul Kruger Gate: Opening Times and Location

The gate opens at sunrise throughout the year.

## Getting there

Follow the R536 from Hazyview.`;

await t('metadata at the TOP never reaches the article body', () => {
  const p = parseArticleBody(META_FIRST);
  assertNotMatch(p.body, /Meta Title/i, 'no meta title in body');
  assertNotMatch(p.body, /Meta Description/i, 'no meta desc in body');
  assertEq(p.metaTitle, 'Paul Kruger Gate: Times, Location & Tips | Kruger Gate Hotel', 'metaTitle still parsed');
  assertEq(p.metaDesc, 'Opening times, exact location and visitor tips for 2026.', 'metaDesc still parsed');
});

await t('H1 is still found when metadata sat above it', () => {
  const p = parseArticleBody(META_FIRST);
  assertEq(p.articleTitle, 'Paul Kruger Gate: Opening Times and Location', 'articleTitle');
  assertNotMatch(p.body, /Paul Kruger Gate: Opening Times and Location/, 'H1 removed from body');
  assertMatch(p.body, /## Getting there/, 'rest of article intact');
});

await t('the --- rule left by the metadata block is dropped', () => {
  const p = parseArticleBody(META_FIRST);
  if (/^\s*---/.test(p.body)) throw new Error('body still starts with a separator: ' + p.body.slice(0, 40));
});

await t('the QA scoring block never reaches the body, even unterminated', () => {
  // Real shape: the article ends with a fenced JSON quality score. The
  // trailing fence gets trimmed early, so the block must still be removed
  // without one — this reached a live client draft.
  const withQa = `# Real Title

${'Genuine article content that is long enough to pass. '.repeat(4)}

---

\`\`\`json
{
  "keyword_integration": 9,
  "overall": 91,
  "suggestions": ["add a stat"]
}`;
  const p = parseArticleBody(withQa);
  assertNotMatch(p.body, /keyword_integration|overall|suggestions/i, 'QA block stripped');
  assertNotMatch(p.body, /\bjson\b/i, 'no orphaned "json" word left');
  assertMatch(p.body, /Genuine article content/, 'real content kept');
});

await t('JSON-LD schema blocks never reach the body', () => {
  const withSchema = '# Title\n\nReal content here that is long enough.\n\n```json\n{"@type":"FAQPage"}\n```';
  const p = parseArticleBody(withSchema);
  assertNotMatch(p.body, /FAQPage|@type/, 'schema stripped');
});

await t('slugifyTitle matches WP-style slugs', () => {
  assertEq(slugifyTitle('The Complete Guide to Widgets'), 'the-complete-guide-to-widgets');
  assertEq(slugifyTitle("What's New: SEO & AEO in 2026!"), 'whats-new-seo-aeo-in-2026');
  assertEq(slugifyTitle('  Spaced   Out — Title  '), 'spaced-out-title');
  assertEq(slugifyTitle(''), '');
});

// The generator labels its opening answer paragraph for the writer. The label
// reached client drafts on 8 of 9 pushes; the sentence after it must survive.
await t('strips the "AEO Summary Block:" label and keeps the answer', () => {
  const raw = '# Choosing Drawers\n\n**AEO Summary Block:** The right chest of drawers balances size and storage.\n\n## Measure first\n\nText.';
  const { body, articleTitle } = parseArticleBody(raw);
  assertEq(articleTitle, 'Choosing Drawers');
  assertNotMatch(body, /AEO Summary/i, 'label');
  assertMatch(body, /^The right chest of drawers balances size and storage\./, 'answer paragraph kept, now first');
});

await t('strips the label in the other shapes it comes in', () => {
  for (const line of ['AEO Summary Block: Answer.', '**AEO Summary Block**: Answer.', '**AEO Summary:** Answer.', 'Answer Block: Answer.']) {
    const { body } = parseArticleBody('# T\n\n' + line + '\n\nMore.');
    assertMatch(body, /^Answer\./, JSON.stringify(line));
  }
  const quoted = parseArticleBody('# T\n\n> **AEO Summary Block:** Answer.\n\nMore.').body;
  assertMatch(quoted, /^> Answer\./, 'blockquote form keeps the quote, loses the label');
  const heading = parseArticleBody('# T\n\n## AEO Summary Block\n\nAnswer.\n\nMore.').body;
  assertNotMatch(heading, /AEO Summary/i, 'heading form');
  const html = parseArticleBody('<h1>T</h1><p><strong>AEO Summary Block:</strong> Answer.</p>').body;
  assertEq(html, '<p>Answer.</p>', 'HTML form');
});

// A prompt version that marked sections with HTML comments: the comment put
// the metadata at index 20 instead of 0, and the parser kept only the comment.
await t('an article whose metadata sits under HTML comment markers is kept whole', () => {
  const raw = '<!-- META TITLE -->\n**Meta Title:** Retail Shops in Containers | FS\n*(52 chars — within 50–58 ✅)*\n\n'
    + '<!-- META DESCRIPTION -->\n**Meta Description:** Containers are reshaping retail.\n*(152 chars ✅)*\n\n---\n\n'
    + '# Containers Are Redefining Retail\n\n> **AEO Summary Block:** Open-side containers are affordable shops.\n\n---\n\n'
    + '## Why Retailers Are Turning to Containers\n\n' + 'Rent is high. '.repeat(40)
    + '\n\n```json\n{ "overall": 88, "suggestions": ["x"] }\n```';
  const { body, articleTitle, metaTitle, metaDesc } = parseArticleBody(raw);
  assertEq(articleTitle, 'Containers Are Redefining Retail');
  assertEq(metaTitle, 'Retail Shops in Containers | FS');
  assertEq(metaDesc, 'Containers are reshaping retail.');
  assertMatch(body, /## Why Retailers Are Turning to Containers/, 'article body kept');
  assertMatch(body, /^> Open-side containers are affordable shops\./, 'answer first, label gone');
  assertNotMatch(body, /<!--|Meta Title|Meta Description|chars — within|152 chars|"overall"/, 'no markers, meta, length notes or QA');
});

await t('metadata trailing the article is still cut off', () => {
  const raw = '# Title\n\n' + 'Real article text. '.repeat(60) + '\n\n**Meta Title:** T\n**Meta Description:** D\n\nSchema notes that must not ship.';
  const { body, metaTitle } = parseArticleBody(raw);
  assertEq(metaTitle, 'T');
  assertNotMatch(body, /Schema notes|Meta Title/, 'trailing block removed');
  assertMatch(body, /Real article text\./, 'article kept');
});

await t('leaves a sentence that merely mentions the phrase alone', () => {
  const { body } = parseArticleBody('# T\n\nWe add an AEO Summary Block: it helps AI engines quote you.');
  assertMatch(body, /We add an AEO Summary Block: it helps/, 'mid-sentence mention kept');
});

console.log(`\ncmsParse: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
