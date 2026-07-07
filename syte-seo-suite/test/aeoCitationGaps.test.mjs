// Citation-gap tests (Requirement 5 / AC2).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const m = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/aeoCitationGaps.js')).href);

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function eq(a, b, label) { if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }

const PROBES = [
  { id: 'P1', intent: 'commercial', query: 'best widget suppliers' },
  { id: 'P2', intent: 'commercial', query: 'top widget companies' },
  { id: 'P3', intent: 'awareness', query: 'how are widgets made' }
];

const RUNS = [
  // Commercial, brand absent, competitor present, cites a directory → gap.
  { probeId: 'P1', appeared: false, competitorsNamed: ['BetaCorp'], citedUrls: ['https://www.directory.test/list', 'https://blog.test/x'] },
  { probeId: 'P2', appeared: false, competitorsNamed: ['BetaCorp', 'GammaLtd'], citedUrls: ['https://directory.test/widgets'] },
  // Commercial but brand APPEARED → not a gap.
  { probeId: 'P1', appeared: true, competitorsNamed: ['BetaCorp'], citedUrls: ['https://directory.test/list'] },
  // Commercial, brand absent, but NO competitor named → excluded.
  { probeId: 'P2', appeared: false, competitorsNamed: [], citedUrls: ['https://directory.test/none'] },
  // Awareness probe → excluded even though brand absent + competitor present.
  { probeId: 'P3', appeared: false, competitorsNamed: ['BetaCorp'], citedUrls: ['https://awareness.test/x'] },
  // Cites the brand's own domain → not a gap.
  { probeId: 'P1', appeared: false, competitorsNamed: ['BetaCorp'], citedUrls: ['https://acme.test/home'] },
  // Errored run → skipped.
  { probeId: 'P2', error: 'rate limit' }
];

t('gaps: aggregates commercial brand-absent competitor-present citations by domain', () => {
  const gaps = m.buildCitationGaps(RUNS, PROBES, { brandName: 'Acme', brandUrl: 'https://acme.test/' });
  const dir = gaps.find(g => g.domain === 'directory.test');
  ok(dir, 'directory.test surfaced');
  eq(dir.hitCount, 2, 'two commercial-miss citations'); // P1 + P2
  ok(dir.competitors.includes('BetaCorp') && dir.competitors.includes('GammaLtd'), 'competitors aggregated');
  ok(dir.exampleQueries.includes('best widget suppliers'), 'example query captured');
  eq(dir.brandPresent, 'unknown', 'brand present unknown by default');
  ok(/directory\.test/.test(dir.suggestedAction), 'suggested action mentions domain');
});

t('gaps: excludes awareness probes, brand-present runs, no-competitor runs, own domain, errors', () => {
  const gaps = m.buildCitationGaps(RUNS, PROBES, { brandName: 'Acme', brandUrl: 'https://acme.test/' });
  ok(!gaps.some(g => g.domain === 'awareness.test'), 'awareness excluded');
  ok(!gaps.some(g => g.domain === 'acme.test'), 'own domain excluded');
  // blog.test only appeared once (P1, valid gap run) → present with hitCount 1.
  const blog = gaps.find(g => g.domain === 'blog.test');
  eq(blog.hitCount, 1, 'blog counted once');
});

t('gaps: ranked by hitCount desc and capped', () => {
  const gaps = m.buildCitationGaps(RUNS, PROBES, { brandName: 'Acme', brandUrl: 'https://acme.test/', limit: 1 });
  eq(gaps.length, 1, 'capped');
  eq(gaps[0].domain, 'directory.test', 'highest hitCount first');
});

t('gaps: empty when no commercial misses', () => {
  eq(m.buildCitationGaps([{ probeId: 'P1', appeared: true, competitorsNamed: ['X'], citedUrls: ['https://y.test/'] }], PROBES, { brandUrl: 'https://acme.test/' }).length, 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
