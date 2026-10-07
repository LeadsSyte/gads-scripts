// Branded-query exclusion: SEO and AEO reports never showcase or mention how
// the client performs for searches/prompts containing its own name.

import { brandedMatcherFor, stripBrandedPrompts } from '../src/modules/reports/brandedQuery.js';
import { nonBrandedKeywords } from '../src/modules/reports/keywordBuckets.js';
import { resolveProbes } from '../src/modules/reports/aeoRunner.js';
import { formFromReportData } from '../src/modules/reports/reportGenerate.js';
import { buildReportCheckInput } from '../netlify/functions/lib/reportScan.js';
import { buildMicrositeHtml } from '../src/modules/reports/microsite.js';
import { ALICE_SEO_SYSTEM, ALICE_AEO_SYSTEM, MICROSITE_SEO_SYSTEM, MICROSITE_AEO_SYSTEM, QA_SEO_SYSTEM, QA_AEO_SYSTEM } from '../src/modules/reports/reportPrompts.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assert(cond, label) { if (!cond) throw new Error(label || 'assertion failed'); }

const krost = { id: 'c1', name: 'Krost Shelving', industry: 'industrial shelving and racking' };

t('matcher flags the distinctive brand token, keeps the category word', () => {
  const b = brandedMatcherFor(krost);
  assert(b('krost racking prices'), 'krost racking');
  assert(b('Is Krost Shelving any good?'), 'full name');
  assert(b('krostshelving'), 'concatenated');
  assert(!b('best industrial shelving supplier in johannesburg'), 'category query kept');
});

t('matcher catches a short single-token brand name', () => {
  const b = brandedMatcherFor({ name: 'DPA', industry: 'data centres' });
  assert(b('what does dpa offer for colocation'), 'dpa');
  assert(!b('best data centre in johannesburg'), 'category kept');
});

t('resolveProbes drops branded probes but keeps reverse instruments', () => {
  const client = { ...krost, aeo_probes: [
    { id: 'p1', query: 'best pallet racking supplier in johannesburg', active: true, type: 'qualified' },
    { id: 'p2', query: 'how does krost compare to dexion?', active: true, type: 'comparison' }
  ] };
  const { active, scorable, reverse } = resolveProbes(client);
  assert(active.some(p => p.id === 'p1'), 'non-branded kept');
  assert(!active.some(p => p.id === 'p2'), 'branded dropped from active');
  assert(!scorable.some(p => p.id === 'p2'), 'branded dropped from scorable');
  assert(reverse.length > 0, 'reverse instruments still generated');
});

t('stripBrandedPrompts removes branded rows from stored snapshot lists', () => {
  const snap = {
    per_query: [{ query: 'krost racking' }, { query: 'best racking' }],
    keyword_wins: { active: [{ query: 'Krost Shelving reviews' }, { query: 'best racking' }], zero: [{ query: 'cheap shelving' }] }
  };
  const out = stripBrandedPrompts(snap, krost);
  assert(out.per_query.length === 1 && out.per_query[0].query === 'best racking', 'per_query');
  assert(out.keyword_wins.active.length === 1, 'active wins');
  assert(out.keyword_wins.zero.length === 1, 'zero kept');
  assert(snap.per_query.length === 2, 'input not mutated');
});

const data = {
  keywords: [
    { query: 'krost shelving', position: 1, clicks: 900, impressions: 5000, change: 0, classification: { branded: true } },
    { query: 'steel shelving', position: 4, clicks: 40, impressions: 800, change: 1, classification: { branded: false, headTerm: true } }
  ],
  keywordBuckets: {
    headTermWins: [], top3: [], top10: [], improved: [], striking: [],
    branded: [{ query: 'krost shelving', position: 1, clicks: 900, impressions: 5000, change: 0 }],
    counts: { total: 2, eligible: 1, top3: 0, top10: 0, improved: 0, striking: 0, branded: 1 }
  },
  topPages: [], traffic: {}
};

t('nonBrandedKeywords drops classified branded rows', () => {
  assert(nonBrandedKeywords(data.keywords).map(k => k.query).join() === 'steel shelving');
});

t('SEO topQueries handed to the AI exclude branded queries', () => {
  const form = formFromReportData(data);
  assert(!/krost/i.test(form.topQueries), form.topQueries);
  assert(/steel shelving/.test(form.topQueries), 'non-branded kept');
});

t('accuracy-check facts exclude branded keywords', () => {
  const input = buildReportCheckInput({ client: krost, month: '2026-09', data, form: {}, work: {}, email: { subject: '', body: '' }, micro: {} });
  assert(!/krost shelving"/i.test(input.split('top_keywords')[1] || ''), 'branded keyword in facts');
});

t('microsite renders no Branded Queries section', () => {
  const html = buildMicrositeHtml({
    micro: { clientName: 'Krost Shelving', headline: 'x' }, client: krost, monthLabel: 'September 2026',
    reportData: data, seoOnly: true
  });
  assert(!/Branded Queries/i.test(html), 'branded section rendered');
  assert(!/non-branded/i.test(html), 'mentions non-branded');
  assert(!/>krost shelving</i.test(html), 'branded keyword row rendered');
});

t('every report system prompt carries the branded rule; QA checks for it', () => {
  for (const s of [ALICE_SEO_SYSTEM, ALICE_AEO_SYSTEM, MICROSITE_SEO_SYSTEM, MICROSITE_AEO_SYSTEM]) {
    assert(s.includes('BRANDED SEARCH RULE'), 'rule missing');
  }
  assert(QA_SEO_SYSTEM.includes('No branded-search talk'), 'SEO QA check');
  assert(QA_AEO_SYSTEM.includes('No branded-prompt talk'), 'AEO QA check');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
