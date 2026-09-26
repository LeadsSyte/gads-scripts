// In-theme preview: our article inside one of the client's published posts.

import { buildThemePreview, pickTemplate } from '../src/modules/cms/themePreview.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

const BODY = '<p class="wp-block-paragraph">If you have finally booked an appointment with an allergist, that is a big step.</p>';
const PAGE = `<html><head><title>What to Expect at Your First Allergy Appointment</title></head><body>
<header>Allergy Facts</header>
<div class="hero" style="background-image:url(https://a.example/wp-content/uploads/doctor-1024x576.jpg)">
<h1>What to Expect at Your First Allergy Appointment</h1></div>
<div class="elementor-widget-raven-post-content">${BODY}</div>
<img src="https://a.example/wp-content/uploads/doctor.jpg"></body></html>`;

await t('swaps body, every title occurrence and the hero image (incl. resized copies)', () => {
  const r = buildThemePreview({
    pageHtml: PAGE, templateContent: BODY, templateTitle: 'What to Expect at Your First Allergy Appointment',
    draftContent: '<h2>What Is Asthma?</h2><p>Wheezing.</p>', draftTitle: 'Asthma Symptoms & Triggers',
    templateImage: 'https://a.example/wp-content/uploads/doctor.jpg', draftImage: 'https://a.example/wp-content/uploads/asthma.png',
    pageUrl: 'https://a.example/first-appointment/'
  });
  assertEq(r.ok, true);
  if (r.html.includes('booked an appointment')) throw new Error('old body left');
  if (!r.html.includes('<h2>What Is Asthma?</h2>')) throw new Error('draft body missing');
  assertEq(r.titleSwaps, 2);
  if (!r.html.includes('<h1>Asthma Symptoms &amp; Triggers</h1>')) throw new Error('title not swapped/escaped');
  assertEq(r.imageSwaps, 2, 'full size and 1024x576 copy');
  if (/doctor/.test(r.html)) throw new Error('old image left');
  if (!r.html.includes('<base href="https://a.example/first-appointment/">')) throw new Error('base missing');
  if (!/noindex/.test(r.html)) throw new Error('noindex missing');
  if (!/Syte draft preview/.test(r.html)) throw new Error('banner missing');
});

await t('refuses when the body cannot be located (never shows the old article as ours)', () => {
  const r = buildThemePreview({ pageHtml: PAGE, templateContent: '<p>Something else entirely that is long enough.</p>', templateTitle: 'x', draftContent: 'y', draftTitle: 'z' });
  assertEq(r.ok, false);
});

await t('picks the first candidate whose body is really on its page', async () => {
  const pages = { 'https://a/1': '<html>other</html>', 'https://a/2': PAGE };
  const t2 = await pickTemplate([
    { link: 'https://a/1', content: BODY }, { link: 'https://a/2', content: BODY }
  ], async (u) => pages[u]);
  assertEq(t2.link, 'https://a/2');
  assertEq(await pickTemplate([{ link: 'https://a/1', content: BODY }], async () => { throw new Error('403'); }), null);
});

await t('links minted in the suite are accepted by the server, and nothing else is', async () => {
  globalThis.__SYTE_PROXY_AUTH = 'gate-value';
  globalThis.__SYTE_FN_BASE = 'https://suite.example';
  const { themePreviewUrl } = await import('../src/modules/cms/previewLink.js');
  const { previewSig, previewUrl } = await import('../netlify/functions/lib/previewSig.js');
  const url = await themePreviewUrl('a', 'blog-123');
  const sig = new URL(url).searchParams.get('sig');
  assertEq(sig, previewSig('a', 'blog-123', 'gate-value'), 'browser and server HMAC agree');
  if (sig === previewSig('q', 'blog-123', 'gate-value')) throw new Error('kind must be part of the signature');
  assertEq(url.startsWith('https://suite.example/.netlify/functions/draft-preview?a=blog-123&sig='), true);
  assertEq(previewUrl('q', 'x', { base: 'https://s.example/', key: '' }), '', 'no key, no link');
});

await t('the run summary email carries preview links for ready and held-back articles', async () => {
  const { buildRunSummaryEmail } = await import('../netlify/functions/lib/reportEmail.js');
  const state = { month: '2026-10', status: 'done', plan: [{ topic_title: 'A' }, { topic_title: 'B' }, { topic_title: 'C' }],
    articles: { 0: { status: 'ready', blog_id: 'b0' }, 1: { status: 'blocked', blog_id: 'b1' }, 2: { status: 'failed', error: 'x' } } };
  const { html } = buildRunSummaryEmail({ name: 'X' }, state, 'u', a => 'https://p.example/' + a.blog_id);
  if (!html.includes('https://p.example/b0') || !html.includes('https://p.example/b1')) throw new Error('links missing');
  if (html.includes('p.example/undefined')) throw new Error('failed article got a link');
});

console.log(`\nthemePreview: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
