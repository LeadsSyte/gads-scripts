// Guard: a generated article must be about something the brand actually does.
//
// WHY THIS EXISTS
// The Content Engine produced an article about property listings in Chamdor
// under a lifting-equipment client's brand. The prompt-side guards try to
// prevent that; this is the check that CATCHES it after generation, before a
// human or a client's CMS ever sees it.
//
// THE CASE THAT MAKES THIS HARD
// In the real incident the article's LOCATION was correct — JGS Lifting
// really is in Chamdor — and only the SUBJECT was wrong. Any check that
// rewards shared words passes that article, because it shares "Chamdor" with
// the brand. So the brand's own name and location must not be able to earn
// relevance. That is the property most of these tests are defending.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}

// articleRelevance.js imports the browser-coupled Claude client, so stub it
// the way gsc.test.mjs does. Written beside the original so its relative
// import of ../../lib/brandScan.js still resolves.
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/content/articleRelevance.js'), 'utf8');
globalThis.__adjudications = [];
globalThis.__nextVerdict = { relevant: false, confidence: 'high', article_subject: 'property listings', reason: 'Different industry.' };
const PATCHED = SRC.replace(
  "import { claudeComplete, extractJSON } from '../../lib/anthropic.js';",
  "const claudeComplete = async (a) => { globalThis.__adjudications.push(a); return JSON.stringify(globalThis.__nextVerdict); };\n"
  + "const extractJSON = (t) => { try { return JSON.parse(t); } catch { return null; } };"
);
const tmp = path.join(__dirname, '../src/modules/content', '.article-relevance-test-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
let rel;
try { rel = await import(tmp); } finally { fs.unlinkSync(tmp); }

// ---------------------------------------------------------------------------
// Fixtures — the real incident.
// ---------------------------------------------------------------------------

const JGS = {
  id: 'jgs-1',
  name: 'JGS Lifting',
  url: 'https://jgslifting.co.za',
  industry: 'Lifting equipment supply and load testing',
  location: 'Chamdor, Krugersdorp, Gauteng',
  brand_docs: [
    '=== Website Brand Scan (2026/09/19) ===',
    'Source: https://jgslifting.co.za',
    'Scanned: 2026-09-19',
    '',
    '- Supplies and services lifting equipment: chain blocks, lever hoists, webbing slings, shackles',
    '- Load testing and certification of lifting tackle to SANS standards',
    '- On-site inspection and LMI services for mines and industrial clients',
    '- Based in Chamdor, Krugersdorp, serving Gauteng'
  ].join('\n')
};

const article = (parts) => parts.join('\n\n');

const CHAMDOR_PROPERTY = article([
  '**Meta Title:** Properties for Sale in Chamdor | JGS Lifting',
  '**Meta Description:** Browse industrial properties for sale in Chamdor, Krugersdorp.',
  '# Properties for Sale in Chamdor',
  '**AEO Summary Block:** Chamdor offers industrial properties for sale, with warehouse space and zoning suited to manufacturing tenants in Krugersdorp.',
  '## Industrial Property Prices in Chamdor',
  '## Warehouse Zoning and Municipal Rates',
  '## Choosing an Estate Agent in Krugersdorp'
]);

const ON_TOPIC = article([
  '**Meta Title:** Chain Block Load Testing Explained | JGS Lifting',
  '**Meta Description:** How load testing and certification of chain blocks works.',
  '# Chain Block Load Testing and Certification',
  '**AEO Summary Block:** Load testing verifies a chain block can safely hold its rated load, and certification to SANS standards is required annually.',
  '## How Often Must Lifting Tackle Be Tested?',
  '## Inspection of Webbing Slings and Shackles'
]);

// ---------------------------------------------------------------------------
// The core property: location and brand name never earn relevance.
// ---------------------------------------------------------------------------

t('an on-topic article is recognised without needing adjudication', () => {
  const r = rel.checkArticleRelevance({ output: ON_TOPIC, client: JGS });
  assert.equal(r.verdict, 'relevant');
  assert.equal(r.needsAdjudication, false, 'a clear pass must not cost a Claude call');
});

t('sharing the brand\'s town does not make an article relevant', () => {
  const r = rel.checkArticleRelevance({ output: CHAMDOR_PROPERTY, client: JGS });
  assert.notEqual(r.verdict, 'relevant',
    'the Chamdor property article must never be cleared on the strength of the shared location');
  assert.equal(r.needsAdjudication, true);
});

t('the shared town is reported as identity-only, not as evidence', () => {
  const r = rel.checkArticleRelevance({ output: CHAMDOR_PROPERTY, client: JGS });
  assert.ok(r.identityOnlyTerms.includes('chamdor'));
  assert.ok(!r.sharedTerms.includes('chamdor'),
    'location must not appear among the terms that earn relevance');
  assert.ok(!r.sharedTerms.includes('krugersdorp'));
});

t('the brand name does not earn relevance either', () => {
  const r = rel.checkArticleRelevance({ output: CHAMDOR_PROPERTY, client: JGS });
  assert.ok(!r.sharedTerms.includes('jgs'));
  assert.ok(!r.sharedTerms.includes('lifting'),
    'a word from the brand name must not count as subject overlap');
});

// ---------------------------------------------------------------------------
// The writer's own mismatch report is trusted immediately.
// ---------------------------------------------------------------------------

t('a self-reported TOPIC MISMATCH is a hard fail with no adjudication', () => {
  const out = 'TOPIC MISMATCH: Properties for sale does not match JGS Lifting, which supplies lifting equipment. Confirm the topic before generating.';
  const r = rel.checkArticleRelevance({ output: out, client: JGS });
  assert.equal(r.verdict, 'mismatch');
  assert.equal(r.needsAdjudication, false);
  assert.match(r.findings[0].detail, /flagged it itself/);
});

t('detectSelfReportedMismatch ignores an ordinary article', () => {
  assert.equal(rel.detectSelfReportedMismatch(ON_TOPIC), null);
});

// ---------------------------------------------------------------------------
// No ground truth to check against.
// ---------------------------------------------------------------------------

t('a client with no website scan is unclear, never silently relevant', () => {
  const r = rel.checkArticleRelevance({
    output: CHAMDOR_PROPERTY,
    client: { id: 'x', name: 'Unscanned', industry: 'Lifting' }
  });
  assert.equal(r.verdict, 'unclear');
  assert.equal(r.needsAdjudication, true);
  assert.match(r.findings[0].detail, /No website scan/);
});

// ---------------------------------------------------------------------------
// Adjudication.
// ---------------------------------------------------------------------------

const adjudicated = await rel.verifyArticleRelevance({ output: CHAMDOR_PROPERTY, client: JGS });
t('verifyArticleRelevance returns mismatch when the reviewer rejects it', () => {
  assert.equal(adjudicated.verdict, 'mismatch');
  assert.equal(adjudicated.adjudicated, true);
});

t('the reviewer is shown the brand reference and the subject, not the body', () => {
  const call = globalThis.__adjudications.at(-1);
  assert.ok(call.messages[0].content.includes('Supplies and services lifting equipment'),
    'the website scan must reach the reviewer');
  assert.ok(/Sharing a town, city or service area with the brand is NOT relevance/.test(call.system));
});

t('a clearly relevant article is never sent for adjudication', async () => {
  const before = globalThis.__adjudications.length;
  const r = await rel.verifyArticleRelevance({ output: ON_TOPIC, client: JGS });
  assert.equal(r.verdict, 'relevant');
  assert.equal(r.adjudicated, false);
  assert.equal(globalThis.__adjudications.length, before, 'no Claude call for a clear pass');
});

globalThis.__nextVerdict = { relevant: true, confidence: 'high', article_subject: 'lifting gear', reason: 'Core service.' };
// Adjacent-but-legitimate: thin lexical overlap, so the lexical pass cannot
// clear it on its own, but a reviewer with the brand reference can.
const BORDERLINE = article([
  '# Preparing Your Workshop for a Safety Audit',
  '**AEO Summary Block:** A safety audit reviews your equipment records and inspection history before an assessor visits.'
]);
t('the borderline article really is borderline, not an outright pass', () => {
  const lexical = rel.checkArticleRelevance({ output: BORDERLINE, client: JGS });
  assert.equal(lexical.verdict, 'unclear');
});
const rescued = await rel.verifyArticleRelevance({ output: BORDERLINE, client: JGS });
t('the reviewer can clear an article the lexical pass was unsure about', () => {
  assert.equal(rescued.verdict, 'relevant');
  assert.equal(rescued.adjudicated, true);
});

globalThis.__nextVerdict = { relevant: true, confidence: 'low', article_subject: 'unclear', reason: 'Thin reference.' };
const lowConf = await rel.verifyArticleRelevance({ output: CHAMDOR_PROPERTY, client: JGS });
t('a low-confidence pass stays unclear rather than becoming a green light', () => {
  assert.equal(lowConf.verdict, 'unclear');
});

// ---------------------------------------------------------------------------
// The verifier must fail safe, never error open.
// ---------------------------------------------------------------------------

const BROKEN = fs.readFileSync(path.join(__dirname, '../src/modules/content/articleRelevance.js'), 'utf8')
  .replace("import { claudeComplete, extractJSON } from '../../lib/anthropic.js';",
    "const claudeComplete = async () => { throw new Error('network down'); };\nconst extractJSON = () => null;");
const brokenTmp = path.join(__dirname, '../src/modules/content', '.article-relevance-broken-' + Date.now() + '.mjs');
fs.writeFileSync(brokenTmp, BROKEN);
let brokenMod;
try { brokenMod = await import(brokenTmp); } finally { fs.unlinkSync(brokenTmp); }
const degraded = await brokenMod.verifyArticleRelevance({ output: CHAMDOR_PROPERTY, client: JGS });

t('a failed reviewer call degrades to the lexical verdict instead of throwing', () => {
  assert.notEqual(degraded.verdict, 'relevant', 'a broken reviewer must never clear an article');
  assert.equal(degraded.adjudicated, false);
  assert.ok(degraded.findings.some(f => /Could not run the relevance review/.test(f.detail)));
});

t('relevanceHeadline names the client and what the article actually reads as', () => {
  assert.match(rel.relevanceHeadline(adjudicated, JGS), /Off topic for JGS Lifting/);
  assert.match(rel.relevanceHeadline(adjudicated, JGS), /property listings/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
