// AEO v2 snapshot runner.
//
// For each active probe x engine x runMode we run N iterations. Every run is
// captured as a full record (Requirement 2) via ONE structured Haiku
// extraction call, and citation URLs are pulled from each API's structured
// citation fields. Scores use appearance rate + average position WHEN
// APPEARING (Requirement 3) — single-shot position is dead.
//
// The runner does NOT import supabase (that keeps it node-importable and lets
// callers inject stubs). Per-run records + raw bodies are handed to the
// caller through the `onRuns` callback for persistence, exactly like the UI
// already owns saveAeoSnapshot.

import { ALL_ENGINES, activeEngines, resolveRunModes } from './aeoEngines.js';
import { extractRun, extractCitedUrls, hashResponse } from './aeoExtract.js';
import { detectBrand, countCitations } from './brandDetection.js';
import {
  scoreRunGroup, appearanceRate, avgPositionWhenAppearing, visibilityScore,
  promptCoverage, coverageRate, meanVisibilityCovered, compositeIndex,
  citationDensity, bucketByAppearance
} from './aeoScore.js';
import {
  parseProbes, migrateClientProbes, activeProbes, scorableProbes,
  reverseProbesFor, countNewThemesSince, INTENT_IDS
} from './aeoProbes.js';
import { buildCitationGaps } from './aeoCitationGaps.js';
import { expandWinnerQuery } from './winnerExpansion.js';

const DEFAULT_ITERATIONS = 3;
const DEFAULT_CONCURRENCY = 3;   // max in-flight requests per engine

// Resolve run modes for a probe, honouring a run-wide retrieval-only override.
// Retrieval-only drops the parametric (search_off) pass entirely, so a toggle
// engine (ChatGPT/Claude) runs half the calls and the sweep finishes faster.
// The headline score is retrieval-first anyway, so nothing that feeds the top
// line is lost — only the parametric_appearance_rate diagnostic goes quiet.
function runModesFor(probeRunMode, engine, retrievalOnly) {
  if (retrievalOnly) return resolveRunModes('search_on', engine);
  return resolveRunModes(probeRunMode, engine);
}
const DEFAULT_RETRIES = 3;       // on 429
const DEFAULT_RETRY_MS = 1000;   // base backoff, doubles each attempt

// Tiny concurrency limiter — caps how many of `fn` run at once.
function pLimit(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms));

function is429(resp) {
  return resp?.error && (resp.status === 429 || /\b429\b|rate limit|too many requests/i.test(resp.error));
}

// Call eng.ask with exponential backoff on 429. sleep is injectable so tests
// don't actually wait. Non-429 errors return immediately (skip, don't abort).
async function askWithBackoff(eng, query, askOpts, { retries, baseMs, sleep }) {
  let delay = baseMs;
  for (let attempt = 0; ; attempt++) {
    const resp = await eng.ask(query, askOpts);
    // A flagged sustained rate-limit / config error already exhausted the
    // engine's own retries, so don't hammer it; the runner disables it instead.
    if (resp?.rateLimited || resp?.configError) return resp;
    if (!is429(resp) || attempt >= retries) return resp;
    await sleep(delay);
    delay *= 2;
  }
}

function parseCompetitors(raw) {
  return (raw || '')
    .split(/[,\n]/).map(s => s.trim()).filter(Boolean)
    .map(entry => {
      const sep = entry.match(/^(.+?)\s*[|]\s*(.+)$/) || entry.match(/^(.+?)\s*\((.+?)\)\s*$/);
      if (sep) return { name: sep[1].trim(), url: sep[2].trim() };
      if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(entry)) return { name: entry, url: entry };
      return { name: entry, url: '' };
    });
}

function inline_shareOfVoice(brandMentions, competitors) {
  const brand = Math.max(0, Number(brandMentions) || 0);
  const compTotal = (competitors || []).reduce((a, c) => a + (Number(c.mentions) || 0), 0);
  const denom = brand + compTotal;
  if (denom === 0) return { sov: 0, brand, competitorTotal: compTotal, totalMentions: 0 };
  return { sov: Math.round((brand / denom) * 1000) / 10, brand, competitorTotal: compTotal, totalMentions: denom };
}

function hostMatchesBrand(url, brandUrl, brandName) {
  const bd = (brandUrl || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  const slug = (brandName || '').toLowerCase().replace(/\s+/g, '');
  let host = '';
  try { host = new URL(url).host.replace(/^www\./, '').toLowerCase(); } catch { return false; }
  if (bd && (host === bd || host.endsWith('.' + bd))) return true;
  const root = bd.split('.')[0];
  if (root && root.length >= 4 && host.includes(root)) return true;
  if (slug.length >= 4 && host.includes(slug)) return true;
  return false;
}

// Headline metrics are RETRIEVAL-first. If a (probe, engine) has web-search
// (search_on) runs, score ONLY those and report the parametric (search_off)
// runs as a separate signal. Without this, the near-zero parametric runs halve
// the visibility of the toggle-capable engines (ChatGPT, Claude) relative to
// the retrieval-native ones (Perplexity, Gemini) — which is exactly why
// ChatGPT reads ~0 in the automated tool while it shows up in manual runs.
function retrievalPreferred(runs) {
  const on = (runs || []).filter(r => r.runMode === 'search_on');
  return on.length ? on : (runs || []);
}

// Resolve the probe set the snapshot runs against.
export function resolveProbes(client, { now, includeReverse = true } = {}) {
  const stored = parseProbes(client);
  const base = (stored && stored.length) ? stored : migrateClientProbes(client, { now });
  const act = activeProbes(base);
  const reverse = includeReverse ? reverseProbesFor(client, { now }) : [];
  return { all: base, active: act, scorable: act.filter(p => p.type !== 'reverse'), reverse };
}

export function snapshotPreflight(client) {
  const engines = activeEngines();
  const { scorable } = resolveProbes(client, { includeReverse: false });
  const missingEngines = ALL_ENGINES.filter(e => !e.isConfigured());
  return {
    engines,
    queries: scorable.map(p => p.query),
    probes: scorable,
    missingEngines,
    canRun: engines.length > 0 && scorable.length > 0
  };
}

// Cost preview (Requirement 7): total model calls a run will make.
// callsPerRun = 1 engine ask + 1 Haiku extraction. Reverse probes run too.
export function estimateRunCost(client, { iterations = DEFAULT_ITERATIONS, engines, retrievalOnly = false } = {}) {
  const engs = engines || activeEngines();
  const { active, scorable, reverse } = resolveProbes(client);
  // Reverse instruments run every snapshot too, so count them in the preview.
  const runnable = active.concat(reverse.filter(r => !active.some(a => a.id === r.id)));
  let engineCalls = 0;
  for (const probe of runnable) {
    for (const eng of engs) {
      engineCalls += runModesFor(probe.runMode, eng, retrievalOnly).length * iterations;
    }
  }
  const extractionCalls = engineCalls; // one extraction per response
  return {
    probes: runnable.length,
    scorableProbes: scorable.length,
    engines: engs.length,
    iterations,
    engineCalls,
    extractionCalls,
    totalCalls: engineCalls + extractionCalls
  };
}

// onProgress({ phase, engine, query, index, total, iteration, iterations })
// onRuns(records[], rawEntries[]) — caller persists (saveAeoRuns / saveRawResponse)
export async function runSnapshot(client, opts = {}) {
  if (!client?.id) {
    throw new Error('runSnapshot called without a valid client.id — pick a client first.');
  }
  const {
    onProgress, onRuns, iterations, now,
    engines: engineOverride, extract = extractRun,
    sinceISO,
    concurrency = DEFAULT_CONCURRENCY,
    retries = DEFAULT_RETRIES,
    retryDelayMs = DEFAULT_RETRY_MS,
    sleep = defaultSleep,
    temperature = 0.7,
    retrievalOnly = false,  // drop the parametric search_off pass (faster, retrieval-first headline unchanged)
    maxQueries,   // optional cap on scorable probes (bounds the live probe in the full report)
    // Winner expansion (the "spider web"): when a probe wins, drill it deeper
    // into long-tail (geo + segment) and recurse on winners-of-winners.
    expandWinners = false,
    winnerTarget = 30,          // stop expanding once this many distinct winners found
    maxExpansionDepth = 2,      // how many recursion rounds
    maxExpansionQueries = 60,   // hard cap on extra queries the expansion may add
    expandGeos = [],            // extra cities/regions to drill into
    expandSegments             // buyer segments/industries to qualify by (defaults inside winnerExpansion)
  } = opts;

  const engines = engineOverride || activeEngines();
  if (!engines.length) throw new Error('No AI engines configured. Open Suite Settings.');

  const { all: allProbes, active, scorable, reverse } = resolveProbes(client, { now });
  if (!scorable.length) throw new Error('This client has no active AEO probes. Migrate or add some.');
  // maxQueries bounds how many scorable probes run (reverse instruments always
  // run). Used by the full monthly report to keep the inline live probe cheap.
  const scorableToRun = (maxQueries && Number(maxQueries) > 0)
    ? active.filter(p => p.type !== 'reverse').slice(0, Number(maxQueries))
    : active;
  const runnableProbes = scorableToRun.concat(reverse.filter(r => !scorableToRun.some(a => a.id === r.id)));

  const N = Math.max(1, Math.min(10, Number(iterations) || DEFAULT_ITERATIONS));
  const competitorList = parseCompetitors(client.competitors);
  const brandName = client.name;

  // Precount for progress.
  let total = 0;
  for (const probe of runnableProbes)
    for (const eng of engines)
      total += runModesFor(probe.runMode, eng, retrievalOnly).length * N;
  let done = 0;

  const runRecords = [];   // persisted per-run records
  const rawEntries = [];   // { hash, engine, run_mode, raw_response }
  const enginesRan = new Set();
  const disabledEngines = new Set();  // PERMANENTLY out this sweep (bad key / config error only)
  const consecErrors = {};            // engine.id -> consecutive error count
  const cooldown = {};                // engine.id -> probe-attempts to skip before retrying
  const FAIL_DISABLE_THRESHOLD = 3;   // consecutive transient misses (429/504 storm) → cooldown
  const ENGINE_COOLDOWN = 8;          // attempts an engine sits out before it retries (recovers from per-minute 429 / 503 blips)
  const nowISO = (now ? new Date(now) : new Date()).toISOString();
  const runMonth = nowISO.slice(0, 7);

  function errorRecord(probe, eng, i, mode, error) {
    return {
      client_id: client.id, month: runMonth, probeId: probe.id, engine: eng.id, runIndex: i,
      timestamp: nowISO, runMode: mode, error,
      appeared: null, position: null, listLength: null,
      segmentLabel: null, reasonPhrase: null, sentiment: null,
      competitorsNamed: [], citedUrls: [], rawResponseHash: null
    };
  }

  // Probe one (engine, mode) N times, sequentially (rate-limit friendly).
  async function probeGroup(probe, eng, mode) {
    const runs = [];
    for (let i = 0; i < N; i++) {
      // Skip an engine a bad key / config error took out for good.
      if (disabledEngines.has(eng.id)) {
        runRecords.push(errorRecord(probe, eng, i, mode, 'engine disabled for this sweep'));
        done++;
        continue;
      }
      // Skip an engine that's cooling down after a rate-limit / timeout, but
      // only for a window — then it retries, so a per-minute 429 or a transient
      // 503/504 blip doesn't wipe the engine out of the whole sweep.
      if (cooldown[eng.id] > 0) {
        cooldown[eng.id] -= 1;
        runRecords.push(errorRecord(probe, eng, i, mode, 'engine cooling down after rate-limit/timeout'));
        done++;
        continue;
      }
      onProgress?.({ phase: 'query', engine: eng.label, query: probe.query, mode, index: done, total, iteration: i + 1, iterations: N });
      const search = mode === 'search_on';
      const resp = await askWithBackoff(eng, probe.query, { search }, { retries, baseMs: retryDelayMs, sleep });
      done++;
      onProgress?.({ phase: 'done', engine: eng.label, query: probe.query, mode, index: done, total });
      // A config / bad-key error is permanent — retrying is futile, so bench it
      // for good. A rate-limit (429) or a repeated transient error (503/504)
      // only triggers a COOLDOWN: the engine sits out a window then retries,
      // so one early 429 no longer erases the engine from all 115 prompts.
      if (resp.configError) {
        disabledEngines.add(eng.id);
        runRecords.push(errorRecord(probe, eng, i, mode, resp.error));
        continue;
      }
      if (resp.rateLimited) {
        cooldown[eng.id] = ENGINE_COOLDOWN;
        consecErrors[eng.id] = 0;
        runRecords.push(errorRecord(probe, eng, i, mode, resp.error));
        continue;
      }
      if (resp.error) {
        consecErrors[eng.id] = (consecErrors[eng.id] || 0) + 1;
        if (consecErrors[eng.id] >= FAIL_DISABLE_THRESHOLD) {
          cooldown[eng.id] = ENGINE_COOLDOWN;   // cool down, don't kill — it may recover
          consecErrors[eng.id] = 0;
        }
        runRecords.push(errorRecord(probe, eng, i, mode, resp.error));
        continue;
      }
      consecErrors[eng.id] = 0; // reset on any success
      enginesRan.add(eng.id);
      const text = resp.text || '';
      const raw = resp.raw;
      const hash = hashResponse(text);
      let ext = await extract({ text, brandName, competitorNames: competitorList.map(c => c.name) });
      if (!ext) {
        // Fallback: regex brand detection so the run still records.
        const hit = detectBrand(text, { name: brandName, url: client.url, competitors: competitorList.map(c => c.name).join(',') });
        ext = {
          appeared: !!hit.mentioned, position: hit.mentioned ? (hit.position || 1) : null,
          listLength: null, segmentLabel: null, reasonPhrase: hit.excerpt ? hit.excerpt.slice(0, 200) : null,
          sentiment: 'neutral', competitorsNamed: hit.competitorHits || []
        };
      }
      const citedUrls = extractCitedUrls(eng.id, raw, text);
      const rec = {
        client_id: client.id, month: runMonth, probeId: probe.id, engine: eng.id, runIndex: i,
        timestamp: nowISO, runMode: mode,
        appeared: !!ext.appeared,
        position: ext.appeared ? (ext.position ?? null) : null,
        listLength: ext.listLength ?? null,
        segmentLabel: ext.segmentLabel || null,
        reasonPhrase: ext.reasonPhrase || null,
        sentiment: ext.sentiment || 'neutral',
        competitorsNamed: ext.competitorsNamed || [],
        citedUrls,
        rawResponseHash: hash
      };
      runRecords.push(rec);
      rawEntries.push({ hash, engine: eng.id, run_mode: mode, raw_response: text, client_id: client.id });
      runs.push(rec);
    }
    return { probe, engine: eng, mode, runs };
  }

  // Per-engine concurrency cap: each engine runs at most `concurrency` groups
  // at once; engines run independently of each other. Iterations stay
  // sequential within a group (probeGroup). 429s back off exponentially.
  const perEngineLimit = new Map(engines.map(e => [e.id, pLimit(Math.max(1, concurrency))]));

  // Sweep a list of probes across every engine × run-mode. Reused for the
  // initial sweep and each winner-expansion round.
  async function sweep(probeList) {
    const promises = [];
    for (const probe of probeList) {
      for (const eng of engines) {
        for (const mode of runModesFor(probe.runMode, eng, retrievalOnly)) {
          const limit = perEngineLimit.get(eng.id);
          promises.push(limit(() => probeGroup(probe, eng, mode)));
        }
      }
    }
    return Promise.all(promises);
  }

  let groups = await sweep(runnableProbes);

  // ── Winner expansion (spider web) ─────────────────────────────
  // A probe "wins" when the brand appeared in any run. Drill each winner into
  // deeper long-tail (geo + segment) and recurse on winners-of-winners until we
  // hit the volume target, run out of new winners, or exhaust the query budget.
  const discoveredProbes = [];   // fan-out children we actually probed (for the report / approval queue)
  if (expandWinners) {
    const normQ = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const winningIds = (grps) => {
      const ids = new Set();
      for (const g of grps) if (g.runs.some(r => r.appeared)) ids.add(g.probe.id);
      return ids;
    };
    const probedNorm = new Set(runnableProbes.map(p => normQ(p.query)));
    const expandedIds = new Set();
    let expansionUsed = 0;
    let seq = 0;
    for (let depth = 0; depth < maxExpansionDepth; depth++) {
      const winners = [...winningIds(groups)];
      if (winners.length >= winnerTarget) break;
      const toExpand = winners.filter(id => !expandedIds.has(id));
      if (!toExpand.length) break;
      const childProbes = [];
      for (const id of toExpand) {
        expandedIds.add(id);
        if (expansionUsed >= maxExpansionQueries) break;
        const parent = groups.find(g => g.probe.id === id)?.probe;
        if (!parent) continue;
        const kids = expandWinnerQuery(parent.query, {
          geos: expandGeos, segments: expandSegments,
          parentProbeId: parent.id, parentTier: parent.tier
        });
        for (const k of kids) {
          const nk = normQ(k.query);
          if (probedNorm.has(nk) || expansionUsed >= maxExpansionQueries) continue;
          probedNorm.add(nk);
          expansionUsed++;
          const child = {
            id: `${client.id}-FO${++seq}`, tier: k.tier, type: k.type, intent: k.intent,
            query: k.query, source: 'fanout', parentProbeId: k.parentProbeId,
            active: true, runMode: 'search_on'   // long-tail children run retrieval only
          };
          childProbes.push(child);
          discoveredProbes.push(child);
        }
      }
      if (!childProbes.length) break;
      // Grow the progress denominator before sweeping the new children.
      for (const probe of childProbes)
        for (const eng of engines)
          total += runModesFor(probe.runMode, eng, retrievalOnly).length * N;
      const childGroups = await sweep(childProbes);
      groups = groups.concat(childGroups);
    }
  }

  // Hand raw runs to the caller for persistence (UI wires DB writers).
  try { await onRuns?.(runRecords, rawEntries); } catch (e) { console.warn('[aeo] onRuns persistence failed:', e.message); }

  // Per-engine health so the report UI can explain all-zero engines (timeout /
  // rate-limit / bad key) instead of showing them as "0% visibility".
  const engineHealth = {};
  for (const eng of engines) engineHealth[eng.id] = { label: eng.label, runs: 0, errors: 0, sample_error: null, all_failed: false };
  for (const r of runRecords) {
    const h = engineHealth[r.engine];
    if (!h) continue;
    h.runs++;
    if (r.error) { h.errors++; if (!h.sample_error) h.sample_error = r.error; }
  }
  for (const h of Object.values(engineHealth)) h.all_failed = h.runs > 0 && h.errors === h.runs;

  // ── Aggregate ──────────────────────────────────────────────
  // Index groups by probe.
  const byProbe = new Map();
  for (const g of groups) {
    if (!byProbe.has(g.probe.id)) byProbe.set(g.probe.id, { probe: g.probe, groups: [] });
    byProbe.get(g.probe.id).groups.push(g);
  }

  const probeResults = [];   // one row per (probe, engine), with per-mode splits
  const probeAgg = [];       // one aggregate per scorable probe (for portfolio)
  const brandAppearedRuns = []; // scorable appeared runs (retrieval-preferred) for brand-level top3/sentiment
  const fanoutSignals = { segmentLabels: [], reasonPhrases: [], competitorsNamed: [] };

  for (const { probe, groups: pgroups } of byProbe.values()) {
    // Collect fan-out signals from every appeared run of this probe.
    for (const g of pgroups) for (const r of g.runs) {
      if (r.appeared) {
        if (r.segmentLabel) fanoutSignals.segmentLabels.push(r.segmentLabel);
        if (r.reasonPhrase) fanoutSignals.reasonPhrases.push(r.reasonPhrase);
        for (const c of (r.competitorsNamed || [])) fanoutSignals.competitorsNamed.push(c);
      }
    }

    // Per-engine rows.
    const byEngine = new Map();
    for (const g of pgroups) {
      if (!byEngine.has(g.engine.id)) byEngine.set(g.engine.id, { engine: g.engine, byMode: {} });
      byEngine.get(g.engine.id).byMode[g.mode] = g.runs;
    }

    for (const { engine, byMode } of byEngine.values()) {
      const allRuns = [].concat(...Object.values(byMode));
      const scoredRuns = retrievalPreferred(allRuns);        // headline = web-search runs
      const parametricRuns = byMode['search_off'] || [];
      const modes = {};
      for (const [m, rs] of Object.entries(byMode)) modes[m] = scoreRunGroup(rs);
      const combined = scoreRunGroup(scoredRuns);
      const top3 = scoredRuns.filter(r => r.appeared && r.position && r.position <= 3).length;
      const brandCites = allRuns.reduce((a, r) =>
        a + (r.citedUrls || []).filter(u => hostMatchesBrand(u, client.url, brandName)).length, 0);
      probeResults.push({
        probeId: probe.id, query: probe.query, tier: probe.tier, type: probe.type, intent: probe.intent,
        engine: engine.id, engine_label: engine.label,
        runs: combined.runs, appearances: combined.appearances,
        appearanceRate: combined.appearanceRate,
        avgPositionWhenAppearing: combined.avgPositionWhenAppearing,
        visibilityScore: combined.visibilityScore,
        top3_rate: combined.runs ? Math.round((top3 / combined.runs) * 1000) / 10 : 0,
        // Parametric (no web search) kept separate — never blended into the headline.
        parametric_appearance_rate: parametricRuns.length ? scoreRunGroup(parametricRuns).appearanceRate : null,
        modes,   // { search_off: {...}|undefined, search_on: {...}|undefined }
        citations: brandCites,
        // Qualitative core: the exact segment label + reason phrase the engine
        // attached to the brand (this is what makes the report actionable).
        segmentLabels: [...new Set(scoredRuns.filter(r => r.appeared && r.segmentLabel).map(r => r.segmentLabel))],
        reasons: [...new Set(scoredRuns.filter(r => r.appeared && r.reasonPhrase).map(r => r.reasonPhrase))],
        // Average size of the brand list when named ("#4.2 of 8").
        avgListLength: (() => {
          const lens = scoredRuns.filter(r => r.appeared && r.listLength).map(r => r.listLength);
          return lens.length ? Math.round((lens.reduce((a, b) => a + b, 0) / lens.length) * 10) / 10 : null;
        })(),
        sentiment: dominant(scoredRuns.filter(r => r.appeared).map(r => r.sentiment)) || (combined.appearances ? 'neutral' : null)
      });
    }

    // Probe-level aggregate across engines (scorable only, retrieval-preferred).
    if (probe.type !== 'reverse') {
      const allRuns = [].concat(...pgroups.map(g => g.runs));
      const scoredRuns = retrievalPreferred(allRuns);
      for (const r of scoredRuns) if (r.appeared) brandAppearedRuns.push(r);
      const ar = appearanceRate(scoredRuns);
      const avgPos = avgPositionWhenAppearing(scoredRuns);
      probeAgg.push({
        probeId: probe.id, parentProbeId: probe.parentProbeId || null,
        query: probe.query, intent: probe.intent, type: probe.type,
        runs: scoredRuns.length,
        appearances: scoredRuns.filter(r => r.appeared).length,
        appearanceRate: Math.round(ar * 100) / 100,
        avgPositionWhenAppearing: avgPos,
        visibilityScore: visibilityScore(ar, avgPos),
        citations: allRuns.reduce((a, r) => a + (r.citedUrls || []).filter(u => hostMatchesBrand(u, client.url, brandName)).length, 0),
        // best engine for this probe (highest visibilityScore)
        bestEngine: bestEngineFor(probeResults, probe.id)
      });
    }
  }

  // ── Portfolio metrics ──────────────────────────────────────
  const scorableRuns = probeAgg.reduce((a, p) => a + p.runs, 0);
  const brandAppearances = probeAgg.reduce((a, p) => a + p.appearances, 0);
  const brandCitationsTotal = probeAgg.reduce((a, p) => a + p.citations, 0);
  const coverage = promptCoverage(probeAgg);
  const covRate = coverageRate(probeAgg);
  const meanVis = meanVisibilityCovered(probeAgg);

  // Competitor aggregation from extraction across scorable runs.
  const competitorAgg = {};
  for (const c of competitorList) competitorAgg[c.name] = { name: c.name, url: c.url, mentions: 0, citations: 0, runs: 0 };
  for (const g of groups) {
    if (g.probe.type === 'reverse') continue;
    for (const r of g.runs) {
      for (const cn of (r.competitorsNamed || [])) {
        const match = competitorList.find(c => cn.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(cn.toLowerCase()));
        if (match) competitorAgg[match.name].mentions++;
      }
      for (const c of competitorList) {
        competitorAgg[c.name].runs++;
        if (c.url) competitorAgg[c.name].citations += (r.citedUrls || []).filter(u => hostMatchesBrand(u, c.url, c.name)).length;
      }
    }
  }
  const competitors = Object.values(competitorAgg).map(a => ({
    name: a.name, url: a.url,
    visibility: a.runs ? Math.round((a.mentions / a.runs) * 1000) / 10 : 0,
    mentions: a.mentions, citations: a.citations,
    top3_rate: 0, avg_position: null, appearances: a.mentions
  }));

  const sov = inline_shareOfVoice(brandAppearances, competitors);
  const citeDensity = citationDensity(brandCitationsTotal, scorableRuns);

  // Brand-level top3 / sentiment come from the retrieval-preferred appeared
  // runs collected during aggregation (not the parametric no-search runs).
  const appearedRuns = brandAppearedRuns;
  const positiveCount = appearedRuns.filter(r => r.sentiment === 'positive').length;
  const sentimentPct = appearedRuns.length ? Math.round((positiveCount / appearedRuns.length) * 1000) / 10 : 0;
  const top3Runs = appearedRuns.filter(r => r.position && r.position <= 3).length;
  const brandTop3Rate = scorableRuns ? Math.round((top3Runs / scorableRuns) * 1000) / 10 : 0;
  const brandVisibility = scorableRuns ? Math.round((brandAppearances / scorableRuns) * 1000) / 10 : 0;
  const brandAvgPos = avgPositionWhenAppearing(appearedRuns);

  const composite = compositeIndex({ coverageRate: covRate, meanVis, sov: sov.sov, citeDensity, sentiment: sentimentPct });

  // ── Buckets on appearanceRate ──────────────────────────────
  const keywordWins = { active: [], emerging: [], zero: [] };
  for (const p of probeAgg) {
    const bucket = bucketByAppearance(p.appearanceRate);
    const be = p.bestEngine || {};
    const entry = { query: p.query, probeId: p.probeId, engine: be.engine, engine_label: be.engine_label, visibility: p.visibilityScore, appearance_rate: Math.round(p.appearanceRate * 100), avg_position: p.avgPositionWhenAppearing };
    if (bucket === 'active') keywordWins.active.push(entry);
    else if (bucket === 'emerging') keywordWins.emerging.push(entry);
    else keywordWins.zero.push({ query: p.query, probeId: p.probeId, best_visibility: p.visibilityScore });
  }
  keywordWins.active.sort((a, b) => b.visibility - a.visibility);
  keywordWins.emerging.sort((a, b) => b.visibility - a.visibility);

  // ── Engine scores + intent breakdown ───────────────────────
  const engineScores = {};
  for (const eng of engines) {
    const rows = probeResults.filter(r => r.engine === eng.id && r.type !== 'reverse');
    const app = rows.reduce((a, r) => a + r.appearances, 0);
    const rr = rows.reduce((a, r) => a + r.runs, 0);
    engineScores[eng.id] = rr ? Math.round((app / rr) * 100) : 0;
  }

  const intentAgg = {};
  for (const id of INTENT_IDS) intentAgg[id] = { hits: 0, runs: 0, queries: new Set() };
  for (const p of probeAgg) {
    const it = intentAgg[p.intent] || (intentAgg[p.intent] = { hits: 0, runs: 0, queries: new Set() });
    it.hits += p.appearances; it.runs += p.runs; it.queries.add(p.query);
  }
  const intentBreakdown = Object.entries(intentAgg)
    .filter(([, v]) => v.runs > 0)
    .map(([intent, v]) => ({ intent, queries: v.queries.size, visibility: v.runs ? Math.round((v.hits / v.runs) * 1000) / 10 : 0 }));

  // ── Back-compat per_query (one row per scorable probe×engine) ──
  const perQuery = probeResults.filter(r => r.type !== 'reverse').map(r => ({
    query: r.query, intent: r.intent, engine: r.engine, engine_label: r.engine_label,
    iterations: r.runs, hits: r.appearances,
    visibility: Math.round(r.appearanceRate * 100),
    appearance_rate: Math.round(r.appearanceRate * 100),
    top3_rate: r.top3_rate,
    avg_position: r.avgPositionWhenAppearing,
    avg_position_when_named: r.avgPositionWhenAppearing,
    mentioned: r.appearanceRate > 0,
    position: r.avgPositionWhenAppearing,
    avg_list_length: r.avgListLength,
    segment_labels: r.segmentLabels,
    reason: (r.reasons && r.reasons[0]) || '',
    excerpt: r.segmentLabels[0] || (r.reasons && r.reasons[0]) || '',
    sentiment: r.sentiment,
    citations: r.citations,
    visibility_score: r.visibilityScore,
    parametric_appearance_rate: r.parametric_appearance_rate,
    modes: r.modes,
    error: null,
    text: r.segmentLabels[0] || ''
  }));

  const excerpts = appearedRuns.slice(0, 50).map(r => ({
    query: (allProbes.find(p => p.id === r.probeId) || {}).query || r.probeId,
    engine: r.engine,
    excerpt: r.reasonPhrase || r.segmentLabel || '',
    sentiment: r.sentiment || 'neutral'
  }));

  const month = (now ? new Date(now) : new Date()).toISOString().slice(0, 7);
  const newThemes = countNewThemesSince(allProbes, sinceISO);

  // Branch exhaustion (Requirement 4 stopping rule): per fan-out parent, the
  // fraction of its probes covered this snapshot. Consumers stop proposing
  // children from a branch that comes in under 10%.
  const byParent = {};
  for (const p of probeAgg) {
    const key = p.parentProbeId || '__root__';
    (byParent[key] || (byParent[key] = { total: 0, covered: 0 }));
    byParent[key].total++;
    if (p.appearanceRate > 0) byParent[key].covered++;
  }
  const branchExhaustion = {};
  for (const [k, v] of Object.entries(byParent)) {
    const rate = v.total ? v.covered / v.total : 0;
    branchExhaustion[k] = { total: v.total, covered: v.covered, rate: Math.round(rate * 100) / 100, exhausted: rate < 0.1 };
  }

  return {
    client_id: client.id,
    month,

    // v2 hero
    composite_index: composite,
    overall_score: composite,          // back-compat: History/cards read overall_score
    coverage_rate: covRate,            // 0..1
    prompt_coverage: coverage,         // named in X of Y
    scorable_probes: probeAgg.length,
    new_themes: newThemes,
    branch_exhaustion: branchExhaustion,
    share_of_voice: sov.sov,
    sov_detail: sov,

    // per-probe scored results (new)
    probe_results: probeResults,

    // Per-engine params used this snapshot, persisted so month-over-month
    // comparisons can flag param changes (Requirement 7).
    engine_params: engines.map(e => ({
      id: e.id, model: e.model, retrievalNative: !!e.retrievalNative,
      temperature, extraction_temperature: 0
    })),
    run_config: { iterations: N, concurrency, retries, temperature },
    run_modes_used: [...new Set(groups.map(g => g.mode))],

    // signals for the fan-out loop (Stage 4)
    fanout_signals: fanoutSignals,

    // back-compat brand metrics
    visibility_score: brandVisibility,
    detection_rate: Math.round(covRate * 1000) / 10,   // == coverage %
    top3_rate: brandTop3Rate,
    avg_position: brandAvgPos,
    mentions: brandAppearances,
    citations: brandCitationsTotal,
    sentiment_score: sentimentPct,
    sentiment: sentimentPct + '% positive',

    engine_scores: engineScores,
    engines_used: [...enginesRan.size ? enginesRan : new Set(engines.map(e => e.id))],
    engine_health: engineHealth,

    iterations: N,
    total_runs: runRecords.filter(r => !r.error).length,
    queries_count: probeAgg.length,

    // Winner-expansion output: the long-tail children the spider web probed.
    // The UI can offer to add the ones that won to the tracked probe set.
    expansion_probes: discoveredProbes,
    expansion_count: discoveredProbes.length,

    per_query: perQuery,
    competitors,
    keyword_wins: keywordWins,
    intent_breakdown: intentBreakdown,
    excerpts,

    // Citation gaps — the actionable half: commercial probes where the brand
    // missed but competitors were cited, grouped by source domain.
    citation_gaps: buildCitationGaps(runRecords, allProbes, { brandName, brandUrl: client.url })
  };
}

function dominant(arr) {
  if (!arr?.length) return null;
  const c = {};
  for (const v of arr) if (v) c[v] = (c[v] || 0) + 1;
  const e = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return e ? e[0] : null;
}

function bestEngineFor(probeResults, probeId) {
  const rows = probeResults.filter(r => r.probeId === probeId);
  if (!rows.length) return null;
  return rows.reduce((acc, r) => (r.visibilityScore > (acc?.visibilityScore ?? -1) ? r : acc), null);
}
