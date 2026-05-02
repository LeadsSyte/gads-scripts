// migration.js contract tests. The migration module reads localStorage
// from three legacy single-tool apps (syte-tseo-clients, syte-aeo-clients,
// syte-ce-brands) and feeds them into the unified suite. Pins:
//   • needsMigration false when MIGRATED_FLAG set
//   • needsMigration false when no legacy keys present
//   • countLegacyClients dedupes by url/name across sources
//   • runMigration sets the flag, returns counts, calls upsertClient
//   • parsePastedClients accepts: array, object map, bundle shape, raw
//     localStorage dump
//   • mapLegacy normalises the many casings (camelCase + snake_case + bare)
//   • mergeClient picks the most-complete value for each field

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/lib/migration.js'), 'utf8');

// Patch the supabase imports — we control upsertClient + listClients via
// globals so we can assert on call args.
globalThis.__upsertCalls = [];
globalThis.__existingClients = [];
const PATCHED = SRC.replace(
  "import { upsertClient, listClients } from './supabase.js';",
  `const upsertClient = async (c) => { globalThis.__upsertCalls.push(c); return { ...c, id: 'inserted' }; };
   const listClients = async () => globalThis.__existingClients;`
);

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};

const tmp = path.join(os.tmpdir(), 'migration-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
async function t(name, fn) {
  store.clear();
  globalThis.__upsertCalls = [];
  globalThis.__existingClients = [];
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
// needsMigration / countLegacyClients
// ============================================================================
await t('needsMigration: false when no legacy keys present', () => {
  eq(mod.needsMigration(), false);
});

await t('needsMigration: true when any legacy key has data', () => {
  store.set('syte-tseo-clients', JSON.stringify([{ name: 'Acme' }]));
  eq(mod.needsMigration(), true);
});

await t('needsMigration: false when MIGRATED_FLAG already set, even with data present', () => {
  store.set('syte-tseo-clients', JSON.stringify([{ name: 'Acme' }]));
  store.set('syte-suite-migrated', '1');
  eq(mod.needsMigration(), false);
});

await t('needsMigration: false when legacy key is empty array', () => {
  store.set('syte-tseo-clients', '[]');
  eq(mod.needsMigration(), false);
});

await t('countLegacyClients: dedupes by URL across sources', () => {
  store.set('syte-tseo-clients', JSON.stringify([
    { name: 'Acme', url: 'https://acme.test/' }
  ]));
  store.set('syte-aeo-clients', JSON.stringify([
    { name: 'Acme', url: 'https://acme.test/', industry: 'Hospitality' }
  ]));
  eq(mod.countLegacyClients(), 1, 'same URL → one client');
});

await t('countLegacyClients: counts distinct clients across sources', () => {
  store.set('syte-tseo-clients', JSON.stringify([{ name: 'A', url: 'https://a.test/' }]));
  store.set('syte-aeo-clients', JSON.stringify([{ name: 'B', url: 'https://b.test/' }]));
  store.set('syte-ce-brands', JSON.stringify([{ name: 'C', url: 'https://c.test/' }]));
  eq(mod.countLegacyClients(), 3);
});

await t('countLegacyClients: handles object-map shape ({id: client})', () => {
  store.set('syte-tseo-clients', JSON.stringify({
    id1: { name: 'A', url: 'https://a.test/' },
    id2: { name: 'B', url: 'https://b.test/' }
  }));
  eq(mod.countLegacyClients(), 2);
});

await t('countLegacyClients: skips records with no name AND no url', () => {
  store.set('syte-tseo-clients', JSON.stringify([
    { name: '', url: '' },
    { name: 'Acme', url: 'https://acme.test/' }
  ]));
  eq(mod.countLegacyClients(), 1);
});

// ============================================================================
// runMigration
// ============================================================================
await t('runMigration: returns {migrated:0, skipped:0} when flag already set', async () => {
  store.set('syte-suite-migrated', '1');
  store.set('syte-tseo-clients', JSON.stringify([{ name: 'Acme', url: 'https://acme.test/' }]));
  const r = await mod.runMigration();
  eq(r.migrated, 0);
  eq(r.skipped, 0);
  eq(globalThis.__upsertCalls.length, 0, 'no upserts called');
});

await t('runMigration: inserts new clients + sets MIGRATED_FLAG', async () => {
  store.set('syte-tseo-clients', JSON.stringify([
    { name: 'Acme', url: 'https://acme.test/' }
  ]));
  const r = await mod.runMigration();
  eq(r.migrated, 1);
  eq(r.skipped, 0);
  eq(globalThis.__upsertCalls.length, 1);
  eq(globalThis.__upsertCalls[0].name, 'Acme');
  // Flag set to prevent re-runs.
  eq(store.get('syte-suite-migrated'), '1');
});

await t('runMigration: skips clients that already exist by URL', async () => {
  store.set('syte-tseo-clients', JSON.stringify([
    { name: 'Acme', url: 'https://acme.test/' }
  ]));
  globalThis.__existingClients = [
    { id: 'c1', name: 'Acme Co', url: 'https://acme.test/' }
  ];
  const r = await mod.runMigration();
  eq(r.migrated, 0);
  eq(r.skipped, 1);
  eq(globalThis.__upsertCalls.length, 0);
});

await t('runMigration: merges duplicates from multiple sources before insert', async () => {
  store.set('syte-tseo-clients', JSON.stringify([
    { name: 'Acme', url: 'https://acme.test/', gsc_property: 'sc-domain:acme.test' }
  ]));
  store.set('syte-aeo-clients', JSON.stringify([
    { name: 'Acme', url: 'https://acme.test/', industry: 'Hospitality', voice: 'Editorial' }
  ]));
  await mod.runMigration();
  eq(globalThis.__upsertCalls.length, 1, 'one merged client');
  const c = globalThis.__upsertCalls[0];
  eq(c.gsc_property, 'sc-domain:acme.test');
  eq(c.industry, 'Hospitality');
  eq(c.voice, 'Editorial');
});

await t('runMigration: legacy field name aliases mapped (camelCase → snake_case)', async () => {
  store.set('syte-tseo-clients', JSON.stringify([
    { brand: 'Acme', site: 'https://acme.test/', ga4PropertyId: '123', sitemapUrl: 'https://acme.test/sitemap.xml' }
  ]));
  await mod.runMigration();
  const c = globalThis.__upsertCalls[0];
  eq(c.name, 'Acme', 'brand → name');
  eq(c.url, 'https://acme.test/', 'site → url');
  eq(c.ga4_property_id, '123', 'ga4PropertyId → ga4_property_id');
  eq(c.sitemap_url, 'https://acme.test/sitemap.xml');
});

// ============================================================================
// parsePastedClients
// ============================================================================
await t('parsePastedClients: rejects non-JSON with friendly error', () => {
  expectThrow(() => mod.parsePastedClients('not json'), /does not look like JSON/);
});

await t('parsePastedClients: accepts a plain array', () => {
  const out = mod.parsePastedClients(JSON.stringify([
    { name: 'A', url: 'https://a.test/' },
    { name: 'B', url: 'https://b.test/' }
  ]));
  eq(out.length, 2);
});

await t('parsePastedClients: accepts an id-keyed object map', () => {
  const out = mod.parsePastedClients(JSON.stringify({
    id1: { name: 'A', url: 'https://a.test/' },
    id2: { name: 'B', url: 'https://b.test/' }
  }));
  eq(out.length, 2);
});

await t('parsePastedClients: accepts the bundle shape {tseo, aeo, ce}', () => {
  const out = mod.parsePastedClients(JSON.stringify({
    tseo: [{ name: 'A', url: 'https://a.test/' }],
    aeo:  [{ name: 'B', url: 'https://b.test/' }],
    ce:   [{ name: 'C', url: 'https://c.test/' }]
  }));
  eq(out.length, 3);
});

await t('parsePastedClients: accepts a raw localStorage dump', () => {
  const dump = {
    'syte-tseo-clients': JSON.stringify([{ name: 'A', url: 'https://a.test/' }]),
    'syte-aeo-clients':  JSON.stringify([{ name: 'B', url: 'https://b.test/' }])
  };
  const out = mod.parsePastedClients(JSON.stringify(dump));
  eq(out.length, 2);
});

await t('parsePastedClients: dedupes records appearing in multiple bundle keys', () => {
  const out = mod.parsePastedClients(JSON.stringify({
    tseo: [{ name: 'Acme', url: 'https://acme.test/', gsc: 'sc-domain:acme.test' }],
    aeo:  [{ name: 'Acme', url: 'https://acme.test/', industry: 'Hospitality' }]
  }));
  eq(out.length, 1, 'one merged client');
  eq(out[0].industry, 'Hospitality');
  eq(out[0].gsc_property, 'sc-domain:acme.test');
});

await t('importPastedClients: classifies inserts vs merges vs skips', async () => {
  globalThis.__existingClients = [
    { name: 'Existing', url: 'https://existing.test/' }
  ];
  const r = await mod.importPastedClients(JSON.stringify([
    { name: 'New', url: 'https://new.test/' },
    { name: 'Existing', url: 'https://existing.test/', industry: 'Hospitality' }
  ]));
  eq(r.total, 2);
  eq(r.inserted, 1);
  eq(r.merged, 1);
});

await t('importPastedClients: throws when paste yields zero clients', async () => {
  await expectThrow(() => mod.importPastedClients('{}'), /No client records/);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
