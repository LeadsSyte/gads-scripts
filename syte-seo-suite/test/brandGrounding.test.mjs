// Guard: an article is written from the client's OWN website, and ranking
// context never crosses between clients.
//
// WHY THIS EXISTS
// The Content Engine produced an article about property listings in Chamdor
// under a lifting-equipment client's brand. Two faults combined:
//
//   1. buildArticleResearchContext() returned an ANONYMOUS object. The
//      Content Engine holds it in component state that outlives a change of
//      the top-bar client selection (TopicResearch resets itself, the parent
//      did not), so the previous client's keyword, suggested angle and
//      long-tail queries were folded into the next client's article, and
//      nothing downstream could tell.
//   2. Nothing guaranteed the brand had been analysed from its own website,
//      so there was no ground truth to contradict the borrowed keyword.
//
// The rule now: the website scan is authoritative about what the business
// is, and research context is an override that must prove it belongs to the
// client being written for.

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}

// brandScan.js loads cleanly under node; topicResearch.js pulls in the
// browser-coupled GSC layer, so stub its imports the way gsc.test.mjs does.
const scan = await import('../src/lib/brandScan.js');
const prompts = await import('../src/modules/content/prompts.js');

// The research logic lives in topicResearchCore.js (topicResearch.js only
// adds the browser-side Search Console fetch).
const TR_SRC = fs.readFileSync(path.join(__dirname, '../src/modules/content/topicResearchCore.js'), 'utf8');
globalThis.__claudeCalls = [];
const TR_PATCHED = TR_SRC
  .replace("import { claudeComplete, extractJSON } from '../../lib/anthropic.js';",
           "const claudeComplete = async (args) => { globalThis.__claudeCalls.push(args); return 'stubbed'; };\n"
           + "const extractJSON = () => ({ opportunities: [], summary: '' });");
// Written BESIDE the original (not in tmpdir) so its remaining relative
// imports — notably ../../lib/brandScan.js — still resolve. Same trick as
// shopifyPush.test.mjs.
const trTmp = path.join(__dirname, '../src/modules/content', '.topic-research-test-' + Date.now() + '.mjs');
fs.writeFileSync(trTmp, TR_PATCHED);
let research;
try {
  research = await import(trTmp);
} finally {
  fs.unlinkSync(trTmp);
}

// ---------------------------------------------------------------------------
// Research context is stamped with, and gated on, its client.
// ---------------------------------------------------------------------------

const JGS = { id: 'jgs-1', name: 'JGS Lifting' };
const OTHER = { id: 'prop-2', name: 'Chamdor Properties' };
const EMPTY_RESEARCH = { queries: [], pageByQuery: {} };

t('buildArticleResearchContext stamps the client it was researched for', () => {
  const ctx = research.buildArticleResearchContext(
    { primary_keyword: 'properties in chamdor' }, EMPTY_RESEARCH, OTHER);
  assert.equal(ctx.client_id, 'prop-2');
  assert.equal(ctx.client_name, 'Chamdor Properties');
});

t('context built without a client is not silently trusted', () => {
  const ctx = research.buildArticleResearchContext(
    { primary_keyword: 'x' }, EMPTY_RESEARCH, undefined);
  assert.equal(ctx.client_id, null);
  assert.equal(research.researchContextForClient(ctx, JGS), null);
});

t('researchContextForClient passes a context through to its own client', () => {
  const ctx = research.buildArticleResearchContext(
    { primary_keyword: 'lifting equipment' }, EMPTY_RESEARCH, JGS);
  assert.equal(research.researchContextForClient(ctx, JGS), ctx);
});

t('researchContextForClient refuses another client\'s context', () => {
  const ctx = research.buildArticleResearchContext(
    { primary_keyword: 'properties in chamdor' }, EMPTY_RESEARCH, OTHER);
  assert.equal(research.researchContextForClient(ctx, JGS), null,
    'a context researched for one client must not be usable for another');
});

t('researchContextForClient refuses legacy unstamped context', () => {
  assert.equal(research.researchContextForClient({ primary_keyword: 'x' }, JGS), null);
});

t('researchContextForClient handles missing inputs', () => {
  assert.equal(research.researchContextForClient(null, JGS), null);
  assert.equal(research.researchContextForClient({ client_id: 'jgs-1' }, null), null);
});

// ---------------------------------------------------------------------------
// Website scan block: readable, replaceable, and staleness-aware.
// ---------------------------------------------------------------------------

const BRIEF = {
  sourceUrl: 'https://jgslifting.co.za',
  voice: 'Direct, technical',
  audience: 'Industrial buyers',
  brief: '- Supplies lifting equipment\n- Based in Chamdor, Krugersdorp'
};

t('formatScanBlock round-trips through parseScanBlock', () => {
  const block = scan.formatScanBlock(BRIEF, { now: new Date('2026-09-20T00:00:00Z') });
  const parsed = scan.parseScanBlock(block);
  assert.equal(parsed.sourceUrl, 'https://jgslifting.co.za');
  assert.equal(parsed.scannedAt, '2026-09-20');
});

t('parseScanBlock returns null when the client was never scanned', () => {
  assert.equal(scan.parseScanBlock(''), null);
  assert.equal(scan.parseScanBlock('=== notes.txt ===\nsome uploaded doc'), null);
});

t('merging a scan preserves uploaded docs and never stacks duplicates', () => {
  const uploaded = '=== brand-guide.txt ===\nTone: plain English';
  let docs = scan.mergeScanIntoBrandDocs(uploaded, BRIEF, { now: new Date('2026-09-20T00:00:00Z') });
  docs = scan.mergeScanIntoBrandDocs(docs, BRIEF, { now: new Date('2026-09-21T00:00:00Z') });
  const occurrences = docs.match(/=== Website Brand Scan/g) || [];
  assert.equal(occurrences.length, 1, 'rescanning must replace the old block');
  assert.ok(docs.includes('brand-guide.txt'), 'uploaded docs must survive a rescan');
  assert.equal(scan.parseScanBlock(docs).scannedAt, '2026-09-21');
});

t('parseScanBlock falls back to the header date on pre-ISO blocks', () => {
  const legacy = [
    '=== Website Brand Scan (2026/03/04) ===',
    'Source: https://jgslifting.co.za',
    '',
    '- Supplies lifting equipment'
  ].join('\n');
  assert.equal(scan.parseScanBlock(legacy).scannedAt, '2026-03-04');
});

const NOW = new Date('2026-09-20T00:00:00Z');
const scanned = (date) => scan.formatScanBlock(BRIEF, { now: new Date(date) });

t('a client that has never been scanned is stale', () => {
  assert.equal(scan.isScanStale({ url: 'https://jgslifting.co.za' }, { now: NOW }), true);
});

t('a recent scan of the same site is not stale', () => {
  const client = { url: 'https://jgslifting.co.za', brand_docs: scanned('2026-08-20T00:00:00Z') };
  assert.equal(scan.isScanStale(client, { now: NOW }), false);
});

t('a scan older than the window is stale', () => {
  const client = { url: 'https://jgslifting.co.za', brand_docs: scanned('2026-01-01T00:00:00Z') };
  assert.equal(scan.isScanStale(client, { now: NOW }), true);
});

t('www and scheme differences do not force a rescan', () => {
  const client = { url: 'http://www.jgslifting.co.za/', brand_docs: scanned('2026-08-20T00:00:00Z') };
  assert.equal(scan.isScanStale(client, { now: NOW }), false);
});

t('a scan taken against a different website is stale', () => {
  // The exact shape of the incident: the stored brief describes someone else.
  const client = { url: 'https://jgslifting.co.za', brand_docs: scanned('2026-09-19T00:00:00Z')
    .replace('https://jgslifting.co.za', 'https://chamdorproperties.co.za') };
  assert.equal(scan.isScanStale(client, { now: NOW }), true);
});

t('a client with no website URL is not reported stale', () => {
  assert.equal(scan.isScanStale({ url: '' }, { now: NOW }), false);
});

// ---------------------------------------------------------------------------
// The prompt treats the website scan as ground truth.
// ---------------------------------------------------------------------------

const GROUNDED_CLIENT = {
  id: 'jgs-1', name: 'JGS Lifting', url: 'https://jgslifting.co.za',
  industry: 'Lifting equipment', location: 'Chamdor, Krugersdorp',
  brand_docs: scanned('2026-09-19T00:00:00Z')
};

t('brand reference material is marked as ground truth and outranks research', () => {
  const sys = prompts.buildSystemPrompt(GROUNDED_CLIENT, '', null);
  assert.ok(sys.includes('GROUND TRUTH'), 'scan must be labelled ground truth');
  assert.ok(sys.includes('SUBJECT-MATTER GUARD'), 'subject guard must be present');
  assert.ok(/outranking every other input/.test(sys));
});

t('the research block defers to the brand reference material', () => {
  const ctx = research.buildArticleResearchContext(
    { primary_keyword: 'lifting equipment hire' }, EMPTY_RESEARCH, GROUNDED_CLIENT);
  const sys = prompts.buildSystemPrompt(GROUNDED_CLIENT, '', ctx);
  assert.ok(sys.includes('SEARCH CONSOLE RESEARCH CONTEXT'));
  assert.ok(/supplies the ANGLE/.test(sys), 'research must be scoped to angle, not subject');
  assert.ok(/the reference material wins/.test(sys));
  // Ground truth must still be present alongside the research context.
  assert.ok(sys.includes('SUBJECT-MATTER GUARD'));
});

t('an unscanned client is told there is no ground truth', () => {
  const sys = prompts.buildSystemPrompt({ id: 'x', name: 'Unscanned', industry: 'Lifting' }, '', null);
  assert.ok(sys.includes('NO BRAND REFERENCE MATERIAL AVAILABLE'));
  assert.ok(!sys.includes('SUBJECT-MATTER GUARD'));
});


// ---------------------------------------------------------------------------
// Topic research is grounded too — a misattributed Search Console property is
// what produced the wrong-subject topics in the first place, so the plan must
// be generated against the brand's own website, not the typed fields alone.
// ---------------------------------------------------------------------------

async function lastResearchPrompt(client) {
  globalThis.__claudeCalls.length = 0;
  await research.generateTopicRecommendations(client, {
    days: 90, totalImpressions: 0, totalClicks: 0, siteAvgCtr: 0,
    queries: [], topOpportunities: [], pageByQuery: {}, allQueryCount: 0
  }, { targetArticles: 4 });
  const call = globalThis.__claudeCalls.at(-1);
  return { system: call.system, user: call.messages[0].content };
}

const grounded = await lastResearchPrompt(GROUNDED_CLIENT);
const ungrounded = await lastResearchPrompt({ id: 'u', name: 'Unscanned', industry: 'Lifting' });

t('topic research is sent the website scan as BRAND_REFERENCE', () => {
  assert.ok(grounded.user.includes('BRAND_REFERENCE'));
  assert.ok(grounded.user.includes('Supplies lifting equipment'),
    'the scan brief itself must reach the research prompt');
});

t('topic research is told a GSC query is not proof of what the brand does', () => {
  assert.ok(/GROUNDING \(HARD RULE\)/.test(grounded.system));
  assert.ok(/NOT evidence the brand operates in that field/.test(grounded.system));
  assert.ok(/DISCARD any query whose subject is inconsistent/.test(grounded.system));
});

t('an unscanned client is flagged as having no reference to ground against', () => {
  assert.ok(ungrounded.user.includes('no website scan on file'));
  assert.ok(!ungrounded.user.includes('Supplies lifting equipment'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
