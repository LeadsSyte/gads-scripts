// Grounded discovery: seed from GSC head-terms + website, use the client's own
// geo (not hardcoded SA cities).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const d = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/aeoDiscovery.js')).href);

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }

const CLIENT = { name: 'TEKenable', url: 'https://tekenable.com', industry: 'digital transformation', location: 'Ireland' };

t('extractSitePhrases: pulls short phrases from title/h1/h2, drops boilerplate', () => {
  const html = `<title>Dynamics 365 Partner Ireland | TEKenable</title>
    <h1>Power Platform Consulting</h1><h2>Copilot Studio Agents</h2>
    <h2>Home</h2><h3>About Us</h3>
    <p>lots of body text that should be ignored because it is far too long to be a phrase</p>`;
  const p = d.extractSitePhrases(html);
  ok(p.some(x => /power platform consulting/i.test(x)), 'h1 captured');
  ok(p.some(x => /copilot studio agents/i.test(x)), 'h2 captured');
  ok(!p.some(x => /^home$/i.test(x)) && !p.some(x => /^about us$/i.test(x)), 'boilerplate dropped');
});

t('buildDiscoveryQueries: leads with GSC head-terms + variants', () => {
  const qs = d.buildDiscoveryQueries(CLIENT, { gscSeeds: ['dynamics 365 partner ireland'], sitePhrases: [] });
  ok(qs.includes('dynamics 365 partner ireland'), 'raw GSC term probed directly');
  ok(qs.includes('best dynamics 365 partner ireland'), 'best-variant');
  ok(qs.some(q => /top dynamics 365 partner ireland companies/.test(q)), 'top-companies variant');
});

t('buildDiscoveryQueries: uses the client geo (Ireland), not hardcoded SA cities', () => {
  const qs = d.buildDiscoveryQueries(CLIENT, { gscSeeds: [], sitePhrases: ['power platform consulting'] });
  ok(qs.some(q => /power platform consulting/.test(q)), 'site phrase seeded');
  ok(qs.some(q => /in ireland/.test(q)), 'client geo used');
  ok(!qs.some(q => /durban|johannesburg|cape town/.test(q)), 'no hardcoded SA cities');
});

t('buildDiscoveryQueries: empty when no signal at all', () => {
  ok(d.buildDiscoveryQueries({ name: 'X' }, {}).length === 0, 'no seeds → empty');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
