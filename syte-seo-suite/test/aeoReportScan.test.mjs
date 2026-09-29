// AEO Report Autopilot: the census carried from run to run, the report
// written from it, every figure checked, and the engines calling their
// providers directly on the server. Every outside call is faked.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.localStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; } };
globalThis.sessionStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; } };

const here = path.dirname(fileURLToPath(import.meta.url));
const load = p => import(pathToFileURL(path.join(here, p)).href);
const { runSnapshot } = await load('../src/modules/reports/aeoRunner.js');
const { runAeoReportScan, newAeoReportState, packCarry, unpackCarry, aeoNumbers, aeoNotable, buildAeoCheckInput } = await load('../netlify/functions/lib/aeoReportScan.js');
const { checkFigures } = await load('../netlify/functions/lib/reportScan.js');
const { buildReportReadyEmail } = await load('../netlify/functions/lib/reportEmail.js');
const engines = await load('../src/modules/reports/aeoEngines.js');
const { extractRun } = await load('../src/modules/reports/aeoExtract.js');
const { PROFILE_DEFAULTS } = await load('../src/modules/cms/publishingProfile.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
const has = (s, re, label) => { if (!re.test(s)) throw new Error((label || '') + ' missing ' + re); };

const CLIENT = {
  id: 'c1', name: 'Acme', url: 'https://acme.test/', competitors: 'BetaCorp',
  aeo_probe_queries: ['best widgets', 'buy widgets cape town', 'widget suppliers', 'widget repair', 'cheap widgets', 'widget reviews'].join('\n')
};

// An engine that names the brand only for prompts containing "best" or "buy".
function engine(id, calls) {
  return {
    id, label: id.toUpperCase(), model: id + '-1', retrievalNative: true, supportsSearchOff: false, isConfigured: () => true,
    ask: async (q) => { calls.push(id + '|' + q); return { text: /best|buy/.test(q) ? 'Acme is a top choice. https://acme.test/' : 'BetaCorp is well known.', raw: {}, searchMode: 'search_on' }; }
  };
}
const extract = async ({ text }) => /Acme/.test(text)
  ? { appeared: true, position: 1, listLength: 2, segmentLabel: 'top choice', reasonPhrase: 'trusted', sentiment: 'positive', competitorsNamed: [] }
  : { appeared: false, position: null, listLength: 1, segmentLabel: null, reasonPhrase: null, sentiment: 'neutral', competitorsNamed: ['BetaCorp'] };

// ── The runner: stop, carry, resume ──
await t('a census stopped for time resumes where it stopped and asks nothing twice', async () => {
  const calls = [];
  const engs = [engine('chatgpt', calls), engine('gemini', calls)];
  const opts = { engines: engs, extract, iterations: 2, concurrency: 1, now: '2026-10-06T08:00:00Z' };

  const full = await runSnapshot(CLIENT, opts);
  const fullCalls = calls.length;
  calls.length = 0;

  // First run: time runs out after a few groups have started.
  let asked = 0;
  const first = await runSnapshot(CLIENT, { ...opts, timeLeftMs: () => (asked++ < 5 ? 10 * 60 * 1000 : 0) });
  eq(first.partial, true, 'partial');
  if (!(first.groups_done > 0 && calls.length < fullCalls)) throw new Error('should have done some, not all: ' + calls.length + '/' + fullCalls);
  const afterFirst = calls.length;

  // The carry survives being stored as JSON, packed.
  const carry = unpackCarry(JSON.parse(JSON.stringify(packCarry('2026-09', first.carry))));
  const second = await runSnapshot(CLIENT, { ...opts, carry, timeLeftMs: () => 10 * 60 * 1000 });
  eq(!!second.partial, false, 'finished');
  eq(calls.length, fullCalls, 'total calls across both runs = one full run');
  eq(new Set(calls).size * 2, calls.length, 'each prompt/engine asked exactly twice (2 iterations), never more');
  if (calls.slice(afterFirst).some((c, i, arr) => calls.slice(0, afterFirst).filter(x => x === c).length >= 2)) throw new Error('a finished group was asked again');

  for (const k of ['prompt_coverage', 'scorable_probes', 'visibility_score', 'mentions', 'total_runs', 'queries_count', 'composite_index', 'share_of_voice']) {
    eq(second[k], full[k], k + ' same as an uninterrupted run');
  }
  eq(second.engine_scores, full.engine_scores, 'engine scores');
  eq(second.keyword_wins.active.map(w => w.query).sort(), full.keyword_wins.active.map(w => w.query).sort(), 'wins');
});

await t('only new answers are handed over for saving on a continued run', async () => {
  const calls = [];
  const engs = [engine('chatgpt', calls)];
  let asked = 0; const saved = [];
  const first = await runSnapshot(CLIENT, { engines: engs, extract, iterations: 1, concurrency: 1, timeLeftMs: () => (asked++ < 3 ? 6e5 : 0), onRuns: r => { saved.push(r.length); } });
  await runSnapshot(CLIENT, { engines: engs, extract, iterations: 1, concurrency: 1, carry: first.carry, onRuns: r => { saved.push(r.length); } });
  eq(saved.reduce((a, b) => a + b, 0), calls.length, 'every answer saved once');
});

await t('winner expansion carries over too, within the same query budget', async () => {
  const calls = [];
  const engs = [engine('chatgpt', calls)];
  const base = { engines: engs, extract, iterations: 1, concurrency: 1, expandWinners: true, winnerTarget: 30, maxExpansionQueries: 6, expandGeos: ['Durban'] };
  const full = await runSnapshot(CLIENT, base);
  const fullCalls = calls.length; calls.length = 0;
  let asked = 0;
  let r = await runSnapshot(CLIENT, { ...base, timeLeftMs: () => (asked++ < 8 ? 6e5 : 0) });
  let hops = 1;
  while (r.partial && hops < 10) { asked = 0; r = await runSnapshot(CLIENT, { ...base, carry: JSON.parse(JSON.stringify(r.carry)), timeLeftMs: () => (asked++ < 8 ? 6e5 : 0) }); hops++; }
  eq(!!r.partial, false, 'finished');
  if (hops < 2) throw new Error('expected more than one run');
  eq(r.expansion_count, full.expansion_count, 'same number of long-tail prompts');
  eq(calls.length, fullCalls, 'same number of questions as one uninterrupted run');
});

// ── The engines on the server ──
await t('on the server each engine calls its provider directly with the deployment key', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.Authorization || init.headers['x-api-key'] || '', body: JSON.parse(init.body) });
    const body = /openai/.test(url) ? { output: [{ content: [{ text: 'Acme', annotations: [{ type: 'url_citation', url: 'https://acme.test/' }] }] }] }
      : /googleapis/.test(url) ? { candidates: [{ content: { parts: [{ text: 'Acme' }] } }] }
      : { content: [{ text: 'Acme' }] };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  try {
    globalThis.__SYTE_AEO_KEYS = { openai: 'sk-o', google: 'g-key', anthropic: '' };
    eq(engines.activeEngines().map(e => e.id), ['chatgpt', 'gemini'], 'an engine without a key is left out');
    globalThis.__SYTE_AEO_KEYS.anthropic = 'sk-a';
    eq(engines.activeEngines().map(e => e.id), ['chatgpt', 'gemini', 'claude']);
    const a = await engines.chatgpt.ask('best widgets', { search: true });
    has(a.text, /Acme\nhttps:\/\/acme\.test\//, 'citations kept');
    await engines.gemini.ask('best widgets');
    await engines.claude.ask('best widgets', { search: true });
    eq(seen.map(s => s.url.split('?')[0]), ['https://api.openai.com/v1/responses', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', 'https://api.anthropic.com/v1/messages']);
    eq(seen[0].auth, 'Bearer sk-o'); eq(seen[2].auth, 'sk-a');
    has(seen.find(s => /googleapis/.test(s.url)).url, /key=g-key/);
    eq(seen[0].body.tools[0].search_context_size, 'low', 'same search depth as the page, so months compare');
    eq(seen[0].body.model, 'gpt-4o');
  } finally { globalThis.fetch = realFetch; delete globalThis.__SYTE_AEO_KEYS; }
});

await t('extraction uses the Claude call it is given', async () => {
  let used = null;
  const out = await extractRun({ text: 'Acme is great', brandName: 'Acme' }, async (o) => { used = o.model; return '{"appeared":true,"brandsInOrder":["Acme"],"position":1,"sentiment":"positive"}'; });
  eq(out.appeared, true); has(used, /haiku/);
});

// ── The scan ──
const SNAP = await runSnapshot(CLIENT, { engines: [engine('chatgpt', []), engine('gemini', [])], extract, iterations: 3 });
function deps(over = {}) {
  const log = { saved: null, carry: undefined, carrySaves: [], states: [], claude: 0, snapshots: 0, history: null, probesSaved: 0 };
  const d = {
    loadExisting: async () => null,
    loadPrevious: async () => null,
    engines: () => [engine('chatgpt', [])],
    extract,
    loadCarry: async () => log.carry ?? null,
    saveCarry: async (c, data) => { log.carry = data == null ? null : JSON.parse(JSON.stringify(data)); log.carrySaves.push(data == null ? 'cleared' : data.snapshot ? 'snapshot' : 'census'); },
    persistRuns: async () => {},
    saveSnapshot: async (s) => { log.history = s; },
    complete: async ({ system }) => {
      log.claude++;
      if (/JSON/.test(system) && /report page|microsite/i.test(system)) return '{"headline":"Named in 2 of 6 prompts","summary":"A solid first measurement"}';
      if (/review|QA/i.test(system.slice(0, 300))) return '{"overallScore": 9, "readyToSend": true}';
      return 'SUBJECT: Acme in AI answers, September\n---\nHi team, Acme was named in 2 of 6 buyer prompts.';
    },
    checkReport: async () => ({ verdict: 'accurate', issues: [], summary: 'Figures match.' }),
    saveGenerated: async row => { log.saved = row; },
    saveState: async s => { log.states.push(s.status); },
    snapshot: async () => { log.snapshots++; return SNAP; },
    ...over
  };
  return { d, log };
}

await t('the AEO report switch is off until someone turns it on', () => eq(PROFILE_DEFAULTS.aeo_reports_enabled, false));

await t('measures, writes, checks and saves the AEO report (never sends it)', async () => {
  const { d, log } = deps();
  const state = newAeoReportState(CLIENT, '2026-09');
  const { more } = await runAeoReportScan(CLIENT, state, d);
  eq(more, false); eq(state.status, 'done');
  eq(log.saved.report_type, 'aeo'); eq(log.saved.month, '2026-09');
  eq(log.saved.aeo_probe.month, '2026-09', 'results filed under the report month');
  eq(log.saved.qa.independent_check.verdict, 'accurate');
  eq(log.saved.qa.compared_with, null);
  eq(log.history.client_id, 'c1', 'also offered to AEO History');
  eq(log.carry, null, 'working data cleared once the report is saved');
  eq(state.summary.named_in, SNAP.prompt_coverage);
});

await t('a long census is carried across runs, then written in a later one', async () => {
  let n = 0;
  const partial = { partial: true, groups_done: 40, carry: { groups: [{ probe: { id: 'p', query: 'q' }, engineId: 'chatgpt', mode: 'search_on', runs: [{ probeId: 'p', appeared: true }] }], runRecords: [{ probeId: 'p', appeared: true }, { probeId: 'x', error: 'boom' }], discovered: [] } };
  const { d, log } = deps({ snapshot: async (c, o) => { n++; if (n === 1) return partial; eq(o.carry.groups.length, 1, 'carry handed back'); eq(o.carry.runRecords.length, 2, 'failed and good answers both restored'); return SNAP; } });
  const state = newAeoReportState(CLIENT, '2026-09');
  eq((await runAeoReportScan(CLIENT, state, d)).more, true);
  eq(state.status, 'probing'); eq(state.progress.groups_done, 40); eq(log.saved, null);
  eq(log.carry.runRecords.length, 1, 'stored packed: only the failed call separately');
  eq((await runAeoReportScan(CLIENT, state, d)).more, false);
  eq(state.status, 'done'); eq(n, 2);
});

await t('when the census finishes with no time left, the writing waits for the next run — without measuring again', async () => {
  let left = 2 * 60 * 1000;
  const { d, log } = deps({ timeLeftMs: () => left });
  const state = newAeoReportState(CLIENT, '2026-09');
  eq((await runAeoReportScan(CLIENT, state, d)).more, true);
  eq(state.stage, 'probed'); eq(log.claude, 0);
  left = 13 * 60 * 1000;
  eq((await runAeoReportScan(CLIENT, state, d)).more, false);
  eq(state.status, 'done'); eq(log.snapshots, 1, 'measured once');
});

await t('an existing report is kept unless asked; no prompts or no working engine means no report', async () => {
  let x = deps({ loadExisting: async () => ({ id: 'r1' }) });
  let state = newAeoReportState(CLIENT, '2026-09');
  await runAeoReportScan(CLIENT, state, x.d);
  eq(state.status, 'skipped'); eq(x.log.snapshots, 0);
  state = newAeoReportState(CLIENT, '2026-09');
  await runAeoReportScan(CLIENT, state, x.d, { force: true });
  eq(state.status, 'done');

  x = deps();
  state = newAeoReportState({ id: 'c2', name: 'Empty' }, '2026-09');
  await runAeoReportScan({ id: 'c2', name: 'Empty' }, state, x.d);
  eq(state.status, 'blocked'); has(state.error, /No prompts to measure/); eq(x.log.snapshots, 0);

  const dead = { ...SNAP, engine_health: { chatgpt: { label: 'ChatGPT', runs: 18, errors: 18, all_failed: true, sample_error: 'OpenAI 401' } } };
  x = deps({ snapshot: async () => dead });
  state = newAeoReportState(CLIENT, '2026-09');
  await runAeoReportScan(CLIENT, state, x.d);
  eq(state.status, 'failed'); has(state.error, /OpenAI 401/); eq(x.log.saved, null); eq(x.log.claude, 0);
});

await t('grounding runs first and a changed prompt set is saved to the client', async () => {
  const grounded = { ...CLIENT, aeo_probes: [{ id: 'g1', query: 'best widget makers', type: 'category', intent: 'commercial', tier: 1, source: 'gold', active: true, runMode: 'search_on' }] };
  let given = null; let savedClient = null;
  const { d } = deps({ groundClient: async () => ({ client: grounded, changed: true }), saveClientProbes: async c => { savedClient = c; }, snapshot: async c => { given = c; return SNAP; } });
  await runAeoReportScan(CLIENT, newAeoReportState(CLIENT, '2026-09'), d);
  eq(savedClient.aeo_probes.length, 1); eq(given.aeo_probes[0].query, 'best widget makers');
});

await t('month on month comes from the previous AEO report', async () => {
  const before = { ...SNAP, visibility_score: 10, mentions: 3, citations: 1 };
  let payload = '';
  const { d, log } = deps({ loadPrevious: async () => ({ month: '2026-08', snapshot: before }), complete: async ({ system, messages }) => { payload = messages[0].content; return /JSON/.test(system) ? '{"headline":"x"}' : 'SUBJECT: s\n---\nbody'; } });
  const state = newAeoReportState(CLIENT, '2026-09');
  await runAeoReportScan(CLIENT, state, d);
  eq(log.saved.qa.compared_with, '2026-08'); eq(state.summary.compared_with, '2026-08');
});

// ── The figure check ──
await t('figures are checked against the measured results; invented ones are left for the reviewer', () => {
  const probe = { ...SNAP, prompt_coverage: 2, scorable_probes: 6, coverage_rate: 0.33, visibility_score: 33.3, share_of_voice: 50, mentions: 12, citations: 12, sentiment_score: 100, total_runs: 36, engine_scores: { chatgpt: 33, gemini: 33 } };
  const text = 'Acme was named in 2 of 6 prompts (33% coverage), with 12 mentions and a 50% share of voice across 36 answers. Visibility grew 45%.';
  const f = checkFigures(text, aeoNumbers(probe, null, [], 0));
  for (const ok of ['33%', '12', '50%', '36']) if (!f.verified.includes(ok)) throw new Error(ok + ' should verify: ' + JSON.stringify(f));
  if (!f.unmatched.includes('45%')) throw new Error('45% is invented');
});

await t('an engine that could not be measured, and a missing earlier month, are flagged to the reviewer', () => {
  const probe = { ...SNAP, engine_health: { chatgpt: { label: 'ChatGPT', runs: 18, errors: 18, all_failed: true }, gemini: { label: 'Gemini', runs: 18, errors: 9, all_failed: false } } };
  const notes = aeoNotable(probe, { has_previous: false }).join(' | ');
  has(notes, /ChatGPT could not be measured/); has(notes, /Gemini failed on 50% of calls/); has(notes, /no previous month/i);
  const input = buildAeoCheckInput({ client: CLIENT, month: '2026-09', probe, compare: { has_previous: false }, ranking: [], brandRank: 0, email: { subject: 's', body: 'b' }, micro: {} });
  has(input, /"previous_month": null/); has(input, /must not be reported as 0% visibility/);
});

// ── The email to the team ──
await t('"report ready" email: says AEO, what was measured, and what to do', () => {
  const state = { status: 'done', month: '2026-09', qa_score: 9, check: { verdict: 'issues', issues: [{ severity: 'error', issue: 'Says visibility grew 45%.' }, { severity: 'warning', issue: 'Low coverage called strong.' }] },
    email_subject: 'Acme in AI answers', email_body: 'Hi team', engine_notes: ['Gemini failed on 50% of calls'],
    summary: { prompts: 6, named_in: 2, answers: 36, engines: ['chatgpt', 'gemini'], compared_with: null } };
  const { subject, html } = buildReportReadyEmail(CLIENT, state, 'https://suite.example', 'https://suite.example/view?e=1', { kind: 'aeo' });
  eq(subject, 'Action needed — Acme: AEO report for 2026-09 is ready, 1 thing to fix first');
  has(html, /What you need to do/); has(html, /Fix 1 point the accuracy check found/); has(html, /Measured: 6 prompts across chatgpt, gemini \(36 answers\)/);
  has(html, /No earlier month to compare with/); has(html, /Gemini failed on 50%/); has(html, /the answers collected from the AI engines/);
  const clean = buildReportReadyEmail(CLIENT, { ...state, check: { verdict: 'accurate', issues: [] }, engine_notes: [] }, 'u', 'v', { kind: 'aeo' });
  eq(clean.subject, 'Acme: AEO report for 2026-09 is ready to send');
  const seo = buildReportReadyEmail(CLIENT, { status: 'blocked', month: '2026-09', error: 'Search Console check failed' }, 'u', '');
  eq(seo.subject, 'Action needed — Acme: SEO report for 2026-09 was NOT built'); has(seo.html, /Search Console check failed/);
});

console.log(`\naeoReportScan: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
