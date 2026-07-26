// Unit tests for the AEO v2 scoring math (Requirement 3 / AC4).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const s = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/aeoScore.js')).href);

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

// ── AC4: avgPositionWhenAppearing never contaminated by absent runs ──
t('AC4: runs [absent, pos2, pos4] → avgPositionWhenAppearing = 3.0 (not 2.0)', () => {
  const runs = [
    { appeared: false, position: null },
    { appeared: true, position: 2 },
    { appeared: true, position: 4 }
  ];
  eq(s.avgPositionWhenAppearing(runs), 3.0, 'mean of 2 and 4 only');
});

t('avgPositionWhenAppearing: all absent → null', () => {
  eq(s.avgPositionWhenAppearing([{ appeared: false, position: null }, { appeared: false, position: 0 }]), null);
});

t('avgPositionWhenAppearing: ignores appeared runs with null/0 position', () => {
  const runs = [{ appeared: true, position: 0 }, { appeared: true, position: 6 }];
  eq(s.avgPositionWhenAppearing(runs), 6.0, 'zero position not averaged in');
});

t('appearanceRate: 2 of 3', () => {
  eq(s.appearanceRate([{ appeared: true }, { appeared: false }, { appeared: true }]), 2 / 3);
});

// ── visibilityScore ──
t('visibilityScore: ar=1, avgPos=1 → 100', () => {
  eq(s.visibilityScore(1, 1), 100);
});
t('visibilityScore: ar=1, avgPos=2 → 50', () => {
  eq(s.visibilityScore(1, 2), 50);
});
t('visibilityScore: ar=0.667, avgPos=4 → 17', () => {
  eq(s.visibilityScore(2 / 3, 4), Math.round((2 / 3) * (1 / 4) * 100)); // 17
});
t('visibilityScore: never appeared (null avgPos) → 0', () => {
  eq(s.visibilityScore(0, null), 0);
});
t('visibilityScore: capped at 100', () => {
  eq(s.visibilityScore(1, 0.5), 100);
});

// ── portfolio ──
const AGG = [
  { probeId: 'A', appearanceRate: 1.0, visibilityScore: 100 },
  { probeId: 'B', appearanceRate: 0.5, visibilityScore: 40 },
  { probeId: 'C', appearanceRate: 0.0, visibilityScore: 0 },
  { probeId: 'D', appearanceRate: 0.0, visibilityScore: 0 }
];
t('promptCoverage: probes with appearanceRate > 0', () => {
  eq(s.promptCoverage(AGG), 2);
});
t('coverageRate: 2 of 4 = 0.5', () => {
  eq(s.coverageRate(AGG), 0.5);
});
t('meanVisibilityCovered: mean over covered only (100,40) = 70', () => {
  eq(s.meanVisibilityCovered(AGG), 70);
});

// ── composite ──
t('compositeIndex: weighted sum rounds correctly', () => {
  // cr .5*30=15, meanVis 70/100*30=21, sov 40/100*20=8, cite 20/100*10=2, sent 60/100*10=6 → 52
  const c = s.compositeIndex({ coverageRate: 0.5, meanVis: 70, sov: 40, citeDensity: 20, sentiment: 60 });
  eq(c, 52);
});
t('compositeIndex: all-max caps at 100', () => {
  eq(s.compositeIndex({ coverageRate: 1, meanVis: 100, sov: 100, citeDensity: 100, sentiment: 100 }), 100);
});

// ── buckets ──
t('bucketByAppearance: thresholds', () => {
  eq(s.bucketByAppearance(1.0), 'active');
  eq(s.bucketByAppearance(0.7), 'active');
  eq(s.bucketByAppearance(0.667), 'emerging');
  eq(s.bucketByAppearance(0.3), 'emerging');
  eq(s.bucketByAppearance(0), 'zero');
});

// ── scoreRunGroup end-to-end ──
t('scoreRunGroup: [absent, pos2, pos4] → ar .67, avgPos 3.0, vis 22', () => {
  const g = s.scoreRunGroup([
    { appeared: false, position: null },
    { appeared: true, position: 2 },
    { appeared: true, position: 4 }
  ]);
  eq(g.appearances, 2);
  eq(g.avgPositionWhenAppearing, 3.0);
  eq(g.visibilityScore, Math.round((2 / 3) * (1 / 3) * 100)); // 22
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
