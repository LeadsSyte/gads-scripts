// Onboarding Baseline, captured automatically when a client is added.
//
// A baseline is "where the client is with everything" on day one — not a
// hunt for opportunities. So, unlike the monthly reports, it:
//   - pulls last month's GA4 organic traffic + conversions and GSC rankings
//     (the same fetchReportData the Monthly Report uses),
//   - crawls the site once and records the technical health counts (no AI
//     triage, no tasks written to the board),
//   - measures AI-engine visibility once on the client's tracked prompts with
//     NO winner expansion, no new prompts, no fan-out proposals (no "gems"),
//   - and saves it all as the client's row in syte_suite_baselines.
//
// A background function has a hard time limit, so the work is staged and
// carried in the state row; runBaselineScan returns { more: true } until it's
// finished. Every outside call is injected (`deps`), so it's testable.

import { runSnapshot, resolveProbes } from '../../../src/modules/reports/aeoRunner.js';
import { previousMonthKey, monthKeyLabel } from '../../../src/modules/reports/reportMonths.js';
import { packCarry, unpackCarry } from './aeoReportScan.js';

export const BASELINE_STATE_PREFIX = 'baseline:';
export const BASELINE_DATA_VERSION = 1;
export const BASELINE_ACTIVE = ['queued', 'traffic', 'technical', 'aeo', 'saving'];

// Bounds on the one-off AEO measurement: a handful of prompts, once each,
// retrieval mode only — enough to say where the brand stands today.
export const BASELINE_AEO_MAX_PROMPTS = 20;
export const BASELINE_CRAWL_PAGES = 50;

export function newBaselineState(client, now = new Date(), { force = false, trigger = 'auto' } = {}) {
  return {
    client_id: client.id, client_name: client.name,
    month: previousMonthKey(now),
    status: 'queued', stage: 'traffic', force: !!force, trigger,
    started_at: now.toISOString(), updated_at: now.toISOString(), finished_at: null,
    sections: {}, log: []
  };
}

function log(state, line, now) {
  state.log = [...(state.log || []), (now || new Date()).toISOString().slice(11, 19) + ' ' + line].slice(-30);
}

// The shape ReportDashboard expects, for a client with no GA4/GSC yet.
export function emptyReportData(errors = []) {
  return {
    traffic: { current: null, previous: null, yoy: null, momChange: null, yoyChange: null },
    keywords: [], keywordBuckets: null, topPages: [], errors
  };
}

// Technical health from a crawl: counts by severity and the most widespread
// issues. Facts only — no fixes proposed.
export function summarizeCrawl(crawl) {
  const pages = (crawl?.pages || []).filter(p => !p.error && !p.skipped);
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const byIssue = new Map();
  for (const p of pages) {
    for (const i of p.issues || []) {
      if (i.severity in bySeverity) bySeverity[i.severity]++;
      const key = (i.type || 'other') + '|' + (i.severity || 'low') + '|' + String(i.detail || '').replace(/\d+/g, '#').slice(0, 80);
      const e = byIssue.get(key) || { type: i.type || 'other', severity: i.severity || 'low', detail: i.detail || '', pages: 0 };
      e.pages++;
      byIssue.set(key, e);
    }
  }
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  const topIssues = [...byIssue.values()]
    .sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || b.pages - a.pages)
    .slice(0, 12);
  const totalIssues = Object.values(bySeverity).reduce((a, b) => a + b, 0);
  return {
    pages_crawled: crawl?.totalCrawled || 0,
    pages_ok: pages.length,
    pages_with_issues: crawl?.withIssues || 0,
    pages_unreachable: crawl?.withErrors || 0,
    urls_discovered: crawl?.urlsDiscovered ?? null,
    discovery_source: crawl?.discoverySource || null,
    total_issues: totalIssues,
    by_severity: bySeverity,
    top_issues: topIssues
  };
}

// AI-engine visibility from one snapshot. Headline numbers + per-prompt rows.
export function summarizeAeo(snap) {
  const rows = (snap?.probe_results || []).filter(r => r.type !== 'reverse');
  const byQuery = new Map();
  for (const r of rows) {
    const q = byQuery.get(r.query) || { query: r.query, intent: r.intent || null, engines: {} };
    q.engines[r.engine] = { appeared: (r.appearances || 0) > 0, rate: r.appearanceRate ?? 0, position: r.avgPositionWhenAppearing ?? null };
    byQuery.set(r.query, q);
  }
  return {
    composite_index: snap?.composite_index ?? snap?.overall_score ?? null,
    coverage_pct: snap?.coverage_rate != null ? Math.round(snap.coverage_rate * 1000) / 10 : null,
    prompt_coverage: snap?.prompt_coverage ?? null,
    share_of_voice: snap?.share_of_voice ?? null,
    visibility_score: snap?.visibility_score ?? null,
    mentions: snap?.mentions ?? 0,
    citations: snap?.citations ?? 0,
    avg_position: snap?.avg_position ?? null,
    top3_rate: snap?.top3_rate ?? null,
    sentiment: snap?.sentiment ?? null,
    engine_scores: snap?.engine_scores || {},
    engines_used: snap?.engines_used || [],
    competitors: (snap?.competitors || []).map(c => ({ name: c.name, mentions: c.mentions || 0, citations: c.citations || 0 })),
    total_runs: snap?.total_runs ?? 0,
    prompts: [...byQuery.values()]
  };
}

// What the baseline row's `data` holds: the report-shaped search data (so
// ReportDashboard renders it as before) plus the rest of "everything".
export function buildBaselineData(state) {
  const s = state.sections || {};
  const base = s.traffic?.data || emptyReportData(s.traffic?.note ? [s.traffic.note] : []);
  return {
    ...base,
    baseline: {
      version: BASELINE_DATA_VERSION,
      mode: state.trigger === 'manual' ? 'manual-full' : 'auto',
      month: state.month,
      captured_at: state.finished_at || new Date().toISOString(),
      technical: s.technical || null,
      aeo: s.aeo || null,
      sources: {
        ga4: s.traffic?.ga4 || 'skipped',
        gsc: s.traffic?.gsc || 'skipped',
        technical: s.technical?.status || 'skipped',
        aeo: s.aeo?.status || 'skipped'
      }
    }
  };
}

// deps:
//   loadBaseline(client)              → existing baseline row | null
//   fetchData(client, year, month1)   → fetchReportData-shaped object
//   crawl(client)                     → crawlSiteForIssues result
//   groundClient(client)              → { client, changed } (optional)
//   saveClientProbes(client)          (optional)
//   engines()                         → AEO engines with keys
//   extract(args)                     → structured facts from one answer
//   snapshot(client, opts)            → runSnapshot (tests pass a fake)
//   saveBaseline(clientId, month, data)
//   saveState(state), timeLeftMs(), now()
export async function runBaselineScan(client, state, deps) {
  const now = () => (deps.now ? deps.now() : new Date());
  const save = async () => { state.updated_at = now().toISOString(); await deps.saveState(state); };
  const timeLeft = () => (deps.timeLeftMs ? deps.timeLeftMs() : Infinity);
  const snapshot = deps.snapshot || runSnapshot;
  state.sections = state.sections || {};

  // Never replace a baseline someone already captured unless asked to.
  if (state.stage === 'traffic' && !state.force) {
    const existing = await deps.loadBaseline(client);
    if (existing) {
      state.status = 'skipped';
      state.note = 'A baseline already exists for ' + client.name + ' — not overwritten.';
      state.finished_at = now().toISOString();
      log(state, state.note, now());
      await save();
      return { more: false };
    }
  }

  // 1. GA4 + Search Console, last complete month.
  if (state.stage === 'traffic') {
    state.status = 'traffic';
    if (client.ga4_property_id || client.gsc_property) {
      log(state, 'Pulling GA4 traffic + Search Console rankings for ' + monthKeyLabel(state.month), now());
      await save();
      try {
        const [y, m] = state.month.split('-').map(Number);
        const data = await deps.fetchData(client, y, m);
        const errs = data?.errors || [];
        state.sections.traffic = {
          data,
          ga4: !client.ga4_property_id ? 'not_connected' : (data?.traffic?.current ? 'ok' : 'error'),
          gsc: !client.gsc_property ? 'not_connected' : (errs.some(e => /^GSC/.test(e)) ? 'error' : 'ok')
        };
        log(state, 'Search data: ' + [
          data?.traffic?.current ? 'GA4 ✓' : null,
          data?.keywords?.length ? 'GSC ✓ (' + data.keywords.length + ' keywords)' : null,
          ...errs
        ].filter(Boolean).join(' · '), now());
      } catch (e) {
        const msg = String(e.message || e).slice(0, 200);
        state.sections.traffic = { data: emptyReportData([msg]), ga4: 'error', gsc: 'error', note: msg };
        log(state, 'Search data failed: ' + msg, now());
      }
    } else {
      state.sections.traffic = { ga4: 'not_connected', gsc: 'not_connected', note: 'GA4 / Search Console not connected yet' };
      log(state, 'No GA4 or Search Console connected — skipping search data', now());
    }
    state.stage = 'technical';
    await save();
  }

  // 2. Technical health — one crawl, counts only.
  if (state.stage === 'technical') {
    state.status = 'technical';
    if (client.url || client.sitemap_url) {
      log(state, 'Crawling the website (up to ' + BASELINE_CRAWL_PAGES + ' pages)', now());
      await save();
      try {
        const crawl = await deps.crawl(client);
        state.sections.technical = { status: 'ok', ...summarizeCrawl(crawl) };
        log(state, 'Crawled ' + state.sections.technical.pages_crawled + ' pages · ' + state.sections.technical.total_issues + ' issues', now());
      } catch (e) {
        state.sections.technical = { status: 'error', error: String(e.message || e).slice(0, 200) };
        log(state, 'Crawl failed: ' + state.sections.technical.error, now());
      }
    } else {
      state.sections.technical = { status: 'skipped', note: 'No website URL on the client' };
    }
    state.stage = 'aeo';
    await save();
  }

  // 3. AI-engine visibility — one measurement, no expansion.
  if (state.stage === 'aeo') {
    state.status = 'aeo';
    const engines = client.does_aeo === false ? [] : deps.engines();
    if (client.does_aeo === false) {
      state.sections.aeo = { status: 'skipped', note: 'AEO is not a service for this client' };
    } else if (!engines.length) {
      state.sections.aeo = { status: 'skipped', note: 'No AI engine keys are set on the server' };
    } else {
      let working = client;
      if (!state.aeo_carry && deps.groundClient) {
        log(state, 'Preparing the prompts to measure', now());
        await save();
        try {
          const g = await deps.groundClient(client);
          if (g?.client) working = g.client;
          if (g?.changed && deps.saveClientProbes) { try { await deps.saveClientProbes(working); } catch { /* run with the set in hand */ } }
        } catch { /* keep the client's own probes */ }
      }
      const { scorable } = resolveProbes(working, { includeReverse: false });
      if (!scorable.length) {
        state.sections.aeo = { status: 'skipped', note: 'No AEO prompts could be built for this client yet' };
      } else {
        log(state, 'Asking the AI engines (' + Math.min(scorable.length, BASELINE_AEO_MAX_PROMPTS) + ' prompts, once each)', now());
        await save();
        try {
          const result = await snapshot(working, {
            engines, extract: deps.extract,
            carry: state.aeo_carry ? unpackCarry(state.aeo_carry) : null,
            previousSnapshot: null,
            iterations: 1,
            retrievalOnly: true,
            maxQueries: BASELINE_AEO_MAX_PROMPTS,
            expandWinners: false, newPrompts: 0,
            timeLeftMs: deps.timeLeftMs,
            onProgress: null
          });
          if (result.partial) {
            state.aeo_carry = packCarry(state.month, result.carry);
            log(state, 'Pausing — ' + result.groups_done + ' prompt/engine pairs measured so far; carrying on in a fresh run', now());
            await save();
            return { more: true };
          }
          state.aeo_carry = null;
          state.sections.aeo = { status: 'ok', ...summarizeAeo(result) };
          log(state, 'AI visibility measured: ' + state.sections.aeo.total_runs + ' answers', now());
        } catch (e) {
          state.aeo_carry = null;
          state.sections.aeo = { status: 'error', error: String(e.message || e).slice(0, 200) };
          log(state, 'AI visibility failed: ' + state.sections.aeo.error, now());
        }
      }
    }
    state.stage = 'saving';
    await save();
    if (timeLeft() < 60 * 1000) return { more: true };
  }

  // 4. Save against the client.
  if (state.stage === 'saving') {
    state.status = 'saving';
    state.finished_at = now().toISOString();
    await deps.saveBaseline(client.id, state.month, buildBaselineData(state));
    state.status = 'done';
    state.stage = 'done';
    // The data lives on the baseline row now; keep the state row small.
    if (state.sections.traffic) delete state.sections.traffic.data;
    log(state, 'Baseline saved', now());
    await save();
  }
  return { more: false };
}
