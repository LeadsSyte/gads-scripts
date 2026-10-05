// The Syte SEO Helper plugin's side of the suite: turning a scan task into a
// rule, checking the preview shows the intended effect before offering it,
// and falling back to the plugin only for what a post's own fields can't do.
// A fake plugin API and fake pages (the real plugin is exercised in
// test/live/helper-live.mjs).

import { ruleFromTask, verifyRule, readPage, planHelperFix, wpTechOps, wpAeoOps, helperStatus } from '../netlify/functions/lib/helperFix.js';
import { runTechFix, canAutoFix } from '../netlify/functions/lib/techFixRun.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
const eq = (a, b, label) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const has = (s, re, label) => { if (!re.test(String(s))) throw new Error((label || '') + ' missing ' + re + ' in ' + String(s).slice(0, 120)); };

const U = 'https://krost.example/racking-guide/';
const task = (fix_type, fix, over = {}) => ({ id: 't1', fix_type, page_url: U, copy_paste_fix: fix, title: 'Fix', ...over });

await t('scan tasks become rules: the real shapes the triage writes', () => {
  const dup = ruleFromTask(task('h1', 'Keep exactly ONE instance of: <h1>Gaming Desks South Africa</h1>\nRemove the second duplicate H1 tag.'));
  eq(dup.rule, { type: 'heading', mode: 'keep_one', path: '/racking-guide/', text: 'Gaming Desks South Africa', to: 2 });
  const krost = ruleFromTask(task('h1', 'change: <h1>Latest News</h1> to: <h2>Latest News</h2>.', { title: 'Fix site-wide duplicate H1 caused by blog post template' }));
  eq(krost.rule, { type: 'heading', mode: 'demote', path: '*', text: 'Latest News', to: 2 });
  eq(ruleFromTask(task('h1', 'Change <h1>Latest News</h1> to <h2>Latest News</h2>', { title: 'Duplicate H1 on this post' })).rule.path, '/racking-guide/', 'one page unless filed as site-wide');
  eq(ruleFromTask(task('h1', '<h1>Contact &amp; Book Direct</h1>')).rule, { type: 'heading', mode: 'promote', path: '/racking-guide/', text: 'Contact & Book Direct', to: 1 });
  eq(ruleFromTask(task('canonical', '<link rel="canonical" href="https://krost.example/racking-guide/" />')).rule, { type: 'canonical', path: '/racking-guide/', url: 'https://krost.example/racking-guide/' });
  eq(ruleFromTask(task('robots', '<meta name="robots" content="noindex, follow">')).rule.value, 'noindex');
  eq(ruleFromTask(task('robots', '<meta name="robots" content="index, follow">')).rule.value, 'index');
  eq(ruleFromTask(task('redirect', 'Then add a 301 redirect:\n\nRedirect 301 /hello-world-2/ https://krost.example/')).rule, { type: 'redirect', path: '/hello-world-2/', to: 'https://krost.example/', code: 301 });
  const schema = ruleFromTask(task('structured_data', '<script type="application/ld+json">\n{"@context":"https://schema.org","@type":"Service","name":"Racking"}\n</script>'));
  eq([schema.rule.type, schema.rule.json['@type']], ['schema', 'Service']);
  eq(ruleFromTask(task('meta_title', '<title>Shelving Suppliers | Krost Shelving</title>', { page_url: 'https://krost.example/' })).rule, { type: 'title', path: '/', value: 'Shelving Suppliers | Krost Shelving' });
  const px = ruleFromTask(task('image_alt', '<img src="https://www.facebook.com/tr?id=1" alt="">\n<img src="https://krost.example/wp-content/uploads/hero-1024x512.jpg" alt="Pallet racking in a Krost warehouse">', { title: 'Fix site-wide Facebook Pixel rendered as <img> with missing alt text — affects all 100 crawled pages' }));
  eq(px.rule, { type: 'image_alt', path: '*', images: [{ src: 'https://krost.example/wp-content/uploads/hero-1024x512.jpg', alt: 'Pallet racking in a Krost warehouse' }] }, 'only images with alt text; site-wide from the title');
  eq(ruleFromTask(task('image_alt', '<img src="https://krost.example/wp-content/uploads/team.jpg" alt="The Krost team">', { title: 'Add missing alt text to About page team images' })).rule.path, '/racking-guide/');
});

await t('anything that needs a decision, has placeholders, or leaves the site is left for a person', () => {
  has(ruleFromTask(task('robots', 'Option A (keep noindex): <meta name="robots" content="noindex, follow"> Option B (redirect): install Redirection.')).manual, /decision/);
  has(ruleFromTask(task('robots', 'Step 1: Visit /robots.txt and check for Disallow: /')).manual, /robots\.txt/);
  has(ruleFromTask(task('structured_data', '<script type="application/ld+json">{"@type":"LodgingBusiness","telephone":"+27000000000"}</script>')).manual, /placeholder/);
  has(ruleFromTask(task('structured_data', '<script type="application/ld+json">{bad json</script>')).manual, /not valid JSON/);
  has(ruleFromTask(task('canonical', '<link rel="canonical" href="https://other-site.example/x/" />')).manual, /different website/);
  has(ruleFromTask(task('redirect', 'RewriteRule ^ask$ /ask/ [R=301,L]\n\nOR, if using a canonical tag, add <link rel="canonical" href="https://krost.example/ask/" />')).manual, /option/);
  has(ruleFromTask(task('redirect', 'Redirect 301 / https://krost.example/new/')).manual, /home page/);
  has(ruleFromTask(task('page_speed', 'Compress the images')).manual, /developer/);
  has(ruleFromTask(task('h1', 'The page has two headings, tidy them up.')).manual, /needs a person/);
});

const html = ({ h1 = ['Racking Guide'], title = 'Racking Guide', canonical = '', robots = '', extra = '' } = {}) =>
  '<html><head><title>' + title + '</title>' + (canonical ? '<link rel="canonical" href="' + canonical + '">' : '') + (robots ? '<meta name="robots" content="' + robots + '">' : '') + '</head><body><!-- <h1>in a comment</h1> --><script>var x = "<h1>in a script</h1>";</script>' + h1.map(x => '<h1 class="t">' + x + '</h1>').join('') + '<main><p>Body</p>' + extra + '</main></body></html>';

await t('the preview must show the intended effect, or the fix is not offered', () => {
  eq(readPage(html({ h1: ['A', 'B'] })).h1, ['A', 'B'], 'headings in comments and scripts are ignored');
  const hr = { id: 'tech-t1', type: 'heading', mode: 'demote', path: '/racking-guide/', text: 'Latest News' };
  eq(verifyRule(hr, { html: html({ h1: ['Latest News', 'Racking Guide'] }) }, { html: html({ h1: ['Racking Guide'] }) }).ok, true);
  has(verifyRule(hr, { html: html({ h1: ['Latest News', 'Racking Guide'] }) }, { html: html({ h1: ['Latest News', 'Racking Guide'] }) }).detail, /2 main headings/);
  has(verifyRule(hr, { html: html() }, { html: html() }).detail, /already has exactly one/);
  has(verifyRule({ ...hr, mode: 'promote' }, { html: html({ h1: [] }) }, { html: html({ h1: [] }) }).detail, /no heading with that wording/);
  eq(verifyRule({ id: 'x', type: 'canonical', url: U }, null, { html: html({ canonical: U }) }).ok, true);
  eq(verifyRule({ id: 'x', type: 'canonical', url: U }, null, { html: html({ canonical: 'https://krost.example/other/' }) }).ok, false);
  eq(verifyRule({ id: 'x', type: 'robots', value: 'noindex' }, null, { html: html({ robots: 'noindex, follow' }) }).ok, true);
  eq(verifyRule({ id: 'x', type: 'robots', value: 'index' }, null, { html: html({ robots: 'noindex, follow' }) }).ok, false);
  eq(verifyRule({ id: 'x', type: 'redirect', to: 'https://krost.example/' }, null, { status: 301, location: 'https://krost.example/', html: '' }).ok, true);
  eq(verifyRule({ id: 'x', type: 'redirect', to: 'https://krost.example/' }, null, { status: 200, location: '', html: 'x' }).ok, false);
  eq(verifyRule({ id: 'tech-s', type: 'schema' }, null, { html: html({ extra: '<script type="application/ld+json" data-syte="tech-s">{}</script>' }) }).ok, true);
  eq(verifyRule({ id: 'aeo-1', type: 'insert_html' }, null, { html: html({ extra: '<!-- syte:aeo-1 --><p>x</p>' }) }).ok, true);
  eq(verifyRule({ id: 'x', type: 'title', value: 'New Title' }, null, { html: html({ title: 'New Title' }) }).ok, true);
  const imgRule = { id: 'x', type: 'image_alt', images: [{ src: 'https://krost.example/wp-content/uploads/hero-1024x512.jpg', alt: 'Pallet racking' }] };
  eq(verifyRule(imgRule, null, { html: html({ extra: '<img class="hero" src="https://krost.example/wp-content/uploads/hero-600x300.jpg" alt="Pallet racking">' }) }).ok, true, 'any size variant of the same file');
  has(verifyRule(imgRule, null, { html: html({ extra: '<img src="https://krost.example/wp-content/uploads/hero.jpg" alt="">' }) }).detail, /did not take/);
  has(verifyRule(imgRule, null, { html: html() }).detail, /None of those images/);
});

// A fake plugin: rules kept in a Map; a fake site whose pages reflect them.
function fakeSite({ installed = true, effective = true } = {}) {
  const rules = new Map();
  const calls = [];
  const wp = async (path, body, method) => {
    calls.push((method || (body ? 'POST' : 'GET')) + ' ' + path);
    if (path.startsWith('wp/v2/pages?slug=') || path.startsWith('wp/v2/posts?slug=')) return [];
    if (!installed) throw new Error('WordPress 404: No route was found');
    if (path === 'syte/v1/status') return { plugin: 'syte-seo-helper', version: '1.0.0' };
    const id = (path.match(/^syte\/v1\/rules\/([\w-]+)$/) || [])[1];
    if (id && method === 'DELETE') { rules.delete(id); return { deleted: true }; }
    if (id && body) { const r = { ...body, id }; rules.set(id, r); return r; }
    if (id) { if (!rules.has(id)) throw new Error('WordPress 404: No such rule.'); return rules.get(id); }
    throw new Error('unexpected ' + path);
  };
  const fetchPage = async (url) => {
    const token = (url.match(/syte_preview=([a-f0-9]+)/) || [])[1];
    const on = [...rules.values()].filter(r => r.enabled || (token && r.preview === token));
    const demoted = effective && on.some(r => r.type === 'heading');
    return { status: 200, location: '', html: html({ h1: demoted ? ['Racking Guide'] : ['Latest News', 'Racking Guide'] }) };
  };
  return { wp, rules, calls, fetchPage };
}
const KROST = { task: task('h1', 'change: <h1>Latest News</h1> to: <h2>Latest News</h2>', { title: 'Fix site-wide duplicate H1 caused by blog post template' }), check: { verdict: 'confirmed' } };
const deps = (site, over = {}) => ({ wp: site.wp, ops: wpTechOps({ fetchPage: site.fetchPage }), fetchHtml: async () => '', save: async s => s, recordApplied: async () => 'impl', recordUndone: async () => {}, ...over });

await t('preview saves the rule switched off; apply switches it on; undo deletes it', async () => {
  const site = fakeSite();
  const planned = await runTechFix({ entry: KROST, action: 'plan' }, deps(site));
  eq(planned.status, 'planned');
  const rule = site.rules.get('tech-t1');
  eq([rule.enabled, rule.path, /^[a-f0-9]{32}$/.test(rule.preview)], [false, '*', true]);
  has(planned.plan.preview_url, /^https:\/\/krost\.example\/racking-guide\/\?syte_preview=[a-f0-9]{32}$/);
  eq(planned.plan.changes[0].from, '2 main headings: "Latest News", "Racking Guide"');
  has(planned.plan.note, /every page/);

  const applied = await runTechFix({ entry: KROST, action: 'apply', prev: planned }, deps(site));
  eq([applied.status, applied.live.status], ['applied', 'verified']);
  eq([site.rules.get('tech-t1').enabled, site.rules.get('tech-t1').preview], [true, ''], 'on, and the preview token is gone');

  const undone = await runTechFix({ entry: KROST, action: 'undo', prev: applied }, deps(site));
  eq(undone.status, 'undone'); eq(site.rules.size, 0);
});

await t('a rule that does not have the intended effect is removed again and left for a person', async () => {
  const site = fakeSite({ effective: false });
  const s = await runTechFix({ entry: KROST, action: 'plan' }, deps(site));
  eq(s.status, 'manual'); has(s.reason, /2 main headings/);
  eq(site.rules.size, 0, 'nothing left on the site');
});

await t('without the plugin the fix stays manual, and says the plugin would do it', async () => {
  const site = fakeSite({ installed: false });
  eq(await helperStatus(site.wp), null);
  const s = await runTechFix({ entry: KROST, action: 'plan' }, deps(site));
  eq(s.status, 'manual'); has(s.reason, /Syte SEO Helper plugin/);
});

await t('plugin fixes are never part of "Apply all" or the automatic run', () => {
  eq(canAutoFix(KROST), false);
  eq(canAutoFix({ task: task('structured_data', 'x'), check: { verdict: 'confirmed' } }), false);
});

await t('AEO: only "can\'t reach this page\'s content" falls back to the plugin', async () => {
  const site = fakeSite();
  const ops = wpAeoOps({ fetchPage: async (url) => ({ status: 200, location: '', html: html({ extra: /syte_preview=/.test(url) ? '<!-- syte:' + [...site.rules.keys()][0] + ' --><p>x</p>' : '' }) }) });
  const opt = { type: 'content', name: 'Answer Block — direct answer after H1', where: 'Directly after the H1', check: { verdict: 'confirmed' }, implementation: '<p><strong>Krost</strong> supplies industrial shelving and racking across South Africa.</p>' };
  const plan = await ops.plan({ url: 'https://krost.example/', opt, optKey: 'content::x' }, site.wp, async () => '');
  eq([plan.applicable, plan.helper, plan.position], [true, true, 'top']);
  const rule = [...site.rules.values()][0];
  eq([rule.type, rule.position, rule.path, rule.enabled], ['insert_html', 'after_h1', '/', false]);
  eq((await ops.apply(plan, site.wp)).ok, true); eq([...site.rules.values()][0].enabled, true);
  eq((await ops.undo(plan, site.wp)).ok, true); eq(site.rules.size, 0);
  // A suggestion with placeholders is refused before the plugin is even asked.
  const bad = await ops.plan({ url: 'https://krost.example/', opt: { ...opt, implementation: '<p>Call us on [PHONE NUMBER] today for a quote on shelving.</p>' }, optKey: 'content::y' }, site.wp, async () => '');
  eq(bad.applicable, false); has(bad.reason, /placeholder/); eq(site.rules.size, 0);
});

console.log(`\nhelperFix: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
