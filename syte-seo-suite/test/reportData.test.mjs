// reportData.js contract tests. Drives the monthly report's data layer:
//   • 3 GA4 calls (current + previous month + YoY)
//   • Paginated GSC keyword pull (up to 10k rows)
//   • GSC top-pages query
//   • Classification + bucketing of keywords (head-term, top3, etc.)
//
// Pins:
//   • month1Based is converted to 0-based for Date math
//   • clientType=ecommerce → metrics include transactions+purchaseRevenue
//   • clientType=lead_gen (or unset) → metrics include keyEvents
//   • Missing GA4/GSC config produces graceful errors[] entries, never
//     throws — the report still renders with whatever data is available
//   • MoM and YoY pct changes computed correctly
//   • Keywords carry .change (positive = improved), prevPosition,
//     classification, and are sorted by impressions desc

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/reports/reportData.js'), 'utf8');

// We patch out the auth + GSC + keywordBuckets imports and run the full
// fetchReportData flow with mocked fetch.
globalThis.__ensureToken = async () => ({ access_token: 'TEST' });
globalThis.__querySearchAnalytics = async () => ({ rows: [] });

// Pull the real keywordBuckets module so classify+bucket runs end-to-end.
const KB_SRC = fs.readFileSync(path.join(__dirname, '../src/modules/reports/keywordBuckets.js'), 'utf8');
const kbTmp = path.join(os.tmpdir(), 'kb-' + Date.now() + '.mjs');
fs.writeFileSync(kbTmp, KB_SRC);
const kbMod = await import(kbTmp);
fs.unlinkSync(kbTmp);
globalThis.__buildKeywordBuckets = kbMod.buildKeywordBuckets;
globalThis.__classifyKeywords = kbMod.classifyKeywords;

const PATCHED = SRC
  .replace(
    "import { ensureToken, SCOPES } from '../technical/googleAuth.js';",
    `const SCOPES = { ga4: 'ga4-scope', gsc: 'gsc-scope' };
     const ensureToken = (...a) => globalThis.__ensureToken(...a);`
  )
  .replace(
    "import { querySearchAnalytics } from '../technical/gsc.js';",
    "const querySearchAnalytics = (...a) => globalThis.__querySearchAnalytics(...a);"
  )
  .replace(
    "import { buildKeywordBuckets, classifyKeywords } from './keywordBuckets.js';",
    `const buildKeywordBuckets = (...a) => globalThis.__buildKeywordBuckets(...a);
     const classifyKeywords = (...a) => globalThis.__classifyKeywords(...a);`
  );

const tmp = path.join(os.tmpdir(), 'reportData-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let fetchCalls = [];
let fetchHandler = () => { throw new Error('fetch not configured'); };
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  return fetchHandler(String(url), init);
};

let pass = 0, fail = 0;
async function t(name, fn) {
  fetchCalls = [];
  globalThis.__ensureToken = async () => ({ access_token: 'TEST' });
  globalThis.__querySearchAnalytics = async () => ({ rows: [] });
  fetchHandler = () => ({ ok: true, json: async () => ({ rows: [] }), text: async () => '' });
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function close(actual, expected, tol, label) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error((label || '') + ' expected ~' + expected + ' got ' + actual);
  }
}

// Helper: GA4 response with a single Organic Search row.
function ga4Row(metricVals) {
  return { rows: [{ metricValues: metricVals.map(v => ({ value: String(v) })) }] };
}

// ============================================================================
// Empty-config paths — never throws
// ============================================================================
await t('fetchReportData: client with no GA4 + no GSC returns errors[] with both notes', async () => {
  const r = await mod.fetchReportData({ name: 'X' }, 2026, 5);
  // No throw, both errors recorded.
  if (!r.errors.some(e => /GA4/.test(e))) throw new Error('GA4 error not recorded');
  if (!r.errors.some(e => /GSC/.test(e))) throw new Error('GSC error not recorded');
  // Default empty traffic + keywords.
  eq(r.traffic.current, null);
  eq(r.keywords.length, 0);
  eq(r.topPages.length, 0);
});

await t('fetchReportData: GA4 fetch failure goes into errors[], doesn\'t throw', async () => {
  fetchHandler = () => ({ ok: false, status: 403, text: async () => 'forbidden', json: async () => ({}) });
  const r = await mod.fetchReportData({ ga4_property_id: '123' }, 2026, 5);
  if (!r.errors.some(e => /GA4.*403/.test(e))) throw new Error('GA4 403 not in errors: ' + r.errors.join(' | '));
});

await t('fetchReportData: GSC fetch failure goes into errors[], doesn\'t throw', async () => {
  globalThis.__querySearchAnalytics = async () => { throw new Error('GSC 500'); };
  const r = await mod.fetchReportData({ gsc_property: 'sc-domain:x.test' }, 2026, 5);
  if (!r.errors.some(e => /GSC.*500/.test(e))) throw new Error('GSC error not in errors: ' + r.errors.join(' | '));
});

// ============================================================================
// GA4 metric selection — clientType drives which metrics get requested
// ============================================================================
await t('fetchReportData: ecommerce clientType requests transactions + purchaseRevenue', async () => {
  let metricsSent = null;
  fetchHandler = (url, init) => {
    if (!metricsSent) metricsSent = JSON.parse(init.body).metrics;
    return { ok: true, json: async () => ga4Row([100, 200, 5, 1500]), text: async () => '' };
  };
  await mod.fetchReportData({ ga4_property_id: '123', client_type: 'ecommerce' }, 2026, 5);
  const names = metricsSent.map(m => m.name);
  if (!names.includes('transactions')) throw new Error('ecommerce missing transactions metric');
  if (!names.includes('purchaseRevenue')) throw new Error('ecommerce missing purchaseRevenue');
});

await t('fetchReportData: lead_gen clientType requests keyEvents', async () => {
  let metricsSent = null;
  fetchHandler = (url, init) => {
    if (!metricsSent) metricsSent = JSON.parse(init.body).metrics;
    return { ok: true, json: async () => ga4Row([100, 200, 5]), text: async () => '' };
  };
  await mod.fetchReportData({ ga4_property_id: '123', client_type: 'lead_gen' }, 2026, 5);
  if (!metricsSent.some(m => m.name === 'keyEvents')) throw new Error('lead_gen missing keyEvents');
});

await t('fetchReportData: unset clientType defaults to lead_gen (keyEvents)', async () => {
  let metricsSent = null;
  fetchHandler = (url, init) => {
    if (!metricsSent) metricsSent = JSON.parse(init.body).metrics;
    return { ok: true, json: async () => ga4Row([100, 200, 5]), text: async () => '' };
  };
  await mod.fetchReportData({ ga4_property_id: '123' }, 2026, 5);
  if (!metricsSent.some(m => m.name === 'keyEvents')) throw new Error('unset should default to keyEvents');
});

await t('fetchReportData: GA4 zero-row response returns zeros (not crash)', async () => {
  fetchHandler = () => ({ ok: true, json: async () => ({ rows: [] }), text: async () => '' });
  const r = await mod.fetchReportData({ ga4_property_id: '123' }, 2026, 5);
  eq(r.traffic.current.users, 0);
  eq(r.traffic.current.sessions, 0);
  eq(r.traffic.current.conversions, 0);
});

// ============================================================================
// GA4 — three periods (current, previous, yoy)
// ============================================================================
await t('fetchReportData: makes THREE GA4 fetches in parallel (current, previous, yoy)', async () => {
  fetchHandler = () => ({ ok: true, json: async () => ga4Row([100, 200, 5]), text: async () => '' });
  await mod.fetchReportData({ ga4_property_id: '123' }, 2026, 5);
  // 3 GA4 calls (one per period).
  eq(fetchCalls.length, 3);
});

await t('fetchReportData: traffic.current/previous/yoy populated when all three succeed', async () => {
  let n = 0;
  fetchHandler = () => {
    n++;
    return { ok: true, json: async () => ga4Row([n * 100, n * 200, n]), text: async () => '' };
  };
  const r = await mod.fetchReportData({ ga4_property_id: '123' }, 2026, 5);
  if (!r.traffic.current) throw new Error('current missing');
  if (!r.traffic.previous) throw new Error('previous missing');
  if (!r.traffic.yoy) throw new Error('yoy missing');
});

// ============================================================================
// MoM / YoY changes
// ============================================================================
await t('fetchReportData: momChange computed as (cur - prev) / prev × 100', async () => {
  let n = 0;
  fetchHandler = () => {
    n++;
    // current=120 users, previous=100 users → +20%
    const users = n === 1 ? 120 : (n === 2 ? 100 : 60);
    return { ok: true, json: async () => ga4Row([users, users * 2, users / 10]), text: async () => '' };
  };
  const r = await mod.fetchReportData({ ga4_property_id: '123' }, 2026, 5);
  close(r.traffic.momChange.users, 20, 0.1);
});

await t('fetchReportData: pctChange returns 100 when previous is 0 and current > 0', async () => {
  let n = 0;
  fetchHandler = () => {
    n++;
    // current=50, previous=0, yoy=0
    const users = n === 1 ? 50 : 0;
    return { ok: true, json: async () => ga4Row([users, users, users]), text: async () => '' };
  };
  const r = await mod.fetchReportData({ ga4_property_id: '123' }, 2026, 5);
  eq(r.traffic.momChange.users, 100, 'previous=0 + current>0 → 100% growth');
});

// ============================================================================
// GSC keyword pull — pagination + change calculation
// ============================================================================
// fetchReportData fires 3 GSC calls in parallel (current keywords, previous
// keywords, top pages). Distinguish them by the startDate's month rather
// than a call counter — Promise.all order isn't deterministic.
function makeGscMock({ currentRows = [], prevRows = [], pageRows = [] } = {}) {
  // querySearchAnalytics is called as (siteUrl, options). Second arg has
  // the dateRange + dimensions we need to route on.
  return async (siteUrl, { startDate, dimensions }) => {
    if (dimensions.includes('page')) return { rows: pageRows };
    const month = (startDate || '').slice(0, 7);
    if (month === '2026-05') return { rows: currentRows };
    if (month === '2026-04') return { rows: prevRows };
    return { rows: [] };
  };
}

await t('fetchReportData: keywords carry change = prevPosition - position (positive = improved)', async () => {
  globalThis.__querySearchAnalytics = makeGscMock({
    currentRows: [{ keys: ['kw1'], position: 5, clicks: 10, impressions: 100, ctr: 0.1 }],
    prevRows:    [{ keys: ['kw1'], position: 8, clicks: 5,  impressions: 50,  ctr: 0.1 }]
  });
  const r = await mod.fetchReportData({ gsc_property: 'sc-domain:x.test' }, 2026, 5);
  const kw = r.keywords.find(k => k.query === 'kw1');
  if (!kw) throw new Error('kw1 missing from results');
  eq(kw.position, 5);
  eq(kw.prevPosition, 8);
  eq(kw.change, 3, 'positive = improved');
});

await t('fetchReportData: keywords with no previous match get change=null + prevPosition=null', async () => {
  globalThis.__querySearchAnalytics = makeGscMock({
    currentRows: [{ keys: ['new_kw'], position: 12, clicks: 1, impressions: 50, ctr: 0.02 }]
  });
  const r = await mod.fetchReportData({ gsc_property: 'x' }, 2026, 5);
  const kw = r.keywords.find(k => k.query === 'new_kw');
  eq(kw.prevPosition, null);
  eq(kw.change, null, 'no prev = null change (rendered as "new" in the report)');
});

await t('fetchReportData: keywords sorted by impressions DESC', async () => {
  globalThis.__querySearchAnalytics = makeGscMock({
    currentRows: [
      { keys: ['low'],  position: 5, clicks: 1,  impressions: 50,   ctr: 0.02 },
      { keys: ['high'], position: 5, clicks: 50, impressions: 5000, ctr: 0.01 },
      { keys: ['mid'],  position: 5, clicks: 10, impressions: 500,  ctr: 0.02 }
    ]
  });
  const r = await mod.fetchReportData({ gsc_property: 'x' }, 2026, 5);
  eq(r.keywords[0].query, 'high');
  eq(r.keywords[2].query, 'low');
});

// ============================================================================
// keywordBuckets present + classified
// ============================================================================
await t('fetchReportData: result includes classified keywords + keywordBuckets', async () => {
  globalThis.__querySearchAnalytics = makeGscMock({
    currentRows: [{ keys: ['industrial racking'], position: 4, clicks: 30, impressions: 800, ctr: 0.04 }]
  });
  const r = await mod.fetchReportData({ name: 'Acme', gsc_property: 'x' }, 2026, 5);
  if (!r.keywordBuckets) throw new Error('keywordBuckets missing');
  const kw = r.keywords.find(k => k.query === 'industrial racking');
  if (!kw.classification) throw new Error('classification missing');
});

// ============================================================================
// Period math — verify month1Based → 0-based conversion
// ============================================================================
await t('fetchReportData: month1Based=1 (January) handles year wraparound for previous', async () => {
  // January 2026 — previous = Dec 2025.
  let bodies = [];
  fetchHandler = (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ga4Row([1, 1, 1]), text: async () => '' };
  };
  await mod.fetchReportData({ ga4_property_id: '123' }, 2026, 1);
  // Three calls — current (Jan 2026), previous (Dec 2025), yoy (Jan 2025).
  // dateRanges has a single entry per call.
  const dates = bodies.map(b => b.dateRanges[0]);
  if (!dates.some(d => d.startDate.startsWith('2026-01'))) throw new Error('current Jan 2026 missing');
  if (!dates.some(d => d.startDate.startsWith('2025-12'))) throw new Error('previous Dec 2025 missing');
  if (!dates.some(d => d.startDate.startsWith('2025-01'))) throw new Error('yoy Jan 2025 missing');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
