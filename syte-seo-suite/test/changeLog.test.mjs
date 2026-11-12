// "What we changed this month" (changeLog.js + microsite section).
import { changeLog } from '../src/modules/reports/changeLog.js';
import { buildMicrositeHtml } from '../src/modules/reports/microsite.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function ok(c, m) { if (!c) throw new Error(m); }

const C = 'client-1';
const row = (o) => ({ client_id: C, module: 'aeo', verification_status: 'verified', implemented_at: '2026-10-10T08:00:00Z', page_url: 'https://acme.co.za/offices/', title: 'FAQ section', ...o });
const IMPLS = [
  row({}),
  row({ implemented_at: '2026-10-12T08:00:00Z' }),                       // same change re-logged: one change
  row({ title: 'Direct answer', verification_status: 'sent_to_developer' }),
  row({ title: 'Pending one', verification_status: 'pending' }),         // not delivered
  row({ title: 'Undone', verification_status: 'failed' }),               // removed
  row({ title: 'Other client', client_id: 'other' }),
  row({ title: 'Broken link fixed', module: 'technical', change_type: 'fix' }),
  row({ title: 'September change', implemented_at: '2026-09-20T08:00:00Z' }),
  row({ title: 'August change', implemented_at: '2026-08-02T08:00:00Z' }),
  row({ title: 'August change 2', implemented_at: '2026-08-03T08:00:00Z' })
];

t('only delivered changes for this client, report module and month', () => {
  const r = changeLog(IMPLS, { clientId: C, kind: 'aeo', month: '2026-10' });
  ok(r.total === 2, 'total ' + r.total);
  ok(r.items.map(i => i.title).join() === 'FAQ section,Direct answer', r.items.map(i => i.title).join());
  ok(r.items[0].page === '/offices/' && r.items[0].status === 'Live on your site', 'live');
  ok(r.items[1].status === 'Sent to your developer', 'handover');
});

t('SEO report shows technical/content changes only', () => {
  const r = changeLog(IMPLS, { clientId: C, kind: 'seo', month: '2026-10' });
  ok(r.total === 1 && r.items[0].title === 'Broken link fixed' && r.items[0].type === 'Technical fix', JSON.stringify(r.items));
});

t('month-to-month history, oldest first, ending at the report month', () => {
  const r = changeLog(IMPLS, { clientId: C, kind: 'aeo', month: '2026-10', months: 4 });
  ok(r.history.map(h => h.month + ':' + h.count).join() === '2026-07:0,2026-08:2,2026-09:1,2026-10:2', r.history.map(h => h.month + ':' + h.count).join());
});

t('first line of a title only, no HTML', () => {
  const r = changeLog([row({ title: '<b>Schema</b> added\n<script>x</script>' })], { clientId: C, kind: 'aeo', month: '2026-10' });
  ok(r.items[0].title === 'Schema added', r.items[0].title);
});

const MICRO = { headline: 'H', subheadline: 'S', narrative: 'N', highlights: [] };

t('report renders the changes table and the monthly strip', () => {
  const html = buildMicrositeHtml({ micro: MICRO, client: { id: C, name: 'Acme' }, monthLabel: 'October 2026', monthKey: '2026-10', implementations: IMPLS, aeoOnly: true });
  ok(html.includes('What We Changed This Month'), 'heading');
  ok(html.includes('2 changes made for you in October 2026'), 'count line');
  ok(html.includes('/offices/') && html.includes('Sent to your developer'), 'rows');
  ok(html.includes('change-history') && html.includes('Changes delivered per month'), 'strip');
  ok(!html.includes('Broken link fixed'), 'no SEO changes in the AEO report');
  ok(!html.includes('What We Do For You Every Month'), 'no standing scope when changes exist');
});

t('no changes and nothing typed: standing scope instead', () => {
  const html = buildMicrositeHtml({ micro: MICRO, client: { id: C, name: 'Acme' }, monthLabel: 'June 2026', monthKey: '2026-06', implementations: IMPLS, aeoOnly: true });
  ok(html.includes('What We Do For You Every Month') && !html.includes('What We Changed This Month'), 'fallback');
});

t('typed items show alongside the logged changes', () => {
  const html = buildMicrositeHtml({ micro: MICRO, client: { id: C, name: 'Acme', monthly_scope_aeo: 'New website: launched 6 October' }, monthLabel: 'October 2026', monthKey: '2026-10', implementations: IMPLS, aeoOnly: true });
  ok(html.includes('/offices/') && html.includes('New website'), 'both');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
