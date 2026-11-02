// Own Fixes (Chris, 29 Oct 2026): the team's own optimisations become items
// the suite can apply — checked against the real apply parsers first, so a
// vague item is sent back instead of becoming a by-hand task.

import { normaliseOwnFixes, resolvePageUrl, fixShapeProblem, additionsByPage, OWN_SOURCE, OWN_FIXES_SYSTEM } from '../src/modules/technical/ownFixes.js';
import { parseFixValues } from '../netlify/functions/lib/techFix.js';
import { ruleFromTask } from '../netlify/functions/lib/helperFix.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const has = (s, re, l) => { if (!re.test(String(s))) throw new Error((l || '') + ' missing ' + re + ' in ' + String(s).slice(0, 160)); };

const CLIENT = { id: 'c1', name: 'Krost Shelving', url: 'https://www.krostshelving.com/' };
const opts = { now: new Date('2026-11-02T12:00:00Z'), uuid: () => 'uuid-1' };

t('page addresses: paths get the client\'s site; other websites are refused', () => {
  eq(resolvePageUrl('/about/', CLIENT), 'https://www.krostshelving.com/about/');
  eq(resolvePageUrl('krostshelving.com/racking/', CLIENT), 'https://krostshelving.com/racking/');
  eq(resolvePageUrl('https://other.example/page/', CLIENT), '');
  eq(resolvePageUrl('', CLIENT), '');
});

t('a title fix in the right shape becomes a board task the apply code can read', () => {
  const n = normaliseOwnFixes({ items: [{ kind: 'fix', fix_type: 'meta_title', page_url: '/about/', title: 'New title on About', copy_paste_fix: '<title>Industrial Shelving & Racking | Krost</title>' }] }, CLIENT, opts);
  eq(n.rejected, []);
  eq(n.fixes.length, 1);
  const task = n.fixes[0];
  eq([task.client_id, task.status, task.data_source, task.page_url, task.fix_type], ['c1', 'open', OWN_SOURCE, 'https://www.krostshelving.com/about/', 'meta_title']);
  eq(parseFixValues(task).value, 'Industrial Shelving & Racking | Krost', 'the real parser reads it');
});

t('H1, schema, canonical, robots and redirect fixes are accepted only in shapes the plugin path reads', () => {
  const ok = ['Keep exactly one: <h1>Warehouse Racking</h1>', 'Change <h1>Latest News</h1> to <h2>Latest News</h2>', '<h1>Contact Us</h1>'];
  for (const f of ok) eq(fixShapeProblem('h1', f), '', f);
  has(fixShapeProblem('h1', 'make the heading bigger'), /which heading/);
  eq(fixShapeProblem('schema', '<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage"}</script>'), '');
  has(fixShapeProblem('schema', '<script type="application/ld+json">{bad json}</script>'), /valid JSON/);
  eq(fixShapeProblem('canonical', '<link rel="canonical" href="https://www.krostshelving.com/racking/">'), '');
  eq(fixShapeProblem('robots', '<meta name="robots" content="index, follow">'), '');
  eq(fixShapeProblem('redirect', 'Redirect 301 /old-racking https://www.krostshelving.com/racking/'), '');
  has(fixShapeProblem('redirect', 'redirect the old page'), /Redirect 301/);
  // and the plugin path really does turn them into rules
  eq(ruleFromTask({ fix_type: 'h1', page_url: 'https://www.krostshelving.com/x/', copy_paste_fix: ok[0] }).rule.mode, 'keep_one');
  eq(ruleFromTask({ fix_type: 'redirect', page_url: 'https://www.krostshelving.com/old-racking', copy_paste_fix: 'Redirect 301 /old-racking https://www.krostshelving.com/racking/' }).rule.type, 'redirect');
});

t('vague or unsupported items are sent back with a reason, not saved', () => {
  const n = normaliseOwnFixes({ items: [
    { kind: 'fix', fix_type: 'meta_description', page_url: '/about/', copy_paste_fix: 'make it better' },
    { kind: 'fix', fix_type: 'layout', page_url: '/about/', copy_paste_fix: 'move the sidebar' },
    { kind: 'fix', fix_type: 'meta_title', page_url: 'https://other.example/', copy_paste_fix: '<title>Good enough title here</title>' },
    { kind: 'addition', page_url: '/about/', name: 'FAQ', type: 'content', where: 'end of the content', implementation: '<h2>FAQ</h2><p>Call [PHONE NUMBER] to book.</p>' }
  ], notes: ['Rewording the intro paragraph needs a person.'] }, CLIENT, opts);
  eq(n.fixes.length + n.additions.length, 0);
  eq(n.rejected.length, 4);
  has(n.rejected[0].reason, /stated plainly/); has(n.rejected[1].reason, /Not a kind of fix/); has(n.rejected[2].reason, /not on https:\/\/www\.krostshelving\.com/); has(n.rejected[3].reason, /placeholder/);
  eq(n.notes, ['Rewording the intro paragraph needs a person.']);
});

t('additions keep the AEO shape, place answers at the top and FAQs at the end, and dedupe by page + name', () => {
  const faq = { kind: 'addition', page_url: '/racking/', name: 'FAQ section', type: 'content', where: 'end of the content', implementation: '<h2>Frequently asked questions</h2><h3>What load can pallet racking take?</h3><p>Most selective racking carries 1,000 to 3,000 kg per level, depending on the beam.</p>' };
  const ans = { kind: 'addition', page_url: '/racking/', name: 'Answer block', type: 'content', where: 'after the H1', implementation: '<p><strong>Pallet racking</strong> is steel shelving built to hold palletised goods, reached by forklift, in selective, drive-in or push-back layouts.</p>' };
  const n = normaliseOwnFixes({ items: [faq, ans, faq] }, CLIENT, opts);
  eq(n.rejected, []);
  eq(n.additions.map(a => a.opt.name), ['FAQ section', 'Answer block']);
  eq(n.additions.every(a => a.opt.own === true && a.opt.check === undefined), true, 'own, and never part of the automatic run');
  const pages = additionsByPage(n.additions);
  eq(pages.length, 1); eq(pages[0].url, 'https://www.krostshelving.com/racking/'); eq(pages[0].opts.length, 2);
});

t('the prompt spells out every shape the apply code reads', () => {
  for (const s of ['<title>', 'name="description"', '<img src', 'Keep exactly one', 'application/ld+json', 'rel="canonical"', 'name="robots"', 'Redirect 301', 'after the H1', 'end of the content', 'Never use placeholders']) has(OWN_FIXES_SYSTEM, new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), s);
});

console.log(`\nownFixes: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
