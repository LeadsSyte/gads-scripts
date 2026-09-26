// AEO Autopilot: pages → optimisations → independent check → AEO Engine.
// Every outside call is faked.

import { runAeoScan, newAeoState, aeoPageEvidence, normalizeAeoCheck, summarizeAeoRun } from '../netlify/functions/lib/aeoScan.js';
import { prioritizePages, rotateQueue, coveredPagesFrom, runShortlist } from '../src/modules/aeo/aeoRun.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

const CLIENT = { id: 'c1', name: 'Allergy Facts', url: 'https://af.example', pages_per_month: 3, aeo_items_per_month: 4 };
const URLS = ['https://af.example/', 'https://af.example/eczema/', 'https://af.example/hay-fever/', 'https://af.example/asthma/'];
const PAGE = (h) => `<html><head><title>T</title></head><body><main><h1>Page</h1>${h}<p>${'Allergy info. '.repeat(40)}</p></main></body></html>`;
const HTML = {
  'https://af.example/eczema/': PAGE('<h2>Frequently asked questions</h2><p>Q and A</p>'),
  'https://af.example/hay-fever/': PAGE(''),
  'https://af.example/asthma/': PAGE(''),
  'https://af.example/': PAGE('')
};

function fakeDeps(over = {}) {
  const calls = { saved: [], checks: [], gen: 0 };
  const deps = {
    discover: async () => ({ urls: URLS, source: 'sitemap' }),
    trafficRows: async () => [{ path: '/asthma/', sessions: 90 }, { path: '/hay-fever/', sessions: 40 }],
    loadPrior: async () => ({ results: [], impls: [], rejectionsByPage: new Map() }),
    complete: async ({ messages }) => {
      calls.gen++;
      const url = (messages[0].content.match(/Page URL: (\S+)/) || [])[1];
      return JSON.stringify({ optimizations: [
        { type: 'content', name: 'FAQ section', description: 'Add FAQs', implementation: '<section><h2>FAQ</h2></section>', where: 'end', impact: 'high' },
        { type: 'schema', name: 'FAQPage schema', description: 'Schema', implementation: '{"@type":"FAQPage"}', where: 'head', impact: 'medium' }
      ].map(o => ({ ...o, name: o.name + ' — ' + url })) });
    },
    fetchHtml: async (u) => HTML[u] || '',
    checkOpt: async ({ user }) => {
      calls.checks.push(user);
      if (user.includes('af.example/eczema/') && user.includes('FAQ section')) return { verdict: 'false_alarm', reason: 'The page already has an FAQ section.' };
      return { verdict: 'confirmed', reason: 'Missing and supported.' };
    },
    saveRow: async (row) => { calls.saved.push(row); },
    saveState: async () => {},
    ...over
  };
  return { deps, calls };
}

await t('traffic-ranked, never-optimised pages first; revisits oldest-first', () => {
  const pr = prioritizePages(URLS, [{ path: '/asthma/', sessions: 90 }, { path: '/new-page/', sessions: 5 }], 'https://af.example');
  assertEq(pr[0].url, 'https://af.example/asthma/');
  if (!pr.some(p => p.url === 'https://af.example/new-page/')) throw new Error('traffic page missing from sitemap not added');
  const covered = coveredPagesFrom([{ client_id: 'c1', url: 'https://af.example/asthma', optimizations: [{}], generated_at: '2026-08-01' }], 'c1');
  const q = rotateQueue(pr, covered);
  assertEq(q[q.length - 1].url, 'https://af.example/asthma/', 'optimised page goes to the back (trailing slash ignored)');
});

await t('a run shortlists, checks every item, drops false alarms and saves to the AEO Engine', async () => {
  const { deps, calls } = fakeDeps();
  const state = newAeoState(CLIENT);
  const r = await runAeoScan(CLIENT, state, deps);
  assertEq(r.more, false); assertEq(state.status, 'done');
  const s = summarizeAeoRun(state);
  if (s.total < 1) throw new Error('nothing shortlisted');
  assertEq(calls.checks.length, s.total, 'every shortlisted item checked');
  const savedOpts = calls.saved.flatMap(r => r.optimizations);
  if (savedOpts.some(o => o.check?.verdict === 'false_alarm')) throw new Error('false alarm saved');
  if (!savedOpts.every(o => o.check?.verdict)) throw new Error('saved items carry their check');
  if (!calls.saved.every(r => r.client_id === 'c1' && Array.isArray(r.prior_keys))) throw new Error('row shape');
});

await t('the reviewer sees what the page already has (e.g. an FAQ heading)', async () => {
  const e = aeoPageEvidence(HTML['https://af.example/eczema/']);
  assertEq(e.has_faq_heading, true);
  assertEq(aeoPageEvidence(HTML['https://af.example/asthma/']).has_faq_heading, false);
  assertEq(normalizeAeoCheck({ verdict: 'nope' }).verdict, 'needs_human');
});

await t('generation pauses at the time limit and resumes without regenerating pages', async () => {
  const BIG = { ...CLIENT, pages_per_month: 12, aeo_items_per_month: 20 };
  const urls = Array.from({ length: 12 }, (_, i) => 'https://af.example/p' + i + '/');
  let left = 5 * 60 * 1000;
  const generated = [];
  const { deps } = fakeDeps({ discover: async () => ({ urls, source: 'sitemap' }), trafficRows: async () => [], timeLeftMs: () => left });
  const complete = deps.complete;
  deps.complete = async (o) => {
    generated.push((o.messages[0].content.match(/Page URL: (\S+)/) || [])[1]);
    left -= 60 * 1000;
    return complete(o);
  };
  const state = newAeoState(BIG);
  const first = await runAeoScan(BIG, state, deps);
  assertEq(first.more, true, 'paused');
  if (!state.progress?.attempted?.length) throw new Error('progress not saved');
  left = Infinity;
  const second = await runAeoScan(BIG, state, deps);
  assertEq(second.more, false);
  assertEq(new Set(generated).size, generated.length, 'a page was generated twice');
  if (generated.length <= 3) throw new Error('did not continue after the pause');
});

await t('shortlist runner: repeats of delivered work are filtered', async () => {
  const prior = new Map();
  const r = await runShortlist({
    queue: [{ url: 'https://af.example/a/', path: '/a/' }], clientId: 'c1', itemTarget: 3, maxPages: 1, pageCeiling: 1,
    priorByPage: prior, generate: async () => [{ type: 'content', name: 'Answer block', implementation: 'x', impact: 'high' }]
  });
  assertEq(r.shortlist.kept, 1);
  assertEq(r.progress.drafts[0].client_id, 'c1');
});

console.log(`\naeoScan: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
