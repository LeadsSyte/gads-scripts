// Team emails for the automated pipeline (run summary, "went live" digest)
// and the staggered monthly start. Pure builders only — nothing is sent.

import { buildRunSummaryEmail, buildPublishedEmail, parseRecipients } from '../netlify/functions/lib/reportEmail.js';
import { clientsToStart } from '../netlify/functions/autopilot-monthly.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
const has = (s, re, label) => { if (!re.test(s)) throw new Error((label || '') + ' missing ' + re); };

const CLIENT = { id: 'c1', name: 'JGS Lifting' };
const STATE = {
  month: '2026-10', status: 'done',
  plan: [{ topic_title: 'Load Testing Guide' }, { topic_title: 'Kempton Park <Property>' }, { topic_title: 'Crane Kits' }],
  articles: {
    0: { status: 'ready', push: { status: 'pushed', admin_url: 'https://jgs.example/wp-admin/post.php?post=9', warnings: ['SEO meta not set'] } },
    1: { status: 'blocked', check: { problems: [{ severity: 'error', issue: 'Centred on Kempton Park, where JGS has no branch.' }] } },
    2: { status: 'ready', push: { status: 'failed', error: 'WordPress 401: bad password' } }
  }
};

await t('recipients: only real addresses, comma or space separated', () => {
  assertEq(parseRecipients('chrisb@syte.co.za, bad, x@y.co').join('|'), 'chrisb@syte.co.za|x@y.co');
  assertEq(parseRecipients('').length, 0);
});

await t('run summary flags a run that needs a look, with each reason', () => {
  const { subject, html } = buildRunSummaryEmail(CLIENT, STATE, 'https://suite.example');
  has(subject, /needs a look: JGS Lifting \(2026-10\) — 2\/3 ready, 1 drafted/, 'subject');
  has(html, /Centred on Kempton Park/, 'held-back reason');
  has(html, /WordPress 401: bad password/, 'push failure');
  has(html, /post\.php\?post=9/, 'draft link');
  has(html, /SEO meta not set/, 'site warning');
  has(html, /Kempton Park &lt;Property&gt;/, 'titles escaped');
});

await t('a clean run says done', () => {
  const clean = { month: '2026-10', status: 'done', plan: [{ topic_title: 'A' }], articles: { 0: { status: 'ready' } } };
  has(buildRunSummaryEmail(CLIENT, clean, 'u').subject, /^Autopilot done: JGS Lifting/);
});

await t('a failed run says FAILED and shows the error', () => {
  const { subject, html } = buildRunSummaryEmail(CLIENT, { month: '2026-10', status: 'failed', error: 'ANTHROPIC_API_KEY is not set', plan: null, articles: {} }, 'u');
  has(subject, /^Autopilot FAILED: JGS Lifting/);
  has(html, /ANTHROPIC_API_KEY is not set/);
});

await t('went-live digest lists live links and failures', () => {
  const { subject, html } = buildPublishedEmail([
    { client: 'Allergy Facts', title: 'Hay Fever', liveUrl: 'https://a.example/hay-fever/' },
    { client: 'BAM DIY', title: 'Drawers', error: 'Shopify publish 403' }
  ], 'u');
  has(subject, /Publish FAILED for 1, 1 went live: Allergy Facts, BAM DIY/);
  has(html, /href="https:\/\/a\.example\/hay-fever\/"/);
  has(html, /Shopify publish 403/);
  has(buildPublishedEmail([{ client: 'A', title: 'x', liveUrl: '' }], 'u').subject, /^1 post went live: A/);
});

await t('tech scan email: confirmed, wrong, needs-a-human and removed false alarms, each with its reason', async () => {
  const { buildTechSummaryEmail } = await import('../netlify/functions/lib/reportEmail.js');
  const state = { status: 'done', crawl: { pages: 40 }, tasks: [
    { task: { title: 'Add meta description', page_url: 'https://j.example/cranes/' }, check: { verdict: 'confirmed', reason: 'Missing on the live page.' } },
    { task: { title: 'Remove noindex', page_url: 'https://j.example/thank-you/' }, check: { verdict: 'false_alarm', reason: 'Thank-you pages should be noindex.' } },
    { task: { title: 'Alt text', page_url: 'https://j.example/hoists/' }, check: { verdict: 'fix_wrong', reason: 'Placeholder text.' } }
  ] };
  const { subject, html } = buildTechSummaryEmail({ name: 'JGS Lifting' }, state, 'u');
  has(subject, /Tech scan — needs a look: JGS Lifting — 1 confirmed fix, 1 false alarm removed/);
  has(html, /Thank-you pages should be noindex/); has(html, /Placeholder text/); has(html, /of 40 pages/);
});

await t('monthly start: only switched-on clients not yet started this month, a few at a time', () => {
  const on = id => ({ id, publishing_profile: { autopilot_enabled: true } });
  const clients = [on('a'), on('b'), { id: 'off', publishing_profile: {} }, on('c'), on('d'), on('e'), on('f')];
  const states = [{ client_id: 'a', month: '2026-10' }, { client_id: 'b', month: '2026-09' }];
  const due = clientsToStart(clients, states, '2026-10', 4).map(c => c.id).join(',');
  assertEq(due, 'b,c,d,e', 'a already started; off skipped; last month does not count; batch of 4');
});

console.log(`\nreportEmail: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
