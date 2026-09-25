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

console.log(`\nautopilot: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
