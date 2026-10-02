// The screenshot-based look at a live page: PageSpeed takes the picture, an
// AI with vision judges it. Both are faked here.

import { takeScreenshot, judgePage, visualCheck, normalizeVisual, visualCheckAvailable } from '../netlify/functions/lib/visualCheck.js';
import { referencePostUrl } from '../netlify/functions/visual-check-background.js';
import { runAeoFix, aeoOptKey } from '../netlify/functions/lib/aeoFixRun.js';
import { buildAeoSummaryEmail, buildVisualProblemEmail } from '../netlify/functions/lib/reportEmail.js';
import { fixKey } from '../netlify/functions/lib/aeoFix.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
const eq = (a, b, label) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const has = (s, re, label) => { if (!re.test(s)) throw new Error((label || '') + ' missing ' + re); };

const psi = (over = {}) => ({ lighthouseResult: { audits: { 'final-screenshot': { details: { data: 'data:image/jpeg;base64,TOP' } } }, fullPageScreenshot: { screenshot: { data: 'data:image/webp;base64,FULL', width: 1335, height: 6000 } }, ...over } });
const fakeFetch = (answer, seen = []) => async (url) => { seen.push(String(url)); return { status: answer.error ? 400 : 200, json: async () => answer }; };

await t('only available when the PageSpeed key is set', () => {
  eq(visualCheckAvailable({}), false); eq(visualCheckAvailable({ PAGESPEED_API_KEY: ' ' }), false); eq(visualCheckAvailable({ PAGESPEED_API_KEY: 'k' }), true);
});

await t('a screenshot is the top of the page and the whole page; the key never appears in an error', async () => {
  const seen = [];
  const s = await takeScreenshot('https://k.example/post/', { key: 'SECRETKEY', fetch: fakeFetch(psi(), seen) });
  eq([s.ok, s.top.media_type, s.top.data, s.full.media_type, s.full.data, s.height], [true, 'image/jpeg', 'TOP', 'image/webp', 'FULL', 6000]);
  has(seen[0], /url=https%3A%2F%2Fk\.example%2Fpost%2F&category=PERFORMANCE&strategy=DESKTOP&key=SECRETKEY/);
  const bad = await takeScreenshot('https://k.example/', { key: 'SECRETKEY', fetch: fakeFetch({ error: { message: 'API key SECRETKEY not valid' } }) });
  eq(bad.ok, false); if (/SECRETKEY/.test(bad.error)) throw new Error('key leaked: ' + bad.error);
  eq((await takeScreenshot('https://k.example/', { key: '', fetch: fakeFetch(psi()) })).ok, false);
  eq((await takeScreenshot('https://k.example/', { key: 'k', fetch: fakeFetch({ lighthouseResult: { audits: {} } }) })).ok, false);
});

await t('the judge is shown both views and the reference, and its answer is read strictly', async () => {
  let sent = null;
  const complete = async (o) => { sent = o; return 'Here you go: {"looks_right": false, "problems": ["The hero image is stretched across the full width."], "summary": "Image problem."}'; };
  const shot = { top: { media_type: 'image/jpeg', data: 'A' }, full: { media_type: 'image/webp', data: 'B' } };
  const v = await judgePage({ url: 'https://k.example/p/', what: 'A new article was published.', shot, reference: { top: { media_type: 'image/jpeg', data: 'R' } }, referenceUrl: 'https://k.example/old/' }, { complete });
  eq(v.ok, false); eq(v.problems, ['The hero image is stretched across the full width.']);
  const images = sent.messages[0].content.filter(c => c.type === 'image').map(c => c.source.data);
  eq(images, ['A', 'B', 'R']); eq(sent.temperature, 0);
  has(sent.system, /DO NOT flag: cookie banners/);
  eq(normalizeVisual({ looks_right: true, problems: [] }).ok, true);
  eq(normalizeVisual({ looks_right: true, problems: ['x'] }).ok, false, 'a listed problem wins');
  eq(normalizeVisual(null).ok, false, 'an unreadable answer is not a pass');
});

await t('visualCheck: ok, problems, and "unchecked" — never a false pass when it could not look', async () => {
  const ok = await visualCheck({ url: 'https://k.example/p/', what: 'x', referenceUrl: 'https://k.example/old/' }, { key: 'k', fetch: fakeFetch(psi()), complete: async () => '{"looks_right": true, "problems": [], "summary": "Fine."}' });
  eq([ok.status, ok.compared_with], ['ok', 'https://k.example/old/']);
  const bad = await visualCheck({ url: 'https://k.example/p/', what: 'x' }, { key: 'k', fetch: fakeFetch(psi()), complete: async () => '{"looks_right": false, "problems": ["Text overlaps the image."]}' });
  eq([bad.status, bad.problems[0]], ['problems', 'Text overlaps the image.']);
  eq((await visualCheck({ url: 'https://k.example/p/', what: 'x' }, { key: '', fetch: fakeFetch(psi()), complete: async () => '{}' })).status, 'unchecked');
  eq((await visualCheck({ url: 'https://k.example/p/', what: 'x' }, { key: 'k', fetch: async () => { throw new Error('timeout'); }, complete: async () => '{}' })).status, 'unchecked');
  eq((await visualCheck({ url: 'https://k.example/p/', what: 'x' }, { key: 'k', fetch: fakeFetch(psi()), complete: async () => { throw new Error('AI down'); } })).status, 'unchecked');
  eq((await visualCheck({ url: '', what: 'x' }, { key: 'k' })).status, 'unchecked');
});

await t('the reference is another published post on the same site, never the new one', async () => {
  const wpRow = { payload: { wp_id: 42, rest_base: 'posts', live_url: 'https://k.example/new/' } };
  const wp = async () => [{ id: 42, link: 'https://k.example/new/' }, { id: 7, link: 'https://k.example/older/' }];
  eq(await referencePostUrl({ cms_type: 'WordPress', wp_url: 'https://k.example', wp_app_password: 'x' }, wpRow, { wp }), 'https://k.example/older/');
  const shRow = { payload: { shopify_article_id: 600, shopify_blog_id: 9, live_url: 'https://bamdiy.com/blogs/news/new-post' } };
  const sh = async () => ({ articles: [{ id: 600, handle: 'new-post' }, { id: 5, handle: 'older-post' }] });
  eq(await referencePostUrl({ cms_type: 'Shopify', shopify_store: 's', shopify_token: 't' }, shRow, { sh }), 'https://bamdiy.com/blogs/news/older-post');
  eq(await referencePostUrl({ cms_type: 'WordPress', wp_url: 'https://k.example', wp_app_password: 'x' }, wpRow, { wp: async () => { throw new Error('401'); } }), '');
});

// ── An AEO section is looked at after it is added ──
const RAW = '<!-- wp:paragraph -->\n<p>A first allergy appointment usually starts with a detailed conversation about your symptoms and history.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>Skin prick tests are quick, and results are usually ready within twenty minutes of the test being done.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>Your allergist will then explain the results and agree a management plan that suits your daily life.</p>\n<!-- /wp:paragraph -->';
const strip = s => s.replace(/<!--[^>]*-->\n?/g, '');
const URL_ = 'https://af.example/your-first-allergy-appointment/';
const FAQ = { type: 'content', name: 'FAQ Content Section', where: 'After the main content', check: { verdict: 'confirmed', reason: 'No FAQ.' },
  implementation: '<h2>Frequently asked questions</h2><h3>How long does a first appointment take?</h3><p>Usually about an hour, including testing and discussion.</p>' };
function site({ cached = false } = {}) {
  const post = { raw: RAW };
  const wp = async (path, body) => {
    if (body) { post.raw = body.content; return {}; }
    if (path.startsWith('wp/v2/pages?slug=')) return [];
    if (path.startsWith('wp/v2/posts?slug=your-first')) return [{ id: 7, link: URL_, meta: {} }];
    if (path.startsWith('wp/v2/posts?slug=')) return [];
    if (path.startsWith('wp/v2/posts/7')) return { content: { raw: post.raw, rendered: strip(post.raw) } };
    throw new Error('unexpected ' + path);
  };
  // A cached page keeps serving the old content.
  const live = async () => '<html><body><h1>First appointment</h1><div>' + strip(cached ? RAW : post.raw) + '</div></body></html>';
  return { wp, live };
}
const deps = (s, over = {}) => ({ wp: s.wp, fetchHtml: s.live, previewUrlFor: k => 'p:' + k, save: async st => st, recordApplied: async () => 'impl', recordUndone: async () => {}, ...over });

await t('after a section is added the page is looked at, and the result is kept with it', async () => {
  let asked = null;
  const s = await runAeoFix({ url: URL_, opt: FAQ, optKey: aeoOptKey(FAQ), action: 'auto' }, deps(site(), { visualCheck: async (a) => { asked = a; return { status: 'problems', problems: ['The new heading is in a different font.'], summary: '' }; } }));
  eq(s.status, 'applied'); eq(s.visual.status, 'problems');
  eq([asked.url, asked.plan.position, asked.opt.name], [URL_, 'end', 'FAQ Content Section']);
});

await t('no look is taken while the live page is still the cached old one; a failed look never undoes the add', async () => {
  let called = 0;
  const cachedRun = await runAeoFix({ url: URL_, opt: FAQ, optKey: aeoOptKey(FAQ), action: 'auto' }, deps(site({ cached: true }), { visualCheck: async () => { called++; return { status: 'ok' }; } }));
  eq([cachedRun.status, cachedRun.live.status, called, cachedRun.visual], ['applied', 'pending', 0, undefined]);
  const crash = await runAeoFix({ url: URL_, opt: FAQ, optKey: aeoOptKey(FAQ), action: 'auto' }, deps(site(), { visualCheck: async () => { throw new Error('boom'); } }));
  eq([crash.status, crash.visual], ['applied', undefined]);
});

await t('emails: a section that may not look right becomes the first thing to do; a clean one says so', () => {
  const state = { status: 'done', rows: [{ url: URL_, optimizations: [FAQ] }] };
  const key = fixKey(URL_, aeoOptKey(FAQ));
  const odd = buildAeoSummaryEmail({ id: 'c', name: 'Allergy Facts' }, state, 'u', { fixes: new Map([[key, { status: 'applied', live: { status: 'verified' }, plan: { position: 'end' }, visual: { status: 'problems', problems: ['The new heading is in a different font.'] } }]]) });
  has(odd.subject, /^Look at this — Allergy Facts: AEO — 1 made on the site \(1 may not look right\)/);
  has(odd.html, /1 added section may not look right on the page/); has(odd.html, /Screenshot check: The new heading is in a different font\./);
  const fine = buildAeoSummaryEmail({ id: 'c', name: 'Allergy Facts' }, state, 'u', { fixes: new Map([[key, { status: 'applied', live: { status: 'verified' }, plan: { position: 'end' }, visual: { status: 'ok' } }]]) });
  eq(fine.subject, 'Allergy Facts: AEO — 1 made on the site'); has(fine.html, /Screenshot check: looks right\./);
  const post = buildVisualProblemEmail({ client: 'Krost', title: 'Racking <Guide>', url: 'https://k.example/racking/', result: { problems: ['The hero image is stretched.'], compared_with: 'https://k.example/older/' } }, 'https://suite.example');
  has(post.subject, /^Look at this live page — Krost: "Racking <Guide>" may not look right/);
  has(post.html, /Racking &lt;Guide&gt;/); has(post.html, /The hero image is stretched\./); has(post.html, /Take down/); has(post.html, /still live/);
});

console.log(`\nvisualCheck: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
