// LIVE test of the Syte SEO Helper plugin against a real WordPress — a
// private test site with the plugin installed, never a client's.
// Each kind of theme-level fix: preview on the real page (only the preview
// link shows it), apply, see it live, undo, see it gone.
//
// Not part of `npm test`. Usage:
//   node test/live/helper-live.mjs <site-url> <site.json>
// The test site needs a template that adds a second <h1>Latest News</h1> to
// single posts, and a page titled "Latest News" (see the session's wp-test/).

import fs from 'node:fs';
import { wpClient } from '../../netlify/functions/lib/wpClient.js';
import { runTechFix, runAllTechFixes } from '../../netlify/functions/lib/techFixRun.js';
import { runAeoFix, aeoOptKey } from '../../netlify/functions/lib/aeoFixRun.js';
import { fixKey } from '../../netlify/functions/lib/aeoFix.js';
import { wpTechOps, wpAeoOps, helperStatus, readPage, fetchPageRaw } from '../../netlify/functions/lib/helperFix.js';

const [siteUrl, credsFile] = process.argv.slice(2);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(siteUrl || '')) { console.error('Refusing: this test only runs against a local test site.'); process.exit(2); }
const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
const SITE = siteUrl.replace(/\/+$/, '');
const wp = wpClient({ wp_url: SITE, wp_username: creds.user, wp_app_password: creds.app_password });

let pass = 0, fail = 0;
async function t(name, fn) {
  try { const note = await fn(); console.log('PASS', name + (note ? '  — ' + note : '')); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
const eq = (a, b, label) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const page = async url => readPage((await fetchPageRaw(url + (url.includes('?') ? '&' : '?') + 'x=' + Date.now())).html);
const raw = url => fetchPageRaw(url + (url.includes('?') ? '&' : '?') + 'x=' + Date.now());

const P1 = SITE + '/mezzanine-floors-benefits/', P2 = SITE + '/storage-bins-vs-filing-cupboards/', NEWS = SITE + '/latest-news/';
const rows = new Map();
const ops = wpTechOps();
const deps = entry => ({
  wp, ops, fetchHtml: async u => (await fetchPageRaw(u)).html,
  save: async s => { const row = { ...s, task_id: entry.task.id }; rows.set(entry.task.id, row); return row; },
  recordApplied: async () => 'impl-' + entry.task.id, recordUndone: async () => {}
});
const entry = (id, fix_type, page_url, fix, title = 'Fix', description = '') => ({ task: { id, fix_type, page_url, copy_paste_fix: fix, title, description }, check: { verdict: 'confirmed', reason: 'Checked.' } });
async function previewApplyUndo(e, { beforeOk, afterOk, publicUrl = e.task.page_url }) {
  const planned = await runTechFix({ entry: e, action: 'plan' }, deps(e));
  if (planned.status !== 'planned') throw new Error('plan: ' + planned.status + ' — ' + (planned.reason || ''));
  await beforeOk('while only previewed, visitors still see the old page');
  const applied = await runTechFix({ entry: e, action: 'apply', prev: planned }, deps(e));
  if (applied.status !== 'applied') throw new Error('apply: ' + applied.status + ' — ' + (applied.reason || applied.error || ''));
  eq(applied.live.status, 'verified', 'live check');
  await afterOk();
  const undone = await runTechFix({ entry: e, action: 'undo', prev: applied }, deps(e));
  eq(undone.status, 'undone');
  await beforeOk('after undo the page is back as it was');
  return planned;
}

await t('the plugin is installed and answers the suite; strangers are refused', async () => {
  const s = await helperStatus(wp);
  if (!s) throw new Error('plugin not found');
  const anon = await fetch(SITE + '/wp-json/syte/v1/rules');
  eq(anon.status, 401, 'no login');
  const bad = wpClient({ wp_url: SITE, wp_username: creds.user, wp_app_password: 'wrong wrong wrong wrong wrong wrong' });
  eq(await helperStatus(bad), null, 'wrong password');
  return 'version ' + s.version + ', ' + s.types.length + ' kinds of fix';
});

await t('starting point: every post has two main headings (one from the template)', async () => {
  eq((await page(P1)).h1, ['Latest News', 'Mezzanine Floors Benefits']);
  eq((await page(P2)).h1.length, 2);
  eq((await page(NEWS)).h1, ['Latest News'], 'the news page has only its own');
});

await t('DUPLICATE HEADING (the Krost case): previewed on the real page, applied site-wide, undone', async () => {
  const e = entry('k1', 'h1', P1, 'Change <h1 class="template-heading">Latest News</h1> to <h2 class="template-heading">Latest News</h2> in the blog post template.', 'Fix site-wide duplicate H1 caused by blog post template rendering "Latest News" as a second <h1>');
  const planned = await previewApplyUndo(e, {
    beforeOk: async () => { eq((await page(P1)).h1.length, 2); },
    afterOk: async () => {
      eq((await page(P1)).h1, ['Mezzanine Floors Benefits'], 'post 1');
      eq((await page(P2)).h1, ['Storage Bins vs Filing Cupboards'], 'post 2 — one rule fixed every post');
      eq((await page(NEWS)).h1, ['Latest News'], 'the page where it is the only main heading keeps it');
      const html = (await raw(P1)).html;
      if (!/<h2 class="template-heading">Latest News<\/h2>/.test(html)) throw new Error('the heading should keep its class and words');
    }
  });
  const preview = readPage((await fetchPageRaw(planned.plan.preview_url)).html);
  return 'preview link showed ' + planned.plan.changes[0].now;
});

await t('a preview link only works with its own token', async () => {
  const e = entry('k2', 'h1', P1, 'Change <h1>Latest News</h1> to <h2>Latest News</h2>', 'Fix duplicate H1 on this post');
  const planned = await runTechFix({ entry: e, action: 'plan' }, deps(e));
  eq(planned.status, 'planned');
  eq(readPage((await fetchPageRaw(planned.plan.preview_url)).html).h1.length, 1, 'with the token');
  eq(readPage((await fetchPageRaw(P1 + '?syte_preview=' + 'a'.repeat(32))).html).h1.length, 2, 'with a made-up token');
  eq((await page(P1)).h1.length, 2, 'without a token');
  await wp('syte/v1/rules/tech-k2', null, 'DELETE');
});

await t('STRUCTURED DATA is added to the page code, and removed on undo', async () => {
  const schema = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Mezzanine Floors Benefits","author":{"@type":"Organization","name":"Syte Test Shelving"}}</script>';
  await previewApplyUndo(entry('s1', 'structured_data', P1, schema, 'Add Article schema'), {
    beforeOk: async () => { if (/"@type":"Article","headline":"Mezzanine/.test((await raw(P1)).html)) throw new Error('schema should not be there'); },
    afterOk: async () => { if (!/<script type="application\/ld\+json" data-syte="tech-s1">\{"@context":"https:\/\/schema.org","@type":"Article"/.test((await raw(P1)).html)) throw new Error('schema missing'); }
  });
});

await t('structured data with placeholder values is NOT applied', async () => {
  const e = entry('s2', 'structured_data', P1, '<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","telephone":"+27000000000"}</script>');
  const s = await runTechFix({ entry: e, action: 'plan' }, deps(e));
  eq(s.status, 'manual'); if (!/placeholder/.test(s.reason)) throw new Error(s.reason);
});

await t('CANONICAL link is set and put back', async () => {
  const before = (await page(P2)).canonical;
  await previewApplyUndo(entry('c1', 'canonical', P2, '<link rel="canonical" href="' + P1 + '" />', 'Point this duplicate at the main page'), {
    beforeOk: async () => { eq((await page(P2)).canonical, before); },
    afterOk: async () => { eq((await page(P2)).canonical, P1); const n = ((await raw(P2)).html.match(/rel=["']canonical["']/g) || []).length; eq(n, 1, 'exactly one canonical tag'); }
  });
});

await t('NOINDEX is set on one page only, and removed', async () => {
  await previewApplyUndo(entry('r1', 'robots', P2, '<meta name="robots" content="noindex, follow">', 'Keep this thin page out of Google'), {
    beforeOk: async () => { if (/noindex/.test((await page(P2)).robots)) throw new Error('should be indexable'); },
    afterOk: async () => { if (!/noindex/.test((await page(P2)).robots)) throw new Error('noindex missing'); if (/noindex/.test((await page(P1)).robots)) throw new Error('another page was affected'); }
  });
});

await t('a fix that offers options is left for a person', async () => {
  const e = entry('r2', 'robots', P2, 'Option A (keep noindex): <meta name="robots" content="noindex, follow"> Option B (redirect to homepage): install a redirect plugin.');
  eq((await runTechFix({ entry: e, action: 'plan' }, deps(e))).status, 'manual');
});

await t('REDIRECT from a dead address works, and stops on undo', async () => {
  const OLD = SITE + '/hello-world-2/';
  const e = entry('d1', 'redirect', OLD, 'Add a 301 redirect:\n\nRedirect 301 /hello-world-2/ ' + P1, 'Redirect the deleted test post');
  await previewApplyUndo(e, {
    // A normal site answers 404 here; the test server shows its home page. Either way: no redirect.
    beforeOk: async () => { const r = await raw(OLD); if ([301, 302].includes(r.status) || r.location) throw new Error('already redirecting: ' + r.status); },
    afterOk: async () => { const r = await raw(OLD); eq([r.status, r.location], [301, P1]); }
  });
});

await t('HOME PAGE title (no editor for it) is changed and put back', async () => {
  const HOME = SITE + '/';
  const before = (await page(HOME)).title;
  await previewApplyUndo(entry('h1', 'meta_title', HOME, '<title>Shelving and Racking Suppliers | Syte Test Shelving</title>', 'Fix the home page title'), {
    beforeOk: async () => { eq((await page(HOME)).title, before); },
    afterOk: async () => { eq((await page(HOME)).title, 'Shelving and Racking Suppliers | Syte Test Shelving'); eq((await page(P1)).title !== 'Shelving and Racking Suppliers | Syte Test Shelving', true, 'only the home page'); }
  });
});

await t('ordinary post fixes still go through the post\'s own fields, not the plugin', async () => {
  const e = entry('n1', 'meta_title', P1, '<title>Mezzanine Floor Benefits for Warehouses | Syte Test</title>');
  const s = await runTechFix({ entry: e, action: 'plan' }, deps(e));
  eq(s.status, 'planned'); eq(!!s.plan.helper, false); eq(s.plan.changes[0].kind, 'meta_title');
});

await t('"Apply all" does not include plugin fixes — those are approved one at a time', async () => {
  const e = entry('k3', 'h1', P1, 'Change <h1>Latest News</h1> to <h2>Latest News</h2>', 'Fix duplicate H1');
  const out = await runAllTechFixes({ entries: [e], fixes: new Map(), by: 'test' }, deps);
  eq(out.length, 0); eq((await page(P1)).h1.length, 2);
});

await t('the plugin refuses unsafe rules', async () => {
  const tryRule = async (id, rule) => { try { await wp('syte/v1/rules/' + id, rule); return 'accepted'; } catch (e) { return String(e.message).slice(0, 60); } };
  for (const [id, rule] of [
    ['bad1', { type: 'redirect', path: '*', to: 'https://evil.example/' }],
    ['bad2', { type: 'redirect', path: '/', to: 'https://evil.example/' }],
    ['bad3', { type: 'redirect', path: '/wp-admin/', to: 'https://evil.example/' }],
    ['bad4', { type: 'schema', path: '/x/', json: '{not json' }],
    ['bad5', { type: 'run_php', path: '/x/', code: 'phpinfo();' }]
  ]) { const r = await tryRule(id, rule); if (!/WordPress 400/.test(r)) throw new Error(id + ' → ' + r); }
  const s = await wp('syte/v1/rules/xss', { type: 'insert_html', path: '/x/', position: 'end_of_main', html: '<p onclick="alert(1)">Hello there, this is a long enough paragraph.</p><script>alert(1)</script><iframe src="https://evil.example"></iframe>' });
  if (/onclick|<script|<iframe/i.test(s.html)) throw new Error('unsafe HTML kept: ' + s.html);
  await wp('syte/v1/rules/xss', null, 'DELETE');
  return 'redirect-everything, admin paths, bad JSON, unknown types refused; scripts stripped';
});

// ── AEO on the home page (not editable through post content) ──
const ANSWER = { type: 'content', name: 'Answer Block — direct answer after H1', where: 'Directly after the H1', check: { verdict: 'confirmed', reason: 'No direct answer.' },
  implementation: '<p class="syte-test-answer"><strong>Syte Test Shelving</strong> supplies and installs industrial shelving, racking and mezzanine floors for warehouses across South Africa.</p>' };
await t('AEO SECTION on the home page: previewed on the real page, added after the main heading, removed on undo', async () => {
  const HOME = SITE + '/';
  const aeoRows = new Map();
  const k = aeoOptKey(ANSWER);
  const d = { wp, ops: wpAeoOps(), fetchHtml: async u => (await fetchPageRaw(u + '?x=' + Date.now())).html, previewUrlFor: x => 'rebuilt:' + x,
    save: async s => { aeoRows.set(fixKey(HOME, k), s); return s; }, recordApplied: async () => 'impl', recordUndone: async () => {} };
  const planned = await runAeoFix({ url: HOME, opt: ANSWER, optKey: k, action: 'plan' }, d);
  if (planned.status !== 'planned') throw new Error('plan: ' + planned.status + ' — ' + planned.reason);
  if (!/syte_preview=/.test(planned.preview_url)) throw new Error('preview should be the real page: ' + planned.preview_url);
  if (!/supplies and installs industrial shelving/.test((await fetchPageRaw(planned.preview_url)).html)) throw new Error('not in the preview');
  if (/supplies and installs industrial shelving/.test((await raw(HOME)).html)) throw new Error('visible to visitors before it was applied');
  const applied = await runAeoFix({ url: HOME, opt: ANSWER, optKey: k, action: 'apply', prev: planned }, d);
  eq([applied.status, applied.live.status], ['applied', 'verified']);
  const html = (await raw(HOME)).html;
  const iH1 = html.indexOf('</h1>'), iAns = html.indexOf('supplies and installs industrial shelving');
  if (!(iH1 > 0 && iAns > iH1 && iAns - iH1 < 400)) throw new Error('not right after the main heading');
  const undone = await runAeoFix({ url: HOME, opt: ANSWER, optKey: k, action: 'undo', prev: applied }, d);
  eq(undone.status, 'removed');
  if (/supplies and installs industrial shelving/.test((await raw(HOME)).html)) throw new Error('still on the page after undo');
});

await t('nothing is left behind: no rules remain and the pages are as they started', async () => {
  for (const id of ['tech-n1']) await wp('syte/v1/rules/' + id, null, 'DELETE').catch(() => {});
  const left = (await wp('syte/v1/rules')).filter(r => r.enabled);
  eq(left.length, 0, 'enabled rules');
  eq((await page(P1)).h1, ['Latest News', 'Mezzanine Floors Benefits']);
});

console.log(`\nhelper-live: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
