// Orchestrates a full AEO snapshot for a client.
// Fires every probe query in parallel across every configured engine,
// runs brand + sentiment detection, scores each hit, and returns a single
// structured snapshot object ready to persist to syte_suite_aeo_history.

import { ALL_ENGINES, activeEngines } from './aeoEngines.js';
import { detectBrand, sentimentOf, scoreMention } from './brandDetection.js';

function parseQueries(raw) {
  return (raw || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
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

// onProgress gets called with { phase, engine, query, index, total }.
export async function runSnapshot(client, { onProgress } = {}) {
  const engines = activeEngines();
  const queries = parseQueries(client.aeo_probe_queries);
  if (!engines.length) throw new Error('No AI engines configured. Open Suite Settings.');
  if (!queries.length) throw new Error('This client has no AEO probe queries. Edit the client to add some.');

  const total = queries.length * engines.length;
  let done = 0;

  // Phase 1: fire all engine requests in parallel per query.
  const rawResults = [];
  for (const query of queries) {
    const batch = await Promise.all(
      engines.map(async (eng) => {
        onProgress?.({ phase: 'query', engine: eng.label, query, index: done, total });
        const resp = await eng.ask(query);
        done++;
        onProgress?.({ phase: 'done', engine: eng.label, query, index: done, total });
        return { engine: eng.id, engineLabel: eng.label, query, ...resp };
      })
    );
    rawResults.push(...batch);
  }

  // Phase 2: brand detect + sentiment pass. Sentiment adds one Claude Haiku
  // call per mention; run them sequentially to keep rate-limit headroom.
  const withBrand = [];
  for (const r of rawResults) {
    if (r.error) {
      withBrand.push({ ...r, mentioned: false, score: 0 });
      continue;
    }
    const detected = detectBrand(r.text || '', {
      name: client.name,
      url: client.url,
      competitors: client.competitors
    });
    let sentiment = 'neutral';
    if (detected.mentioned) {
      onProgress?.({ phase: 'sentiment', query: r.query, engine: r.engineLabel });
      sentiment = await sentimentOf(detected.excerpt, client.name);
    }
    const score = scoreMention({ ...detected, sentiment });
    withBrand.push({ ...r, ...detected, sentiment, score });
  }

  // Phase 3: aggregate.
  const engineScores = {};
  for (const eng of engines) {
    const mine = withBrand.filter(r => r.engine === eng.id);
    const avg = mine.length ? Math.round(mine.reduce((a, b) => a + b.score, 0) / mine.length) : 0;
    engineScores[eng.id] = avg;
  }
  const overall = Math.round(
    withBrand.reduce((a, b) => a + b.score, 0) / (withBrand.length || 1)
  );

  // Competitor appearances — count how many responses each competitor name
  // shows up in at all (not just after the brand).
  const competitorList = (client.competitors || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const competitorCounts = Object.fromEntries(competitorList.map(n => [n, 0]));
  for (const r of withBrand) {
    if (!r.text) continue;
    const lower = r.text.toLowerCase();
    for (const n of competitorList) {
      if (lower.includes(n.toLowerCase())) competitorCounts[n]++;
    }
  }

  const mentionedResponses = withBrand.filter(r => r.mentioned).length;
  const positiveMentions = withBrand.filter(r => r.sentiment === 'positive').length;
  const sentimentPct = mentionedResponses
    ? Math.round((positiveMentions / mentionedResponses) * 100)
    : 0;

  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  return {
    client_id: client.id,
    month,
    overall_score: overall,
    engine_scores: engineScores,
    per_query: withBrand.map(r => ({
      query: r.query,
      engine: r.engine,
      mentioned: r.mentioned,
      position: r.position,
      excerpt: r.excerpt,
      sentiment: r.sentiment,
      score: r.score,
      error: r.error || null,
      text: (r.text || '').slice(0, 2000) // truncate for storage
    })),
    competitors: Object.entries(competitorCounts).map(([name, appearances]) => ({ name, appearances })),
    sentiment: sentimentPct + '% positive',
    engines_used: engines.map(e => e.id)
  };
}
