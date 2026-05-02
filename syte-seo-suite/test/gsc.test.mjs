// gsc.js contract tests — Search Console client used by Technical SEO,
// Reports, and AEO Engine.
//
// Pins:
//   • Authorization header carries the ensureToken bearer
//   • POST /searchAnalytics/query body has startDate/endDate/dimensions/rowLimit
//   • 403 "has not been used in project" → apiDisabled=true error (so the
//     picker can show the "Enable Search Console API" link)
//   • 403 "does not have sufficient permission" → permissionDenied=true
//     error with the property URL extracted (so the picker can tell the
//     user *which* property to add their account to)
//   • topQueriesByImpression sorts by impressions desc
//   • topPagesWithQueries returns flat (page, query) rows
//
// Run: npm test  (from syte-seo-suite/)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/technical/gsc.js'), 'utf8');

// Stub the auth module — we want gsc.js's logic to run, not Google's OAuth.
globalThis.__mockToken = { access_token: 'TEST_BEARER' };
const PATCHED = SRC.replace(
  "import { ensureToken, SCOPES } from './googleAuth.js';",
  `const SCOPES = { gsc: 'https://www.googleapis.com/auth/webmasters.readonly' };
   const ensureToken = async () => globalThis.__mockToken;`
);

const tmp = path.join(os.tmpdir(), 'gsc-' + Date.now() + '.mjs');
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
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj)
  };
}
function errRes(status, body) {
  return { ok: false, status, json: async () => ({}), text: async () => body };
}

let pass = 0, fail = 0;
async function t(name, fn) {
  fetchCalls = [];
  globalThis.__mockToken = { access_token: 'TEST_BEARER' };
  fetchHandler = () => { throw new Error('fetch not configured for ' + name); };
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function match(s, re, label) {
  if (!re.test(s || '')) throw new Error((label || '') + ' "' + s + '" did not match ' + re);
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
// listSites
// ============================================================================
await t('listSites: GETs /webmasters/v3/sites with bearer auth', async () => {
  fetchHandler = () => jsonRes({ siteEntry: [{ siteUrl: 'https://x.test/', permissionLevel: 'siteOwner' }] });
  const data = await mod.listSites();
  eq(fetchCalls.length, 1);
  match(fetchCalls[0].url, /\/webmasters\/v3\/sites$/);
  eq(fetchCalls[0].init.headers.Authorization, 'Bearer TEST_BEARER');
  eq(data.siteEntry[0].siteUrl, 'https://x.test/');
});

await t('listSites: 403 "has not been used" surfaces apiDisabled error', async () => {
  fetchHandler = () => errRes(403, 'Search Console API has not been used in project 12345 before or it is disabled.');
  const err = await expectThrow(() => mod.listSites(), /Search Console API is not enabled/i);
  eq(err.apiDisabled, true, 'flag set so the picker can show the "Enable" link');
});

await t('listSites: 403 "does not have sufficient permission" surfaces permissionDenied with property URL', async () => {
  fetchHandler = () => errRes(403, "User does not have sufficient permission for site 'sc-domain:fleetwood.test'.");
  const err = await expectThrow(() => mod.listSites(), /No GSC access to sc-domain:fleetwood\.test/);
  eq(err.permissionDenied, true);
});

await t('listSites: other 4xx surfaces generic GSC error with status + body slice', async () => {
  fetchHandler = () => errRes(401, 'Invalid Credentials');
  await expectThrow(() => mod.listSites(), /GSC 401.*Invalid Credentials/);
});

// ============================================================================
// querySearchAnalytics
// ============================================================================
await t('querySearchAnalytics: POSTs to /searchAnalytics/query with derived dates', async () => {
  fetchHandler = () => jsonRes({ rows: [] });
  await mod.querySearchAnalytics('https://x.test/', { days: 28, dimensions: ['query'], rowLimit: 100 });
  eq(fetchCalls.length, 1);
  const call = fetchCalls[0];
  eq(call.init.method, 'POST');
  match(call.url, /\/searchAnalytics\/query$/);
  match(call.url, /https%3A%2F%2Fx\.test%2F/, 'siteUrl encoded into path');
  const body = JSON.parse(call.init.body);
  eq(body.dimensions[0], 'query');
  eq(body.rowLimit, 100);
  // Default startRow is 0 — important for pagination flows.
  eq(body.startRow, 0);
  // Dates are YYYY-MM-DD, derived from `days`.
  match(body.startDate, /^\d{4}-\d{2}-\d{2}$/);
  match(body.endDate, /^\d{4}-\d{2}-\d{2}$/);
});

await t('querySearchAnalytics: explicit startDate/endDate override `days`', async () => {
  fetchHandler = () => jsonRes({ rows: [] });
  await mod.querySearchAnalytics('https://x.test/', {
    startDate: '2026-01-01', endDate: '2026-01-31', dimensions: ['page']
  });
  const body = JSON.parse(fetchCalls[0].init.body);
  eq(body.startDate, '2026-01-01');
  eq(body.endDate, '2026-01-31');
});

await t('querySearchAnalytics: passes startRow for pagination', async () => {
  fetchHandler = () => jsonRes({ rows: [] });
  await mod.querySearchAnalytics('https://x.test/', { startRow: 1000, dimensions: ['query'] });
  const body = JSON.parse(fetchCalls[0].init.body);
  eq(body.startRow, 1000);
});

// ============================================================================
// topQueriesByImpression — sort + shape contract
// ============================================================================
await t('topQueriesByImpression: returns rows sorted by impressions DESC', async () => {
  fetchHandler = () => jsonRes({
    rows: [
      { keys: ['low'], clicks: 1, impressions: 100, ctr: 0.01, position: 5 },
      { keys: ['high'], clicks: 50, impressions: 9000, ctr: 0.06, position: 2 },
      { keys: ['mid'], clicks: 10, impressions: 500, ctr: 0.02, position: 8 }
    ]
  });
  const out = await mod.topQueriesByImpression('https://x.test/', 30);
  eq(out.length, 3);
  eq(out[0].query, 'high', 'highest impressions first');
  eq(out[2].query, 'low', 'lowest last');
  // Shape preserved.
  eq(out[0].clicks, 50);
  eq(out[0].impressions, 9000);
  eq(out[0].position, 2);
});

await t('topQueriesByImpression: handles missing rows gracefully', async () => {
  fetchHandler = () => jsonRes({});
  const out = await mod.topQueriesByImpression('https://x.test/');
  eq(out.length, 0);
});

await t('topQueriesByImpression: defaults missing metrics to 0 (not undefined/NaN)', async () => {
  fetchHandler = () => jsonRes({ rows: [{ keys: ['q'] }] });
  const out = await mod.topQueriesByImpression('https://x.test/');
  eq(out[0].clicks, 0);
  eq(out[0].impressions, 0);
  eq(out[0].ctr, 0);
  eq(out[0].position, 0);
});

// ============================================================================
// topPagesWithQueries — flat (page, query) rows
// ============================================================================
await t('topPagesWithQueries: requests dimensions=[page,query] and rowLimit 2500', async () => {
  fetchHandler = () => jsonRes({ rows: [] });
  await mod.topPagesWithQueries('https://x.test/', 60);
  const body = JSON.parse(fetchCalls[0].init.body);
  eq(body.dimensions[0], 'page');
  eq(body.dimensions[1], 'query');
  eq(body.rowLimit, 2500);
});

await t('topPagesWithQueries: maps GSC keys to {page, query, ...metrics}', async () => {
  fetchHandler = () => jsonRes({
    rows: [
      { keys: ['https://x.test/about', 'about us'], clicks: 5, impressions: 50, ctr: 0.1, position: 4.2 }
    ]
  });
  const out = await mod.topPagesWithQueries('https://x.test/');
  eq(out[0].page, 'https://x.test/about');
  eq(out[0].query, 'about us');
  eq(out[0].clicks, 5);
  eq(out[0].position, 4.2);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
