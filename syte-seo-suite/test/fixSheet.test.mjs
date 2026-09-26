// Fix sheet: only the work the suite can't apply itself, each item with
// what / where / how to check — for a developer or a Grok Bot.

import { buildFixSheet, renderFixSheetText, renderFixSheetHtml } from '../src/modules/technical/fixSheet.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

const WP = { name: 'Krost Shelving', url: 'https://krost.example', cms_type: 'WordPress' };
const task = (id, fix_type, extra = {}) => ({ id, status: 'open', fix_type, title: fix_type + ' task', page_url: 'https://krost.example/' + id + '/', priority: 'high',
  description: 'Problem.\n\n✓ Independent check: confirmed — Really missing.', copy_paste_fix: 'Change <h1>Latest News</h1> to <h2>', ...extra });
const TASKS = [
  task('a', 'h1', { priority: 'critical' }),
  task('b', 'meta_title'),                                   // suite applies it → not on the sheet
  task('c', 'meta_title'),                                   // suite couldn't (manual) → on the sheet
  task('d', 'image_alt', { description: 'x\n\n⚠ Independent check: the fix itself looks wrong — review before briefing — placeholder' }),
  task('e', 'redirect', { status: 'done' })
];
const AEO = [{ url: 'https://krost.example/', optimizations: [
  { type: 'content', name: 'FAQ section', description: 'Add FAQs', implementation: '<h2>FAQ</h2>', where: 'After the hero', check: { verdict: 'confirmed', reason: 'Missing.' } },
  { type: 'structure', name: 'Heading hierarchy', description: 'Fix H2s', implementation: 'Rename…', check: { verdict: 'confirmed', reason: 'Skips levels.' } },
  { type: 'content', name: 'Redundant block', implementation: '<p>x</p>', check: { verdict: 'false_alarm', reason: 'Already there.' } }
] }];

await t('only work the suite can\'t do, most important first', () => {
  const s = buildFixSheet({ client: WP, techTasks: TASKS, techFixes: { c: { status: 'manual', reason: 'SEO fields hidden (needs PHP snippet)' } },
    aeoRows: AEO, aeoFixes: { 'https://krost.example/|content::FAQ section': { status: 'manual', reason: 'Homepage is built in a page builder' } } });
  const titles = s.items.map(i => i.title);
  assertEq(titles[0], 'h1 task', 'critical first');
  if (titles.includes('image_alt task')) throw new Error('a fix the reviewer called wrong was briefed');
  if (s.items.some(i => i.page_url.endsWith('/b/'))) throw new Error('suite-applicable fix listed');
  if (!s.items.some(i => i.page_url.endsWith('/c/') && /PHP snippet/.test(i.where))) throw new Error('manual fallback missing its reason');
  if (s.items.some(i => i.page_url.endsWith('/e/'))) throw new Error('done task listed');
  if (!titles.includes('Heading hierarchy')) throw new Error('structure item missing');
  if (!titles.includes('FAQ section')) throw new Error('page-builder AEO item missing');
  if (titles.includes('Redundant block')) throw new Error('false alarm listed');
  assertEq(s.suite_can_do, 1);
});

await t('every item says where to change it and how to check it', () => {
  const s = buildFixSheet({ client: WP, techTasks: [TASKS[0]], aeoRows: [], techFixes: {} });
  const it = s.items[0];
  if (!/theme|Theme Builder/.test(it.where)) throw new Error(it.where);
  if (!/exactly one/.test(it.how_to_check)) throw new Error(it.how_to_check);
  assertEq(it.problem, 'Problem.', 'check label stripped from the problem text');
  if (!/Independently checked: Really missing\./.test(it.check)) throw new Error(it.check);
});

await t('a Shopify client gets Shopify directions, and everything is listed', () => {
  const s = buildFixSheet({ client: { ...WP, cms_type: 'Shopify' }, techTasks: [TASKS[1]], aeoRows: [] });
  assertEq(s.items.length, 1);
  if (!/Search engine listing/.test(s.items[0].where)) throw new Error(s.items[0].where);
});

await t('text for a Grok Bot / email and a printable page', () => {
  const s = buildFixSheet({ client: WP, techTasks: [TASKS[0]], aeoRows: AEO, aeoFixes: {} });
  const text = renderFixSheetText(s);
  if (!/^FIX SHEET — Krost Shelving/.test(text)) throw new Error('header');
  if (!/HOW TO WORK THROUGH THIS/.test(text) || !/done \/ skipped/.test(text)) throw new Error('instructions');
  if (!/Change <h1>Latest News<\/h1> to <h2>/.test(text)) throw new Error('code must be verbatim in text');
  const html = renderFixSheetHtml(s);
  if (!/&lt;h1&gt;Latest News/.test(html)) throw new Error('code must be escaped in html');
  if (!/noindex/.test(html)) throw new Error('noindex');
});

console.log(`\nfixSheet: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
