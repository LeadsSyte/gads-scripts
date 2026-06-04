// Orchestrates a full AEO snapshot for a client.
//
// For each (query × engine) pair we run N iterations and aggregate the
// hits into a visibility percentage — this is what produces the rich
// "76.9% on AI Mode" style numbers that competitive tools (RankScale,
// Profound, Otterly) lead their reports with. Single-shot probes only
// give binary cited/not-cited, which understates real visibility.
//
// We track competitors with the same depth as the brand: visibility,
// detection rate, top-3 rate, mentions, citations (URL hits), sentiment.
// That gives us the competitive-landscape table the client expects.

import { ALL_ENGINES, activeEngines } from './aeoEngines.js';
import { detectBrand, sentimentOf, scoreMention, countCitations } from './brandDetection.js';

// Default iterations per (query × engine). 3 gives bands of 0/33/66/100% —
// enough resolution to spot partial wins without 9× the API cost of 10.
const DEFAULT_ITERATIONS = 3;

function parseQueries(raw) {
  return (raw || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

function parseCompetitors(raw) {
  return (raw || '')
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      // Allow "Name | https://domain.tld" or "Name (domain.tld)" or just "Name".
      const sepMatch = entry.match(/^(.+?)\s*[|]\s*(.+)$/) ||
                       entry.match(/^(.+?)\s*\((.+?)\)\s*$/);
      if (sepMatch) return { name: sepMatch[1].trim(), url: sepMatch[2].trim() };
      // If it's a domain on its own, use it as both.
      if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(entry)) return { name: entry, url: entry };
      return { name: entry, url: '' };
    });
}

export function snapshotPreflight(client) {
  const engines = activeEngines();
  const queries = parseQueries(client?.aeo_probe_queries);
  const missingEngines = ALL_ENGINES.filter(e => !e.isConfigured());
  return {
    engines,
    queries,
    missingEngines,
    canRun: engines.length > 0 && queries.length > 0
  };
}

// Run one single (engine, query) ask + brand detect. Returns the raw row
// before per-query aggregation. Errors are returned as { error } so a
// single failure does not abort the sweep.
async function probeOne(eng, query, client, brandList, competitorList) {
  const resp = await eng.ask(query);
  if (resp.error) {
    // Surface rate-limit (429) failures so the runner can stop probing this
    // engine for the rest of the sweep instead of paying the cost on every
    // remaining round. Detect both the explicit flag and a 429 in the text.
    const rateLimited = !!resp.rateLimited || /\b429\b/.test(resp.error || '');
    return { engine: eng.id, engineLabel: eng.label, query, error: resp.error, rateLimited };
  }
  const text = resp.text || '';

  // Brand detection — does the client appear, where, what was said.
  const brandHit = detectBrand(text, {
    name: client.name,
    url: client.url,
    competitors: competitorList.map(c => c.name).join(',')
  });

  // Per-competitor detection — exactly the same logic the client gets.
  // We treat each competitor as a "self" probe so we can compute the
  // same metrics for them (position, top-3, citations) as for the brand.
  const competitorHits = competitorList.map(c => {
    const hit = detectBrand(text, {
      name: c.name,
      url: c.url,
      competitors: [client.name, ...competitorList.filter(x => x !== c).map(x => x.name)].join(',')
    });
    const citations = countCitations(text, c.url, c.name);
    return { name: c.name, url: c.url, ...hit, citations };
  });

  const brandCitations = countCitations(text, client.url, client.name);

  return {
    engine: eng.id,
    engineLabel: eng.label,
    query,
    text: text.slice(0, 4000),
    brand: { ...brandHit, citations: brandCitations },
    competitorHits
  };
}

// onProgress gets called with { phase, engine, query, index, total }.
// maxQueries (optional) caps how many probe queries are swept. The full
// snapshot is queries × engines × iterations live LLM calls, so an
// uncapped run over a very large probe-query list takes many minutes. The
// dedicated AEO Snapshot tool runs the full set; callers that just want a
// quick freshness probe (e.g. the in-report fallback) pass a cap so they
// can't kick off an unbounded sweep that locks up the UI.
export async function runSnapshot(client, { onProgress, iterations, maxQueries } = {}) {
  if (!client?.id) {
    throw new Error('runSnapshot called without a valid client.id — pick a client first.');
  }
  const engines = activeEngines();
  let queries = parseQueries(client.aeo_probe_queries);
  const competitorList = parseCompetitors(client.competitors);
  const N = Math.max(1, Math.min(10, Number(iterations) || DEFAULT_ITERATIONS));

  if (!engines.length) throw new Error('No AI engines configured. Open Suite Settings.');
  if (!queries.length) throw new Error('This client has no AEO probe queries. Edit the client to add some.');

  // Cap the sweep when asked. Keep the first N queries — the probe-query
  // list is authored most-important-first (head terms before long-tail).
  if (maxQueries && queries.length > maxQueries) {
    queries = queries.slice(0, maxQueries);
  }

  const total = queries.length * engines.length * N;
  let done = 0;

  // --- Diagnostic timing (console only; no effect on the snapshot data) ---
  // The full sweep is queries × engines × iterations sequential LLM calls,
  // and a slow/retrying engine (Gemini's model-fallback chain) or a long
  // sentiment pass can make a run take many minutes with no visible
  // progress. These timers print exactly where the wall-clock goes so we
  // can target the real bottleneck instead of guessing.
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const fmt = (ms) => (ms / 1000).toFixed(1) + 's';
  const t0 = now();
  const engineMs = {};    // engine.label → total ms spent awaiting that engine
  const engineCalls = {}; // engine.label → number of probe calls
  const tick = (label, ms) => {
    engineMs[label] = (engineMs[label] || 0) + ms;
    engineCalls[label] = (engineCalls[label] || 0) + 1;
  };

  // Phase 1: probe each (query, engine) N times. Iterations are sequential
  // per engine to keep within rate limits; engines run in parallel per query.
  //
  // Circuit breaker: when an engine returns a rate-limit (429) error, its
  // quota is exhausted for the run — every further call would just fail after
  // wasting backoff time. Once an engine rate-limits we add it to
  // `rateLimitedEngines` and skip it for all remaining iterations/queries,
  // recording a quick synthetic error row so aggregation still scores it 0%.
  // This is what stops a quota-exhausted Gemini from adding minutes of dead
  // waiting to every round (the reported "stuck on Working" freeze).
  const rateLimitedEngines = new Set();
  const phase1Start = now();
  const rawResults = [];
  for (const query of queries) {
    const enginePromises = engines.map(async (eng) => {
      const runs = [];
      for (let i = 0; i < N; i++) {
        if (rateLimitedEngines.has(eng.id)) {
          done++;
          onProgress?.({
            phase: 'done', engine: eng.label, query,
            index: done, total, iteration: i + 1, iterations: N
          });
          runs.push({
            engine: eng.id, engineLabel: eng.label, query,
            error: eng.label + ' rate-limited (429) — skipped for rest of run',
            rateLimited: true
          });
          continue;
        }
        onProgress?.({
          phase: 'query', engine: eng.label, query,
          index: done, total, iteration: i + 1, iterations: N
        });
        const callStart = now();
        const row = await probeOne(eng, query, client, [], competitorList);
        tick(eng.label, now() - callStart);
        if (row.rateLimited) rateLimitedEngines.add(eng.id);
        done++;
        onProgress?.({
          phase: 'done', engine: eng.label, query,
          index: done, total, iteration: i + 1, iterations: N
        });
        runs.push(row);
      }
      return runs;
    });
    const batches = await Promise.all(enginePromises);
    for (const batch of batches) rawResults.push(...batch);
  }
  const phase1Ms = now() - phase1Start;
  if (rateLimitedEngines.size) {
    try { console.warn('[AEO] rate-limited engines disabled mid-run:', [...rateLimitedEngines].join(', ')); } catch {}
  }

  // Phase 2: sentiment for cited brand mentions. One Haiku call each,
  // sequential to spare rate limits. Skip if not mentioned or errored.
  const phase2Start = now();
  let sentimentCalls = 0;
  for (const r of rawResults) {
    if (r.error || !r.brand?.mentioned) continue;
    onProgress?.({ phase: 'sentiment', query: r.query, engine: r.engineLabel });
    r.brand.sentiment = await sentimentOf(r.brand.excerpt, client.name);
    r.brand.score = scoreMention({ ...r.brand, sentiment: r.brand.sentiment });
    sentimentCalls++;
  }
  const phase2Ms = now() - phase2Start;

  // Print the breakdown. Per-engine cumulative time is summed across the
  // parallel branches, so engineMs can exceed phase1Ms — the useful signal
  // is which engine dominates and its avg per-call latency.
  try {
    const engineRows = Object.keys(engineMs)
      .sort((a, b) => engineMs[b] - engineMs[a])
      .map(label => `${label}: ${fmt(engineMs[label])} over ${engineCalls[label]} calls (avg ${fmt(engineMs[label] / engineCalls[label])})`);
    console.info(
      `[AEO timing] ${client.name}: total ${fmt(now() - t0)} · ` +
      `Phase1 probes ${fmt(phase1Ms)} (${rawResults.length} calls) · ` +
      `Phase2 sentiment ${fmt(phase2Ms)} (${sentimentCalls} calls)\n` +
      `[AEO timing] per-engine cumulative:\n  ` + engineRows.join('\n  ')
    );
  } catch {}

  // Phase 3: per-query aggregation across iterations and engines.
  // For each (query, engine) we compute visibility = hits / iterations.
  const perQueryEngine = {}; // key: `${query}::${engine}` → aggregate
  for (const r of rawResults) {
    const key = r.query + '::' + r.engine;
    if (!perQueryEngine[key]) {
      perQueryEngine[key] = {
        query: r.query, engine: r.engine, engineLabel: r.engineLabel,
        runs: 0, hits: 0, top3Hits: 0, errors: 0,
        positions: [], excerpts: [], sentiments: [], citations: 0
      };
    }
    const agg = perQueryEngine[key];
    agg.runs++;
    if (r.error) { agg.errors++; continue; }
    if (r.brand?.mentioned) {
      agg.hits++;
      agg.positions.push(r.brand.position);
      if (r.brand.position && r.brand.position <= 3) agg.top3Hits++;
      if (r.brand.excerpt) agg.excerpts.push(r.brand.excerpt);
      if (r.brand.sentiment) agg.sentiments.push(r.brand.sentiment);
    }
    agg.citations += r.brand?.citations || 0;
  }

  // Roll up per-query (across engines): used for active/emerging/zero.
  const perQuery = Object.values(perQueryEngine).map(agg => {
    const visibility = agg.runs ? Math.round((agg.hits / agg.runs) * 1000) / 10 : 0;
    const top3Rate = agg.runs ? Math.round((agg.top3Hits / agg.runs) * 1000) / 10 : 0;
    const avgPosition = agg.positions.length
      ? Math.round((agg.positions.reduce((a, b) => a + b, 0) / agg.positions.length) * 10) / 10
      : null;
    const dominantSentiment = mostFrequent(agg.sentiments) || (agg.hits ? 'neutral' : null);
    return {
      query: agg.query,
      engine: agg.engine,
      engine_label: agg.engineLabel,
      iterations: agg.runs,
      hits: agg.hits,
      visibility,                          // % of iterations where mentioned
      top3_rate: top3Rate,
      avg_position: avgPosition,
      mentioned: agg.hits > 0,             // back-compat for old microsite renderer
      position: avgPosition,               // back-compat
      excerpt: agg.excerpts[0] || '',
      sentiment: dominantSentiment,
      citations: agg.citations,
      score: visibility >= 70 ? 100 : visibility >= 30 ? 50 : (agg.hits > 0 ? 25 : 0),
      error: agg.errors === agg.runs ? 'all iterations errored' : null,
      text: agg.excerpts[0] || ''
    };
  });

  // Phase 4: per-competitor aggregation. We compute the same metrics for
  // every competitor as for the brand — visibility, top-3, mentions,
  // citations, sentiment — so we can rank everyone in one table.
  const competitorAgg = {};
  for (const c of competitorList) {
    competitorAgg[c.name] = {
      name: c.name, url: c.url,
      runs: 0, hits: 0, top3Hits: 0,
      positions: [], mentions: 0, citations: 0
    };
  }
  for (const r of rawResults) {
    if (r.error) continue;
    for (const ch of (r.competitorHits || [])) {
      const agg = competitorAgg[ch.name];
      if (!agg) continue;
      agg.runs++;
      if (ch.mentioned) {
        agg.hits++;
        agg.mentions++;
        if (ch.position) agg.positions.push(ch.position);
        if (ch.position && ch.position <= 3) agg.top3Hits++;
      }
      agg.citations += ch.citations || 0;
    }
  }
  const competitors = Object.values(competitorAgg).map(agg => {
    const visibility = agg.runs ? Math.round((agg.hits / agg.runs) * 1000) / 10 : 0;
    const top3 = agg.runs ? Math.round((agg.top3Hits / agg.runs) * 1000) / 10 : 0;
    const avgPosition = agg.positions.length
      ? Math.round((agg.positions.reduce((a, b) => a + b, 0) / agg.positions.length) * 10) / 10
      : null;
    return {
      name: agg.name, url: agg.url,
      visibility, top3_rate: top3,
      avg_position: avgPosition,
      mentions: agg.mentions,
      citations: agg.citations,
      // Legacy field kept for backwards-compat with older microsite render
      appearances: agg.hits
    };
  });

  // Phase 5: brand-level aggregates.
  const brandRuns = rawResults.filter(r => !r.error);
  const brandHits = brandRuns.filter(r => r.brand?.mentioned);
  const brandTop3 = brandHits.filter(r => r.brand.position && r.brand.position <= 3);
  const brandPositive = brandHits.filter(r => r.brand?.sentiment === 'positive');
  const brandCitations = brandRuns.reduce((a, b) => a + (b.brand?.citations || 0), 0);
  const brandPositions = brandHits.map(r => r.brand.position).filter(Boolean);
  const avgBrandPosition = brandPositions.length
    ? Math.round((brandPositions.reduce((a, b) => a + b, 0) / brandPositions.length) * 10) / 10
    : null;

  const visibilityScore = brandRuns.length
    ? Math.round((brandHits.length / brandRuns.length) * 1000) / 10
    : 0;
  const top3Rate = brandRuns.length
    ? Math.round((brandTop3.length / brandRuns.length) * 1000) / 10
    : 0;
  const sentimentPct = brandHits.length
    ? Math.round((brandPositive.length / brandHits.length) * 1000) / 10
    : 0;

  // Detection rate: % of *queries* (across engines) where brand was hit
  // at least once. Distinct from visibility (per-iteration rate).
  const detectionByQuery = {};
  for (const pq of perQuery) {
    if (!detectionByQuery[pq.query]) detectionByQuery[pq.query] = false;
    if (pq.hits > 0) detectionByQuery[pq.query] = true;
  }
  const detected = Object.values(detectionByQuery).filter(Boolean).length;
  const detectionRate = queries.length
    ? Math.round((detected / queries.length) * 1000) / 10
    : 0;

  // Engine-level scores using the same visibility metric for consistency.
  const engineScores = {};
  for (const eng of engines) {
    const mine = perQuery.filter(pq => pq.engine === eng.id);
    const hits = mine.reduce((a, b) => a + b.hits, 0);
    const runs = mine.reduce((a, b) => a + b.iterations, 0);
    engineScores[eng.id] = runs ? Math.round((hits / runs) * 100) : 0;
  }

  // Per-engine health — runs / errors / first error message. Surfaces
  // engines that are silently failing across every probe (e.g. retired
  // model, expired API key, proxy down) instead of leaving the operator
  // wondering why only Claude rows show up in the report.
  const engineHealth = {};
  for (const eng of engines) {
    const mineRaw = rawResults.filter(r => r.engine === eng.id);
    const errored = mineRaw.filter(r => r.error);
    engineHealth[eng.id] = {
      label: eng.label,
      runs: mineRaw.length,
      errors: errored.length,
      // Sample first non-empty error message to surface — most diagnostic
      // value is in seeing it once, not 50 times.
      sample_error: errored[0]?.error || null,
      // Convenience flag: every iteration of every query failed for this
      // engine. That's the "totally broken" case the UI should highlight.
      all_failed: mineRaw.length > 0 && errored.length === mineRaw.length
    };
  }

  // Composite "AEO Performance Index" — a weighted 0-100 number that
  // balances four quality dimensions instead of being a glorified
  // mention-count. The visibility-only version was effectively
  // (citations / total) × constant, which is exactly the "X out of N
  // cited" framing that makes reports read poorly for clients who are
  // early on their AEO journey.
  //
  // Weights:
  //   Visibility       40%  — are we showing up at all? (×5 to map low
  //                           absolute % into the 0-100 range; capped 100)
  //   Top-3 rate       25%  — when we show up, are we prominent? (×5)
  //   Citation density 20%  — are URLs being cited? (citations per response)
  //   Sentiment        15%  — when mentioned, is the language positive?
  const visibilityComponent = Math.min(100, visibilityScore * 5);
  const top3Component       = Math.min(100, top3Rate * 5);
  const citationDensity     = brandRuns.length
    ? Math.min(100, Math.round((brandCitations / brandRuns.length) * 100))
    : 0;
  const sentimentComponent  = sentimentPct;
  const overallScore = Math.round(
    visibilityComponent * 0.40 +
    top3Component       * 0.25 +
    citationDensity     * 0.20 +
    sentimentComponent  * 0.15
  );

  // Phase 6: categorize keyword wins for the strategy section.
  // Active = ≥70% visibility on at least one engine
  // Emerging = 30-69% visibility on at least one engine
  // Zero = no engine has >0%, or all <30% with 0 hits on most
  const keywordWins = { active: [], emerging: [], zero: [] };
  for (const query of queries) {
    const enginesForQ = perQuery.filter(pq => pq.query === query);
    const best = enginesForQ.reduce((acc, pq) =>
      pq.visibility > (acc?.visibility || 0) ? pq : acc, null);
    if (!best) continue;
    if (best.visibility >= 70) {
      keywordWins.active.push({
        query, engine: best.engine, engine_label: best.engine_label,
        visibility: best.visibility, top3_rate: best.top3_rate
      });
    } else if (best.visibility >= 30) {
      keywordWins.emerging.push({
        query, engine: best.engine, engine_label: best.engine_label,
        visibility: best.visibility
      });
    } else {
      keywordWins.zero.push({ query, best_visibility: best.visibility });
    }
  }
  // Sort each bucket by visibility desc.
  keywordWins.active.sort((a, b) => b.visibility - a.visibility);
  keywordWins.emerging.sort((a, b) => b.visibility - a.visibility);

  const month = new Date().toISOString().slice(0, 7); // YYYY-MM

  return {
    client_id: client.id,
    month,

    // Hero metrics — what the report leads with
    overall_score: overallScore,                  // Composite AEO Performance Index
    score_components: {                           // Transparency on what made up the composite
      visibility: Math.round(visibilityComponent),
      top3:       Math.round(top3Component),
      citations:  citationDensity,
      sentiment:  Math.round(sentimentComponent)
    },
    visibility_score: visibilityScore,    // % of all responses where brand mentioned
    detection_rate: detectionRate,        // % of queries hit at least once
    top3_rate: top3Rate,                  // % of responses where brand in top 3
    avg_position: avgBrandPosition,
    mentions: brandHits.length,           // count of times the brand was mentioned
    citations: brandCitations,            // count of URL/domain references in responses
    sentiment_score: sentimentPct,        // % positive (numeric)
    sentiment: sentimentPct + '% positive', // back-compat string

    // Engine breakdown
    engine_scores: engineScores,
    engines_used: engines.map(e => e.id),
    engine_health: engineHealth,

    // Run config
    iterations: N,
    total_runs: rawResults.length,
    queries_count: queries.length,

    // Per-query × engine results (with visibility%)
    per_query: perQuery,

    // Per-competitor full metrics
    competitors,

    // Categorized strategy buckets
    keyword_wins: keywordWins,

    // Raw text excerpts for the response-excerpts panel
    excerpts: rawResults
      .filter(r => !r.error && r.brand?.excerpt)
      .slice(0, 50)
      .map(r => ({
        query: r.query,
        engine: r.engine,
        excerpt: r.brand.excerpt,
        sentiment: r.brand.sentiment || 'neutral'
      }))
  };
}

function mostFrequent(arr) {
  if (!arr?.length) return null;
  const counts = {};
  for (const v of arr) counts[v] = (counts[v] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}
