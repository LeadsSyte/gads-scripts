// Gold-standard eval: score the tool's generated probe set against the
// hand-built TEKenable gold grid (test/fixtures/tekenable-gold.json).
//
// This is the offline optimisation target. It does NOT call any LLM — it
// measures whether our probe GENERATOR reproduces the strategic structure of
// the gold sheet, because probe quality is what drives live appearances.
//
// Run:  node test/aeoGoldStandard.eval.mjs
// Exits non-zero if the score is below TARGET (so it doubles as a gate).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildGoldGrid } from '../src/modules/reports/goldGrid.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(HERE, 'fixtures', 'tekenable-gold.json'), 'utf8'));
const { profile, goldProbes } = fixture;

const TARGET = 90;

// ---- normalisation + matching helpers -------------------------------------
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const hasAll = (hay, needles) => needles.every(n => hay.includes(norm(n)));

// ---- generate -------------------------------------------------------------
const gen = buildGoldGrid(profile);
const genQ = gen.map(p => ({ ...p, n: norm(p.query) }));
const genByType = (t) => genQ.filter(p => p.type === t);

// ---- gold buckets ---------------------------------------------------------
const goldByType = {};
for (const g of goldProbes) (goldByType[g.type] ||= []).push(g);

const report = [];
let score = 0;

// 1. Type coverage (20) — every gold type reproduced at reasonable volume.
{
  const TYPES = ['category', 'qualified', 'comparison', 'reverse', 'niche', 'conversational'];
  let acc = 0;
  const detail = [];
  for (const t of TYPES) {
    const goldN = (goldByType[t] || []).length || 1;
    const genN = genByType(t).length;
    const ratio = Math.min(genN / goldN, 1);
    acc += ratio;
    detail.push(`${t}: gen ${genN} / gold ${goldByType[t]?.length || 0} = ${(ratio * 100).toFixed(0)}%`);
  }
  const pts = (acc / TYPES.length) * 20;
  score += pts;
  report.push(['Type coverage', pts, 20, detail]);
}

// 2. Tier-2 service x geo grid (25).
{
  const cells = [];
  for (const s of profile.services) for (const g of profile.geoVariants) cells.push({ s, g });
  const grid = genQ.filter(p => p.n.includes('implementation partner'));
  let matched = 0;
  const misses = [];
  for (const { s, g } of cells) {
    const ok = grid.some(p => hasAll(p.n, [s, g]));
    if (ok) matched++; else misses.push(`${s} / ${g}`);
  }
  const pts = (matched / cells.length) * 25;
  score += pts;
  report.push(['Tier-2 service×geo grid', pts, 25, [`${matched}/${cells.length} cells`, ...misses.slice(0, 4).map(m => 'MISS ' + m)]]);
}

// 3. Tier-2 qualifier grid (10).
{
  const svcs = profile.gridQualifierServices;
  const cells = [];
  for (const s of svcs) for (const seg of profile.segments) cells.push({ s, seg });
  let matched = 0;
  const misses = [];
  for (const { s, seg } of cells) {
    const ok = genQ.some(p => hasAll(p.n, [s, seg]) && p.n.includes('partner'));
    if (ok) matched++; else misses.push(`${s} / ${seg}`);
  }
  const pts = cells.length ? (matched / cells.length) * 10 : 10;
  score += pts;
  report.push(['Tier-2 qualifier grid', pts, 10, [`${matched}/${cells.length} cells`, ...misses.slice(0, 3).map(m => 'MISS ' + m)]]);
}

// 4. Tier-3 industry grid (15).
{
  const TEMPLATE_KEYS = ['technology partner for', profile.services[0], 'ai solutions for'];
  const cells = [];
  for (const ind of profile.industries) for (const t of TEMPLATE_KEYS) cells.push({ ind, t });
  let matched = 0;
  const misses = [];
  for (const { ind, t } of cells) {
    const core = norm(ind).split(' ').slice(0, 2).join(' '); // e.g. "credit unions"
    const ok = genQ.some(p => p.n.includes(norm(t).split(' ')[0]) && p.n.includes(core));
    if (ok) matched++; else misses.push(`${t} × ${ind}`);
  }
  const pts = (matched / cells.length) * 15;
  score += pts;
  report.push(['Tier-3 industry grid', pts, 15, [`${matched}/${cells.length} cells`, ...misses.slice(0, 3).map(m => 'MISS ' + m)]]);
}

// 5. Tier-1 strategic coverage (15) — six qualitative checks.
{
  const checks = [];
  checks.push(['reverse names brand', genByType('reverse').some(p => p.n.includes(norm(profile.brand)))]);
  checks.push(['≥5 headline category terms', profile.headlineServices.filter(s => genByType('category').some(p => p.n.includes(norm(s)))).length >= 5]);
  checks.push(['comparison names ≥2 competitors', profile.competitors.filter(c => genByType('comparison').some(p => p.n.includes(norm(c)))).length >= 2]);
  checks.push(['qualified w/ buyer segment', genByType('qualified').some(p => profile.segments.some(seg => p.n.includes(norm(seg))))]);
  checks.push(['niche industry moonshot', genByType('niche').length >= 3]);
  checks.push(['conversational buyer-journey', genByType('conversational').length >= 1]);
  const passed = checks.filter(c => c[1]).length;
  const pts = (passed / checks.length) * 15;
  score += pts;
  report.push(['Tier-1 strategic coverage', pts, 15, checks.map(c => `${c[1] ? 'ok ' : 'MISS'} ${c[0]}`)]);
}

// 6. Competitor naming in comparisons (5).
{
  const named = profile.competitors.filter(c => genByType('comparison').some(p => p.n.includes(norm(c)))).length;
  const pts = profile.competitors.length ? Math.min(named / Math.min(profile.competitors.length, 2), 1) * 5 : 5;
  score += pts;
  report.push(['Competitor naming', pts, 5, [`${named} competitors named in comparisons`]]);
}

// 7. Anti-keyword-stuffing (10) — penalise GSC-stacked "best X company in Y".
{
  const STUFFED = /^best .+ company in \w+$/;
  const bad = genQ.filter(p => STUFFED.test(p.n) && p.n.split(' ').length >= 7);
  const pts = 10 * (1 - bad.length / Math.max(genQ.length, 1));
  score += pts;
  report.push(['Anti-keyword-stuffing', pts, 10, [`${bad.length}/${genQ.length} stuffed`, ...bad.slice(0, 3).map(b => 'BAD ' + b.query)]]);
}

// ---- print ----------------------------------------------------------------
console.log('\n=== GOLD-STANDARD PROBE EVAL (TEKenable) ===');
console.log(`Generated ${gen.length} probes (gold has ${goldProbes.length}).`);
console.log(`Type counts: ${['category','qualified','comparison','reverse','niche','conversational'].map(t => `${t}=${genByType(t).length}`).join('  ')}\n`);
for (const [name, pts, max, detail] of report) {
  console.log(`${pts >= max * 0.9 ? '✓' : pts >= max * 0.5 ? '~' : '✗'} ${name}: ${pts.toFixed(1)} / ${max}`);
  for (const d of (detail || [])) console.log(`      ${d}`);
}
console.log(`\nSCORE: ${score.toFixed(1)} / 100   (target ${TARGET})`);

if (score < TARGET) {
  console.log(`\nBELOW TARGET by ${(TARGET - score).toFixed(1)} — biggest gaps first:`);
  [...report].sort((a, b) => (a[1] / a[2]) - (b[1] / b[2])).slice(0, 3)
    .forEach(([name, pts, max]) => console.log(`  - ${name}: ${((pts / max) * 100).toFixed(0)}% of ${max}pts`));
  process.exit(1);
}
console.log('\nMEETS TARGET.');
