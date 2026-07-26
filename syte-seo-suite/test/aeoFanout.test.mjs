// Fan-out tests — grid generation, Jaccard dedup vs existing probes, novelty
// ranking, orchestrator parentProbeId wiring, and branch exhaustion (AC3 + Req4).

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const f = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/aeoFanout.js')).href);

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) { if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }

const ATTRS = {
  services: ['pallet racking', 'industrial shelving'],
  qualifiers: ['heavy-duty'],
  geos: ['Johannesburg'],
  personas: ['warehouse manager'],
  competitors: ['Universal Storage']
};

await t('buildCandidates: grid produces inactive tier-2 fanout probes with parent', () => {
  const c = f.buildCandidates(ATTRS, { seedProbeId: 'TEK-001' });
  ok(c.length > 0, 'produced candidates');
  for (const p of c) {
    eq(p.tier, 2, 'tier2');
    eq(p.active, false, 'inactive');
    eq(p.source, 'fanout', 'source');
    eq(p.parentProbeId, 'TEK-001', 'parent set');
  }
  ok(c.some(p => /alternatives to universal storage/i.test(p.query)), 'comparison probe present');
  ok(c.some(p => p.type === 'conversational'), 'conversational variants present');
  ok(c.some(p => /in johannesburg/i.test(p.query)), 'geo probe present');
});

await t('dedupeAndRank: drops candidates overlapping existing probes >0.7 Jaccard', () => {
  const existing = [{ query: 'best pallet racking specialists' }];
  const cands = [
    { query: 'best pallet racking specialists' },       // exact dup
    { query: 'top pallet racking specialists near me' }, // near dup (>0.7)
    { query: 'recommended industrial shelving consultants' } // novel
  ];
  const ranked = f.dedupeAndRank(cands, existing, { limit: 25 });
  ok(!ranked.some(r => /best pallet racking specialists/.test(r.query)), 'exact dup dropped');
  ok(ranked.some(r => /industrial shelving consultants/.test(r.query)), 'novel kept');
});

await t('dedupeAndRank: caps at limit and assigns novelty', () => {
  const cands = f.buildCandidates(ATTRS, { seedProbeId: 'X-1' });
  const ranked = f.dedupeAndRank(cands, [], { limit: 25 });
  ok(ranked.length <= 25, 'capped at 25');
  ok(ranked.every(r => typeof r.novelty === 'number'), 'novelty assigned');
  eq(ranked[0].novelty, 1, 'novel vs empty existing set');
});

await t('generateFanout: uses injected extractor, sets parentProbeId to best-covered probe', async () => {
  const snapshot = {
    fanout_signals: { segmentLabels: ['best for mid-market'], reasonPhrases: ['durable'], competitorsNamed: ['Universal Storage'] },
    probe_results: [
      { probeId: 'TEK-001', type: 'qualified', visibilityScore: 80 },
      { probeId: 'TEK-002', type: 'qualified', visibilityScore: 40 },
      { probeId: 'TEK-REV1', type: 'reverse', visibilityScore: 100 } // excluded from seed pick
    ]
  };
  const out = await f.generateFanout({
    snapshot, client: { name: 'Tekkie', competitors: 'Universal Storage' },
    existingProbes: [], limit: 10,
    extractFn: async () => ATTRS
  });
  ok(out.candidates.length > 0, 'candidates produced');
  eq(out.seedProbeId, 'TEK-001', 'seed = highest-visibility scorable probe');
  ok(out.candidates.every(c => c.parentProbeId === 'TEK-001'), 'all carry parent');
});

await t('generateFanout: stops proposing children from exhausted branch', async () => {
  const snapshot = {
    fanout_signals: { segmentLabels: ['x'], reasonPhrases: ['y'], competitorsNamed: [] },
    probe_results: [{ probeId: 'TEK-050', type: 'qualified', visibilityScore: 30 }]
  };
  const out = await f.generateFanout({
    snapshot, client: { name: 'Tekkie' }, existingProbes: [], limit: 10,
    exhaustedParents: ['TEK-050'], extractFn: async () => ATTRS
  });
  eq(out.candidates.length, 0, 'no candidates from exhausted branch');
  eq(out.exhausted, true, 'flagged exhausted');
});

await t('evaluateBranchExhaustion: <10% covered flags branch exhausted', () => {
  const rows = [];
  // Parent P1: 20 probes, 1 covered → 5% → exhausted.
  for (let i = 0; i < 20; i++) rows.push({ parentProbeId: 'P1', appearanceRate: i === 0 ? 0.5 : 0 });
  // Parent P2: 4 probes, 2 covered → 50% → alive.
  for (let i = 0; i < 4; i++) rows.push({ parentProbeId: 'P2', appearanceRate: i < 2 ? 1 : 0 });
  const res = f.evaluateBranchExhaustion(rows);
  eq(res.P1.exhausted, true, 'P1 exhausted');
  eq(res.P2.exhausted, false, 'P2 alive');
  eq(res.P1.rate, 0.05, 'P1 rate');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
