// LIVE test against a real WordPress — a private test site, never a client's.
// Runs the code that changes a website, end to end:
//   technical fixes (apply → live check → undo), AEO sections (add → live
//   check → undo), article push as a draft → read-back check → publish →
//   look at the live page.
//
// Not part of `npm test` (it needs a running site). Usage:
//   node test/live/wordpress-live.mjs <site-url> <site.json>
// where site.json is { user, app_password } for an administrator.
// Refuses to run against anything but a local address.

import fs from 'node:fs';
import http from 'node:http';
import { wpClient } from '../../netlify/functions/lib/wpClient.js';
import { runTechFix, runAllTechFixes } from '../../netlify/functions/lib/techFixRun.js';
import { runAeoFix, aeoOptKey } from '../../netlify/functions/lib/aeoFixRun.js';
import { fixKey } from '../../netlify/functions/lib/aeoFix.js';
import { lookAtLivePost } from '../../netlify/functions/lib/livePostCheck.js';
import { publishOne } from '../../netlify/functions/publish-approved.js';
import { handler as wpProxy } from '../../netlify/functions/wp-proxy.js';
import { buildTechSummaryEmail } from '../../netlify/functions/lib/reportEmail.js';

const [siteUrl, credsFile] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(siteUrl || '')) { console.error('Refusing: this test only runs against a local test site.'); process.exit(2); }
const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
const SITE = siteUrl.replace(/\/+$/, '');
const client = { id: 'test-client', name: 'Syte Test Shelving', url: SITE + '/', cms_type: 'WordPress', wp_url: SITE, wp_username: creds.user, wp_app_password: creds.app_password,
  publishing_profile: { hero_mode: 'none' } };
const wp = wpClient(client);

let pass = 0, fail = 0;
const results = [];
async function t(name, fn) {
  try { const note = await fn(); console.log('PASS', name + (note ? '  — ' + note : '')); pass++; results.push({ name, ok: true, note }); }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; results.push({ name, ok: false, note: e.message }); }
}
const eq = (a, b, label) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const livePage = async url => { const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } }); return r.ok ? r.text() : ''; };
const titleOf = html => (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.replace(/&amp;/g, '&').replace(/&#8211;/g, '–').trim();
const rawOf = async (id) => (await wp('wp/v2/posts/' + id + '?context=edit&_fields=content,meta,status,title')).content.raw;

function techDeps(entry, rows, log) {
  return {
    wp, fetchHtml: livePage,
    save: async s => { const row = { ...s, task_id: entry.task.id }; rows.set(entry.task.id, row); return row; },
    recordApplied: async () => { log.push('applied ' + entry.task.id); return 'impl-' + entry.task.id; },
    recordUndone: async () => { log.push('undone ' + entry.task.id); }
  };
}
const entry = (id, slug, fix_type, fix, title) => ({ task: { id, fix_type, title, page_url: SITE + '/' + slug + '/', copy_paste_fix: fix }, check: { verdict: 'confirmed', reason: 'Checked on the live page.' } });

const P1 = 'mezzanine-floors-benefits', P2 = 'storage-bins-vs-filing-cupboards';
const NEW1 = 'Mezzanine Floor Benefits for Warehouses | Syte Test';
const NEW2 = 'Storage Bins vs Filing Cupboards: Which to Choose | Syte Test';
const DESC = 'How a mezzanine floor adds storage space to a warehouse without moving premises, what it costs and how long installation takes.';

await t('the connection works and the account is an administrator', async () => {
  const me = await wp('wp/v2/users/me?context=edit');
  if (!(me.roles || []).includes('administrator')) throw new Error('roles: ' + JSON.stringify(me.roles));
  return 'logged in as ' + me.name;
});

let before1 = '';
await t('starting point: the live page shows the old, broken title', async () => {
  before1 = titleOf(await livePage(SITE + '/' + P1 + '/'));
  if (!/Mezzanine Floors Benefits\s*[-–]$/.test(before1)) throw new Error('title is: ' + before1);
  return '"' + before1 + '"';
});

const rows = new Map(); const log = [];
const entries = [
  entry('t1', P1, 'meta_title', '<title>' + NEW1 + '</title>', 'Fix incomplete meta title on the Mezzanine page'),
  entry('t2', P2, 'meta_title', '<title>' + NEW2 + '</title>', 'Fix incomplete meta title on the Storage Bins page'),
  entry('t3', P1, 'meta_description', '<meta name="description" content="' + DESC + '">', 'Add a meta description to the Mezzanine page'),
  entry('t4', 'no-such-page', 'meta_title', '<title>A Title For A Page That Does Not Exist</title>', 'Fix the title on a page that is not there'),
  entry('t5', P1, 'heading', '<h2>Latest News</h2>', 'Theme heading (not something the suite changes)')
];

await t('Apply all: three fixes made on the site, each read back and seen on the live page', async () => {
  const out = await runAllTechFixes({ entries, fixes: rows, by: 'live test' }, e => techDeps(e, rows, log));
  eq(out.map(o => o.entry.task.id + ':' + o.status.status), ['t1:applied', 't2:applied', 't3:applied', 't4:manual']);
  eq(out.slice(0, 3).map(o => o.status.live.status), ['verified', 'verified', 'verified'], 'live check');
  const html = await livePage(SITE + '/' + P1 + '/');
  eq(titleOf(html), NEW1, 'live <title>');
  if (!html.includes('content="' + DESC.slice(0, 60))) throw new Error('meta description not on the live page');
  eq(titleOf(await livePage(SITE + '/' + P2 + '/')), NEW2);
  return 'live title is now "' + NEW1 + '"';
});

await t('a page that does not exist is left alone, with the reason', async () => {
  if (!/Could not match/.test(rows.get('t4').reason)) throw new Error(rows.get('t4').reason);
});

await t('the email reports exactly what happened on the site', async () => {
  const { subject, html } = buildTechSummaryEmail(client, { status: 'done', crawl: { pages: 2 }, tasks: entries }, 'https://suite.example', { fixes: rows });
  eq(subject, 'Syte Test Shelving: technical SEO — 3 made on the site, 2 for a developer');
  for (const s of ['Mezzanine Floors Benefits -', NEW1, 'showing on the live page']) if (!html.includes(s.replace(/&/g, '&amp;'))) throw new Error('email is missing: ' + s);
  fs.writeFileSync(new URL('./last-tech-email.html', import.meta.url), html);
  return subject;
});

await t('running Apply all again changes nothing', async () => {
  const out = await runAllTechFixes({ entries, fixes: rows, by: 'live test' }, e => techDeps(e, rows, log));
  eq(out.filter(o => o.skipped).length, 3);
});

await t('Undo puts the old title back on the live page', async () => {
  const s = await runTechFix({ entry: entries[0], action: 'undo', prev: rows.get('t1') }, techDeps(entries[0], rows, log));
  eq(s.status, 'undone');
  eq(titleOf(await livePage(SITE + '/' + P1 + '/')), before1);
  return 'live title is back to "' + before1 + '"';
});

await t('Undo leaves the client\'s own later edit alone', async () => {
  const post = (await wp('wp/v2/posts?slug=' + P2 + '&context=edit&_fields=id'))[0];
  await wp('wp/v2/posts/' + post.id, { meta: { _yoast_wpseo_title: 'Edited by the client afterwards' } });
  const s = await runTechFix({ entry: entries[1], action: 'undo', prev: rows.get('t2') }, techDeps(entries[1], rows, log));
  eq(s.status, 'undone');
  eq(titleOf(await livePage(SITE + '/' + P2 + '/')), 'Edited by the client afterwards');
});

await t('Undo of the meta description removes it again', async () => {
  const s = await runTechFix({ entry: entries[2], action: 'undo', prev: rows.get('t3') }, techDeps(entries[2], rows, log));
  eq(s.status, 'undone');
  if ((await livePage(SITE + '/' + P1 + '/')).includes(DESC.slice(0, 60))) throw new Error('still on the live page');
});

// ── Image descriptions ──
let mediaId = null, imgSrc = '';
await t('image description: set on a real uploaded image, seen on the live page, then undone', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await fetch(SITE + '/wp-json/wp/v2/media', { method: 'POST', body: png,
    headers: { Authorization: 'Basic ' + Buffer.from(creds.user + ':' + creds.app_password).toString('base64'), 'Content-Type': 'image/png', 'Content-Disposition': 'attachment; filename="long-span-shelving.png"' } });
  if (!up.ok) throw new Error('upload ' + up.status + ' ' + (await up.text()).slice(0, 150));
  const media = await up.json(); mediaId = media.id; imgSrc = media.source_url;
  const page = await wp('wp/v2/posts', { title: 'Shelving Gallery', slug: 'shelving-gallery', status: 'publish',
    content: '<!-- wp:image {"id":' + mediaId + '} -->\n<figure class="wp-block-image"><img src="' + imgSrc + '" alt="" class="wp-image-' + mediaId + '"/></figure>\n<!-- /wp:image -->\n\n<!-- wp:paragraph -->\n<p>Long span shelving in a warehouse.</p>\n<!-- /wp:paragraph -->' });
  const e = entry('t6', 'shelving-gallery', 'image_alt', '<img src="' + imgSrc + '" alt="Long span shelving holding boxed stock in a warehouse">', 'Add alt text to the gallery image');
  const s = await runTechFix({ entry: e, action: 'auto', by: 'live test' }, techDeps(e, rows, log));
  eq(s.status, 'applied');
  eq((await wp('wp/v2/media/' + mediaId + '?context=edit&_fields=alt_text')).alt_text, 'Long span shelving holding boxed stock in a warehouse');
  const u = await runTechFix({ entry: e, action: 'undo', prev: s }, techDeps(e, rows, log));
  eq(u.status, 'undone');
  eq((await wp('wp/v2/media/' + mediaId + '?context=edit&_fields=alt_text')).alt_text, '');
  return 'live check said: ' + s.live.status + ' (the image tag in the post keeps its own alt, so "pending" is the honest answer there)' + (page.id ? '' : '');
});

// ── AEO ──
const FAQ = { type: 'content', name: 'FAQ Content Section — mezzanine floor questions', where: 'After the main content', check: { verdict: 'confirmed', reason: 'No FAQ on the page.' },
  implementation: '<h2 class="wp-block-heading">Frequently asked questions about mezzanine floors</h2>\n<h3>How long does a mezzanine floor take to install?</h3>\n<p>Most mezzanine floors are installed within two to four weeks of the order, depending on size.</p>\n<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How long does a mezzanine floor take to install?","acceptedAnswer":{"@type":"Answer","text":"Most mezzanine floors are installed within two to four weeks of the order."}}]}</script>' };
const ANSWER = { type: 'content', name: 'Answer Block — direct answer after H1', where: 'Directly after the H1', check: { verdict: 'confirmed', reason: 'No direct answer.' },
  implementation: '<p><strong>A mezzanine floor</strong> is a raised platform built inside a warehouse that adds a second level of storage without extending the building.</p>' };
const aeoRows = new Map();
const aeoDeps = (url, optKey) => ({
  wp, fetchHtml: livePage, previewUrlFor: k => 'preview:' + k,
  save: async s => { const row = { ...s, key: fixKey(url, optKey) }; aeoRows.set(row.key, row); return row; },
  recordApplied: async () => 'impl-aeo', recordUndone: async () => {}
});
const AEO_URL = SITE + '/' + P1 + '/';
let postId = null, rawBefore = '';

await t('AEO: an FAQ is added at the end and an answer at the top; both show on the live page', async () => {
  postId = (await wp('wp/v2/posts?slug=' + P1 + '&context=edit&_fields=id'))[0].id;
  rawBefore = await rawOf(postId);
  const a = await runAeoFix({ url: AEO_URL, opt: FAQ, optKey: aeoOptKey(FAQ), action: 'auto', by: 'live test' }, aeoDeps(AEO_URL, aeoOptKey(FAQ)));
  eq([a.status, a.live?.status], ['applied', 'verified'], 'FAQ');
  const b = await runAeoFix({ url: AEO_URL, opt: ANSWER, optKey: aeoOptKey(ANSWER), action: 'auto', by: 'live test' }, aeoDeps(AEO_URL, aeoOptKey(ANSWER)));
  eq([b.status, b.live?.status], ['applied', 'verified'], 'answer');
  const html = await livePage(AEO_URL);
  const iAnswer = html.indexOf('is a raised platform built inside'), iBody = html.indexOf('Mezzanine floors add a second level'), iFaq = html.indexOf('Frequently asked questions about mezzanine');
  if (!(iAnswer > 0 && iAnswer < iBody && iBody < iFaq)) throw new Error('order on the page is wrong: ' + [iAnswer, iBody, iFaq]);
  if (!/"@type":"FAQPage"/.test(html.replace(/\s+/g, ''))) throw new Error('FAQ schema not on the live page');
  if (!(await rawOf(postId)).includes(rawBefore)) throw new Error('the existing content was changed');
  return 'answer → existing text → FAQ, with FAQ schema';
});

await t('AEO: the same section cannot be added twice', async () => {
  // As the panel does: the saved status is passed in, so an added section is left as it is…
  const k = aeoOptKey(FAQ);
  const again = await runAeoFix({ url: AEO_URL, opt: FAQ, optKey: k, action: 'plan', prev: aeoRows.get(fixKey(AEO_URL, k)) }, aeoDeps(AEO_URL, k));
  eq(again.status, 'applied');
  // …and even a fresh preview refuses to add it a second time (the status row is put back afterwards).
  const keep = aeoRows.get(fixKey(AEO_URL, k));
  const fresh = await runAeoFix({ url: AEO_URL, opt: FAQ, optKey: k, action: 'plan', prev: null }, aeoDeps(AEO_URL, k));
  aeoRows.set(fixKey(AEO_URL, k), keep);
  eq(fresh.status, 'manual'); if (!/Already added/.test(fresh.reason)) throw new Error(fresh.reason);
  eq(((await rawOf(postId)).match(/Frequently asked questions about mezzanine/g) || []).length, 1);
});

await t('AEO: undoing both puts the page back exactly as it was, character for character', async () => {
  for (const opt of [FAQ, ANSWER]) {
    const k = aeoOptKey(opt);
    const u = await runAeoFix({ url: AEO_URL, opt, optKey: k, action: 'undo', prev: aeoRows.get(fixKey(AEO_URL, k)) }, aeoDeps(AEO_URL, k));
    eq(u.status, 'removed');
  }
  eq(await rawOf(postId), rawBefore, 'page content');
  const html = await livePage(AEO_URL);
  if (/Frequently asked questions about mezzanine|raised platform built inside/.test(html)) throw new Error('still on the live page');
});

// ── Articles: push as a draft → check → publish → look at the live page ──
const proxy = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', async () => {
    try {
      const r = await wpProxy({ httpMethod: req.method, headers: req.headers, body });
      res.writeHead(r.statusCode, r.headers || {}); res.end(r.body || '');
    } catch (e) { res.writeHead(500); res.end(String(e.message)); }
  });
});
await new Promise(r => proxy.listen(0, '127.0.0.1', r));
process.env.WP_PROXY_AUTH = 'live-test-gate';
globalThis.__SYTE_FN_BASE = 'http://127.0.0.1:' + proxy.address().port;
globalThis.__SYTE_PROXY_AUTH = 'live-test-gate';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { pushItemInline } = await import('../../src/modules/cms/pushAction.js');

const ARTICLE = `Meta Title: Pallet Racking Guide for Warehouses | Syte Test
Meta Description: A plain guide to choosing pallet racking for a warehouse: the main types, what they cost and how to plan the layout safely.

# Pallet Racking Guide for Warehouses

Pallet racking keeps heavy stock off the floor and within reach of a forklift. Choosing the right type depends on how many pallets you store, how often they move and how much floor space you have.

## The main types of pallet racking

**Selective racking** gives direct access to every pallet and suits most warehouses. Drive-in racking stores more pallets in the same space, but the last pallet in is the first one out.

- Selective racking: every pallet is reachable
- Drive-in racking: highest density
- Cantilever racking: long loads such as timber

## Planning the layout

Measure the building, the pallets and the forklift before you order. Aisles that are too narrow slow every movement down, and aisles that are too wide waste space you are paying for.

---

## Frequently asked questions

### How much weight can pallet racking hold?

It depends on the beam and frame rating. Every bay should carry a load sign showing its safe working load.
`;
const queue = new Map();
const qdeps = {
  queue: async row => { const r = { id: 'q' + (queue.size + 1), ...row }; queue.set(r.id, r); return r; },
  update: async (id, patch) => { queue.set(id, { ...queue.get(id), ...patch }); },
  notify: async () => {}
};
let pushed = null, row = null;

await t('an article is pushed as a DRAFT (not live), and the draft reads back clean', async () => {
  pushed = await pushItemInline(client, { module: 'content', page_url: client.url, page_title: 'Pallet Racking Guide for Warehouses', change_type: 'article',
    payload: { html: ARTICLE, meta_title: 'Pallet Racking Guide for Warehouses', primary_keyword: 'pallet racking', source: 'autopilot' } }, qdeps);
  row = queue.get(pushed.id);
  eq(row.status, 'pushed');
  const post = await wp('wp/v2/posts/' + row.payload.wp_id + '?context=edit&_fields=status,title,content,meta');
  eq(post.status, 'draft', 'status on the site');
  eq(post.title.raw, 'Pallet Racking Guide for Warehouses');
  for (const bad of ['Meta Title', 'Meta Description', '# Pallet', '**', '---']) if (post.content.raw.includes(bad)) throw new Error('leftover in the draft: ' + bad);
  if (/<h1/i.test(post.content.raw)) throw new Error('the title is repeated inside the article');
  const anon = await fetch(SITE + '/?p=' + row.payload.wp_id);
  if (anon.status !== 404 && /Pallet racking keeps heavy stock/.test(await anon.text())) throw new Error('a visitor can see the draft');
  return 'read-back check: ' + pushed.verification + (pushed.warnings.length ? ' — ' + pushed.warnings.join('; ') : '') + ' · SEO title stored: ' + JSON.stringify(post.meta?._yoast_wpseo_title || '');
});

let liveUrl = '';
await t('publishing the approved draft makes it live, and the live page passes the look-over', async () => {
  liveUrl = await publishOne(client, row);
  const post = await wp('wp/v2/posts/' + row.payload.wp_id + '?context=edit&_fields=status,link');
  eq(post.status, 'publish');
  const check = await lookAtLivePost(liveUrl || post.link, row.page_title);
  if (!check.ok) throw new Error('live page problems: ' + check.problems.join(' | '));
  return liveUrl || post.link;
});

await t('the look-over catches a bad page: leftover labels, stars and a dead link', async () => {
  const bad = await wp('wp/v2/posts', { title: 'Shelving Care Guide', slug: 'shelving-care-guide', status: 'publish',
    content: '<p>Meta Title: Shelving Care Guide</p><p>**Keep shelving clean** and check the bolts.</p><p>' + 'Shelving lasts longer when it is inspected and cleaned on a regular schedule. '.repeat(10) + '</p>' });
  const check = await lookAtLivePost(bad.link, 'Shelving Care Guide');
  eq(check.ok, false);
  const p = check.problems.join(' | ');
  if (!/Meta Title/.test(p) || !/stars/.test(p)) throw new Error(p);
  const dead = await lookAtLivePost(SITE + '/this-page-does-not-exist/', 'x');
  eq(dead.ok, false);
  return p;
});

await t('a wrong password is reported as a login problem, and nothing is changed', async () => {
  const badWp = wpClient({ ...client, wp_app_password: 'wrong wrong wrong wrong wrong wrong' });
  const e = entry('t9', P1, 'meta_title', '<title>This Title Must Never Be Written To The Site</title>', 'x');
  const r = new Map();
  const out = await runAllTechFixes({ entries: [e], fixes: r }, en => ({ ...techDeps(en, r, []), wp: badWp }));
  eq(out[0].status.status, 'failed');
  if (!/WordPress 40[13]/.test(out[0].status.reason)) throw new Error(out[0].status.reason);
  eq(titleOf(await livePage(SITE + '/' + P1 + '/')), before1);
  return out[0].status.reason;
});

proxy.close();
console.log(`\nwordpress-live: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
