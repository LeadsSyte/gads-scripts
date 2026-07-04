// Unit tests for the append-only probe model + census migration + dedup.
// aeoProbes.js is import-pure (no browser deps) so we import it directly.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/aeoProbes.js')).href);

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error((label || '') + ' expected ' + B + ' got ' + A);
}
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }

const NOW = '2026-07-01T00:00:00.000Z';

const CENSUS_CLIENT = {
  name: 'Tekkie Town',
  aeo_probe_queries: 'best running shoes\nbuy sneakers cape town',
  aeo_census: {
    prompts: [
      { query: 'best running shoes', intent: 'commercial' },
      { query: 'buy sneakers cape town', intent: 'local' },
      { query: 'best running shoes', intent: 'commercial' } // dupe — must collapse
    ],
    grounding: { ranking_seeds: [{ query: 'best running shoes', position: 2 }] }
  }
};

// ── Migration ───────────────────────────────────────────────
t('migrate: builds tier-1 qualified probes, parentProbeId null', () => {
  const probes = mod.migrateClientProbes(CENSUS_CLIENT, { now: NOW });
  eq(probes.length, 2, 'deduped to 2');
  for (const p of probes) {
    eq(p.tier, 1, 'tier');
    eq(p.type, 'qualified', 'type');
    eq(p.parentProbeId, null, 'parent');
    eq(p.active, true, 'active');
    eq(p.runMode, 'both', 'runMode');
    eq(p.discoveredAt, NOW, 'discoveredAt');
  }
});

t('migrate: gsc-seeded prompt tagged source gsc, others manual', () => {
  const probes = mod.migrateClientProbes(CENSUS_CLIENT, { now: NOW });
  const byQ = Object.fromEntries(probes.map(p => [p.query, p.source]));
  eq(byQ['best running shoes'], 'gsc', 'seed → gsc');
  eq(byQ['buy sneakers cape town'], 'manual', 'non-seed → manual');
});

t('migrate: intents preserved, ids sequential with brand prefix', () => {
  const probes = mod.migrateClientProbes(CENSUS_CLIENT, { now: NOW });
  eq(probes[0].intent, 'commercial');
  eq(probes[1].intent, 'local');
  eq(probes[0].id, 'TEK-001', 'first id');
  eq(probes[1].id, 'TEK-002', 'second id');
});

t('migrate: idempotent — existing aeo_probes returned untouched', () => {
  const first = mod.migrateClientProbes(CENSUS_CLIENT, { now: NOW });
  const again = mod.migrateClientProbes({ ...CENSUS_CLIENT, aeo_probes: first }, { now: '2099-01-01T00:00:00.000Z' });
  eq(again, first, 'unchanged');
});

t('migrate: falls back to flat list when no census', () => {
  const probes = mod.migrateClientProbes(
    { name: 'Acme', aeo_probe_queries: 'widgets\ngadgets' }, { now: NOW });
  eq(probes.length, 2);
  eq(probes[0].source, 'manual', 'flat → manual');
  eq(probes[0].intent, 'commercial', 'flat default intent');
});

// ── Append-only ─────────────────────────────────────────────
t('addProbes: appends fresh ids, defaults INACTIVE, never mutates input', () => {
  const base = mod.migrateClientProbes(CENSUS_CLIENT, { now: NOW });
  const { probes, added } = mod.addProbes(base, [
    { query: 'running shoe brands south africa', tier: 2, type: 'category', intent: 'commercial', source: 'fanout', parentProbeId: 'TEK-001' }
  ], { now: NOW });
  eq(added, 1, 'one added');
  eq(base.length, 2, 'input untouched');
  eq(probes.length, 3, 'output grown');
  const p = probes[2];
  eq(p.active, false, 'fan-out proposal inactive');
  eq(p.id, 'TEK-003', 'continues counter');
  eq(p.parentProbeId, 'TEK-001', 'parent set');
  eq(p.runMode, 'search_on', 'tier2 default runMode');
});

t('addProbes: exact-normalized duplicate skipped', () => {
  const base = mod.migrateClientProbes(CENSUS_CLIENT, { now: NOW });
  const { added } = mod.addProbes(base, [{ query: 'Best Running Shoes!' }], { now: NOW });
  eq(added, 0, 'dupe not added');
});

t('setProbeActive: flips flag without deleting (append-only)', () => {
  const base = mod.migrateClientProbes(CENSUS_CLIENT, { now: NOW });
  const off = mod.setProbeActive(base, 'TEK-001', false);
  eq(off.length, 2, 'still present');
  eq(off.find(p => p.id === 'TEK-001').active, false, 'deactivated');
  eq(mod.activeProbes(off).length, 1, 'one active');
});

// ── Dedup / novelty ─────────────────────────────────────────
t('isDuplicateQuery: >0.7 Jaccard overlap rejected', () => {
  const existing = [{ query: 'best running shoes in cape town' }];
  ok(mod.isDuplicateQuery('best running shoes cape town', existing), 'near-dup rejected');
  ok(!mod.isDuplicateQuery('waterproof hiking boots durban', existing), 'novel accepted');
});

// ── Reverse probes / scorable ───────────────────────────────
t('reverseProbesFor: two tier-1 reverse instruments', () => {
  const rev = mod.reverseProbesFor({ name: 'Tekkie Town' }, { now: NOW });
  eq(rev.length, 2);
  eq(rev[0].type, 'reverse');
  eq(rev[0].tier, 1);
  ok(rev[0].query.includes('Tekkie Town'), 'brand in query');
});

t('scorableProbes: excludes reverse instruments', () => {
  const base = mod.migrateClientProbes(CENSUS_CLIENT, { now: NOW });
  const withRev = base.concat(mod.reverseProbesFor(CENSUS_CLIENT, { now: NOW }));
  eq(mod.scorableProbes(withRev).length, 2, 'reverse excluded from scorable');
  eq(mod.activeProbes(withRev).length, 4, 'but active includes reverse');
});

t('countNewThemesSince: counts active fanout probes after timestamp', () => {
  const probes = [
    { id: 'A-1', active: true, source: 'fanout', discoveredAt: '2026-06-15T00:00:00.000Z' },
    { id: 'A-2', active: true, source: 'fanout', discoveredAt: '2026-07-02T00:00:00.000Z' },
    { id: 'A-3', active: false, source: 'fanout', discoveredAt: '2026-07-03T00:00:00.000Z' },
    { id: 'A-4', active: true, source: 'manual', discoveredAt: '2026-07-02T00:00:00.000Z' }
  ];
  eq(mod.countNewThemesSince(probes, '2026-07-01T00:00:00.000Z'), 1, 'only active fanout after cutoff');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
