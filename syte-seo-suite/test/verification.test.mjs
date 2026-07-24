// End-to-end verifier tests for src/lib/verification.js. Imports the real
// module source with its external imports (corsFetchText, claudeComplete,
// updateImplementation, listSites) rewritten to mocks, so every line of
// the verifier executes against realistic response fixtures — Yoast
// sitemap XML, robots.txt, GSC siteEntry schema, GA4/GTM HTML.
//
// Run: npm test  (from syte-seo-suite/)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERIF_SRC = fs.readFileSync(path.join(__dirname, '../src/lib/verification.js'), 'utf8');

// -------- Fixtures (real shapes from the actual services) --------

const FIXTURE_SITEMAP_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://fleetwoodonsea.co.za/page-sitemap.xml</loc><lastmod>2026-04-25T08:00:00+00:00</lastmod></sitemap>
  <sitemap><loc>https://fleetwoodonsea.co.za/post-sitemap.xml</loc></sitemap>
</sitemapindex>`;

// Worst-case Jina output — XML structure stripped to readable text. Our
// raw:true bypass means we never see this in production; tested here to
// confirm the bypass is what makes the verified case work.
const FIXTURE_SITEMAP_VIA_JINA = `Sitemap Index

This is the sitemap for fleetwoodonsea.co.za. Last updated 2026-04-25.

* https://fleetwoodonsea.co.za/page-sitemap.xml
* https://fleetwoodonsea.co.za/post-sitemap.xml
`;

const FIXTURE_ROBOTS = `User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
Sitemap: https://fleetwoodonsea.co.za/sitemap_index.xml
`;

// GSC sites.list response per Google's documented schema.
const FIXTURE_GSC_VERIFIED = {
  siteEntry: [
    { siteUrl: 'sc-domain:fleetwoodonsea.co.za', permissionLevel: 'siteOwner' },
    { siteUrl: 'https://otherclient.com/', permissionLevel: 'siteFullUser' }
  ]
};
const FIXTURE_GSC_UNVERIFIED = {
  siteEntry: [{ siteUrl: 'sc-domain:fleetwoodonsea.co.za', permissionLevel: 'siteUnverifiedUser' }]
};
const FIXTURE_GSC_MISSING = { siteEntry: [] };

const FIXTURE_PAGE_WITH_GA4 = `<!DOCTYPE html><html><head>
<title>Fleetwood on Sea</title>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XYZ12345AB"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-XYZ12345AB');</script>
</head><body><h1>Welcome</h1></body></html>`;

const FIXTURE_PAGE_WITH_GTM = `<!DOCTYPE html><html><head>
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-WXYZ123');</script>
</head><body></body></html>`;

const FIXTURE_PAGE_NO_TAGS = `<!DOCTYPE html><html><head><title>Plain page</title></head><body><h1>Nothing here</h1><p>No tracking installed.</p></body></html>`;

// -------- Mocks --------

let mockResponses = new Map();

globalThis.fetch = async (url, init) => {
  for (const [pattern, resp] of mockResponses) {
    if (typeof pattern === 'string' && String(url) === pattern) return resp();
    if (pattern instanceof RegExp && pattern.test(String(url))) return resp();
  }
  throw new Error('no mock for ' + url);
};
function jsonRes(obj, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) };
}

globalThis.__updates = [];
globalThis.__mockCorsFetchText = async () => { throw new Error('cors not mocked'); };
globalThis.__mockClaude        = async () => { throw new Error('claude not mocked'); };
globalThis.__mockListSites     = async () => { throw new Error('listSites not mocked'); };

// Rewrite verification.js imports to read from globalThis stubs, then
// dynamic-import the patched copy from a temp file.
const PATCHED = VERIF_SRC
  .replace("import { corsFetchText } from './corsProxy.js';",
           "const corsFetchText = (url) => globalThis.__mockCorsFetchText(url);")
  .replace("import { claudeComplete } from './anthropic.js';",
           "const claudeComplete = (...a) => globalThis.__mockClaude(...a);")
  .replace("import { updateImplementation } from './supabase.js';",
           "const updateImplementation = async (id, patch) => { globalThis.__updates.push({ id, patch }); return { id, ...patch }; };")
  .replace("import { listSites } from '../modules/technical/gsc.js';",
           "const listSites = () => globalThis.__mockListSites();");

const tmpFile = path.join(os.tmpdir(), 'verification-patched-' + Date.now() + '.mjs');
fs.writeFileSync(tmpFile, PATCHED);
const verif = await import(tmpFile);
fs.unlinkSync(tmpFile);

// -------- Runner --------

let pass = 0, fail = 0;
async function t(name, fn) {
  globalThis.__updates = [];
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(actual, expected, label) {
  if (actual !== expected) throw new Error((label || '') + ' expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
}
function assertMatch(actual, regex, label) {
  if (!regex.test(actual)) throw new Error((label || '') + ' "' + actual + '" did not match ' + regex);
}

// =================== ON-PAGE PATH (existing Claude HTML check) ===================

await t('on-page: head-only HTML from page-proxy is rejected (Krost case)', async () => {
  // Simulates Jina returning <head> + inline CSS only — what happens on
  // some Elementor pages. Page-proxy used to accept this and feed it to
  // Claude, producing the misleading "body content not included" error.
  const headOnly = '<!DOCTYPE html><html><head><title>Krost</title>' +
    '<style>body{margin:0}.elementor-1234{padding:20px}'.padEnd(900, ' /* css */') + '</style></head><body></body></html>';
  let proxyCalls = 0, corsCalls = 0;
  mockResponses = new Map([[/page-proxy/, () => { proxyCalls++; return jsonRes({ status: 200, html: headOnly, source: 'jina-reader' }); }]]);
  globalThis.__mockCorsFetchText = async () => { corsCalls++; throw new Error('cors blocked'); };
  const r = await verif.verifyImplementation(
    { id: 'krost', module: 'aeo', change_type: 'aeo_optimization',
      title: 'Add answer block', description: 'Krost Shelving is SA leading...',
      page_url: 'https://krostshelving.com/' },
    { url: 'https://krostshelving.com/' }
  );
  assertEq(r.status, 'failed');
  assertMatch(r.detail, /Could not fetch/);
  if (proxyCalls < 1) throw new Error('page-proxy should have been called');
  if (corsCalls < 1) throw new Error('should have fallen through to cors after head-only response');
});

await t('on-page: full Elementor body passes the useful-body check', async () => {
  const fullPage = '<!DOCTYPE html><html><head><title>Krost</title></head><body>' +
    '<div class="elementor-widget"><p class="answer-block">For over 60 years, Krost Shelving & Racking has specialised in designing, manufacturing, and installing racking, shelving, mezzanine floors, and custom storage solutions. From retail stockrooms to large distribution centres, we deliver high-performance systems that maximise space and efficiency, serving more than 20 industries across Africa.</p></div>' +
    '</body></html>';
  mockResponses = new Map([[/page-proxy/, () => jsonRes({ status: 200, html: fullPage, source: 'direct' })]]);
  globalThis.__mockClaude = async () => '{"implemented": true, "confidence": "high", "evidence": "Answer block paragraph found.", "suggestion": ""}';
  const r = await verif.verifyImplementation(
    { id: 'krost-ok', module: 'aeo', change_type: 'aeo_optimization',
      title: 'Add answer block', description: 'For over 60 years',
      page_url: 'https://krostshelving.com/' },
    { url: 'https://krostshelving.com/' }
  );
  assertEq(r.status, 'verified');
  assertMatch(r.detail, /Answer block paragraph found/);
});

await t('on-page: HTML verification — Claude says implemented', async () => {
  const html = '<html><head><title>Buy Widget — ExampleCo</title>' +
    '<meta name="description" content="The best widget for all your needs, hand-built and shipped same day from our local warehouse."></head>' +
    '<body><h1>Buy Widget</h1><p>The best widget you can buy. Hand-built and shipped same day from our warehouse. Ships worldwide.</p></body></html>';
  mockResponses = new Map([[/page-proxy/, () => jsonRes({ status: 200, html, source: 'jina-reader' })]]);
  globalThis.__mockClaude = async () => '{"implemented": true, "confidence": "high", "evidence": "Title and meta found.", "suggestion": ""}';
  const r = await verif.verifyImplementation(
    { id: '1', module: 'technical', change_type: 'meta_title', title: 'Update meta', page_url: 'https://example.com/widget', description: 'Buy Widget' },
    { id: 'c1', name: 'X', url: 'https://example.com' }
  );
  assertEq(r.status, 'verified');
  assertMatch(r.detail, /Title and meta found/);
});

await t('on-page: HTML verification — Claude says not implemented', async () => {
  const html = '<html><head><title>Old page</title></head><body><h1>Welcome</h1>' +
    '<p>This is the old version of the page that has not yet been updated. It contains the previous copy that was published last quarter.</p></body></html>';
  mockResponses = new Map([[/page-proxy/, () => jsonRes({ status: 200, html, source: 'direct' })]]);
  globalThis.__mockClaude = async () => '{"implemented": false, "confidence": "high", "evidence": "Meta description not present.", "suggestion": "Add it"}';
  const r = await verif.verifyImplementation(
    { id: '2', change_type: 'meta_description', title: 'Add meta', page_url: 'https://example.com/p' },
    { url: 'https://example.com' }
  );
  assertEq(r.status, 'failed');
  assertMatch(r.detail, /Meta description not present/);
});

await t('on-page: page fetch fails everywhere', async () => {
  mockResponses = new Map([[/page-proxy/, () => jsonRes({ error: 'fail' }, 502)]]);
  globalThis.__mockCorsFetchText = async () => { throw new Error('cors blocked'); };
  const r = await verif.verifyImplementation(
    { id: '3', change_type: 'article', title: 'Article', page_url: 'https://example.com/blog/x' },
    { url: 'https://example.com' }
  );
  assertEq(r.status, 'failed');
  assertMatch(r.detail, /Could not fetch/);
});

await t('on-page: Claude returns junk JSON', async () => {
  const html = '<html><head><title>Page</title></head><body><h1>Heading One</h1>' +
    '<p>Some real body content goes here so the useful-body check passes — at least sixty characters of visible text is required.</p></body></html>';
  mockResponses = new Map([[/page-proxy/, () => jsonRes({ status: 200, html, source: 'direct' })]]);
  globalThis.__mockClaude = async () => 'not json at all';
  const r = await verif.verifyImplementation(
    { id: '4', change_type: 'h1', title: 'fix h1', page_url: 'https://example.com/' },
    { url: 'https://example.com' }
  );
  assertEq(r.status, 'failed');
  assertMatch(r.detail, /Could not parse/);
});

// =================== OFF-PAGE: SITEMAP ===================

await t('off-page sitemap: live raw XML at /sitemap_index.xml', async () => {
  globalThis.__mockCorsFetchText = async (url) => {
    if (url.endsWith('/sitemap.xml'))       return '<html>404</html>';
    if (url.endsWith('/sitemap_index.xml')) return FIXTURE_SITEMAP_INDEX;
    throw new Error('unexpected url ' + url);
  };
  const r = await verif.verifyImplementation(
    { id: 's1', change_type: 'sitemap_submission', title: 'Submit sitemap',
      description: 'submit XML sitemap to Search Console',
      page_url: 'https://search.google.com/search-console' },
    { url: 'https://fleetwoodonsea.co.za/' }
  );
  assertEq(r.status, 'verified');
  assertMatch(r.detail, /sitemap_index\.xml/);
  assertMatch(r.detail, /Off-page check/);
});

await t('off-page sitemap: only Jina-rendered text reachable -> failed', async () => {
  globalThis.__mockCorsFetchText = async () => FIXTURE_SITEMAP_VIA_JINA;
  const r = await verif.verifyImplementation(
    { id: 's2', change_type: 'other', title: '', description: 'submit XML sitemap',
      page_url: 'https://fleetwoodonsea.co.za/' },
    { url: 'https://fleetwoodonsea.co.za/' }
  );
  assertEq(r.status, 'failed');
});

await t('off-page sitemap: every probe URL 404', async () => {
  globalThis.__mockCorsFetchText = async () => { throw new Error('404'); };
  const r = await verif.verifyImplementation(
    { id: 's3', change_type: 'sitemap', title: 'Create sitemap', description: '',
      page_url: 'https://example.com/' },
    { url: 'https://example.com/' }
  );
  assertEq(r.status, 'failed');
  assertMatch(r.detail, /No valid XML sitemap reachable/);
});

await t('off-page sitemap: no client domain available -> manual_required', async () => {
  globalThis.__mockCorsFetchText = async () => { throw new Error('unreachable'); };
  const r = await verif.verifyImplementation(
    { id: 's4', change_type: 'sitemap', title: 'submit sitemap', description: '',
      page_url: 'https://search.google.com/search-console' },
    { url: '' }
  );
  assertEq(r.status, 'manual_required');
  assertMatch(r.detail, /No client domain configured/);
});

// =================== OFF-PAGE: ROBOTS ===================

await t('off-page robots: live robots.txt with Sitemap directive', async () => {
  globalThis.__mockCorsFetchText = async (url) => {
    if (url.endsWith('/robots.txt')) return FIXTURE_ROBOTS;
    throw new Error('not found');
  };
  const r = await verif.verifyImplementation(
    { id: 'r1', change_type: 'robots', title: 'Update robots', description: '',
      page_url: 'https://fleetwoodonsea.co.za/robots.txt' },
    { url: 'https://fleetwoodonsea.co.za/' }
  );
  assertEq(r.status, 'verified');
  assertMatch(r.detail, /references a Sitemap directive/);
});

await t('off-page robots: live robots.txt without Sitemap directive', async () => {
  globalThis.__mockCorsFetchText = async (url) => {
    if (url.endsWith('/robots.txt')) return 'User-agent: *\nDisallow: /admin\n';
    throw new Error('nope');
  };
  const r = await verif.verifyImplementation(
    { id: 'r2', change_type: 'robots_txt', title: 'robots',
      description: 'tweak robots.txt', page_url: '' },
    { url: 'https://example.com/' }
  );
  assertEq(r.status, 'verified');
  assertMatch(r.detail, /no Sitemap directive found/);
});

await t('off-page robots: 404 / unreachable -> failed', async () => {
  globalThis.__mockCorsFetchText = async () => { throw new Error('not reachable'); };
  // Use the unambiguous 'robots_txt' type. Bare 'robots' with empty
  // title/description/url is now intentionally treated as ambiguous
  // (could be a meta robots tag or robots.txt), so we route it to the
  // on-page path. Real off-page tasks should emit 'robots_txt' or
  // include "robots.txt" in the title/description/url.
  const r = await verif.verifyImplementation(
    { id: 'r3', change_type: 'robots_txt', title: '', description: '', page_url: '' },
    { url: 'https://example.com/' }
  );
  assertEq(r.status, 'failed');
  assertMatch(r.detail, /not reachable/);
});

// =================== OFF-PAGE: GSC OWNERSHIP ===================

await t('off-page GSC: siteOwner -> verified', async () => {
  globalThis.__mockListSites = async () => FIXTURE_GSC_VERIFIED;
  const r = await verif.verifyImplementation(
    { id: 'g1', change_type: 'gsc_setup', title: 'Verify domain ownership', description: '', page_url: 'https://fleetwoodonsea.co.za/' },
    { url: 'https://fleetwoodonsea.co.za/', gsc_property: 'sc-domain:fleetwoodonsea.co.za' }
  );
  assertEq(r.status, 'verified');
  assertMatch(r.detail, /siteOwner/);
});

await t('off-page GSC: siteFullUser -> verified', async () => {
  globalThis.__mockListSites = async () => FIXTURE_GSC_VERIFIED;
  const r = await verif.verifyImplementation(
    { id: 'g2', change_type: 'domain_ownership', title: 'verify ownership', description: '', page_url: '' },
    { url: 'https://otherclient.com/', gsc_property: 'https://otherclient.com/' }
  );
  assertEq(r.status, 'verified');
  assertMatch(r.detail, /siteFullUser/);
});

await t('off-page GSC: siteUnverifiedUser -> failed', async () => {
  globalThis.__mockListSites = async () => FIXTURE_GSC_UNVERIFIED;
  const r = await verif.verifyImplementation(
    { id: 'g3', change_type: 'gsc_setup', title: '', description: 'verify domain ownership', page_url: '' },
    { url: 'https://x.com/', gsc_property: 'sc-domain:fleetwoodonsea.co.za' }
  );
  assertEq(r.status, 'failed');
  assertMatch(r.detail, /siteUnverifiedUser|not verified/);
});

await t('off-page GSC: property not in account -> failed', async () => {
  globalThis.__mockListSites = async () => FIXTURE_GSC_MISSING;
  const r = await verif.verifyImplementation(
    { id: 'g4', change_type: 'gsc_setup', title: '', description: 'search console', page_url: '' },
    { url: 'https://x.com/', gsc_property: 'https://newsite.com/' }
  );
  assertEq(r.status, 'failed');
  assertMatch(r.detail, /not in the list/);
});

await t('off-page GSC: API throws (not connected) -> manual_required', async () => {
  globalThis.__mockListSites = async () => { throw new Error('OAuth token expired'); };
  const r = await verif.verifyImplementation(
    { id: 'g5', change_type: 'gsc_setup', title: 'verify ownership', description: '', page_url: '' },
    { url: 'https://x.com/', gsc_property: 'sc-domain:x.com' }
  );
  assertEq(r.status, 'manual_required');
  assertMatch(r.detail, /Could not check GSC|Confirm in Search Console/);
});

await t('off-page GSC: no property linked -> manual_required', async () => {
  globalThis.__mockListSites = async () => { throw new Error('should not be called'); };
  const r = await verif.verifyImplementation(
    { id: 'g6', change_type: 'gsc_setup', title: '', description: 'search console setup', page_url: '' },
    { url: 'https://x.com/' }
  );
  assertEq(r.status, 'manual_required');
  assertMatch(r.detail, /No GSC property/);
});

// =================== OFF-PAGE: ANALYTICS ===================

await t('off-page analytics: GA4 gtag detected', async () => {
  mockResponses = new Map([[/page-proxy/, () => jsonRes({ status: 200, html: FIXTURE_PAGE_WITH_GA4 })]]);
  const r = await verif.verifyImplementation(
    { id: 'a1', change_type: 'analytics_setup', title: 'Install GA4', description: '', page_url: 'https://example.com/' },
    { url: 'https://example.com/' }
  );
  assertEq(r.status, 'verified');
  assertMatch(r.detail, /GA4/);
});

await t('off-page analytics: GTM container detected', async () => {
  mockResponses = new Map([[/page-proxy/, () => jsonRes({ status: 200, html: FIXTURE_PAGE_WITH_GTM })]]);
  const r = await verif.verifyImplementation(
    { id: 'a2', change_type: 'gtm_setup', title: 'Install GTM', description: '', page_url: 'https://example.com/' },
    { url: 'https://example.com/' }
  );
  assertEq(r.status, 'verified');
  assertMatch(r.detail, /GTM container/);
});

await t('off-page analytics: no tag in HTML -> failed', async () => {
  mockResponses = new Map([[/page-proxy/, () => jsonRes({ status: 200, html: FIXTURE_PAGE_NO_TAGS })]]);
  const r = await verif.verifyImplementation(
    { id: 'a3', change_type: 'analytics_setup', title: 'Install GA4', description: '', page_url: 'https://example.com/' },
    { url: 'https://example.com/' }
  );
  assertEq(r.status, 'failed');
  assertMatch(r.detail, /No GA4, GTM/);
});

await t('off-page analytics: page fetch fails -> manual_required', async () => {
  mockResponses = new Map([[/page-proxy/, () => jsonRes({ error: 'x' }, 502)]]);
  globalThis.__mockCorsFetchText = async () => { throw new Error('blocked'); };
  const r = await verif.verifyImplementation(
    { id: 'a4', change_type: 'analytics_setup', title: 'GA install', description: '', page_url: 'https://example.com/' },
    { url: 'https://example.com/' }
  );
  assertEq(r.status, 'manual_required');
  assertMatch(r.detail, /Could not fetch the page/);
});

// =================== HEURISTIC FALLBACK ===================

await t("composite Fleetwood task (change_type='other') routes to sitemap", async () => {
  globalThis.__mockCorsFetchText = async (url) => {
    if (url.endsWith('/sitemap.xml')) return FIXTURE_SITEMAP_INDEX;
    throw new Error('nope');
  };
  const r = await verif.verifyImplementation(
    { id: 'fw1', change_type: 'other',
      title: 'Set up Google Search Console',
      description: 'search.google.com/search-console, verify domain ownership, and submit XML sitemap',
      page_url: 'https://fleetwoodonsea.co.za/' },
    { url: 'https://fleetwoodonsea.co.za/' }
  );
  assertEq(r.status, 'verified');
  assertMatch(r.detail, /Sitemap is live/);
});

await t('truly unknown off-page task -> manual_required (not red)', async () => {
  const r = await verif.verifyImplementation(
    { id: 'u1', change_type: 'page_speed', title: 'Improve Core Web Vitals', description: 'optimize images',
      page_url: 'https://example.com/' },
    { url: 'https://example.com/' }
  );
  assertEq(r.status, 'manual_required');
  assertMatch(r.detail, /off-page/);
});

// =================== PERSISTENCE ===================

await t('verifyImplementation calls updateImplementation exactly once', async () => {
  globalThis.__mockListSites = async () => FIXTURE_GSC_VERIFIED;
  await verif.verifyImplementation(
    { id: 'p1', change_type: 'gsc_setup', title: 'verify ownership', description: '', page_url: '' },
    { url: 'https://x.com/', gsc_property: 'sc-domain:fleetwoodonsea.co.za' }
  );
  if (globalThis.__updates.length !== 1) throw new Error('expected 1 update, got ' + globalThis.__updates.length);
  assertEq(globalThis.__updates[0].id, 'p1');
  assertEq(globalThis.__updates[0].patch.verification_status, 'verified');
});

await t('checkOffPageTask DOES NOT call updateImplementation', async () => {
  globalThis.__mockListSites = async () => FIXTURE_GSC_VERIFIED;
  await verif.checkOffPageTask(
    { change_type: 'gsc_setup', title: 'verify ownership', description: '', page_url: '' },
    { url: 'https://x.com/', gsc_property: 'sc-domain:fleetwoodonsea.co.za' }
  );
  if (globalThis.__updates.length !== 0) throw new Error('checkOffPageTask should not persist');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
