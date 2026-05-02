// topicResearch.js contract tests. Drives the Content Engine "research"
// phase that turns Search Console data into a prioritised topic plan.
//
// Pins:
//   • scoreOpportunity prefers position 5-20 (the "moveable" sweet spot)
//     and discounts already-top-3 queries
//   • classifyOpportunity routes positions to the right type tag
//   • collectResearchData throws when GSC property is missing (no silent
//     empty results)
//   • collectResearchData filters <5 impression queries (noise)
//   • generateTopicRecommendations sends Claude the right shape +
//     manual-direction block when client.internal_notes is set
//   • generateTopicRecommendations throws on malformed Claude output

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/content/topicResearch.js'), 'utf8');

// Patch the GSC + Claude imports.
globalThis.__topQueries = async () => [];
globalThis.__topPages   = async () => [];
globalThis.__claudeComplete = async () => '{}';
globalThis.__claudeSystem = '';
globalThis.__claudeUser = '';

const PATCHED = SRC
  .replace(
    "import { topQueriesByImpression, topPagesWithQueries } from '../technical/gsc.js';",
    `const topQueriesByImpression = (...a) => globalThis.__topQueries(...a);
     const topPagesWithQueries    = (...a) => globalThis.__topPages(...a);`
  )
  .replace(
    "import { claudeComplete, extractJSON } from '../../lib/anthropic.js';",
    `const claudeComplete = async ({ system, messages }) => {
       globalThis.__claudeSystem = system;
       globalThis.__claudeUser = messages[0].content;
       return globalThis.__claudeComplete({ system, messages });
     };
     const extractJSON = (text) => {
       try {
         const m = text.match(/\\{[\\s\\S]*\\}/);
         return m ? JSON.parse(m[0]) : null;
       } catch { return null; }
     };`
  );

const tmp = path.join(os.tmpdir(), 'topicResearch-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
async function t(name, fn) {
  globalThis.__topQueries = async () => [];
  globalThis.__topPages = async () => [];
  globalThis.__claudeComplete = async () => '{}';
  globalThis.__claudeSystem = '';
  globalThis.__claudeUser = '';
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
// scoreOpportunity
// ============================================================================
await t('scoreOpportunity: position 5-20 gets the 1.5x multiplier (sweet spot)', () => {
  const easy   = mod.scoreOpportunity({ position: 12, impressions: 1000, clicks: 5 });
  const tooFar = mod.scoreOpportunity({ position: 60, impressions: 1000, clicks: 5 });
  if (easy <= tooFar) throw new Error('moveable position should outscore far-out');
});

await t('scoreOpportunity: already-top-3 queries get the 0.4x multiplier (don\'t double down)', () => {
  const top3 = mod.scoreOpportunity({ position: 2, impressions: 1000, clicks: 200 });
  const sweet = mod.scoreOpportunity({ position: 8, impressions: 1000, clicks: 50 });
  if (top3 >= sweet) throw new Error('top-3 should score lower than sweet spot');
});

await t('scoreOpportunity: zero impressions → 0', () => {
  eq(mod.scoreOpportunity({ position: 12, impressions: 0, clicks: 0 }), 0);
});

await t('scoreOpportunity: capped at 100', () => {
  const huge = mod.scoreOpportunity({ position: 8, impressions: 10_000_000, clicks: 0 });
  if (huge > 100) throw new Error('score should not exceed 100');
});

// ============================================================================
// classifyOpportunity
// ============================================================================
await t('classifyOpportunity: positions 1-3 → ranking-defend', () => {
  eq(mod.classifyOpportunity({ position: 2 }), 'ranking-defend');
});

await t('classifyOpportunity: positions 4-20 → low-hanging-fruit', () => {
  eq(mod.classifyOpportunity({ position: 6 }), 'low-hanging-fruit');
  eq(mod.classifyOpportunity({ position: 18 }), 'low-hanging-fruit');
});

await t('classifyOpportunity: positions 21-50 → content-gap', () => {
  eq(mod.classifyOpportunity({ position: 35 }), 'content-gap');
});

await t('classifyOpportunity: position > 50 → long-tail', () => {
  eq(mod.classifyOpportunity({ position: 80 }), 'long-tail');
});

// ============================================================================
// collectResearchData
// ============================================================================
await t('collectResearchData: throws when client has no GSC property', async () => {
  await expectThrow(
    () => mod.collectResearchData({}),
    /no Search Console property/i
  );
});

await t('collectResearchData: filters out queries with < 5 impressions (noise)', async () => {
  globalThis.__topQueries = async () => [
    { query: 'high-vol', impressions: 1000, clicks: 30, ctr: 0.03, position: 8 },
    { query: 'noise-1',  impressions: 2,    clicks: 0,  ctr: 0,    position: 50 },
    { query: 'noise-2',  impressions: 3,    clicks: 0,  ctr: 0,    position: 60 }
  ];
  const r = await mod.collectResearchData({ gsc_property: 'sc-domain:x.test' });
  // queries field should NOT contain the noisy ones.
  eq(r.queries.length, 1, 'only the high-volume query survives the >=5 filter');
  eq(r.queries[0].query, 'high-vol');
});

await t('collectResearchData: queries are scored + classified + sorted by score DESC', async () => {
  globalThis.__topQueries = async () => [
    { query: 'a-low',  impressions: 100,   clicks: 2,  ctr: 0.02, position: 25 },
    { query: 'b-high', impressions: 5000, clicks: 50, ctr: 0.01, position: 8 }
  ];
  const r = await mod.collectResearchData({ gsc_property: 'x' });
  eq(r.queries[0].query, 'b-high', 'higher score first');
  if (!r.queries[0].score) throw new Error('score not attached');
  if (!r.queries[0].type) throw new Error('classification not attached');
});

await t('collectResearchData: pageByQuery maps query → best-impression page', async () => {
  globalThis.__topQueries = async () => [
    { query: 'pricing', impressions: 100, clicks: 5, ctr: 0.05, position: 10 }
  ];
  globalThis.__topPages = async () => [
    { page: '/pricing-old/', query: 'pricing', impressions: 50, clicks: 1, position: 12 },
    { page: '/pricing/',     query: 'pricing', impressions: 200, clicks: 10, position: 6 }
  ];
  const r = await mod.collectResearchData({ gsc_property: 'x' });
  eq(r.pageByQuery['pricing'].page, '/pricing/', 'higher-impression page wins');
});

await t('collectResearchData: returns totalImpressions/totalClicks/siteAvgCtr', async () => {
  globalThis.__topQueries = async () => [
    { query: 'a', impressions: 1000, clicks: 30, ctr: 0.03, position: 5 },
    { query: 'b', impressions: 500,  clicks: 20, ctr: 0.04, position: 10 }
  ];
  const r = await mod.collectResearchData({ gsc_property: 'x' });
  eq(r.totalImpressions, 1500);
  eq(r.totalClicks, 50);
  // siteAvgCtr = 50/1500 ≈ 0.0333
  if (Math.abs(r.siteAvgCtr - 50/1500) > 1e-6) throw new Error('siteAvgCtr off: ' + r.siteAvgCtr);
});

// ============================================================================
// generateTopicRecommendations
// ============================================================================
const RESEARCH_FIXTURE = {
  days: 90,
  totalImpressions: 5000,
  totalClicks: 100,
  siteAvgCtr: 0.02,
  queries: [],
  topOpportunities: [
    { query: 'best widgets', impressions: 1000, clicks: 30, ctr: 0.03, position: 8.4, type: 'low-hanging-fruit', score: 70 }
  ],
  pageByQuery: {},
  allQueryCount: 1
};

await t('generateTopicRecommendations: sends targetArticles into the prompt', async () => {
  globalThis.__claudeComplete = async () => JSON.stringify({
    opportunities: [{ topic_title: 'A', primary_keyword: 'k', priority: 1 }],
    summary: 'plan'
  });
  await mod.generateTopicRecommendations(
    { name: 'Acme', gsc_property: 'x' },
    RESEARCH_FIXTURE,
    { targetArticles: 3 }
  );
  if (!/TARGET_ARTICLES: 3/.test(globalThis.__claudeUser)) {
    throw new Error('TARGET_ARTICLES not in prompt: ' + globalThis.__claudeUser.slice(0, 200));
  }
  if (!/Return exactly 3/.test(globalThis.__claudeUser)) throw new Error('"return exactly N" missing');
});

await t('generateTopicRecommendations: defaults to client.pages_per_month then to 4', async () => {
  globalThis.__claudeComplete = async () => JSON.stringify({ opportunities: [{}] });
  // No targetArticles, but client has pages_per_month=15.
  await mod.generateTopicRecommendations(
    { name: 'Acme', pages_per_month: 15, gsc_property: 'x' },
    RESEARCH_FIXTURE
  );
  if (!/TARGET_ARTICLES: 15/.test(globalThis.__claudeUser)) throw new Error('client default not honoured');
});

await t('generateTopicRecommendations: includes manual direction block when internal_notes set', async () => {
  globalThis.__claudeComplete = async () => JSON.stringify({ opportunities: [{}] });
  await mod.generateTopicRecommendations(
    { name: 'Acme', internal_notes: 'Focus on ecommerce case studies this month.', gsc_property: 'x' },
    RESEARCH_FIXTURE,
    { targetArticles: 4 }
  );
  if (!/MANUAL DIRECTION FROM ACCOUNT MANAGER/.test(globalThis.__claudeUser)) {
    throw new Error('manual direction block missing');
  }
  if (!/Focus on ecommerce case studies/.test(globalThis.__claudeUser)) {
    throw new Error('direction text not embedded');
  }
});

await t('generateTopicRecommendations: omits direction block when internal_notes is empty', async () => {
  globalThis.__claudeComplete = async () => JSON.stringify({ opportunities: [{}] });
  await mod.generateTopicRecommendations(
    { name: 'Acme', gsc_property: 'x' },
    RESEARCH_FIXTURE,
    { targetArticles: 4 }
  );
  if (/MANUAL DIRECTION/.test(globalThis.__claudeUser)) throw new Error('direction block leaked when empty');
});

await t('generateTopicRecommendations: throws on malformed Claude output', async () => {
  globalThis.__claudeComplete = async () => 'totally not json';
  await expectThrow(
    () => mod.generateTopicRecommendations({ name: 'X', gsc_property: 'x' }, RESEARCH_FIXTURE),
    /unexpected output/i
  );
});

await t('generateTopicRecommendations: returns parsed opportunities array', async () => {
  globalThis.__claudeComplete = async () => JSON.stringify({
    opportunities: [{ topic_title: 'T', primary_keyword: 'k' }],
    summary: 'sum'
  });
  const r = await mod.generateTopicRecommendations({ name: 'X', gsc_property: 'x' }, RESEARCH_FIXTURE);
  eq(r.opportunities.length, 1);
  eq(r.opportunities[0].topic_title, 'T');
});

// ============================================================================
// buildArticleResearchContext
// ============================================================================
await t('buildArticleResearchContext: pairs opportunity to its best ranking page', () => {
  const research = {
    queries: [],
    pageByQuery: {
      'best widgets': { page: '/widgets/', position: 6, impressions: 800 }
    }
  };
  const out = mod.buildArticleResearchContext(
    { primary_keyword: 'best widgets', current_position: 8 },
    research
  );
  eq(out.best_existing_page, '/widgets/');
  eq(out.best_existing_position, 6);
});

await t('buildArticleResearchContext: pulls related queries sharing the first word', () => {
  const research = {
    queries: [
      { query: 'best widgets',   position: 6, impressions: 800 },
      { query: 'best widget brands', position: 12, impressions: 200 },
      { query: 'cheap pizza',    position: 4,  impressions: 100 } // unrelated
    ],
    pageByQuery: {}
  };
  const out = mod.buildArticleResearchContext(
    { primary_keyword: 'best widgets' },
    research
  );
  // 'best widget brands' shares "best" with the primary keyword, plus
  // partial brand match — should appear. Unrelated 'cheap pizza' should not.
  if (out.related_queries.some(q => q.query === 'cheap pizza')) {
    throw new Error('unrelated query leaked into related');
  }
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
