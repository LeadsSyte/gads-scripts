// Pipeline / readiness invariants. The class of bug we hit when WebCEO
// was replaced by the in-house crawler — pipelineStatus and
// clientReadiness still required wceo_project_id, so a fully-configured
// crawler client got bucketed as "credentials-missing" and the Run Scan
// action button was hidden.
//
// Strategy: for every plausible client shape, assert
//   1. pipelineStatus returns one of the known section keys
//   2. when bucketed as "credentials-missing", the readiness check agrees
//   3. the action button condition (encoded by the module) actually
//      renders the action when the client is in a ready bucket
//
// Run: npm test  (from syte-seo-suite/)

import {
  contentPipelineStatus,
  technicalPipelineStatus,
  aeoPipelineStatus
} from '../src/lib/pipelineStatus.js';
import { readinessFor } from '../src/lib/clientReadiness.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertOneOf(actual, options, label) {
  if (!options.includes(actual)) {
    throw new Error((label || '') + ' expected one of ' + JSON.stringify(options) + ' got ' + JSON.stringify(actual));
  }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

// Realistic client fixtures. Each represents a config we have actually
// seen in production — the rows in Supabase look like these.
const C_EMPTY              = { id: '1', name: '' };
const C_NAME_ONLY          = { id: '2', name: 'Name Only' };
const C_URL_ONLY           = { id: '3', name: 'URL Only', url: 'https://urlonly.test/' };
const C_CRAWLER_READY      = { id: '4', name: 'Crawler', url: 'https://crawler.test/', sitemap_url: 'https://crawler.test/sitemap.xml' };
const C_GSC_ONLY           = { id: '5', name: 'GSC Only', url: 'https://gsc.test/', gsc_property: 'sc-domain:gsc.test' };
const C_GA4_ONLY           = { id: '6', name: 'GA4 Only', url: 'https://ga4.test/', ga4_property_id: '123' };
const C_FULL_CONTENT       = { id: '7', name: 'Full Content',
  url: 'https://full.test/', industry: 'Hospitality', location: 'Cape Town',
  voice: 'Editorial', audience: 'Travellers', context: 'A boutique hotel',
  author: 'Mike', gsc_property: 'sc-domain:full.test' };
const C_FULL_AEO           = { id: '8', name: 'Full AEO',
  url: 'https://aeo.test/', industry: 'Hospitality', location: 'Cape Town',
  aeo_probe_queries: 'best hotels in Cape Town', competitors: 'OneAndOnly',
  sitemap_url: 'https://aeo.test/sitemap.xml' };

const ALL_CLIENTS = [C_EMPTY, C_NAME_ONLY, C_URL_ONLY, C_CRAWLER_READY, C_GSC_ONLY, C_GA4_ONLY, C_FULL_CONTENT, C_FULL_AEO];

const TECH_SECTIONS    = ['verified-on-site', 'fixes-generated', 'not-scanned', 'credentials-missing'];
const CONTENT_SECTIONS = ['verified-on-site', 'articles-written', 'no-articles', 'credentials-missing'];
const AEO_SECTIONS     = ['verified-on-site', 'optimizations-generated', 'not-run', 'credentials-missing'];

// =========================================================================
// Sectioning is total — every client lands in exactly one bucket.
// =========================================================================
await t('technical: every client config lands in a known bucket', async () => {
  for (const c of ALL_CLIENTS) {
    const r = technicalPipelineStatus(c, [], [], '2026-05');
    assertOneOf(r.section, TECH_SECTIONS, c.name);
  }
});
await t('content: every client config lands in a known bucket', async () => {
  for (const c of ALL_CLIENTS) {
    const r = contentPipelineStatus(c, [], '2026-05', []);
    assertOneOf(r.section, CONTENT_SECTIONS, c.name);
  }
});
await t('aeo: every client config lands in a known bucket', async () => {
  for (const c of ALL_CLIENTS) {
    const r = aeoPipelineStatus(c, [], {}, '2026-05', []);
    assertOneOf(r.section, AEO_SECTIONS, c.name);
  }
});

// =========================================================================
// Regression for the bug we just fixed: a crawler-only client (URL +
// sitemap, no WebCEO, no GSC) MUST NOT be bucketed as credentials-missing.
// =========================================================================
await t('technical: crawler-only client (url + sitemap) is scannable, not "credentials-missing"', async () => {
  const r = technicalPipelineStatus(C_CRAWLER_READY, [], [], '2026-05');
  if (r.section === 'credentials-missing') {
    throw new Error('Crawler-only client wrongly bucketed as credentials-missing — the Run Scan button is hidden when this happens. detail=' + r.detail);
  }
  assertEq(r.section, 'not-scanned', 'fresh crawler client');
});

await t('technical: URL-only client (no sitemap, no GSC) is still scannable', async () => {
  // The crawler falls back to discovering links from the homepage, so url
  // alone is enough to run a scan. Used to be wrongly blocked.
  const r = technicalPipelineStatus(C_URL_ONLY, [], [], '2026-05');
  if (r.section === 'credentials-missing') {
    throw new Error('URL-only client wrongly bucketed as credentials-missing. detail=' + r.detail);
  }
});

await t('technical: GSC-only client (no url, no sitemap) is also scannable', async () => {
  const c = { id: 'g', name: 'gsc only', gsc_property: 'sc-domain:x.test' };
  const r = technicalPipelineStatus(c, [], [], '2026-05');
  assertOneOf(r.section, ['not-scanned', 'fixes-generated', 'verified-on-site'], 'gsc-only');
});

await t('technical: completely empty client IS credentials-missing', async () => {
  const r = technicalPipelineStatus(C_EMPTY, [], [], '2026-05');
  assertEq(r.section, 'credentials-missing', 'empty client');
});

// =========================================================================
// Same client, run through readinessFor — must agree with pipelineStatus.
// If pipelineStatus says "credentials-missing", readiness must show missing
// fields (else we contradict ourselves and the user sees an empty card).
// =========================================================================
await t('readiness vs pipeline agreement: technical', async () => {
  for (const c of ALL_CLIENTS) {
    const status = technicalPipelineStatus(c, [], [], '2026-05');
    const readiness = readinessFor(c, 'technical');
    if (status.section === 'credentials-missing' && readiness.status === 'ready') {
      throw new Error(c.name + ': pipeline says credentials-missing but readiness says ready — these must agree');
    }
  }
});

await t('readiness: technical no longer demands deprecated wceo_project_id', async () => {
  // Direct regression: clientReadiness used to push a "WebCEO Project ID
  // or GSC Property" entry into missing[] for any client without those
  // fields. The crawler-first migration left this dangling.
  const r = readinessFor(C_CRAWLER_READY, 'technical');
  const stillAsksForWebceo = r.missing.some(m => /WebCEO/i.test(m.label));
  if (stillAsksForWebceo) {
    throw new Error('readinessFor still lists WebCEO as a missing field — clients with a URL+sitemap should be ready');
  }
});

await t('readiness: full content client is "ready" for content service', async () => {
  const r = readinessFor(C_FULL_CONTENT, 'content');
  assertEq(r.status, 'ready', 'full content client');
});

await t('readiness: full AEO client is "ready" for aeo service', async () => {
  const r = readinessFor(C_FULL_AEO, 'aeo');
  assertEq(r.status, 'ready', 'full AEO client');
});

// =========================================================================
// AEO needs a page source. URL-only is NOT enough (no sitemap, no GA4
// → nothing to optimize). Lock in the contract.
// =========================================================================
await t('aeo: URL-only client is credentials-missing (no page source)', async () => {
  const r = aeoPipelineStatus(C_URL_ONLY, [], {}, '2026-05', []);
  assertEq(r.section, 'credentials-missing', 'aeo URL-only');
});

await t('aeo: client with sitemap is NOT credentials-missing', async () => {
  const r = aeoPipelineStatus(C_CRAWLER_READY, [], {}, '2026-05', []);
  if (r.section === 'credentials-missing') throw new Error('client with sitemap should be runnable');
});

await t('aeo: client with GA4 is NOT credentials-missing', async () => {
  const r = aeoPipelineStatus(C_GA4_ONLY, [], {}, '2026-05', []);
  if (r.section === 'credentials-missing') throw new Error('client with GA4 should be runnable');
});

// =========================================================================
// Content needs GSC + the full content readiness fields.
// =========================================================================
await t('content: full content client gets out of credentials-missing', async () => {
  const r = contentPipelineStatus(C_FULL_CONTENT, [], '2026-05', []);
  assertOneOf(r.section, ['no-articles', 'articles-written', 'verified-on-site'], 'full content');
});

await t('content: zero-readiness client (no GSC, no brand fields) is credentials-missing', async () => {
  const c = { id: 'c', name: '' };
  const r = contentPipelineStatus(c, [], '2026-05', []);
  assertEq(r.section, 'credentials-missing', 'content empty client');
});

await t('content: client without GSC is credentials-missing regardless of brand fields', async () => {
  const c = { ...C_FULL_CONTENT, gsc_property: '' };
  const r = contentPipelineStatus(c, [], '2026-05', []);
  assertEq(r.section, 'credentials-missing', 'content no GSC');
});

// =========================================================================
// REGRESSION — content pipeline detail message must use the actual
// written count, not pages_per_month. Prevents the "3 written · All 2
// articles written…" mismatch that surfaced in the Articles Written
// section when more than the quota had been generated.
// =========================================================================
await t('content: detail uses actual written count (not pages_per_month)', async () => {
  // Quota = 2, but 3 articles exist for this month.
  const c = { ...C_FULL_CONTENT, pages_per_month: 2 };
  const month = '2026-05';
  const history = [
    { client_id: c.id, generated_at: month + '-01T00:00:00Z' },
    { client_id: c.id, generated_at: month + '-02T00:00:00Z' },
    { client_id: c.id, generated_at: month + '-03T00:00:00Z' }
  ];
  const r = contentPipelineStatus(c, [], month, history);
  assertEq(r.section, 'articles-written');
  // Summary uses the actual written count (3).
  if (!/3 written/.test(r.summary)) throw new Error('summary should report 3 written: ' + r.summary);
  // Detail must NOT say "All 2 articles written" (the old bug). It should
  // say "All 3 articles written" since 3 actually exist.
  if (/All 2 articles written/.test(r.detail)) {
    throw new Error('REGRESSION: detail still uses pages_per_month: ' + r.detail);
  }
  if (!/All 3 articles written/.test(r.detail)) {
    throw new Error('detail should say "All 3 articles written": ' + r.detail);
  }
});

await t('content: verified detail also uses actual written count', async () => {
  const c = { ...C_FULL_CONTENT, id: 'cwx', pages_per_month: 2 };
  const month = '2026-05';
  const history = [
    { client_id: 'cwx', generated_at: month + '-01T00:00:00Z' },
    { client_id: 'cwx', generated_at: month + '-02T00:00:00Z' },
    { client_id: 'cwx', generated_at: month + '-03T00:00:00Z' }
  ];
  const impls = [
    { client_id: 'cwx', module: 'content', verification_status: 'verified',
      title: 'A', implemented_at: month + '-04T00:00:00Z' }
  ];
  const r = contentPipelineStatus(c, impls, month, history);
  // 1 of 3 verified — message should reflect 3, not 2.
  if (!/of 3/.test(r.detail)) throw new Error('verified detail should reference 3 (the written count): ' + r.detail);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
