// Tech Autopilot: crawl → fix list → independent check → task board.
// Every outside call is faked.

import { runTechScan, newTechState, pageEvidence, needsRobotsTxt, normalizeTechCheck, buildTechCheckInput, summarizeTechRun } from '../netlify/functions/lib/techScan.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

const CLIENT = { id: 'c1', name: 'JGS Lifting', url: 'https://jgs.example/' };
const TRIAGE = {
  tasks: [
    { title: 'Add meta description to Cranes page', page_url: 'https://jgs.example/cranes/', fix_type: 'meta_description', priority: 'high', copy_paste_fix: '<meta name="description" content="Overhead cranes built in Nigel.">', description: 'Missing' },
    { title: 'Remove noindex from Thank You page', page_url: 'https://jgs.example/thank-you/', fix_type: 'robots', priority: 'critical', copy_paste_fix: '<meta name="robots" content="index, follow">', description: 'Page is noindex' },
    { title: 'Add alt text to hoist image', page_url: 'https://jgs.example/hoists/', fix_type: 'image_alt', priority: 'medium', copy_paste_fix: 'alt="[PRODUCT_NAME]"', description: 'Missing alt' }
  ]
};
const PAGES = {
  'https://jgs.example/cranes/': '<html><head><title>Overhead Cranes | JGS Lifting</title></head><body><h1>Cranes</h1>' + '<p>word </p>'.repeat(60) + '</body></html>',
  'https://jgs.example/thank-you/': '<html><head><title>Thank you | JGS</title><meta name="robots" content="noindex"></head><body><h1>Thanks</h1>' + '<p>x</p>'.repeat(60) + '</body></html>',
  'https://jgs.example/hoists/': '<html><head><title>Hoists</title></head><body><img src="/hoist.jpg"><h1>Hoists</h1>' + '<p>x</p>'.repeat(60) + '</body></html>'
};

function fakeDeps(over = {}) {
  const calls = { checks: [], saved: null, robots: 0, states: 0 };
  const deps = {
    crawl: async () => ({ totalCrawled: 3, withIssues: 3, withErrors: 0, discoverySource: 'sitemap', pages: [{ url: 'https://jgs.example/cranes/', title: 'x', issueCount: 1, issues: [{ type: 'meta_description', severity: 'high', detail: 'Missing meta description', fix: '' }] }] }),
    gscPages: async () => null,
    complete: async () => JSON.stringify(TRIAGE),
    checkTask: async ({ user }) => {
      calls.checks.push(user);
      if (user.includes('thank-you')) return { verdict: 'false_alarm', reason: 'Thank-you pages should be noindex.' };
      if (user.includes('[PRODUCT_NAME]')) return { verdict: 'fix_wrong', reason: 'The alt text is a placeholder.' };
      return { verdict: 'confirmed', reason: 'The page has no meta description.' };
    },
    fetchHtml: async (u) => PAGES[u] || '',
    fetchText: async () => { calls.robots++; return 'User-agent: *\nAllow: /'; },
    loadHistory: async () => ({ tasks: [], impls: [], rejectedKeys: new Set() }),
    saveTasks: async (_c, tasks) => { calls.saved = tasks; },
    saveState: async () => { calls.states++; },
    ...over
  };
  return { deps, calls };
}

await t('false alarms never reach the board; wrong fixes are flagged; confirmed are labelled', async () => {
  const { deps, calls } = fakeDeps();
  const state = newTechState(CLIENT);
  const r = await runTechScan(CLIENT, state, deps);
  assertEq(r.more, false); assertEq(state.status, 'done');
  assertEq(calls.saved.length, 2, 'thank-you false alarm dropped');
  const titles = calls.saved.map(x => x.title).join('|');
  if (/Thank You/.test(titles)) throw new Error('false alarm on board');
  const meta = calls.saved.find(x => x.fix_type === 'meta_description');
  if (!/✓ Independent check: confirmed/.test(meta.description)) throw new Error('confirmed label missing');
  const alt = calls.saved.find(x => x.fix_type === 'image_alt');
  if (!/fix itself looks wrong/.test(alt.description)) throw new Error('fix_wrong label missing');
  assertEq(meta.status, 'open'); assertEq(meta.client_id, 'c1');
  const s = summarizeTechRun(state);
  assertEq(s.confirmed, 1); assertEq(s.false_alarm, 1); assertEq(s.fix_wrong, 1);
});

await t('the reviewer is given the live page facts and robots.txt only when relevant', async () => {
  const { deps, calls } = fakeDeps();
  await runTechScan(CLIENT, newTechState(CLIENT), deps);
  const thanks = calls.checks.find(c => c.includes('thank-you'));
  if (!/"meta_robots": "noindex"/.test(thanks)) throw new Error('noindex evidence missing');
  if (!/live robots.txt/.test(thanks)) throw new Error('robots.txt missing for a robots task');
  const meta = calls.checks.find(c => c.includes('cranes'));
  if (/live robots.txt/.test(meta)) throw new Error('robots.txt sent for an unrelated task');
  assertEq(calls.robots, 1, 'robots.txt fetched once');
});

await t('work already done and rejected tasks are not re-briefed', async () => {
  const { deps, calls } = fakeDeps({
    loadHistory: async () => ({ tasks: [], impls: [], rejectedKeys: new Set(['c1|c1|https://jgs.example/hoists/|Add alt text to hoist image']) })
  });
  await runTechScan(CLIENT, newTechState(CLIENT), deps);
  if (calls.saved.some(x => x.fix_type === 'image_alt')) throw new Error('rejected task came back');
});

await t('a run that hits the time limit resumes the checks without re-crawling', async () => {
  let left = 90 * 1000; let crawls = 0; let triages = 0;
  const { deps, calls } = fakeDeps({ timeLeftMs: () => left });
  const crawl = deps.crawl; deps.crawl = async (c) => { crawls++; return crawl(c); };
  const complete = deps.complete; deps.complete = async (o) => { triages++; return complete(o); };
  const check = deps.checkTask; deps.checkTask = async (o) => { left -= 40 * 1000; return check(o); };
  const state = newTechState(CLIENT);
  const first = await runTechScan(CLIENT, state, deps);
  assertEq(first.more, true, 'paused');
  left = Infinity;
  const second = await runTechScan(CLIENT, state, deps);
  assertEq(second.more, false);
  assertEq(crawls, 1); assertEq(triages, 1);
  assertEq(calls.checks.length, 3, 'each fix checked once');
});

await t('an unfetchable page or a broken reviewer means "needs a human", never "confirmed"', async () => {
  const { deps, calls } = fakeDeps({ fetchHtml: async () => '', checkTask: async () => { throw new Error('OpenAI 500'); } });
  const state = newTechState(CLIENT);
  await runTechScan(CLIENT, state, deps);
  assertEq(state.tasks.every(e => e.check.verdict === 'needs_human'), true);
  assertEq(calls.saved.length, 3, 'kept for a human, not dropped');
  assertEq(normalizeTechCheck({ verdict: 'yes' }).verdict, 'needs_human');
});

await t('page evidence is read from the real markup', () => {
  const e = pageEvidence('<html><head><title>T</title><meta name="description" content="D"><link rel="canonical" href="https://x/"><script type="application/ld+json">{"@type":"Organization"}</script></head><body><h1>A</h1><img src="/a.png"><img src="/b.png" alt="b"></body></html>');
  assertEq(e.title, 'T'); assertEq(e.meta_description, 'D'); assertEq(e.canonical, 'https://x/');
  assertEq(e.h1.join(), 'A'); assertEq(e.images_missing_alt.join(), '/a.png'); assertEq(e.json_ld_types.join(), 'Organization');
  assertEq(needsRobotsTxt({ fix_type: 'robots' }), true); assertEq(needsRobotsTxt({ fix_type: 'image_alt', title: 'Alt text' }), false);
  if (!/could not be fetched/.test(buildTechCheckInput(CLIENT, TRIAGE.tasks[0], null))) throw new Error('missing-evidence note');
});

console.log(`\ntechScan: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
