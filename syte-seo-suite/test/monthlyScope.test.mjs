// "What we do for you every month" report section (monthlyScope.js).
import { defaultScope, parseScope, formatScope, monthlyScopeFor } from '../src/modules/reports/monthlyScope.js';
import { buildMicrositeHtml } from '../src/modules/reports/microsite.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function ok(c, m) { if (!c) throw new Error(m); }

const MICRO = { headline: 'H', subheadline: 'S', narrative: 'N', highlights: [] };

t('parseScope reads "Title: description" lines and strips bullets', () => {
  const items = parseScope('- Content: 4 articles\n\n• Technical SEO\nAI chat: answers: tuned');
  ok(items.length === 3, 'three items');
  ok(items[0].title === 'Content' && items[0].detail === '4 articles', 'first');
  ok(items[1].title === 'Technical SEO' && items[1].detail === '', 'title only');
  ok(items[2].detail === 'answers: tuned', 'splits on first colon only');
});

t('formatScope round-trips', () => {
  const items = defaultScope({ pages_per_month: 6 }, 'seo');
  const back = parseScope(formatScope(items));
  ok(JSON.stringify(back) === JSON.stringify(items), 'round trip');
});

t('SEO default lists only services the client buys', () => {
  const titles = defaultScope({ does_content: false, does_technical: true }, 'seo').map(i => i.title);
  ok(!titles.includes('Content'), 'no content');
  ok(titles.includes('Technical SEO'), 'technical');
});

t('AEO default quotes the real census size from the probe', () => {
  const items = defaultScope({ competitors: 'a.co.za, b.co.za' }, 'aeo',
    { engines_used: ['chatgpt', 'gemini', 'claude'], scorable_probes: 220, iterations: 3 });
  ok(items[0].detail.includes('220 real buyer prompts tested on ChatGPT, Gemini and Claude, each asked 3 times'), items[0].detail);
  ok(items[1].detail.includes('2 competitors'), 'competitor count');
});

t('client override replaces the standard scope', () => {
  const c = { monthly_scope_aeo: 'Listings feed: fixed\nChat agent: trained' };
  ok(monthlyScopeFor(c, 'aeo').map(i => i.title).join() === 'Listings feed,Chat agent', 'override');
  ok(monthlyScopeFor(c, 'seo').length > 0, 'seo falls back to standard');
});

t('microsite renders the section in both report types, escaped', () => {
  const client = { name: 'Acme', monthly_scope_seo: 'Fix <b>: done', monthly_scope_aeo: 'Census: 220 prompts' };
  const seo = buildMicrositeHtml({ micro: MICRO, client, monthLabel: 'October 2026', seoOnly: true });
  ok(seo.includes('What We Changed This Month') && seo.includes('Fix &lt;b&gt;'), 'seo section escaped');
  ok(seo.includes('The changes we made for you in October 2026'), 'changes intro');
  const std = buildMicrositeHtml({ micro: MICRO, client: { name: 'Acme' }, monthLabel: 'October 2026', seoOnly: true });
  ok(std.includes('What We Do For You Every Month') && std.includes('Your SEO programme'), 'standard scope title');
  const aeo = buildMicrositeHtml({ micro: MICRO, client, monthLabel: 'October 2026', aeoOnly: true });
  ok(aeo.includes('Census') && aeo.includes('What We Changed This Month') && !aeo.includes('Fix &lt;b&gt;'), 'aeo uses aeo list');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
