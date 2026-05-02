// googleProperties.js contract tests. The picker depends on:
//   • fetchGa4Properties paginates via nextPageToken; flattens accounts→props
//   • fetchGscSites lists ALL permission levels (no hidden sites)
//   • API-disabled 403 produces a structured error with enableUrl set
//     so the picker can render the "Enable API →" CTA
//   • normalizeGa4Id rejects G-… measurement IDs, UA-… legacy IDs,
//     non-numeric strings; strips properties/ prefix
//   • normalizeGscProperty handles sc-domain: + URL-prefix forms,
//     adds https:// and trailing /, lowercases the host
//   • clearPropertyCache wipes both cache keys
//
// Run: npm test  (from syte-seo-suite/)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/lib/googleProperties.js'), 'utf8');

// Stub the auth module — we want googleProperties.js's logic to run.
globalThis.__mockToken = { access_token: 'TEST_BEARER' };
const PATCHED = SRC.replace(
  "import { ensureToken, SCOPES, GOOGLE_CLIENT_ID } from '../modules/technical/googleAuth.js';",
  `const ensureToken = async () => globalThis.__mockToken;
   const SCOPES = { ga4: 'ga4', gsc: 'gsc' };
   const GOOGLE_CLIENT_ID = '377465514344-abc.apps.googleusercontent.com';`
);

// Fake sessionStorage for the cache.
const session = new Map();
globalThis.sessionStorage = {
  getItem: k => (session.has(k) ? session.get(k) : null),
  setItem: (k, v) => session.set(k, String(v)),
  removeItem: k => session.delete(k),
  clear: () => session.clear()
};

const tmp = path.join(os.tmpdir(), 'googleProps-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let fetchCalls = [];
let fetchHandler = () => { throw new Error('fetch not configured'); };
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  return fetchHandler(String(url), init);
};
function jsonRes(obj, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) };
}
function errRes(status, body) {
  return { ok: false, status, json: async () => ({}), text: async () => body };
}

let pass = 0, fail = 0;
async function t(name, fn) {
  fetchCalls = [];
  session.clear();
  fetchHandler = () => { throw new Error('fetch not configured for ' + name); };
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
    return e;
  }
  throw new Error((label || '') + ' expected throw, did not throw');
}

// ============================================================================
// fetchGa4Properties
// ============================================================================
await t('fetchGa4Properties: flattens accountSummaries → flat property list', async () => {
  fetchHandler = () => jsonRes({
    accountSummaries: [
      {
        account: 'accounts/A1', displayName: 'Agency Acct',
        propertySummaries: [
          { property: 'properties/100', displayName: 'Hotel A' },
          { property: 'properties/101', displayName: 'Hotel B' }
        ]
      },
      {
        account: 'accounts/A2', displayName: 'Direct Acct',
        propertySummaries: [
          { property: 'properties/200', displayName: 'Restaurant' }
        ]
      }
    ]
  });
  const out = await mod.fetchGa4Properties();
  eq(out.length, 3);
  // Sorted by account, then by name.
  eq(out[0].account, 'Agency Acct');
  eq(out[0].name, 'Hotel A');
  eq(out[0].id, '100', 'properties/ prefix stripped');
  eq(out[2].account, 'Direct Acct');
});

await t('fetchGa4Properties: paginates via nextPageToken until exhausted', async () => {
  let page = 0;
  fetchHandler = (url) => {
    page++;
    if (page === 1) {
      return jsonRes({
        accountSummaries: [{ account: 'accounts/A', displayName: 'A', propertySummaries: [{ property: 'properties/1', displayName: 'P1' }] }],
        nextPageToken: 'next-1'
      });
    }
    if (page === 2) {
      // Confirm the second call carries pageToken=next-1.
      if (!url.includes('pageToken=next-1')) throw new Error('pageToken not forwarded');
      return jsonRes({
        accountSummaries: [{ account: 'accounts/A', displayName: 'A', propertySummaries: [{ property: 'properties/2', displayName: 'P2' }] }],
        nextPageToken: 'next-2'
      });
    }
    return jsonRes({
      accountSummaries: [{ account: 'accounts/A', displayName: 'A', propertySummaries: [{ property: 'properties/3', displayName: 'P3' }] }]
    });
  };
  const out = await mod.fetchGa4Properties();
  eq(out.length, 3, '3 props across 3 pages');
  eq(fetchCalls.length, 3);
});

await t('fetchGa4Properties: 403 "has not been used in project" surfaces apiDisabled error with enableUrl', async () => {
  fetchHandler = () => errRes(403, 'Google Analytics Admin API has not been used in project 377465514344 before or it is disabled.');
  const err = await expectThrow(() => mod.fetchGa4Properties(), /GA4 Admin API is not enabled/);
  eq(err.apiDisabled, true);
  // enableUrl includes the project number from GOOGLE_CLIENT_ID's prefix.
  if (!/377465514344/.test(err.enableUrl)) throw new Error('enableUrl missing project number: ' + err.enableUrl);
  if (!err.enableUrl.includes('analyticsadmin.googleapis.com')) throw new Error('wrong api library path');
});

await t('fetchGa4Properties: cache returned on second call within 30 min TTL', async () => {
  fetchHandler = () => jsonRes({
    accountSummaries: [{ account: 'accounts/A', displayName: 'A', propertySummaries: [{ property: 'properties/1', displayName: 'P' }] }]
  });
  await mod.fetchGa4Properties();
  eq(fetchCalls.length, 1);
  fetchCalls.length = 0;
  const out = await mod.fetchGa4Properties();
  eq(out.length, 1);
  eq(fetchCalls.length, 0, 'no second fetch — served from cache');
});

await t('fetchGa4Properties: bypassCache=true forces refetch even with cache', async () => {
  fetchHandler = () => jsonRes({ accountSummaries: [] });
  await mod.fetchGa4Properties();
  await mod.fetchGa4Properties({ bypassCache: true });
  eq(fetchCalls.length, 2);
});

// ============================================================================
// fetchGscSites
// ============================================================================
await t('fetchGscSites: maps siteEntry to {siteUrl, permissionLevel}, sorted', async () => {
  fetchHandler = () => jsonRes({
    siteEntry: [
      { siteUrl: 'https://zebra.test/', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://alpha.test/', permissionLevel: 'siteFullUser' },
      { siteUrl: 'sc-domain:foo.test', permissionLevel: 'siteUnverifiedUser' }
    ]
  });
  const out = await mod.fetchGscSites();
  eq(out.length, 3);
  // Sorted alphabetically by siteUrl.
  eq(out[0].siteUrl, 'https://alpha.test/');
  // ALL permission levels are returned (regression — earlier versions
  // hid siteUnverifiedUser).
  if (!out.some(s => s.permissionLevel === 'siteUnverifiedUser')) {
    throw new Error('siteUnverifiedUser was hidden — picker would lose visibility');
  }
});

await t('fetchGscSites: 403 disabled API → apiDisabled error', async () => {
  fetchHandler = () => errRes(403, 'Search Console API has not been used in project 12345 before.');
  const err = await expectThrow(() => mod.fetchGscSites(), /Search Console API is not enabled/);
  eq(err.apiDisabled, true);
});

await t('fetchGscSites: cache hit avoids second fetch', async () => {
  fetchHandler = () => jsonRes({ siteEntry: [{ siteUrl: 'https://x.test/', permissionLevel: 'siteOwner' }] });
  await mod.fetchGscSites();
  fetchCalls.length = 0;
  await mod.fetchGscSites();
  eq(fetchCalls.length, 0);
});

// ============================================================================
// clearPropertyCache
// ============================================================================
await t('clearPropertyCache: removes both GA4 and GSC cache entries', async () => {
  fetchHandler = () => jsonRes({ accountSummaries: [], siteEntry: [] });
  await mod.fetchGa4Properties();
  await mod.fetchGscSites();
  // Both caches written.
  if (!session.has('syte-suite-ga4-props-cache')) throw new Error('ga4 cache not written');
  if (!session.has('syte-suite-gsc-sites-cache')) throw new Error('gsc cache not written');
  mod.clearPropertyCache();
  if (session.has('syte-suite-ga4-props-cache')) throw new Error('ga4 cache not cleared');
  if (session.has('syte-suite-gsc-sites-cache')) throw new Error('gsc cache not cleared');
});

// ============================================================================
// normalizeGa4Id — every classification path
// ============================================================================
await t('normalizeGa4Id: bare numeric ID is OK', () => {
  const r = mod.normalizeGa4Id('123456789');
  eq(r.ok, true);
  eq(r.value, '123456789');
});

await t('normalizeGa4Id: strips properties/ prefix', () => {
  const r = mod.normalizeGa4Id('properties/123456789');
  eq(r.ok, true);
  eq(r.value, '123456789');
});

await t('normalizeGa4Id: rejects G-XXXXXX measurement IDs with helpful message', () => {
  const r = mod.normalizeGa4Id('G-ABC123XYZ');
  eq(r.ok, false);
  eq(r.reason, 'measurement-id');
  if (!/Measurement ID/.test(r.message)) throw new Error('message should explain G- vs property');
});

await t('normalizeGa4Id: rejects UA-… legacy IDs', () => {
  const r = mod.normalizeGa4Id('UA-12345-1');
  eq(r.ok, false);
  eq(r.reason, 'universal-analytics');
});

await t('normalizeGa4Id: rejects non-numeric strings', () => {
  const r = mod.normalizeGa4Id('not-an-id');
  eq(r.ok, false);
  eq(r.reason, 'not-numeric');
});

await t('normalizeGa4Id: empty/null inputs report empty (not crash)', () => {
  eq(mod.normalizeGa4Id(null).ok, false);
  eq(mod.normalizeGa4Id('').ok, false);
  eq(mod.normalizeGa4Id('   ').ok, false);
});

// ============================================================================
// normalizeGscProperty — sc-domain + URL-prefix
// ============================================================================
await t('normalizeGscProperty: sc-domain: bare domain accepted, lowercased', () => {
  const r = mod.normalizeGscProperty('SC-Domain:Example.COM');
  eq(r.ok, true);
  eq(r.value, 'sc-domain:example.com');
});

await t('normalizeGscProperty: sc-domain: with bad shape rejected', () => {
  const r = mod.normalizeGscProperty('sc-domain:not a domain');
  eq(r.ok, false);
  eq(r.reason, 'bad-domain');
});

await t('normalizeGscProperty: URL-prefix gets https:// and trailing /', () => {
  const r = mod.normalizeGscProperty('example.com');
  eq(r.ok, true);
  eq(r.value, 'https://example.com/');
});

await t('normalizeGscProperty: existing https:// preserved, trailing / added', () => {
  const r = mod.normalizeGscProperty('https://example.com');
  eq(r.ok, true);
  eq(r.value, 'https://example.com/');
});

await t('normalizeGscProperty: full path preserved', () => {
  const r = mod.normalizeGscProperty('https://example.com/blog/');
  eq(r.ok, true);
  eq(r.value, 'https://example.com/blog/');
});

await t('normalizeGscProperty: empty input rejected', () => {
  eq(mod.normalizeGscProperty('').ok, false);
  eq(mod.normalizeGscProperty(null).ok, false);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
