// Per-client CSS (Chris's styling request): only what styles article content
// is kept, it can never reach the rest of the site, and it only goes where the
// site keeps it inside its <style> tag.

import { scopeClientCss, scopeSelector, withClientCss, SCOPE, MAX_BYTES } from '../src/modules/cms/clientCss.js';
import { checkDraftContent } from '../src/modules/cms/verifyDraft.js';
import { planAeoFix } from '../netlify/functions/lib/aeoFix.js';
import { planAeoFixShopify } from '../netlify/functions/lib/shopifyAeo.js';
import { PROFILE_DEFAULTS } from '../src/modules/cms/publishingProfile.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
const eq = (a, b, label) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const has = (s, re, label) => { if (!re.test(String(s))) throw new Error((label || '') + ' missing ' + re + ' in ' + String(s).slice(0, 200)); };
const hasNot = (s, re, label) => { if (re.test(String(s))) throw new Error((label || '') + ' should not contain ' + re + ' in ' + String(s).slice(0, 200)); };

const THEME = `@import url('https://fonts.googleapis.com/css2?family=Lato&display=swap');
@import url('https://evil.example/x.css');
/* theme */
:root{--brand:#0a5}
body{font-family:Lato,sans-serif;color:#222}
.site-header nav a{color:red}
header .logo{width:200px}
#main h2{color:blue}
h1,h2,.entry-content h3{font-family:'Playfair Display';color:var(--brand)}
.has-black-color{color:#000!important}
.wp-block-table td{border:1px solid #ddd;padding:8px}
.cookie-banner{position:fixed;bottom:0}
.footer-widgets h4{color:white}
@media (max-width:600px){h2{font-size:22px}.sidebar{display:none}}
@keyframes spin{to{transform:rotate(1turn)}}
@font-face{font-family:Brand;src:url(/f.woff2)}
.entry-content{line-height:1.7}
p a:hover{text-decoration:underline}
h2 </style><script>alert(1)</script>{color:red}`;

await t('keeps article styling (fonts, headings, tables, the team\'s classes), confined to our content', () => {
  const r = scopeClientCss(THEME);
  has(r.css, /^@import url\('https:\/\/fonts\.googleapis\.com/, 'font import first');
  has(r.css, /\.syte-content\{--brand:#0a5\}/);
  has(r.css, /\.syte-content\{font-family:Lato,sans-serif; color:#222\}/, 'body → our wrapper');
  has(r.css, /\.syte-content h1, \.syte-content h2, \.syte-content h3\{font-family:'Playfair Display'/, '.entry-content h3 → our h3');
  has(r.css, /\.syte-content \.has-black-color\{color:#000!important\}/);
  has(r.css, /\.syte-content \.wp-block-table td\{/);
  has(r.css, /@media \(max-width:600px\)\{\.syte-content h2\{font-size:22px\}\}/);
  has(r.css, /\.syte-content\{line-height:1\.7\}/, 'the article area itself');
  has(r.css, /@font-face\{font-family:Brand/);
  has(r.css, /\.syte-content p a:hover/);
});

await t('leaves out everything that isn\'t article content, and anything unsafe', () => {
  const r = scopeClientCss(THEME);
  hasNot(r.css, /evil\.example/, 'outside imports');
  hasNot(r.css, /nav|logo|#main|cookie|footer|sidebar|keyframes/i, 'layout parts, ids, banners, animations');
  hasNot(r.css, /position:\s*fixed/);
  hasNot(r.css, /<\/style|<script/i, 'can never close its <style> tag');
  // every rule is either a font/at-rule or starts with our scope
  for (const line of r.css.split('\n')) if (!/^@/.test(line)) has(line, /^\.syte-content/, 'scoped: ' + line);
  if (r.kept < 8 || r.dropped < 5) throw new Error('kept ' + r.kept + ', dropped ' + r.dropped);
});

await t('selectors: page-level and article-area prefixes collapse onto our wrapper; others are dropped', () => {
  eq(scopeSelector('body'), SCOPE);
  eq(scopeSelector('.entry-content'), SCOPE);
  eq(scopeSelector('body.single .entry-content h2'), SCOPE + ' h2');
  eq(scopeSelector('article .rte > table td'), SCOPE + ' table td');
  eq(scopeSelector('.wp-block-quote'), SCOPE + ' .wp-block-quote');
  eq(scopeSelector('.site-content .widget h2'), null);
  eq(scopeSelector('div'), null, 'a bare div is layout');
  eq(scopeSelector('#hero h1'), null);
});

await t('a huge theme file is trimmed to the size limit, never cut mid-rule', () => {
  const big = Array.from({ length: 3000 }, (_, i) => '.c' + i + ' p{color:#' + String(i % 999).padStart(3, '0') + '}').join('\n');
  const r = scopeClientCss(big);
  eq(r.truncated, true);
  if (r.css.length > MAX_BYTES) throw new Error('over the limit: ' + r.css.length);
  has(r.css.trim().split('\n').pop(), /\}$/, 'last rule complete');
});

await t('wrapping: one <style> + the content in .syte-content; idempotent; nothing when no CSS', () => {
  const once = withClientCss('<h2>Hi</h2>', '.syte-content h2{color:red}');
  eq(once, '<style data-syte="client-css">.syte-content h2{color:red}</style>\n<div class="syte-content"><h2>Hi</h2></div>');
  eq(withClientCss(once, '.syte-content h3{}'), '<style data-syte="client-css">.syte-content h3{}</style>\n<div class="syte-content"><h2>Hi</h2></div>', 'replaced, not doubled');
  eq(withClientCss('<h2>Hi</h2>', ''), '<h2>Hi</h2>');
  eq(PROFILE_DEFAULTS.client_css, null, 'off unless uploaded');
});

await t('draft read-back: CSS inside its tag is fine; CSS showing as text (site stripped the tag) fails', () => {
  const body = '<p>' + 'A proper paragraph of article text that is long enough to count as content. '.repeat(3) + '</p>';
  const kept = checkDraftContent({ html: withClientCss(body, '.syte-content h2{color:red}') });
  eq(kept.findings.find(f => f.name === 'Client CSS not showing as text')?.ok, true);
  eq(kept.findings.find(f => f.name === 'Content present')?.ok, true);
  const stripped = checkDraftContent({ html: '.syte-content h2{color:red}\n<div class="syte-content">' + body + '</div>' });
  eq(stripped.level, 'failed');
  has(stripped.problems.join(' '), /shows as text/);
  eq(checkDraftContent({ html: body }).findings.some(f => f.name === 'Client CSS not showing as text'), false, 'no check without our CSS');
});

// ── AEO additions carry it — only where the site keeps it ──
const RAW = '<p>A first allergy appointment usually starts with a detailed conversation about your symptoms and history.</p>\n<p>Skin prick tests are quick, and results are usually ready within twenty minutes of the test being done.</p>\n<p>Your allergist will then explain the results and agree a management plan that suits your daily life.</p>';
const LIVE = '<html><body><h1>First appointment</h1><div class="post-content">' + RAW + '</div></body></html>';
const FAQ = { type: 'content', name: 'FAQ section', where: 'After the main content', implementation: '<h2>Frequently asked questions</h2><h3>How long does it take?</h3><p>Usually about an hour, including testing and discussion.</p>' };
const URL_ = 'https://af.example/first-appointment/';
const fakeWp = (unfiltered) => async (path) => {
  if (path.startsWith('wp/v2/users/me')) return { capabilities: { unfiltered_html: unfiltered } };
  if (path.startsWith('wp/v2/pages?slug=')) return [];
  if (path.startsWith('wp/v2/posts?slug=first-appointment')) return [{ id: 7, link: URL_, meta: {} }];
  if (path.startsWith('wp/v2/posts?slug=')) return [];
  if (path.startsWith('wp/v2/posts?status=publish')) return [];
  if (path.startsWith('wp/v2/posts/7')) return { content: { raw: RAW, rendered: RAW } };
  throw new Error('unexpected ' + path);
};
const CSS = '.syte-content h2{color:#123}';

await t('WordPress AEO section: CSS added for an Administrator login, left out otherwise (it would show as text)', async () => {
  const admin = await planAeoFix({ url: URL_, opt: FAQ, optKey: 'content::faq', clientCss: CSS }, fakeWp(true), async () => LIVE);
  eq(admin.applicable, true);
  has(admin.html, /^<style data-syte="client-css">\.syte-content h2\{color:#123\}<\/style>\n<div class="syte-content">/);
  has(admin.renderedPreview, /data-syte="client-css"/, 'the preview shows it too');
  const editor = await planAeoFix({ url: URL_, opt: FAQ, optKey: 'content::faq', clientCss: CSS }, fakeWp(false), async () => LIVE);
  hasNot(editor.html, /<style|syte-content/);
  const none = await planAeoFix({ url: URL_, opt: FAQ, optKey: 'content::faq' }, fakeWp(true), async () => LIVE);
  hasNot(none.html, /<style/, 'no CSS uploaded → nothing added');
});

await t('Shopify AEO section: CSS added (Shopify keeps <style> in content)', async () => {
  const sh = async (path) => {
    if (path.startsWith('blogs.json')) return { blogs: [{ id: 1 }] };
    if (path.startsWith('blogs/1/articles.json')) return { articles: [{ id: 9, title: 'A', body_html: RAW }] };
    throw new Error('unexpected ' + path);
  };
  const plan = await planAeoFixShopify({ url: 'https://shop.example/blogs/news/a', opt: FAQ, optKey: 'content::faq', clientCss: CSS }, sh, async () => LIVE);
  eq(plan.applicable, true);
  has(plan.html, /<style data-syte="client-css">/);
});

console.log(`\nclientCss: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
