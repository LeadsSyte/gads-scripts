// "Do it, then tell Chris": fixes applied without a preview click, undo,
// publishing clean drafts, the look at the live page, and the emails that
// say what was done. A fake WordPress throughout — nothing real is touched.

import { runTechFix, runAllTechFixes, canAutoFix } from '../netlify/functions/lib/techFixRun.js';
import { runAeoFix, runAllAeoFixes, aeoOptKey, canAutoAdd } from '../netlify/functions/lib/aeoFixRun.js';
import { fixKey } from '../netlify/functions/lib/aeoFix.js';
import { pushReadyArticles } from '../netlify/functions/lib/autopilot.js';
import { checkLivePost, lookAtLivePost } from '../netlify/functions/lib/livePostCheck.js';
import { buildTechSummaryEmail, buildAeoSummaryEmail, buildRunSummaryEmail, buildPublishedEmail } from '../netlify/functions/lib/reportEmail.js';
import { PROFILE_DEFAULTS } from '../src/modules/cms/publishingProfile.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
const has = (s, re, label) => { if (!re.test(s)) throw new Error((label || '') + ' missing ' + re); };
const hasNot = (s, re, label) => { if (re.test(s)) throw new Error((label || '') + ' should not contain ' + re); };

// ── A fake WordPress: two posts with Yoast, one that refuses writes ──
const OLD_TITLE = 'Mezzanine Floors Benefits –';
const NEW_TITLE = 'Mezzanine Floor Benefits for Warehouses | Krost Shelving';
function fakeSite({ stubborn = false } = {}) {
  const posts = {
    7: { id: 7, slug: 'mezzanine', link: 'https://krost.example/mezzanine/', title: { raw: 'Mezzanine' }, meta: { _yoast_wpseo_title: OLD_TITLE, _yoast_wpseo_metadesc: '' } },
    8: { id: 8, slug: 'racking', link: 'https://krost.example/racking/', title: { raw: 'Racking' }, meta: { _yoast_wpseo_title: '', _yoast_wpseo_metadesc: '' } }
  };
  const writes = [];
  const wp = async (path, body) => {
    const id = (path.match(/^wp\/v2\/posts\/(\d+)/) || [])[1];
    if (body) {
      writes.push({ path, body });
      if (id && !(stubborn && id === '8')) Object.assign(posts[id].meta, body.meta);
      return {};
    }
    if (path.startsWith('wp/v2/pages?slug=')) return [];
    const slug = (path.match(/^wp\/v2\/posts\?slug=([^&]+)/) || [])[1];
    if (slug) return Object.values(posts).filter(p => p.slug === slug);
    if (id) return { meta: { ...posts[id].meta } };
    throw new Error('unexpected ' + path);
  };
  const live = url => { const p = Object.values(posts).find(x => x.link === url); return '<html><head><title>' + (p?.meta._yoast_wpseo_title || 'Default') + '</title></head><body></body></html>'; };
  return { wp, writes, posts, live };
}

const entry = (id, slug, title, verdict = 'confirmed', fix_type = 'meta_title') => ({
  task: { id, fix_type, title: 'Fix the title on ' + slug, page_url: 'https://krost.example/' + slug + '/', copy_paste_fix: '<title>' + title + '</title>' },
  check: { verdict, reason: 'The title ends with a dash.' }
});

function techHarness(site) {
  const rows = new Map();
  const log = { applied: [], undone: [] };
  const depsFor = e => ({
    wp: site.wp, fetchHtml: async url => site.live(url),
    save: async s => { const row = { ...s, task_id: e.task.id }; rows.set(e.task.id, row); return row; },
    recordApplied: async ({ by }) => { log.applied.push({ id: e.task.id, by }); return 'impl-' + e.task.id; },
    recordUndone: async ({ implId }) => { log.undone.push(implId); }
  });
  return { rows, log, depsFor };
}

await t('every new switch is off until someone turns it on', () => {
  assertEq([PROFILE_DEFAULTS.techfix_auto, PROFILE_DEFAULTS.aeofix_auto, PROFILE_DEFAULTS.autopilot_publish], [false, false, false]);
});

await t('auto: a confirmed title fix is made without a preview click, read back, and checked live', async () => {
  const site = fakeSite(); const h = techHarness(site);
  const e = entry('t1', 'mezzanine', NEW_TITLE);
  const s = await runTechFix({ entry: e, action: 'auto', by: 'applied automatically' }, h.depsFor(e));
  assertEq(s.status, 'applied');
  assertEq(site.posts[7].meta._yoast_wpseo_title, NEW_TITLE);
  assertEq(s.live.status, 'verified');
  assertEq(s.results[0].from, OLD_TITLE, 'the old value is kept for undo');
  assertEq(h.log.applied, [{ id: 't1', by: 'applied automatically' }]);
});

await t('undo puts the old title back and re-opens the task', async () => {
  const site = fakeSite(); const h = techHarness(site);
  const e = entry('t1', 'mezzanine', NEW_TITLE);
  const applied = await runTechFix({ entry: e, action: 'auto' }, h.depsFor(e));
  const s = await runTechFix({ entry: e, action: 'undo', prev: applied }, h.depsFor(e));
  assertEq(s.status, 'undone');
  assertEq(site.posts[7].meta._yoast_wpseo_title, OLD_TITLE);
  assertEq(h.log.undone, ['impl-t1']);
});

await t('undo leaves a value alone when someone has edited it since', async () => {
  const site = fakeSite(); const h = techHarness(site);
  const e = entry('t1', 'mezzanine', NEW_TITLE);
  const applied = await runTechFix({ entry: e, action: 'auto' }, h.depsFor(e));
  site.posts[7].meta._yoast_wpseo_title = 'Edited by the client';
  const s = await runTechFix({ entry: e, action: 'undo', prev: applied }, h.depsFor(e));
  assertEq(s.status, 'undone');
  assertEq(site.posts[7].meta._yoast_wpseo_title, 'Edited by the client');
  has(s.note, /left as they are/);
});

await t('apply (a person) still needs the preview first; auto never touches unconfirmed or theme fixes', async () => {
  const site = fakeSite(); const h = techHarness(site);
  const e = entry('t1', 'mezzanine', NEW_TITLE);
  const s = await runTechFix({ entry: e, action: 'apply', prev: null }, h.depsFor(e));
  has(s.error, /Preview the change/);
  assertEq(site.writes.length, 0);
  assertEq(canAutoFix(entry('x', 'mezzanine', NEW_TITLE, 'fix_wrong')), false);
  assertEq(canAutoFix(entry('x', 'mezzanine', NEW_TITLE, 'confirmed', 'heading')), false);
  const wrong = entry('t2', 'mezzanine', NEW_TITLE, 'needs_human');
  assertEq((await runTechFix({ entry: wrong, action: 'auto' }, h.depsFor(wrong))).status, 'manual');
  assertEq(site.writes.length, 0);
});

await t('apply all: makes what it can, reports what failed, skips what is done or was undone', async () => {
  const site = fakeSite({ stubborn: true }); const h = techHarness(site);
  const entries = [
    entry('t1', 'mezzanine', NEW_TITLE),
    entry('t2', 'racking', 'Racking Prices in South Africa | Krost Shelving'),   // site refuses the write
    entry('t3', 'mezzanine', NEW_TITLE, 'false_alarm'),
    entry('t4', 'mezzanine', NEW_TITLE, 'confirmed', 'heading'),
    entry('t5', 'mezzanine', 'Another Title For The Mezzanine Page | Krost')      // a person undid this one
  ];
  const fixes = new Map([['t5', { status: 'undone', task_id: 't5' }]]);
  const out = await runAllTechFixes({ entries, fixes, by: 'applied automatically' }, h.depsFor);
  assertEq(out.map(o => o.entry.task.id + ':' + o.status.status), ['t1:applied', 't2:failed', 't5:undone']);
  assertEq(site.posts[8].meta._yoast_wpseo_title, '', 'a refused write leaves nothing behind');
  // Running it again changes nothing that is already done.
  const before = site.writes.length;
  const again = await runAllTechFixes({ entries: [entries[0]], fixes: h.rows, by: 'x' }, h.depsFor);
  assertEq(again[0].skipped, true); assertEq(site.writes.length, before);
});

await t('apply all stops when time runs short and says so', async () => {
  const site = fakeSite(); const h = techHarness(site);
  const out = await runAllTechFixes({ entries: [entry('t1', 'mezzanine', NEW_TITLE)], fixes: new Map() }, h.depsFor, { timeLeftMs: () => 1000 });
  assertEq(out[0].status.status, 'waiting'); assertEq(site.writes.length, 0);
});

// ── AEO ──
const RAW = '<!-- wp:paragraph -->\n<p>A first allergy appointment usually starts with a detailed conversation about your symptoms and history.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>Skin prick tests are quick, and results are usually ready within twenty minutes of the test being done.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>Your allergist will then explain the results and agree a management plan that suits your daily life.</p>\n<!-- /wp:paragraph -->';
const strip = s => s.replace(/<!--[^>]*-->\n?/g, '');
const AEO_URL = 'https://af.example/your-first-allergy-appointment/';
const FAQ = { type: 'content', name: 'FAQ Content Section', where: 'After the main content', check: { verdict: 'confirmed', reason: 'No FAQ on the page.' },
  implementation: '<h2>Frequently asked questions</h2><h3>How long does a first appointment take?</h3><p>Usually about an hour, including testing and discussion.</p>' };
function fakeAeoSite() {
  const post = { raw: RAW };
  const wp = async (path, body) => {
    if (body) { post.raw = body.content; return {}; }
    if (path.startsWith('wp/v2/pages?slug=')) return [];
    if (path.startsWith('wp/v2/posts?slug=your-first-allergy-appointment')) return [{ id: 7, link: AEO_URL, meta: {} }];
    if (path.startsWith('wp/v2/posts?slug=')) return [];
    if (path.startsWith('wp/v2/posts/7')) return { content: { raw: post.raw, rendered: strip(post.raw) } };
    throw new Error('unexpected ' + path);
  };
  const live = async () => '<html><body><h1>First appointment</h1><div>' + strip(post.raw) + '</div></body></html>';
  return { wp, post, live };
}
function aeoHarness(site) {
  const rows = new Map();
  const log = { applied: [], undone: [] };
  const depsFor = (url, optKey) => ({
    wp: site.wp, fetchHtml: site.live, previewUrlFor: k => 'https://suite.example/preview?f=' + k,
    save: async s => { const row = { ...s, key: fixKey(url, optKey) }; rows.set(row.key, row); return row; },
    recordApplied: async ({ by }) => { log.applied.push(by); return 'impl-1'; },
    recordUndone: async id => { log.undone.push(id); }
  });
  return { rows, log, depsFor };
}

await t('AEO auto: a confirmed section is added in one go, marked, live-checked, and undo restores the page exactly', async () => {
  const site = fakeAeoSite(); const h = aeoHarness(site);
  const optKey = aeoOptKey(FAQ);
  const s = await runAeoFix({ url: AEO_URL, opt: FAQ, optKey, action: 'auto', by: 'added automatically' }, h.depsFor(AEO_URL, optKey));
  assertEq(s.status, 'applied'); assertEq(s.live.status, 'verified');
  has(site.post.raw, /<!-- syte-aeo:[a-z0-9]+ -->\n<h2>Frequently asked questions/);
  if (!site.post.raw.startsWith(RAW)) throw new Error('existing content changed');
  const u = await runAeoFix({ url: AEO_URL, opt: FAQ, optKey, action: 'undo', prev: s }, h.depsFor(AEO_URL, optKey));
  assertEq(u.status, 'removed'); assertEq(site.post.raw, RAW); assertEq(h.log.undone, ['impl-1']);
});

await t('AEO add all: only checked sections and schema; never rewrites, unchecked or taken-off ones', async () => {
  const site = fakeAeoSite(); const h = aeoHarness(site);
  const rewrite = { type: 'structure', name: 'Rename the H2', check: { verdict: 'confirmed' }, implementation: '<h2>x</h2>' };
  const unchecked = { ...FAQ, name: 'Unchecked FAQ', check: undefined };
  const dropped = { ...FAQ, name: 'Dropped', check: { verdict: 'false_alarm' } };
  const takenOff = { ...FAQ, name: 'Taken off' };
  assertEq([canAutoAdd(FAQ), canAutoAdd(rewrite), canAutoAdd(unchecked), canAutoAdd(dropped)], [true, false, false, false]);
  const fixes = new Map([[fixKey(AEO_URL, aeoOptKey(takenOff)), { status: 'removed' }]]);
  const items = [FAQ, rewrite, unchecked, dropped, takenOff].map(opt => ({ url: AEO_URL, opt }));
  const out = await runAllAeoFixes({ items, fixes, keyOf: fixKey, by: 'added automatically' }, h.depsFor);
  assertEq(out.map(o => o.opt.name + ':' + o.status.status), ['FAQ Content Section:applied', 'Taken off:removed']);
  assertEq((site.post.raw.match(/<!-- syte-aeo:/g) || []).length, 1, 'one section on the page');
});

// ── Content: publish without waiting ──
const pushState = () => ({ plan: [{ topic_title: 'Clean Article', primary_keyword: 'a' }, { topic_title: 'Warned Article', primary_keyword: 'b' }],
  articles: { 0: { status: 'ready', blog_id: 'b0' }, 1: { status: 'ready', blog_id: 'b1' } }, log: [] });
const pushDeps = over => ({
  pushedTitles: async () => new Set(), loadOutput: async () => '# Title\n\nBody text.',
  pushArticle: async ({ title }) => title === 'Clean Article'
    ? { id: 'q0', admin_url: 'a', verification: 'verified', warnings: [] }
    : { id: 'q1', admin_url: 'a', verification: 'warnings', warnings: ['SEO meta not set'] },
  ...over
});

await t('publishing: only a draft that read back clean is approved; a warned draft stays a draft, with the reason', async () => {
  const state = pushState(); const approved = [];
  await pushReadyArticles({ name: 'C' }, state, pushDeps({ approveForPublish: async id => { approved.push(id); } }), { now: () => new Date(), save: async () => {} });
  assertEq(approved, ['q0']);
  assertEq(state.articles[0].push.approved, true);
  assertEq(!!state.articles[1].push.approved, false);
  has(state.articles[1].push.held, /Left as a draft/);
});

await t('publishing: with the switch off nothing is approved', async () => {
  const state = pushState();
  await pushReadyArticles({ name: 'C' }, state, pushDeps(), { now: () => new Date(), save: async () => {} });
  assertEq([state.articles[0].push.status, !!state.articles[0].push.approved, state.articles[0].push.held], ['pushed', false, undefined]);
});

// ── The look at the live page ──
const BODY = '<p>' + 'Pallet racking keeps heavy stock off the floor and easy to reach for a forklift. '.repeat(12) + '</p>';
await t('live page check: a clean page passes; leftover labels, a double title and a dead page are flagged', async () => {
  const page = extra => '<html><body><h1>Pallet Racking Guide for Warehouses</h1>' + extra + BODY + '</body></html>';
  assertEq(checkLivePost({ status: 200, html: page(''), title: 'Pallet Racking Guide for Warehouses' }), { ok: true, problems: [] });
  const bad = checkLivePost({ status: 200, html: page('<h1>Pallet Racking Guide for Warehouses</h1><p>Meta Title: Pallet Racking</p><p>**Bold claim here**</p>'), title: 'Pallet Racking Guide for Warehouses' });
  assertEq(bad.ok, false);
  has(bad.problems.join('|'), /Meta Title/); has(bad.problems.join('|'), /showing twice/); has(bad.problems.join('|'), /stars/);
  has(checkLivePost({ status: 404, html: '', title: 'x' }).problems[0], /did not open \(error 404\)/);
  has(checkLivePost({ status: 200, html: '<html><body><p>Nothing here</p></body></html>', title: 'Pallet Racking Guide' }).problems.join('|'), /very little text/);
  const viaFetch = await lookAtLivePost('https://x.example/p/', 'Pallet Racking Guide for Warehouses', async () => ({ status: 200, ok: true, text: async () => page('') }));
  assertEq(viaFetch.ok, true);
  assertEq((await lookAtLivePost('https://x.example/p/', 't', async () => { throw new Error('timeout'); })).ok, false);
});

// ── Emails: what was done, then what needs a person ──
const KROST = { id: 'c1', name: 'Krost Shelving' };
const techState = { status: 'done', crawl: { pages: 100 }, tasks: [
  entry('t1', 'mezzanine', NEW_TITLE), entry('t2', 'racking', 'Racking Title That Is Long Enough'),
  entry('t3', 'news', 'x', 'confirmed', 'heading'), entry('t4', 'about', 'x', 'false_alarm'), entry('t5', 'contact', 'x', 'fix_wrong')
] };

await t('tech email, automatic: leads with what was done (was → now), and "nothing to do" when all is well', () => {
  const state = { ...techState, tasks: [techState.tasks[0], techState.tasks[3]] };
  const fixes = new Map([['t1', { status: 'applied', live: { status: 'verified' }, results: [{ ok: true, label: 'SEO title · Mezzanine', from: OLD_TITLE, to: NEW_TITLE }] }]]);
  const { subject, html } = buildTechSummaryEmail(KROST, state, 'https://suite.example', { fixes });
  assertEq(subject, 'Krost Shelving: technical SEO — 1 made on the site');
  has(html, /What you need to do<\/strong><div[^>]*>Nothing\. This is just to let you know/);
  has(html, /Done on the site \(1\)/); has(html, /Was:<\/span> Mezzanine Floors Benefits/); has(html, /Now:<\/span> <strong>Mezzanine Floor Benefits for Warehouses/);
  has(html, /showing on the live page/); has(html, /click <em>Undo<\/em>/);
  has(html, /1 suggestion was dropped by the checker/);
});

await t('tech email, not automatic: says exactly what to click, and sends theme fixes to the fix sheet', () => {
  const { subject, html } = buildTechSummaryEmail(KROST, techState, 'https://suite.example', { fixSheetUrl: 'https://suite.example/fix?s=c1&sig=abc' });
  assertEq(subject, 'Action needed — Krost Shelving: technical SEO — 2 waiting for your OK, 1 to look at, 1 for a developer');
  has(html, /Approve 2 fixes\.<\/strong> Open the suite → Technical SEO → New Scan → <em>Apply all<\/em>/);
  has(html, /Pass 1 fix to a developer or a Grok Bot/); has(html, /href="https:\/\/suite\.example\/fix\?s=c1&amp;sig=abc"/);
  has(html, /The checker was not sure \(1\)/);
  hasNot(html, /Done on the site/);
});

await t('tech email: a fix the site refused is an action, with the reason; a failed run says FAILED', () => {
  const fixes = new Map([['t1', { status: 'failed', reason: 'WordPress 403: not allowed' }]]);
  const { subject, html } = buildTechSummaryEmail(KROST, { ...techState, tasks: [techState.tasks[0]] }, 'u', { fixes });
  has(subject, /^Action needed — Krost Shelving: technical SEO — 1 could not be made/);
  has(html, /Could not be made \(1\)/); has(html, /WordPress 403: not allowed/);
  has(buildTechSummaryEmail(KROST, { status: 'failed', error: 'Crawl blocked', tasks: [] }, 'u').subject, /^FAILED — Krost Shelving: technical SEO run stopped/);
});

await t('AEO email: added sections must be read; page-builder pages go to the fix sheet', () => {
  const AF = { id: 'c2', name: 'Allergy Facts' };
  const home = { ...FAQ, name: 'Homepage FAQ' };
  const state = { status: 'done', rows: [{ url: AEO_URL, optimizations: [FAQ, { ...FAQ, name: 'Dropped', check: { verdict: 'false_alarm' } }] }, { url: 'https://af.example/', optimizations: [home] }] };
  const fixes = new Map([
    [fixKey(AEO_URL, aeoOptKey(FAQ)), { status: 'applied', live: { status: 'pending' }, plan: { position: 'end' } }],
    [fixKey('https://af.example/', aeoOptKey(home)), { status: 'manual', reason: 'Built in a page builder.' }]
  ]);
  const { subject, html } = buildAeoSummaryEmail(AF, state, 'u', { fixes, fixSheetUrl: 'https://suite.example/fix' });
  assertEq(subject, 'Allergy Facts: AEO — 1 made on the site, 1 for a developer');
  has(html, /Read the 1 new section on the live page/); has(html, /Added to the site \(1\)/); has(html, /Added at the end of the page/);
  has(html, /not showing yet/); has(html, /Built in a page builder/); has(html, /Open the fix sheet/);
});

await t('content email says which articles are going live and which still need an OK', () => {
  const state = pushState(); state.month = '2026-10'; state.status = 'done';
  state.articles[0].push = { status: 'pushed', approved: true, queue_id: 'q0' };
  state.articles[1].push = { status: 'pushed', held: 'Left as a draft: the check of the draft on the site found problems.', queue_id: 'q1' };
  const { html } = buildRunSummaryEmail(KROST, state, 'u');
  has(html, /going live within 15 minutes/); has(html, /1 article passed every check and is going live/);
  has(html, /Approve 1 draft\./); has(html, /Left as a draft/);
});

await t('went-live email: checked pages are marked, a flagged page becomes the thing to do', () => {
  const { subject, html } = buildPublishedEmail([
    { client: 'Krost Shelving', title: 'Racking Guide', liveUrl: 'https://k.example/racking/', auto: true, check: { ok: true, problems: [] } },
    { client: 'Krost Shelving', title: 'Shelving Guide', liveUrl: 'https://k.example/shelving/', check: { ok: false, problems: ['The title is showing twice.'] } }
  ], 'u');
  assertEq(subject, '2 posts went live (1 to look at): Krost Shelving');
  has(html, /Look at 1 live page/); has(html, /The title is showing twice/); has(html, /the live page looks right/); has(html, /published automatically/);
  has(buildPublishedEmail([{ client: 'A', title: 'x', liveUrl: 'u', check: { ok: true, problems: [] } }], 'u').html, /Nothing\. This is just to let you know/);
});

console.log(`\nautoApply: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
