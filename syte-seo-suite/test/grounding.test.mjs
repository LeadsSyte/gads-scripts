// AEO grounding pipeline — the integration test that was missing. Covers the
// exact failure that shipped a 6-prompt, all-zero report: when profile signals
// fail, grounding must NOT collapse the active probe set.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const g = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/grounding.js')).href);
const gg = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/goldGrid.js')).href);

let pass = 0, fail = 0;
function t(name, fn) { return fn().then(() => { console.log('PASS', name); pass++; }).catch(e => { console.log('FAIL', name, '->', e.message); fail++; }); }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }
function eq(a, b, label) { if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

const activeCount = (probes) => probes.filter(p => p.active !== false).length;
const mkClient = (probes) => ({ id: 'c1', name: 'TEKenable', geo: 'Ireland', aeo_probes: probes });

// A realistic healthy grid the builder returns when signals are good.
const healthyGold = () => gg.buildGoldGrid({
  brand: 'TEKenable', geo: 'Ireland', competitors: ['Codec', 'Storm Technology'],
  services: ['Dynamics 365', 'Power Platform', 'Business Central'],
  headlineServices: ['Microsoft partners', 'Dynamics 365 partners'],
  industries: ['insurance companies', 'credit unions']
});

// The 6 manual money-term probes from the degenerate report.
const sixManual = [
  'Business Transformation Partner Ireland', 'Business Transformation Partner UK and Ireland',
  'Best Dynamics 365 Partner in Ireland', 'Best Power Platform Solutions Ireland',
  'Microsoft Azure consulting firm Ireland', 'Who are the best Microsoft Dynamics 365 consulting companies in Ireland'
].map((q, i) => ({ id: 'TEK-' + (i + 1), tier: 1, type: 'category', intent: 'commercial', query: q, source: 'manual', active: true }));

// 25 old GSC-stuffed probes.
const gscJunk = Array.from({ length: 25 }, (_, i) => ({
  id: 'TEK-G' + i, tier: 1, type: 'category', intent: 'commercial',
  query: `best thing ${i} company in ireland`, source: 'gsc', active: true
}));

await t('healthy gold upgrades a GSC-junk client and retires the junk', async () => {
  const client = mkClient(gscJunk);
  const res = await g.groundClientForAeo(client, { buildGold: async () => ({ probes: healthyGold() }) });
  eq(res.reason, 'upgraded-to-gold', 'reason');
  const active = res.client.aeo_probes.filter(p => p.active !== false);
  ok(active.every(p => p.source !== 'gsc'), 'gsc probes must be retired (inactive)');
  ok(active.length >= 12, 'active grid too small: ' + active.length);
  ok(res.client.aeo_probes.some(p => p.source === 'gsc' && p.active === false), 'gsc history must be preserved inactive');
});

await t('THE REGRESSION: builder throws → active set must NOT shrink', async () => {
  const client = mkClient([...sixManual, ...gscJunk]); // 31 active
  const before = activeCount(client.aeo_probes);
  const res = await g.groundClientForAeo(client, { buildGold: async () => { throw new Error('LLM 500'); } });
  const after = activeCount(res.client.aeo_probes);
  ok(after >= before, `active shrank from ${before} to ${after}`);
});

await t('THE REGRESSION: builder returns a thin set → do not retire, do not collapse to 6', async () => {
  const client = mkClient(gscJunk); // 25 active
  const before = activeCount(client.aeo_probes);
  // All-signals-failed build: just 3 reverse probes.
  const thin = [{ tier: 1, type: 'reverse', query: 'What is TEKenable known for?', source: 'gold', active: true }];
  const res = await g.groundClientForAeo(client, { buildGold: async () => ({ probes: thin }) });
  const after = activeCount(res.client.aeo_probes);
  ok(after >= before, `active shrank from ${before} to ${after}`);
  ok(res.client.aeo_probes.some(p => p.source === 'gsc' && p.active !== false), 'thin gold must NOT retire gsc');
});

await t('thin build + GSC fallback set → fallback is added additively', async () => {
  const client = mkClient(sixManual);
  const fallbackSet = Array.from({ length: 20 }, (_, i) => ({ query: `gsc term ${i} ireland`, type: 'category', source: 'gsc', active: true }));
  const res = await g.groundClientForAeo(client, { buildGold: async () => ({ probes: [] }), fallbackSet });
  ok(activeCount(res.client.aeo_probes) >= activeCount(client.aeo_probes) + 15, 'fallback not added');
});

await t('already on a healthy gold grid → unchanged (MoM stable)', async () => {
  const goldProbes = healthyGold().map((p, i) => ({ ...p, id: 'TEK-' + i, active: true }));
  const client = mkClient(goldProbes);
  let built = false;
  const res = await g.groundClientForAeo(client, { buildGold: async () => { built = true; return { probes: [] }; } });
  eq(res.changed, false, 'should not change');
  eq(built, false, 'must not rebuild when already on gold');
});

await t('no client is handled', async () => {
  const res = await g.groundClientForAeo(null, {});
  eq(res.reason, 'no-client', 'reason');
});

await t('isHealthyGold gate: needs size AND type diversity', async () => {
  ok(!g.isHealthyGold([]), 'empty not healthy');
  ok(!g.isHealthyGold(Array.from({ length: 20 }, () => ({ type: 'category' }))), 'one type not healthy');
  ok(g.isHealthyGold(healthyGold()), 'real grid healthy');
});

await t('probeSetHealth flags a degenerate active set', async () => {
  const thin = sixManual; // 6 active, 1 type
  const h = g.probeSetHealth(thin);
  ok(h.degenerate, 'six manual probes should read degenerate');
  eq(h.activeCount, 6, 'active count');
  const healthy = healthyGold().map((p, i) => ({ ...p, id: 'x' + i, active: true }));
  const h2 = g.probeSetHealth(healthy);
  ok(!h2.degenerate, 'real grid should be healthy');
  ok(h2.onGoldGrid, 'should detect gold grid');
  ok(h2.typeCount >= 3, 'multiple types');
});

await t('probeSetHealth ignores inactive probes', async () => {
  const mixed = [...healthyGold().map((p, i) => ({ ...p, id: 'a' + i, active: false })), ...sixManual];
  const h = g.probeSetHealth(mixed);
  eq(h.activeCount, 6, 'only the 6 active manual probes count');
  ok(h.degenerate, 'active portion is degenerate');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
