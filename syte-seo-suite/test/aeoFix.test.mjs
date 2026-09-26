// Adding AEO optimisations to WordPress pages: only safe additions, only on
// pages whose visible content is the post content, previewable, reversible.

import { planInsertion, contentIsRendered, wrapInsertion, removeInsertion, hasInsertion, planAeoFix, applyAeoFix, undoAeoFix, aeoLiveCheck, fixKey } from '../netlify/functions/lib/aeoFix.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

const RAW = '<!-- wp:paragraph -->\n<p>A first allergy appointment usually starts with a detailed conversation about your symptoms and history.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>Skin prick tests are quick, and results are usually ready within twenty minutes of the test being done.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>Your allergist will then explain the results and agree a management plan that suits your daily life.</p>\n<!-- /wp:paragraph -->';
const RENDERED = RAW.replace(/<!--[^>]*-->\n?/g, '');
const LIVE = '<html><body><header>Allergy Facts</header><h1>First appointment</h1><div class="post-content">' + RENDERED + '</div></body></html>';
const FAQ = { type: 'content', name: 'FAQ Content Section — first appointment questions', where: 'After the main content',
  implementation: '<h2>Frequently asked questions</h2><h3>How long does a first appointment take?</h3><p>Usually about an hour, including testing and discussion.</p>' };
const ANSWER = { type: 'content', name: 'Answer Block — direct answer after H1', where: 'Directly after the H1',
  implementation: '<p><strong>A first allergy appointment</strong> is a consultation with an allergist that covers your history, testing and a management plan.</p>' };
const SCHEMA = { type: 'schema', name: 'FAQPage schema', where: 'In the page',
  implementation: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script>' };

function fakeWp() {
  const post = { raw: RAW };
  const writes = [];
  const wp = async (path, body) => {
    if (body) { writes.push(body); post.raw = body.content; return {}; }
    if (path.startsWith('wp/v2/pages?slug=')) return [];
    if (path.startsWith('wp/v2/posts?slug=your-first-allergy-appointment')) return [{ id: 7, link: 'https://af.example/your-first-allergy-appointment/', meta: {} }];
    if (path.startsWith('wp/v2/posts?slug=')) return [];
    if (path.startsWith('wp/v2/posts/7')) return { content: { raw: post.raw, rendered: post.raw.replace(/<!--[^>]*-->\n?/g, '') } };
    throw new Error('unexpected ' + path);
  };
  return { wp, writes, post };
}
const URL_ = 'https://af.example/your-first-allergy-appointment/';

await t('placement: answers/summaries at the top, FAQs and the rest at the end, schema at the end', () => {
  assertEq(planInsertion(ANSWER).position, 'top');
  assertEq(planInsertion(FAQ).position, 'end');
  const s = planInsertion(SCHEMA);
  assertEq(s.ok, true); assertEq(s.position, 'end');
  if (!/^<script type="application\/ld\+json">\{"@context"/.test(s.html)) throw new Error('schema not normalised');
});

await t('refuses placeholders, invalid schema and edits to existing content', () => {
  assertEq(planInsertion({ ...FAQ, implementation: '<p>Call [PHONE NUMBER] today to book your appointment with us.</p>' }).ok, false);
  assertEq(planInsertion({ ...SCHEMA, implementation: '<script type="application/ld+json">{"@type": "FAQPage",}</script>' }).ok, false);
  assertEq(planInsertion({ type: 'structure', name: 'Heading hierarchy fix', implementation: '<h2>x</h2>'.repeat(10) }).ok, false);
  assertEq(planInsertion({ ...FAQ, where: 'Replace the existing FAQ section' }).ok, false);
  if (/<script>alert/.test(planInsertion({ ...FAQ, implementation: FAQ.implementation + '<script>alert(1)</script>' }).html)) throw new Error('script kept');
});

await t('only pages whose visible content is the post content qualify (not page-builder pages)', () => {
  assertEq(contentIsRendered(RENDERED, LIVE), true);
  assertEq(contentIsRendered(RENDERED, '<html><body><div class="elementor">Totally different builder content on this page.</div></body></html>'), false);
});

await t('preview → apply adds one marked Custom HTML block at the right place; undo removes exactly it', async () => {
  const { wp, writes, post } = fakeWp();
  const optKey = 'content::' + FAQ.name;
  const plan = await planAeoFix({ url: URL_, opt: FAQ, optKey }, wp, async () => LIVE);
  assertEq(plan.applicable, true);
  assertEq(writes.length, 0, 'preview writes nothing');
  if (!plan.renderedPreview.endsWith(FAQ.implementation)) throw new Error('preview content wrong');
  const r = await applyAeoFix(plan, wp);
  assertEq(r.ok, true);
  if (!post.raw.startsWith(RAW)) throw new Error('existing content changed');
  if (!/<!-- wp:html -->\n<!-- syte-aeo:[a-z0-9]+ -->\n<h2>Frequently asked questions/.test(post.raw)) throw new Error('not wrapped: ' + post.raw.slice(-200));
  const again = await planAeoFix({ url: URL_, opt: FAQ, optKey }, wp, async () => LIVE);
  assertEq(again.applicable, false, 'cannot be added twice');
  const u = await undoAeoFix(plan, wp);
  assertEq(u.ok, true);
  assertEq(post.raw, RAW, 'page back exactly as it was');
});

await t('apply refuses if the page was edited after the preview', async () => {
  const { wp, post } = fakeWp();
  const plan = await planAeoFix({ url: URL_, opt: ANSWER, optKey: 'content::a' }, wp, async () => LIVE);
  post.raw = post.raw + '\n<p>Someone edited this.</p>';
  const r = await applyAeoFix(plan, wp);
  assertEq(r.ok, false); assertEq(r.changed, true);
});

await t('marker helpers and live check', () => {
  const k = fixKey(URL_, 'content::x');
  const raw = 'A' + '\n\n' + wrapInsertion(k, '<p>New</p>', '<!-- wp:paragraph -->');
  assertEq(hasInsertion(raw, k), true);
  assertEq(removeInsertion(raw, k), 'A');
  assertEq(aeoLiveCheck('<p>New section text that is now on the page</p>', { html: '<p>New section text that is now on the page</p>' }).status, 'verified');
  assertEq(aeoLiveCheck('<p>old</p>', { html: '<p>New section text</p>' }).status, 'pending');
});

console.log(`\naeoFix: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
