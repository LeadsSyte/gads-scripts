// AEO Report Autopilot — the monthly AEO (AI visibility) report, built on
// the server:
//
//   the client's probe set (grounded the same way the page does it) → the
//   census: every prompt asked of ChatGPT, Claude and Gemini several times
//   (src/modules/reports/aeoRunner.js) → the same email + report page + QA as
//   "Generate AEO report" (reportGenerate.js) → an INDEPENDENT accuracy check
//   of every figure → saved as the month's AEO report, ready to review and
//   send. Nothing is sent to the client.
//
// A census is 700–1,400 questions and does not fit in one background run
// (15 minutes). The work is carried from run to run: runAeoReportScan
// returns { more: true } until it's finished, and nothing is asked twice.
//
// Every outside call is injected (`deps`), so it's testable.

import { runSnapshot, resolveProbes } from '../../../src/modules/reports/aeoRunner.js';
import { generateAeoReport } from '../../../src/modules/reports/reportGenerate.js';
import { normalizeSnapshot } from '../../../src/modules/reports/aeoCompare.js';
import { monthKeyLabel } from '../../../src/modules/reports/reportMonths.js';
import { checkFigures, normalizeReportCheck } from './reportScan.js';

export const AEO_REPORT_STATE_PREFIX = 'aeoreport:';
export const AEO_REPORT_CARRY_PREFIX = 'aeoreport-carry:';

// Time the writing stage needs (two long Claude calls, QA, the check).
const WRITE_NEEDS_MS = 5 * 60 * 1000;

export function newAeoReportState(client, month, now = new Date()) {
  return { client_id: client.id, client_name: client.name, month, status: 'queued', stage: 'start', started_at: now.toISOString(), updated_at: now.toISOString(), log: [] };
}
function log(state, line, now) {
  state.log = [...(state.log || []), (now || new Date()).toISOString().slice(11, 19) + ' ' + line].slice(-30);
}

// The carried census is large; every run record sits in exactly one group,
// so only the failed calls are stored separately.
export function packCarry(month, carry) {
  return { month, ...carry, runRecords: (carry.runRecords || []).filter(r => r.error) };
}
export function unpackCarry(saved) {
  if (!saved?.groups) return null;
  const { month, snapshot, ...carry } = saved;
  return { ...carry, runRecords: (carry.runRecords || []).concat(carry.groups.flatMap(g => g.runs || [])) };
}

export const AEO_CHECK_SYSTEM = `You are an independent reviewer at an SEO agency. Another AI wrote a client's monthly AEO report (how often AI assistants like ChatGPT, Claude and Gemini name the client) from the DATA below. Before an account manager sends it to the client, check that it is accurate and fair.

The figures have ALREADY been checked by code:
- NUMBERS VERIFIED BY CODE are correct (exact or normally rounded). NEVER flag them.
- NUMBERS NOT FOUND IN THE DATA need your judgement: fine when they aren't data claims (e.g. "three engines", "60 to 90 days"), an ERROR when they're presented as this client's results.

Return JSON only: {"verdict": "accurate" | "issues", "issues": [{"severity": "error" | "warning", "issue": "one sentence, quoting the statement"}], "summary": "one sentence"}

ERROR: an unverified number presented as a result; a direction that contradicts the DATA (e.g. "visibility grew" when it fell); a month-on-month claim when the DATA has no previous month; naming a competitor or a win that is not in the DATA; claiming a rank the DATA doesn't give; the wrong client or month; SEO results (rankings, clicks, traffic) presented in this AEO report.
WARNING: a point under NOTABLE that the email doesn't reflect honestly (e.g. an engine that could not be measured presented as "0% visibility"); low coverage described as strong.
Rounding is always fine.`;

export function aeoNumbers(probe, compare, ranking, brandRank) {
  const vals = [];
  const add = v => { const n = Number(v); if (v !== null && v !== '' && v !== undefined && Number.isFinite(n)) { vals.push(n); vals.push(Math.abs(n)); } };
  ['composite_index', 'overall_score', 'prompt_coverage', 'scorable_probes', 'queries_count', 'new_themes', 'share_of_voice',
    'visibility_score', 'detection_rate', 'top3_rate', 'avg_position', 'mentions', 'citations', 'sentiment_score',
    'iterations', 'total_runs', 'expansion_count'].forEach(k => add(probe?.[k]));
  if (probe?.coverage_rate != null) add(Math.round(probe.coverage_rate * 100));
  Object.values(probe?.carry_forward || {}).forEach(add);
  add((probe?.engines_used || []).length);
  Object.values(probe?.engine_scores || {}).forEach(add);
  (probe?.intent_breakdown || []).forEach(b => { add(b.visibility); add(b.queries); });
  (probe?.competitors || []).forEach(c => { add(c.visibility); add(c.mentions); add(c.citations); add(c.top3_rate); });
  (ranking || []).forEach(r => { add(r.visibility); add(r.mentions); add(r.citations); add(r.top3_rate); });
  add((ranking || []).length); add(brandRank);
  const wins = probe?.keyword_wins || {};
  ['active', 'emerging', 'zero'].forEach(k => add((wins[k] || []).length));
  [...(wins.active || []), ...(wins.emerging || [])].forEach(w => { add(w.visibility); add(w.appearance_rate); add(w.avg_position); });
  (probe?.citation_gaps || []).forEach(g => add(g.hitCount));
  add((probe?.citation_gaps || []).length);
  if (probe?.sov_detail) Object.values(probe.sov_detail).forEach(add);
  if (compare?.has_previous) {
    Object.values(compare.previous || {}).forEach(add);
    Object.values(compare.current || {}).forEach(add);
    Object.values(compare.deltas || {}).forEach(d => { add(d?.absolute); add(d?.percent); });
  }
  return vals;
}

// Things the email must reflect honestly.
export function aeoNotable(probe, compare) {
  const out = [];
  for (const h of Object.values(probe?.engine_health || {})) {
    if (h.all_failed) out.push(h.label + ' could not be measured this month (every call failed) — it must not be reported as 0% visibility');
    else if (h.runs && h.errors / h.runs >= 0.4) out.push(h.label + ' failed on ' + Math.round((h.errors / h.runs) * 100) + '% of calls — its figures are from a reduced sample');
  }
  if (!compare?.has_previous) out.push('There is no previous month to compare with — no month-on-month claims');
  const d = compare?.deltas || {};
  if (compare?.has_previous && d.coverage?.absolute <= -10) out.push('coverage fell by ' + Math.abs(d.coverage.absolute) + ' points vs the previous month');
  if (compare?.has_previous && d.visibility?.absolute <= -10) out.push('visibility fell by ' + Math.abs(d.visibility.absolute) + ' points vs the previous month');
  if (probe?.coverage_rate != null && probe.coverage_rate < 0.1) out.push('the brand was named in under 10% of prompts');
  return out;
}

export function buildAeoCheckInput({ client, month, probe, compare, ranking, brandRank, email, micro }) {
  const facts = {
    client: client.name, month: monthKeyLabel(month),
    prompts_measured: probe.scorable_probes ?? probe.queries_count, named_in_prompts: probe.prompt_coverage,
    coverage_pct: probe.coverage_rate != null ? Math.round(probe.coverage_rate * 100) : null,
    aeo_index: probe.composite_index ?? probe.overall_score, share_of_voice_pct: probe.share_of_voice,
    visibility_pct: probe.visibility_score, detection_pct: probe.detection_rate, top3_pct: probe.top3_rate,
    avg_position: probe.avg_position, mentions: probe.mentions, citations: probe.citations, sentiment_positive_pct: probe.sentiment_score,
    new_themes: probe.new_themes, engines: probe.engines_used,
    long_tail_carried_from_last_month: probe.carry_forward || null, per_engine_visibility_pct: probe.engine_scores,
    by_intent: probe.intent_breakdown,
    ranking: (ranking || []).slice(0, 8).map(r => ({ name: r.name, is_client: !!r.isBrand, visibility: r.visibility, mentions: r.mentions, citations: r.citations })),
    client_rank: brandRank || null,
    wins: (probe.keyword_wins?.active || []).slice(0, 12).map(w => ({ prompt: w.query, engine: w.engine_label || w.engine, visibility: w.visibility })),
    emerging: (probe.keyword_wins?.emerging || []).slice(0, 12).map(w => ({ prompt: w.query, visibility: w.visibility })),
    zero_visibility_prompts: (probe.keyword_wins?.zero || []).length,
    citation_gaps: (probe.citation_gaps || []).slice(0, 8).map(g => ({ domain: g.domain, times_cited: g.hitCount, competitors: g.competitors })),
    previous_month: compare?.has_previous ? { values: compare.previous, this_month: compare.current, change: compare.deltas } : null
  };
  const text = (email.subject || '') + '\n' + (email.body || '') + '\n' + JSON.stringify(micro || {});
  const figures = checkFigures(text, aeoNumbers(probe, compare, ranking, brandRank));
  const notable = aeoNotable(probe, compare);
  return `DATA (authoritative):
${JSON.stringify(facts, null, 2)}

NUMBERS VERIFIED BY CODE (correct — do not flag): ${figures.verified.join(', ') || '(none)'}
NUMBERS NOT FOUND IN THE DATA (judge these): ${figures.unmatched.join(', ') || '(none)'}
NOTABLE (the email must reflect these honestly): ${notable.join('; ') || '(none)'}

EMAIL TO CHECK:
Subject: ${email.subject || ''}
${email.body || ''}

REPORT PAGE CONTENT TO CHECK (JSON):
${JSON.stringify(micro).slice(0, 12000)}`;
}

// deps:
//   loadExisting(client, month)  → the month's AEO report row | null
//   loadPrevious(client, month)  → { month, snapshot } of the latest earlier AEO report | null
//   groundClient(client)         → { client, changed } (optional)
//   saveClientProbes(client)     (optional)
//   engines()                    → the engines to ask (aeoEngines-shaped)
//   extract(args)                → structured facts from one answer
//   loadCarry(client) / saveCarry(client, data | null)
//   persistRuns(records, raws), saveSnapshot(row)   (both best-effort)
//   complete(opts), checkReport({ system, user })
//   saveGenerated(row), saveState(state), timeLeftMs(), now()
//   snapshot(client, opts)       → runSnapshot (tests pass a fake)
export async function runAeoReportScan(client, state, deps, { force = false } = {}) {
  const now = () => (deps.now ? deps.now() : new Date());
  const save = async () => { state.updated_at = now().toISOString(); await deps.saveState(state); };
  const timeLeft = () => (deps.timeLeftMs ? deps.timeLeftMs() : Infinity);
  const month = state.month;
  const snapshot = deps.snapshot || runSnapshot;
  // On a continued run the caller has reloaded the client, probes included.
  let working = client;

  if (state.stage === 'start') {
    const existing = await deps.loadExisting(client, month);
    if (existing && !force) {
      state.status = 'skipped';
      state.note = 'An AEO report for ' + monthKeyLabel(month) + ' already exists — not overwritten. Use "Replace it" to build it again.';
      log(state, state.note, now());
      await save();
      return { more: false };
    }
    // The probe set, grounded like the page grounds it. Never shrinks the set.
    if (deps.groundClient) {
      state.status = 'preparing';
      log(state, 'Preparing the prompts to measure', now());
      await save();
      try {
        const g = await deps.groundClient(client);
        if (g?.client) working = g.client;
        if (g?.changed && deps.saveClientProbes) { try { await deps.saveClientProbes(working); } catch { /* the run carries on with the set in hand */ } }
      } catch { /* keep the client's own probes */ }
    }
    const { scorable } = resolveProbes(working, { includeReverse: false });
    if (!scorable.length) {
      state.status = 'blocked';
      state.error = 'No prompts to measure: the prompt set could not be built from the website. Add AEO probe queries to this client (Clients → Edit → AEO Probe Queries).';
      log(state, state.error, now());
      await save();
      return { more: false };
    }
    state.prompts = scorable.length;
    state.stage = 'probing';
    await deps.saveCarry(client, null);
    await save();
  }

  let probe = null;
  if (state.stage === 'probing') {
    state.status = 'probing';
    log(state, 'Asking the AI engines (' + (state.prompts || '?') + ' prompts)', now());
    await save();
    const engines = deps.engines();
    if (!engines.length) throw new Error('No AI engine keys are set on the server (OPENAI_API_KEY, GOOGLE_AI_KEY, ANTHROPIC_API_KEY).');
    const saved = await deps.loadCarry(client);
    const carry = saved?.month === month ? unpackCarry(saved) : null;
    // Last month's long-tail prompts are this month's starting point.
    let previousSnapshot = null;
    try {
      const prev = await deps.loadPrevious(client, month);
      if (prev?.snapshot) previousSnapshot = { ...prev.snapshot, month: prev.month };
    } catch { /* no previous month: the web starts from the tracked set */ }
    const result = await snapshot(working, {
      engines, extract: deps.extract, carry, previousSnapshot,
      retrievalOnly: true,
      expandWinners: true, winnerTarget: 30, maxExpansionQueries: 40,
      timeLeftMs: deps.timeLeftMs,
      onRuns: (records, raws) => deps.persistRuns ? deps.persistRuns(records, raws).catch(() => {}) : null,
      onProgress: null
    });
    if (result.partial) {
      await deps.saveCarry(client, packCarry(month, result.carry));
      state.progress = { groups_done: result.groups_done };
      log(state, 'Pausing — ' + result.groups_done + ' prompt/engine pairs measured so far; carrying on in a fresh run', now());
      await save();
      return { more: true };
    }
    probe = { ...result, client_id: client.id, month };
    // Keep it where the next run can find it, whatever else happens.
    await deps.saveCarry(client, { month, snapshot: probe });
    if (deps.saveSnapshot) { try { await deps.saveSnapshot(probe); } catch (e) { state.snapshot_note = 'Not added to AEO History: ' + String(e.message || e).slice(0, 160); } }
    state.stage = 'probed';
    state.progress = null;
    log(state, 'Census complete: ' + probe.total_runs + ' answers collected', now());
    await save();
    if (timeLeft() < WRITE_NEEDS_MS) return { more: true };
  }

  if (!probe) {
    const saved = await deps.loadCarry(client);
    if (saved?.month !== month || !saved.snapshot) throw new Error('The measured results were not found — run it again.');
    probe = saved.snapshot;
  }

  const health = Object.values(probe.engine_health || {});
  if (health.length && health.every(h => h.all_failed)) {
    state.status = 'failed';
    state.error = 'Every AI engine failed on every call (' + (health[0].sample_error || 'no detail') + '). No report was written.';
    log(state, state.error, now());
    await save();
    return { more: false };
  }
  state.engine_notes = health.filter(h => h.all_failed || (h.runs && h.errors / h.runs >= 0.4))
    .map(h => h.label + (h.all_failed ? ' could not be measured' : ' failed on ' + Math.round((h.errors / h.runs) * 100) + '% of calls') + (h.sample_error ? ' (' + String(h.sample_error).slice(0, 120) + ')' : ''));

  state.status = 'writing';
  log(state, 'Writing the email and report', now());
  await save();
  const prev = await deps.loadPrevious(client, month);
  const previousSnap = prev?.snapshot ? normalizeSnapshot({ ...prev.snapshot, month: prev.month }) : null;
  const gen = await generateAeoReport({
    client, probe, previousSnap,
    monthLabel: monthKeyLabel(month), previousMonthLabel: prev ? monthKeyLabel(prev.month) : null,
    complete: deps.complete
  });

  state.status = 'checking';
  log(state, 'Checking every figure against the measured results', now());
  await save();
  let check;
  try {
    check = normalizeReportCheck(await deps.checkReport({
      system: AEO_CHECK_SYSTEM,
      user: buildAeoCheckInput({ client, month, probe, compare: gen.compare, ranking: gen.ranking, brandRank: gen.brandRank, email: gen.email, micro: gen.micro })
    }));
  } catch (e) {
    check = { verdict: 'issues', issues: [{ severity: 'warning', issue: 'The accuracy check could not run: ' + String(e.message || e).slice(0, 200) }], summary: '' };
  }

  await deps.saveGenerated({
    client_id: client.id, month, report_type: 'aeo',
    qa_score: gen.qa?.overallScore || null,
    email_subject: gen.email.subject || '',
    email_body: gen.email.body || gen.aliceText,
    microsite_json: gen.micro,
    qa: { ...(gen.qa || {}), independent_check: check, generated_by: 'AEO Report Autopilot', compared_with: prev?.month || null },
    aeo_probe: probe,
    report_data: null
  });
  await deps.saveCarry(client, null);

  state.status = 'done';
  state.stage = 'done';
  state.qa_score = gen.qa?.overallScore || null;
  state.check = check;
  state.email_subject = gen.email.subject || '';
  state.email_body = gen.email.body || '';
  state.summary = {
    prompts: probe.scorable_probes ?? probe.queries_count, named_in: probe.prompt_coverage,
    answers: probe.total_runs, engines: probe.engines_used, compared_with: prev?.month || null
  };
  state.finished_at = now().toISOString();
  log(state, 'Report ready for review', now());
  await save();
  return { more: false };
}
