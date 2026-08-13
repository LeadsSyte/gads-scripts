// Gold-grid generator: structural fidelity (TEKenable) + generalisation to an
// arbitrary client (no TEKenable-specific leakage) + generic derivation.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gg = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/goldGrid.js')).href);
const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'tekenable-gold.json'), 'utf8'));

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }
function eq(a, b, label) { if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

const norm = (s) => String(s).toLowerCase();
const types = (probes, ty) => probes.filter(p => p.type === ty);

// ---- TEKenable structural fidelity ----------------------------------------
t('TEKenable grid reproduces every probe type', () => {
  const g = gg.buildGoldGrid(fixture.profile);
  for (const ty of ['category', 'qualified', 'comparison', 'reverse', 'niche', 'conversational'])
    ok(types(g, ty).length >= 1, 'missing type ' + ty);
});

t('TEKenable tier-2 service×geo grid is complete', () => {
  const g = gg.buildGoldGrid(fixture.profile).map(p => norm(p.query));
  for (const s of fixture.profile.services)
    for (const geo of fixture.profile.geoVariants)
      ok(g.some(q => q.includes(norm(s)) && q.includes(norm(geo)) && q.includes('implementation partner')),
        `missing ${s} / ${geo}`);
});

t('TEKenable comparisons name real competitors', () => {
  const cmp = types(gg.buildGoldGrid(fixture.profile), 'comparison').map(p => norm(p.query));
  ok(cmp.some(q => q.includes('codec')), 'codec not named');
  ok(cmp.some(q => q.includes('storm')), 'storm not named');
});

t('no keyword-stuffed "best X company in Y" probes', () => {
  const g = gg.buildGoldGrid(fixture.profile);
  const stuffed = g.filter(p => /^best .+ company in \w+$/.test(norm(p.query)) && norm(p.query).split(' ').length >= 7);
  eq(stuffed.length, 0, 'stuffed count');
});

// ---- generalisation: a totally different client ---------------------------
const lawFirm = {
  name: 'Maponya Attorneys',
  geo: 'South Africa',
  competitors: 'Webber Wentzel, ENS Africa',
  services: ['commercial litigation', 'corporate law', 'labour law', 'conveyancing'],
  headlineServices: ['commercial litigation firms', 'corporate law firms', 'labour law attorneys'],
  industries: ['mining companies', 'financial services', 'retail groups'],
  gridQualifierServices: ['commercial litigation', 'corporate law', 'labour law', 'conveyancing']
};

t('generalises to a non-tech client with its own entities', () => {
  const g = gg.buildGoldGrid(lawFirm);
  const all = g.map(p => norm(p.query)).join(' | ');
  ok(g.length > 30, 'too few probes: ' + g.length);
  ok(all.includes('commercial litigation'), 'own service missing');
  ok(all.includes('south africa'), 'own geo missing');
  ok(all.includes('webber wentzel'), 'own competitor missing');
  // No leakage from the TEKenable fixture.
  ok(!all.includes('tekenable'), 'TEKenable brand leaked');
  ok(!all.includes('dynamics 365'), 'TEKenable service leaked');
  ok(!all.includes('credit union'), 'TEKenable industry leaked');
});

t('every generated probe is well-formed (non-empty, has type+tier)', () => {
  for (const client of [fixture.profile, lawFirm]) {
    for (const p of gg.buildGoldGrid(client)) {
      ok(p.query && p.query.length > 3, 'empty query');
      ok([1, 2, 3].includes(p.tier), 'bad tier');
      ok(p.type, 'missing type');
      ok(!/\bundefined\b|\bnull\b/.test(norm(p.query)), 'templating hole: ' + p.query);
    }
  }
});

t('maxProbes caps the set', () => {
  eq(gg.buildGoldGrid(fixture.profile, { maxProbes: 25 }).length, 25, 'cap');
});

// ---- generic derivation ----------------------------------------------------
t('deriveGridProfile pulls services/industries/geo from raw signals', () => {
  const client = { name: 'Acme Cloud', competitors: 'Rackspace, CloudCo' };
  const prof = gg.deriveGridProfile(client, {
    sitePhrases: ['Azure cloud migration services', 'DevOps consulting', 'managed cloud support', 'Contact us'],
    gscQueries: ['cloud migration company south africa', 'devops consulting johannesburg']
  });
  ok(prof.services.some(s => /cloud|devops/i.test(s)), 'no services derived: ' + JSON.stringify(prof.services));
  eq(prof.geo, 'South Africa', 'geo guessed from text');
  ok(prof.competitors.includes('Rackspace'), 'competitor parsed');
  const grid = gg.buildGoldGrid(prof);
  ok(grid.length > 10, 'derived grid too small');
});

t('deriveGridProfile prefers an LLM profile when supplied', () => {
  const prof = gg.deriveGridProfile(
    { name: 'X', geo: 'Ireland', competitors: 'Y' },
    { llmProfile: { services: ['Dynamics 365', 'Power BI'], industries: ['insurance companies'] } }
  );
  ok(prof.services.includes('Dynamics 365'), 'llm service missing');
  ok(prof.industries.includes('insurance companies'), 'llm industry missing');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
