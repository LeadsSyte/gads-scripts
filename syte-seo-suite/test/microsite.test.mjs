// Smoke tests for buildMicrositeHtml — the report microsite renderer.
// Catches: render crash on partial data, missing sections, unescaped XSS,
// AEO-only mode leaking SEO sections, etc.
//
// Run: npm test  (from syte-seo-suite/)

import { buildMicrositeHtml } from '../src/modules/reports/microsite.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertContains(html, needle, label) {
  if (!html.includes(needle)) throw new Error((label || '') + ' missing "' + needle + '"');
}
function assertNotContains(html, needle, label) {
  if (html.includes(needle)) throw new Error((label || '') + ' should NOT contain "' + needle + '"');
}

const CLIENT = { name: 'Acme Hotels' };
const MICRO_BASE = {
  headline: 'A strong April for Acme',
  subheadline: 'Organic up, AI mentions up',
  narrative: 'The numbers tell a clear story.',
  highlights: [{ label: 'Users', value: '1,200', delta: '+25%', positive: true }],
  topPages: []
};

await t('renders even when reportData is null', () => {
  const html = buildMicrositeHtml({
    micro: MICRO_BASE, client: CLIENT, monthLabel: 'April 2026', reportData: null
  });
  assertContains(html, '<!DOCTYPE html>', 'doctype');
  assertContains(html, 'Acme Hotels', 'client name');
  assertContains(html, 'A strong April for Acme', 'headline');
});

await t('renders with empty AI probe (probe.per_query missing)', () => {
  const html = buildMicrositeHtml({
    micro: MICRO_BASE, client: CLIENT, monthLabel: 'April 2026', aeoProbe: {}
  });
  assertContains(html, '</html>', 'closes html');
  // Empty probe → AI Engine Visibility section should NOT render.
  assertNotContains(html, 'AI Engine Visibility', 'no probe section without data');
});

await t('renders bucketed keyword sections when keywordBuckets is supplied', () => {
  const html = buildMicrositeHtml({
    micro: MICRO_BASE, client: CLIENT, monthLabel: 'April 2026',
    reportData: {
      clientType: 'lead_gen',
      keywords: [
        { query: 'best hotels cape town', position: 3, prevPosition: 8, change: 5, clicks: 50, impressions: 1000, ctr: '5.0%',
          classification: { isHeadTerm: true, branded: false } }
      ],
      keywordBuckets: {
        headTermWins: [{ query: 'best hotels cape town', position: 3, change: 5, impressions: 1000 }],
        top3:    [{ query: 'best hotels cape town', position: 3, change: 5, clicks: 50, impressions: 1000, classification: { isHeadTerm: true } }],
        top10:   [],
        improved:[{ query: 'best hotels cape town', position: 3, change: 5, clicks: 50, impressions: 1000, classification: { isHeadTerm: true } }],
        striking:[],
        branded: [],
        counts:  { eligible: 1, top3: 1, top10: 0, improved: 1, striking: 0, branded: 0 }
      },
      topPages: []
    }
  });
  assertContains(html, 'Head-Term Wins', 'head term wins section');
  assertContains(html, 'Top 3 Rankings', 'top 3 section');
  assertContains(html, 'Most Improved', 'improved section');
  assertContains(html, 'best hotels cape town', 'keyword');
});

await t('aeoOnly mode hides SEO sections', () => {
  const html = buildMicrositeHtml({
    micro: MICRO_BASE, client: CLIENT, monthLabel: 'April 2026', aeoOnly: true,
    reportData: {
      keywords: [{ query: 'foo', position: 5, change: 1, clicks: 10, impressions: 100, ctr: '10%' }],
      traffic: { current: { users: 100, sessions: 200, conversions: 5 } },
      topPages: [{ page: '/foo', clicks: 100 }]
    }
  });
  // Organic Performance table should NOT appear in aeoOnly mode.
  assertNotContains(html, 'Organic Performance, Detailed Comparison', 'no organic table');
  assertNotContains(html, 'Top Pages by Organic Clicks', 'no top pages table');
});

// ── SEO / AEO separation ───────────────────────────────────────────
// The two reports are separate deliverables. A client on both services
// receives two documents; neither may leak the other's data.

const FULL_PROBE = {
  visibility_score: 42, detection_rate: 60, top3_rate: 20,
  mentions: 12, citations: 5, sentiment_score: 80,
  engines_used: ['chatgpt', 'perplexity'], queries_count: 4, iterations: 2, total_runs: 8,
  engine_scores: { chatgpt: 50, perplexity: 34 },
  per_query: [
    { query: 'industrial shelving', engine: 'chatgpt', engine_label: 'ChatGPT', visibility: 75, top3_rate: 50, avg_position: 2, sentiment: 'positive', mentioned: true },
    { query: 'pallet racking', engine: 'perplexity', engine_label: 'Perplexity', visibility: 0, mentioned: false }
  ],
  keyword_wins: {
    active: [{ query: 'industrial shelving', engine_label: 'ChatGPT', visibility: 75 }],
    emerging: [{ query: 'racking systems', engine_label: 'ChatGPT', visibility: 40 }],
    zero: [{ query: 'pallet racking' }]
  }
};
const FULL_COMPARE = {
  has_previous: true, previous_month: '2026-03',
  previous: { visibility: 30, mentions: 8, citations: 3, detection: 40, top3: 10, sentiment: 70 },
  current:  { visibility: 42, mentions: 12, citations: 5, detection: 60, top3: 20, sentiment: 80 },
  deltas: {
    visibility: { absolute: 12, percent: 40 }, mentions: { absolute: 4, percent: 50 },
    citations: { absolute: 2, percent: 67 }, detection: { absolute: 20, percent: 50 },
    top3: { absolute: 10, percent: 100 }, sentiment: { absolute: 10, percent: 14 }
  }
};
const FULL_RANKING = [
  { name: 'Acme Hotels', isBrand: true, visibility: 42, mentions: 12, citations: 5, top3_rate: 20, avg_position: 2 },
  { name: 'Rival Co', isBrand: false, visibility: 30, mentions: 8, citations: 2, top3_rate: 10, avg_position: 4 }
];
const MICRO_WITH_AEO = {
  ...MICRO_BASE,
  aeoSection: { show: true, score: 42, byEngine: { ChatGPT: 50 }, topQueries: [], competitors: [] },
  aeoMomNarrative: 'Citations climbed 67% month-on-month.',
  aeoCompetitiveNarrative: 'Acme leads every tracked SA rival.',
  aeoStrategy: { show: true, priorities: [{ tier: 'Quick Win', title: 'Own pallet racking', rationale: 'Close on Gemini', tags: ['FAQ'] }], zeroOpportunity: 'Attack the 0% category terms.' }
};
const SEO_DATA = {
  clientType: 'lead_gen',
  keywords: [{ query: 'shelving jhb', position: 4, change: 2, clicks: 30, impressions: 600, ctr: '5%' }],
  keywordBuckets: {
    headTermWins: [], top3: [], top10: [], improved: [], striking: [], branded: [],
    counts: { eligible: 1, top3: 0, top10: 0, improved: 0, striking: 0, branded: 0 }
  },
  traffic: {
    current: { users: 1000, sessions: 1500, conversions: 20 },
    previous: { users: 800, sessions: 1200, conversions: 15 },
    yoy: { users: 600, sessions: 1000, conversions: 10 },
    momChange: { users: 25, sessions: 25, conversions: 33 },
    yoyChange: { users: 67, sessions: 50, conversions: 100 }
  },
  topPages: [{ page: 'https://acme.co.za/shelving', clicks: 30, impressions: 600, position: 4 }]
};

await t('seoOnly mode strips every AEO section even when AEO data is supplied', () => {
  const html = buildMicrositeHtml({
    micro: MICRO_WITH_AEO, client: CLIENT, monthLabel: 'April 2026', seoOnly: true,
    reportData: SEO_DATA,
    rankscale: 'https://rankscale.example/acme',
    aeoProbe: FULL_PROBE, aeoCompare: FULL_COMPARE, aeoRanking: FULL_RANKING
  });
  // SEO content is present…
  assertContains(html, 'Organic Performance, Detailed Comparison', 'traffic table');
  assertContains(html, 'Top Pages by Organic Clicks', 'top pages table');
  // …and nothing AEO survives.
  assertNotContains(html, 'Your AI Search Presence', 'aeoSection');
  assertNotContains(html, 'AI Visibility: Headline Metrics', 'probe headline metrics');
  assertNotContains(html, 'Month-on-Month', 'aeo MoM table');
  assertNotContains(html, 'Competitive Landscape', 'competitive landscape');
  assertNotContains(html, 'Keyword Performance', 'aeo keyword wins');
  assertNotContains(html, "Next Month's Strategy", 'aeo strategy');
  assertNotContains(html, 'Query × Engine Visibility Detail', 'per-query detail');
  assertNotContains(html, 'How AI Engines Describe You', 'engine descriptions');
  assertNotContains(html, 'Citation Gaps', 'citation gaps');
  assertNotContains(html, 'Rankscale', 'rankscale link');
  assertNotContains(html, 'Citations climbed', 'aeo MoM narrative');
  assertNotContains(html, 'Acme leads every tracked SA rival', 'aeo competitive narrative');
  assertNotContains(html, 'industrial shelving', 'aeo probe query');
});

await t('aeoOnly mode strips every SEO section even when SEO data is supplied', () => {
  const html = buildMicrositeHtml({
    micro: MICRO_WITH_AEO, client: CLIENT, monthLabel: 'April 2026', aeoOnly: true,
    reportData: SEO_DATA,
    aeoProbe: FULL_PROBE, aeoCompare: FULL_COMPARE, aeoRanking: FULL_RANKING
  });
  assertContains(html, 'AI Visibility: Headline Metrics', 'probe metrics present');
  assertNotContains(html, 'Organic Performance, Detailed Comparison', 'no traffic table');
  assertNotContains(html, 'Top Pages by Organic Clicks', 'no top pages table');
  assertNotContains(html, 'shelving jhb', 'no SEO keyword');
  assertNotContains(html, 'PPC Equivalent Value', 'no PPC section');
});

await t('labels the report type in the title, hero and footer', () => {
  const seo = buildMicrositeHtml({ micro: MICRO_BASE, client: CLIENT, monthLabel: 'April 2026', seoOnly: true });
  assertContains(seo, '<title>Acme Hotels, April 2026 SEO Performance Report</title>', 'seo title');
  assertContains(seo, 'April 2026 · SEO Performance Report', 'seo hero pill');
  assertContains(seo, 'SEO Performance Report prepared for Acme Hotels', 'seo footer');

  const aeo = buildMicrositeHtml({ micro: MICRO_BASE, client: CLIENT, monthLabel: 'April 2026', aeoOnly: true });
  assertContains(aeo, '<title>Acme Hotels, April 2026 AEO Performance Report</title>', 'aeo title');
  assertContains(aeo, 'April 2026 · AEO Performance Report', 'aeo hero pill');
});

await t('escapes HTML in client name (no XSS)', () => {
  const html = buildMicrositeHtml({
    micro: MICRO_BASE, client: { name: '<script>alert(1)</script>' },
    monthLabel: 'April 2026', reportData: null
  });
  // The literal <script> tag must not appear unescaped.
  assertNotContains(html, '<script>alert(1)</script>', 'script tag unescaped');
  assertContains(html, '&lt;script&gt;', 'script tag escaped');
});

await t('renders the traffic comparison table when traffic.current is present', () => {
  const html = buildMicrositeHtml({
    micro: MICRO_BASE, client: CLIENT, monthLabel: 'April 2026',
    reportData: {
      clientType: 'lead_gen',
      keywords: [],
      traffic: {
        current: { users: 1000, sessions: 1500, conversions: 20 },
        previous: { users: 800, sessions: 1200, conversions: 15 },
        yoy: { users: 600, sessions: 1000, conversions: 10 },
        momChange: { users: 25, sessions: 25, conversions: 33 },
        yoyChange: { users: 67, sessions: 50, conversions: 100 }
      },
      topPages: []
    }
  });
  assertContains(html, 'Organic Performance, Detailed Comparison', 'traffic table');
  assertContains(html, '1,000', 'current users formatted');
  assertContains(html, '▲ 25%', 'positive MoM arrow');
});

await t('does not crash with completely minimal input', () => {
  // The smallest legitimate call: just a client and a month.
  const html = buildMicrositeHtml({ client: { name: 'X' }, monthLabel: 'April 2026' });
  assertContains(html, '<!DOCTYPE html>');
  assertContains(html, '</html>');
});

// The report covers the month that has happened — it carries no plan for
// the next one. The model can still emit the old forward-looking keys from a
// cached generation; the renderer must drop them rather than print a plan.
await t('never renders next-month plans, even if the payload carries them', () => {
  const html = buildMicrositeHtml({
    micro: {
      ...MICRO_BASE,
      whatNext: 'Next month we will attack pallet racking queries.',
      aeoStrategy: {
        show: true,
        priorities: [{ tier: 'Quick Win', title: 'Pallet Racking South Africa', rationale: 'Close to winning.', tags: ['FAQ Schema'] }],
        zeroOpportunity: 'The 0% terms are the foundation play.'
      }
    },
    client: CLIENT,
    monthLabel: 'April 2026',
    aeoProbe: {
      per_query: [{ query: 'pallet racking', engine: 'chatgpt', mentioned: true, visibility: 80 }],
      keyword_wins: { zero: [{ query: 'industrial shelving', engine: 'chatgpt', visibility: 0 }] }
    }
  });
  assertNotContains(html, "What's Next", 'what-next heading');
  assertNotContains(html, "Next Month's Strategy", 'strategy heading');
  assertNotContains(html, 'Next month we will attack', 'whatNext prose');
  assertNotContains(html, 'Pallet Racking South Africa', 'strategy priority');
  assertNotContains(html, 'foundation play', 'zero-opportunity prose');
  // The zero-visibility callout used to point at the strategy section below it.
  assertNotContains(html, "next month's strategy", 'dangling pointer to the removed section');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
