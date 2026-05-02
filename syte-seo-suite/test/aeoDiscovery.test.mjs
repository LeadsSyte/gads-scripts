// aeoDiscovery.js contract tests. Discovery sweep finds queries the
// brand is ALREADY cited for in AI engines (vs the regular probe which
// asks "do these specific queries cite us?"). Pins:
//   • buildDiscoveryQueries derives category seeds from industry +
//     storage hints + context phrases
//   • Returns deduped lowercased queries capped at the limit
//   • runDiscoverySweep calls each (query, engine) pair once
//   • Mentions across multiple engines collapse into one citing entry
//     with `engines` listing all of them
//   • Engine errors land in `errors` but don't abort the sweep

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/reports/aeoDiscovery.js'), 'utf8');

globalThis.__activeEngines = () => [];
globalThis.__detectBrand = () => ({ mentioned: false });

const PATCHED = SRC
  .replace(
    "import { activeEngines } from './aeoEngines.js';",
    "const activeEngines = () => globalThis.__activeEngines();"
  )
  .replace(
    "import { detectBrand } from './brandDetection.js';",
    "const detectBrand = (...a) => globalThis.__detectBrand(...a);"
  );

const tmp = path.join(os.tmpdir(), 'aeoDiscovery-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
async function t(name, fn) {
  globalThis.__activeEngines = () => [];
  globalThis.__detectBrand = () => ({ mentioned: false });
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
async function expectThrow(fn, regex, label) {
  try { await fn(); }
  catch (e) {
    if (regex && !regex.test(e.message)) throw new Error((label || '') + ' wrong error: ' + e.message);
    return;
  }
  throw new Error((label || '') + ' expected throw, did not throw');
}

// ============================================================================
// buildDiscoveryQueries
// ============================================================================
await t('buildDiscoveryQueries: empty when industry is missing', () => {
  eq(mod.buildDiscoveryQueries({}).length, 0);
});

await t('buildDiscoveryQueries: derives queries from a basic industry', () => {
  const out = mod.buildDiscoveryQueries({ industry: 'industrial shelving' });
  if (out.length === 0) throw new Error('expected queries to be generated');
  // Should include at least one city-anchored query.
  if (!out.some(q => /johannesburg|cape town|durban/i.test(q))) {
    throw new Error('no SA city query: ' + out.slice(0, 3).join(', '));
  }
});

await t('buildDiscoveryQueries: dedupes results (lowercased)', () => {
  const out = mod.buildDiscoveryQueries({ industry: 'shelving' });
  const set = new Set(out);
  eq(set.size, out.length, 'no duplicate queries');
  // All lowercased.
  for (const q of out) {
    if (q !== q.toLowerCase()) throw new Error('not lowercased: ' + q);
  }
});

await t('buildDiscoveryQueries: respects the limit', () => {
  const out = mod.buildDiscoveryQueries({ industry: 'shelving' }, { limit: 10 });
  if (out.length > 10) throw new Error('exceeded limit: ' + out.length);
});

await t('buildDiscoveryQueries: storage-hint expansion adds related seeds', () => {
  // Industry "racking" should add "racking" + "pallet racking" seeds,
  // producing more queries than a plain industry that doesn't trigger
  // the hint expansion.
  const racking = mod.buildDiscoveryQueries({ industry: 'industrial racking' });
  const generic = mod.buildDiscoveryQueries({ industry: 'consulting' });
  // Racking expansion should outproduce a non-storage industry.
  if (racking.length <= generic.length) {
    throw new Error('storage-hint expansion did not enrich query set');
  }
});

await t('buildDiscoveryQueries: includes generic non-location queries', () => {
  const out = mod.buildDiscoveryQueries({ industry: 'shelving' });
  // Templates without {city}/{region} produce generic queries like
  // "best shelving companies".
  if (!out.some(q => q.includes('best shelving companies'))) {
    throw new Error('expected generic "best X companies" query');
  }
});

// ============================================================================
// runDiscoverySweep
// ============================================================================
await t('runDiscoverySweep: throws when no engines configured', async () => {
  globalThis.__activeEngines = () => [];
  await expectThrow(
    () => mod.runDiscoverySweep({ name: 'X', industry: 'shelving' }),
    /No AI engines configured/i
  );
});

await t('runDiscoverySweep: throws when no queries derivable + none supplied', async () => {
  globalThis.__activeEngines = () => [{ id: 'e1', label: 'E', ask: async () => ({}) }];
  await expectThrow(
    () => mod.runDiscoverySweep({ name: 'X' }, { queries: [] }),
    /Could not derive discovery queries/i
  );
});

await t('runDiscoverySweep: each engine called once per query', async () => {
  let calls = 0;
  globalThis.__activeEngines = () => [
    { id: 'e1', label: 'E1', ask: async () => { calls++; return { text: '' }; } },
    { id: 'e2', label: 'E2', ask: async () => { calls++; return { text: '' }; } }
  ];
  const r = await mod.runDiscoverySweep(
    { name: 'X' },
    { queries: ['q1', 'q2'] }
  );
  eq(calls, 4, '2 queries × 2 engines');
  eq(r.totalQueries, 2);
  eq(r.totalRuns, 4);
});

await t('runDiscoverySweep: queries with mentions captured into citingQueries', async () => {
  globalThis.__activeEngines = () => [
    { id: 'e1', label: 'E1', ask: async () => ({ text: 'Acme is great' }) },
    { id: 'e2', label: 'E2', ask: async () => ({ text: 'No mention' }) }
  ];
  globalThis.__detectBrand = (text) => text.includes('Acme')
    ? { mentioned: true, position: 1, excerpt: 'Acme is great' }
    : { mentioned: false };
  const r = await mod.runDiscoverySweep(
    { name: 'Acme' },
    { queries: ['q1'] }
  );
  eq(r.citingQueries.length, 1);
  eq(r.citingQueries[0].query, 'q1');
  // Only e1 cited the brand.
  eq(r.citingQueries[0].engines.length, 1);
  eq(r.citingQueries[0].engines[0], 'e1');
});

await t('runDiscoverySweep: same query cited by multiple engines collapses into one entry', async () => {
  globalThis.__activeEngines = () => [
    { id: 'chatgpt', label: 'ChatGPT', ask: async () => ({ text: 'Acme leads.' }) },
    { id: 'gemini',  label: 'Gemini',  ask: async () => ({ text: 'Acme is solid.' }) },
    { id: 'claude',  label: 'Claude',  ask: async () => ({ text: 'No mention here.' }) }
  ];
  globalThis.__detectBrand = (text) => text.includes('Acme')
    ? { mentioned: true, position: 1, excerpt: 'x' }
    : { mentioned: false };
  const r = await mod.runDiscoverySweep(
    { name: 'Acme' },
    { queries: ['solo query'] }
  );
  eq(r.citingQueries.length, 1, 'one entry');
  // engines lists both citing engines.
  eq(r.citingQueries[0].engines.length, 2);
  if (!r.citingQueries[0].engines.includes('chatgpt')) throw new Error('chatgpt missing');
  if (!r.citingQueries[0].engines.includes('gemini')) throw new Error('gemini missing');
});

await t('runDiscoverySweep: engine error captured in errors but does not abort', async () => {
  globalThis.__activeEngines = () => [
    { id: 'fail',  label: 'F', ask: async () => ({ error: 'rate limit' }) },
    { id: 'works', label: 'W', ask: async () => ({ text: 'Acme!' }) }
  ];
  globalThis.__detectBrand = (text) => text.includes('Acme')
    ? { mentioned: true, position: 1, excerpt: 'Acme!' }
    : { mentioned: false };
  const r = await mod.runDiscoverySweep(
    { name: 'Acme' },
    { queries: ['q1'] }
  );
  eq(r.errors.length, 1);
  eq(r.errors[0].engine, 'fail');
  // The working engine's mention still made it through.
  eq(r.citingQueries.length, 1);
});

await t('runDiscoverySweep: thrown engine errors land in errors[] (not crash)', async () => {
  globalThis.__activeEngines = () => [
    { id: 'crash', label: 'C', ask: async () => { throw new Error('network down'); } }
  ];
  const r = await mod.runDiscoverySweep(
    { name: 'X' },
    { queries: ['q'] }
  );
  eq(r.errors.length, 1);
  eq(r.errors[0].message, 'network down');
});

await t('runDiscoverySweep: onProgress fires per (query, engine) before the call', async () => {
  globalThis.__activeEngines = () => [
    { id: 'e1', label: 'E1', ask: async () => ({ text: '' }) }
  ];
  const events = [];
  await mod.runDiscoverySweep(
    { name: 'X' },
    { queries: ['q1', 'q2'], onProgress: (e) => events.push(e) }
  );
  eq(events.length, 2, 'one event per query × engine');
  if (!events[0].query || !events[0].engine) throw new Error('event missing fields');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
