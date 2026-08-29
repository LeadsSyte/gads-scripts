// Post-push verification checks. These run against what actually landed
// in the client's CMS, so a reviewer never opens a silently broken draft.

import { checkDraftContent } from '../src/modules/cms/verifyDraft.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function finding(res, name) {
  const f = res.findings.find(x => x.name === name);
  if (!f) throw new Error('no finding named ' + name + ' (have: ' + res.findings.map(x => x.name).join(', ') + ')');
  return f;
}

const GOOD_BODY = `<p>${'Widgets have been part of South African manufacturing for decades. '.repeat(3)}</p>
<h2>Choosing a widget</h2>
<p>There are three things to weigh up before buying.</p>
<ul><li>Price</li><li>Durability</li></ul>`;

await t('clean draft verifies', () => {
  const r = checkDraftContent({
    html: GOOD_BODY,
    profile: { strip_leading_h1: true, hero_mode: 'featured-only' },
    hasFeaturedImage: true,
    metaTitle: 'Widgets Guide | Acme',
    metaDesc: 'Everything about widgets.'
  });
  assertEq(r.level, 'verified', 'level');
  assertEq(r.ok, true);
  assertEq(r.problems.length, 0, 'problems');
});

await t('leftover H1 in body is an error (double title)', () => {
  const r = checkDraftContent({
    html: '<h1>Widgets Guide</h1>' + GOOD_BODY,
    profile: { strip_leading_h1: true, hero_mode: 'none' },
    metaTitle: 'x', metaDesc: 'y'
  });
  assertEq(r.level, 'failed');
  assertEq(finding(r, 'No duplicate title').ok, false);
});

await t('client configured to keep its H1 wants exactly one', () => {
  const keep = { strip_leading_h1: false, hero_mode: 'none' };
  const withH1 = checkDraftContent({ html: '<h1>T</h1>' + GOOD_BODY, profile: keep, metaTitle: 'x', metaDesc: 'y' });
  assertEq(finding(withH1, 'Heading structure').ok, true, 'one h1 ok');
  const without = checkDraftContent({ html: GOOD_BODY, profile: keep, metaTitle: 'x', metaDesc: 'y' });
  assertEq(finding(without, 'Heading structure').ok, false, 'missing h1 flagged');
  assertEq(without.level, 'warnings', 'missing h1 is only a warning');
});

await t('raw markdown artifacts are errors', () => {
  const cases = [
    ['## Choosing a widget\n\n' + GOOD_BODY, 'heading markers'],
    ['<p>This is **important** stuff.</p>' + GOOD_BODY, 'bold markers'],
    ['```html\n<p>x</p>\n```' + GOOD_BODY, 'code fences'],
    ['<p>See [our guide](https://example.com/guide) for more.</p>' + GOOD_BODY, 'markdown links']
  ];
  for (const [html, label] of cases) {
    const r = checkDraftContent({ html, profile: { hero_mode: 'none' }, metaTitle: 'x', metaDesc: 'y' });
    assertEq(r.level, 'failed', label + ' -> failed');
    assertEq(finding(r, 'No raw markdown').ok, false, label);
  }
});

await t('double-escaped HTML is an error', () => {
  const r = checkDraftContent({
    html: '&lt;p&gt;Widgets have been part of South African manufacturing for decades and remain popular today.&lt;/p&gt;',
    profile: { hero_mode: 'none' }, metaTitle: 'x', metaDesc: 'y'
  });
  assertEq(finding(r, 'HTML not escaped').ok, false);
  assertEq(r.level, 'failed');
});

await t('empty or truncated body is an error', () => {
  assertEq(checkDraftContent({ html: '', profile: {} }).level, 'failed', 'empty');
  assertEq(finding(checkDraftContent({ html: '<p>Too short.</p>', profile: {} }), 'Content present').ok, false, 'short');
});

await t('hero image checked per configured placement', () => {
  const inlineOnly = { strip_leading_h1: true, hero_mode: 'inline-only' };
  assertEq(finding(checkDraftContent({ html: GOOD_BODY, profile: inlineOnly, metaTitle: 'x', metaDesc: 'y' }), 'Hero image').ok, false, 'inline missing');
  assertEq(finding(checkDraftContent({ html: '<img src="/a.png"/>' + GOOD_BODY, profile: inlineOnly, metaTitle: 'x', metaDesc: 'y' }), 'Hero image').ok, true, 'inline present');

  const featured = { strip_leading_h1: true, hero_mode: 'featured-only' };
  assertEq(finding(checkDraftContent({ html: GOOD_BODY, profile: featured, hasFeaturedImage: false, metaTitle: 'x', metaDesc: 'y' }), 'Hero image').ok, false, 'featured missing');

  const both = { strip_leading_h1: true, hero_mode: 'both' };
  assertEq(finding(checkDraftContent({ html: '<img src="/a.png"/>' + GOOD_BODY, profile: both, hasFeaturedImage: true, metaTitle: 'x', metaDesc: 'y' }), 'Hero image').ok, true, 'both present');
  assertEq(finding(checkDraftContent({ html: GOOD_BODY, profile: both, hasFeaturedImage: true, metaTitle: 'x', metaDesc: 'y' }), 'Hero image').ok, false, 'both, inline missing');
});

await t('hero_mode none skips the image check entirely', () => {
  const r = checkDraftContent({ html: GOOD_BODY, profile: { strip_leading_h1: true, hero_mode: 'none' }, metaTitle: 'x', metaDesc: 'y' });
  if (r.findings.some(f => f.name === 'Hero image')) throw new Error('should not check hero image');
  assertEq(r.level, 'verified');
});

await t('missing SEO fields warn but do not fail', () => {
  const r = checkDraftContent({ html: GOOD_BODY, profile: { strip_leading_h1: true, hero_mode: 'none' } });
  assertEq(r.level, 'warnings');
  assertEq(finding(r, 'SEO title').ok, false);
  assertEq(finding(r, 'SEO description').ok, false);
  if (r.problems.length < 2) throw new Error('problems should list both');
});

await t('missing subheadings warn', () => {
  const r = checkDraftContent({
    html: '<p>' + 'Widgets have been part of South African manufacturing for decades. '.repeat(3) + '</p>',
    profile: { strip_leading_h1: true, hero_mode: 'none' }, metaTitle: 'x', metaDesc: 'y'
  });
  assertEq(finding(r, 'Subheadings present').ok, false);
  assertEq(r.level, 'warnings');
});

await t('problems are human-readable strings', () => {
  const r = checkDraftContent({ html: '<h1>T</h1>' + GOOD_BODY, profile: { strip_leading_h1: true, hero_mode: 'none' }, metaTitle: 'x', metaDesc: 'y' });
  if (!r.problems[0] || typeof r.problems[0] !== 'string') throw new Error('expected readable problem strings');
  if (!/appear twice/.test(r.problems.join(' '))) throw new Error('expected the double-title explanation, got: ' + r.problems.join(' | '));
});

await t('no input is safe', () => {
  const r = checkDraftContent();
  assertEq(r.level, 'failed');
  if (!Array.isArray(r.findings)) throw new Error('findings should be an array');
});

console.log(`\nverifyDraft: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
