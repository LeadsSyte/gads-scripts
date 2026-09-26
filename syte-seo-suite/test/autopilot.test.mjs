// Autopilot — the server-side monthly content run. Every outside call is a
// fake here, so this checks the run logic: plan once, write each article,
// hold back anything either checker rejects, resume after a time-out, and
// never redo an article already written this month.

import { runAutopilotStep, newRunState, normalizeCheck, buildCheckerInput, summarizeRun } from '../netlify/functions/lib/autopilot.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

const CLIENT = {
  id: 'c1', name: 'Allergy Facts', url: 'https://allergyfacts.example', industry: 'Allergy information',
  location: 'South Africa', pages_per_month: 3, gsc_property: 'sc-domain:allergyfacts.example',
  brand_docs: '=== Website Brand Scan (2026/09/01) ===\n- Allergy information and support for South Africans\n- Eczema, hay fever and food allergy guides\n=== End Website Brand Scan ==='
};

const PLAN = {
  opportunities: [
    { topic_title: 'Hay Fever Season Guide', primary_keyword: 'hay fever', recommended_length: 1200, priority: 1, opportunity_type: 'low-hanging-fruit' },
    { topic_title: 'Eczema Triggers at Home', primary_keyword: 'eczema triggers', recommended_length: 1400, priority: 2, opportunity_type: 'content-gap' },
    { topic_title: 'Food Allergy Labels Explained', primary_keyword: 'food allergy labels', recommended_length: 1300, priority: 3, opportunity_type: 'content-gap' }
  ],
  summary: 'x'
};

const article = (title, body = 'Allergy guidance for South African families about eczema and hay fever. '.repeat(30)) =>
  `**Meta Title:** ${title} | Allergy Facts\n\n**Meta Description:** About ${title}.\n\n# ${title}\n\n${body}\n\n## Allergy tips\n\nMore allergy and eczema detail.`;

function fakeDeps({ checkVerdicts = {}, gscFails = false, existing = new Set(), timeLeft = () => Infinity } = {}) {
  const calls = { complete: [], saved: [], states: 0, checks: 0 };
  return {
    calls,
    deps: {
      complete: async (opts) => {
        calls.complete.push(opts);
        if (/TARGET_ARTICLES/.test(opts.messages[0].content)) return JSON.stringify(PLAN);
        // relevance adjudicator (only asked when the pure check is unsure)
        if (/Does this article belong to this brand/.test(opts.messages[0].content)) return '{"relevant":true,"confidence":"high"}';
        const title = PLAN.opportunities.find(o => opts.messages[0].content.includes(o.topic_title))?.topic_title || 'X';
        return article(title);
      },
      fetchGsc: async () => {
        if (gscFails) throw new Error('403 no access');
        return { queries: [{ query: 'hay fever', clicks: 3, impressions: 400, ctr: 0.01, position: 9 }], pageQueries: [] };
      },
      checkArticle: async ({ user }) => {
        calls.checks++;
        const hit = Object.keys(checkVerdicts).find(k => user.includes(k));
        return hit ? checkVerdicts[hit] : { verdict: 'pass', problems: [], summary: 'fine' };
      },
      existingTopics: async () => existing,
      saveArticle: async (row) => { calls.saved.push(row); return { id: 'b' + calls.saved.length }; },
      saveState: async () => { calls.states++; },
      timeLeftMs: timeLeft
    }
  };
}

await t('plans once, writes and saves every article as an Auto Write article', async () => {
  const { deps, calls } = fakeDeps();
  const state = newRunState(CLIENT);
  const { more } = await runAutopilotStep(CLIENT, state, deps);
  assertEq(more, false); assertEq(state.status, 'done');
  assertEq(state.plan.length, 3);
  assertEq(calls.saved.length, 3);
  assertEq(calls.saved[0].tab, 'Auto Write'); assertEq(calls.saved[0].client_id, 'c1');
  assertEq(summarizeRun(state).ready, 3);
  assertEq(calls.checks, 3, 'independent check ran per article');
});

await t('the writer gets the same prompts as Auto Write', async () => {
  const { deps, calls } = fakeDeps();
  await runAutopilotStep(CLIENT, newRunState(CLIENT), deps);
  const write = calls.complete.find(c => /Hay Fever Season Guide/.test(c.messages[0].content) && c.max_tokens === 5000);
  if (!write) throw new Error('no article write call');
  if (!/Allergy Facts/.test(write.system)) throw new Error('system prompt is not the client brand prompt');
  assertEq(write.temperature, 0.7);
});

await t('an article the independent checker fails is saved but held back', async () => {
  const { deps } = fakeDeps({ checkVerdicts: { 'Eczema Triggers at Home': { verdict: 'fail', problems: [{ severity: 'error', issue: 'Centred on Kempton Park, where the business has no presence.' }] } } });
  const state = newRunState(CLIENT);
  await runAutopilotStep(CLIENT, state, deps);
  const a = state.articles[1];
  assertEq(a.status, 'blocked');
  assertEq(a.check.problems[0].severity, 'error');
  assertEq(summarizeRun(state).blocked, 1);
});

await t('a checker that errors counts as a fail, not a pass', async () => {
  const { deps } = fakeDeps();
  deps.checkArticle = async () => { throw new Error('OpenAI 500'); };
  const state = newRunState(CLIENT);
  await runAutopilotStep(CLIENT, state, deps);
  assertEq(state.articles[0].status, 'blocked');
});

await t('Search Console failing still produces a plan from the client details', async () => {
  const { deps } = fakeDeps({ gscFails: true });
  const state = newRunState(CLIENT);
  await runAutopilotStep(CLIENT, state, deps);
  assertEq(state.plan.length, 3);
  if (!/Search Console unavailable/.test(state.research_note)) throw new Error('note missing');
});

await t('stops before the time limit and the next run resumes without redoing work', async () => {
  let left = 10 * 60 * 1000;
  const { deps, calls } = fakeDeps({ timeLeft: () => left });
  const state = newRunState(CLIENT);
  const origSave = deps.saveArticle;
  deps.saveArticle = async (row) => { left -= 4 * 60 * 1000; return origSave(row); };
  const first = await runAutopilotStep(CLIENT, state, deps);
  assertEq(first.more, true, 'paused');
  const doneFirst = calls.saved.length;
  if (doneFirst < 1 || doneFirst >= 3) throw new Error('expected a partial run, saved ' + doneFirst);
  left = Infinity;
  const plansBefore = calls.complete.filter(c => /TARGET_ARTICLES/.test(c.messages[0].content)).length;
  const second = await runAutopilotStep(CLIENT, state, deps);
  assertEq(second.more, false);
  assertEq(calls.saved.length, 3, 'each article saved exactly once');
  assertEq(calls.complete.filter(c => /TARGET_ARTICLES/.test(c.messages[0].content)).length, plansBefore, 'not re-planned');
});

await t('topics already written this month are skipped', async () => {
  const { deps, calls } = fakeDeps({ existing: new Set(['hay fever season guide']) });
  const state = newRunState(CLIENT);
  await runAutopilotStep(CLIENT, state, deps);
  assertEq(state.articles[0].status, 'skipped');
  assertEq(calls.saved.length, 2);
});

await t('a client with no website scan is scanned first, and the scan is what the writer and reviewer see', async () => {
  const unscanned = { ...CLIENT, brand_docs: '', audience: '' };
  const { deps, calls } = fakeDeps();
  let savedFields = null;
  deps.scanBrand = async () => ({ voice: 'Calm', audience: 'SA allergy sufferers', brief: '- Publishes pollen calendars for Gauteng', sourceUrl: unscanned.url });
  deps.saveClientFields = async (id, f) => { savedFields = { id, ...f }; };
  let reviewed = '';
  deps.checkArticle = async ({ user }) => { reviewed = user; return { verdict: 'pass', problems: [] }; };
  const state = newRunState(unscanned);
  await runAutopilotStep(unscanned, state, deps);
  assertEq(savedFields?.id, 'c1', 'scan saved to the client');
  if (!/Publishes pollen calendars/.test(savedFields.brand_docs)) throw new Error('scan not merged into brand_docs');
  assertEq(savedFields.audience, 'SA allergy sufferers', 'empty audience filled');
  if (!/Publishes pollen calendars/.test(reviewed)) throw new Error('reviewer did not see the fresh scan');
  const write = calls.complete.find(c => c.max_tokens === 5000);
  if (!/Publishes pollen calendars/.test(write.system)) throw new Error('writer did not see the fresh scan');
});

await t('a fresh scan is not redone, and a failed scan does not stop the run', async () => {
  const { deps } = fakeDeps();
  let scans = 0;
  deps.scanBrand = async () => { scans++; throw new Error('site blocked'); };
  const fresh = { ...CLIENT, brand_docs: '=== Website Brand Scan (2026/09/20) ===\nSource: https://allergyfacts.example\nScanned: 2026-09-20\n\n- x' };
  deps.now = () => new Date('2026-09-26T09:00:00Z');
  await runAutopilotStep(fresh, newRunState(fresh), deps);
  assertEq(scans, 0, 'fresh scan skipped');
  const stale = { ...CLIENT, brand_docs: '' };
  const state = newRunState(stale);
  await runAutopilotStep(stale, state, deps);
  assertEq(scans, 1); assertEq(state.status, 'done');
  if (!/Website scan failed/.test(state.scan_note)) throw new Error('scan failure not noted');
});

function withPush(deps, { pushed = new Set(), failTitle = null } = {}) {
  const sent = [];
  deps.pushedTitles = async () => new Set(pushed);
  deps.loadOutput = async (id) => 'article body for ' + id;
  deps.pushArticle = async (a) => {
    if (a.title === failTitle) throw new Error('WordPress 401: bad password');
    sent.push(a);
    return { id: 'q' + sent.length, admin_url: 'https://wp.example/wp-admin/post.php?post=' + sent.length, verification: 'verified', warnings: [] };
  };
  return sent;
}

await t('with pushing on, only articles that passed both checks become drafts', async () => {
  const { deps } = fakeDeps({ checkVerdicts: { 'Eczema Triggers at Home': { verdict: 'fail', problems: [{ severity: 'error', issue: 'x' }] } } });
  const sent = withPush(deps);
  const state = newRunState(CLIENT);
  await runAutopilotStep(CLIENT, state, deps);
  assertEq(sent.map(a => a.title).join('|'), 'Hay Fever Season Guide|Food Allergy Labels Explained', 'held-back article not pushed');
  assertEq(state.articles[0].push.status, 'pushed');
  assertEq(state.articles[1].push, undefined, 'blocked article has no push');
  assertEq(state.status, 'done');
  if (!/^article body for b/.test(sent[0].output)) throw new Error('pushed the saved article text');
});

await t('an article already in the CMS is not pushed again, and a failed push is recorded', async () => {
  const { deps } = fakeDeps();
  const sent = withPush(deps, { pushed: new Set(['hay fever season guide']), failTitle: 'Eczema Triggers at Home' });
  const state = newRunState(CLIENT);
  await runAutopilotStep(CLIENT, state, deps);
  assertEq(state.articles[0].push.status, 'skipped');
  assertEq(state.articles[1].push.status, 'failed');
  if (!/401/.test(state.articles[1].push.error)) throw new Error('error kept');
  assertEq(sent.length, 1);
});

await t('with pushing off, nothing is pushed', async () => {
  const { deps } = fakeDeps();
  const state = newRunState(CLIENT);
  await runAutopilotStep(CLIENT, state, deps);
  if (Object.values(state.articles).some(a => a.push)) throw new Error('pushed without push deps');
});

await t('a push-only pass on a finished run pushes without rewriting', async () => {
  const { deps, calls } = fakeDeps();
  const state = newRunState(CLIENT);
  await runAutopilotStep(CLIENT, state, deps);
  const writes = calls.complete.length;
  const sent = withPush(deps);
  await runAutopilotStep(CLIENT, state, deps);
  assertEq(calls.complete.length, writes, 'no new AI calls');
  assertEq(sent.length, 3);
});

await t('checker verdicts are normalised strictly', () => {
  assertEq(normalizeCheck({ verdict: 'pass', problems: [] }).verdict, 'pass');
  assertEq(normalizeCheck({ verdict: 'pass', problems: [{ severity: 'error', issue: 'x' }] }).verdict, 'fail', 'pass with an error');
  assertEq(normalizeCheck(null).verdict, 'fail', 'unreadable');
  assertEq(normalizeCheck({ verdict: 'pass', problems: [{ severity: 'warning', issue: 'weak intro' }] }).verdict, 'pass');
});

await t('the checker sees the brand reference and the article body, not the meta block', () => {
  const input = buildCheckerInput(CLIENT, article('Hay Fever Season Guide'), PLAN.opportunities[0]);
  if (!/Eczema, hay fever and food allergy guides/.test(input)) throw new Error('brand reference missing');
  if (!/ARTICLE TITLE: Hay Fever Season Guide/.test(input)) throw new Error('title missing');
  if (/\*\*Meta Title:\*\*/.test(input.split('ARTICLE BODY:')[1])) throw new Error('meta block leaked into body');
});

await t('the checker is told who the competitors are', () => {
  const input = buildCheckerInput({ ...CLIENT, competitors: 'allergyfoundation.co.za' }, article('X'), PLAN.opportunities[0]);
  if (!/COMPETITORS[^\n]*allergyfoundation\.co\.za/.test(input)) throw new Error('competitors missing');
});

const { htmlToTextServer, findAboutUrlServer } = await import('../netlify/functions/lib/serverBrandScan.js');

await t('server scan helpers: visible text only, and the About link', () => {
  const html = '<html><head><title>T</title><style>.a{}</style></head><body><nav><a href="/about-us/?x=1#t">About</a></nav>'
    + '<script>var hidden=1</script><h1>Crane &amp; Hoist</h1><p>We build&nbsp;cranes.</p><!-- note --></body></html>';
  assertEq(htmlToTextServer(html), 'About Crane & Hoist We build cranes.');
  assertEq(findAboutUrlServer(html, 'https://jgs.example/'), 'https://jgs.example/about-us/');
  assertEq(findAboutUrlServer('<a href="https://other.example/about">x</a>', 'https://jgs.example/'), null, 'other site ignored');
});

console.log(`\nautopilot: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
