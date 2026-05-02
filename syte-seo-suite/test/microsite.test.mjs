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
  assertNotContains(html, 'Organic Performance — Detailed Comparison', 'no organic table');
  assertNotContains(html, 'Top Pages by Organic Clicks', 'no top pages table');
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
  assertContains(html, 'Organic Performance — Detailed Comparison', 'traffic table');
  assertContains(html, '1,000', 'current users formatted');
  assertContains(html, '▲ 25%', 'positive MoM arrow');
});

await t('does not crash with completely minimal input', () => {
  // The smallest legitimate call: just a client and a month.
  const html = buildMicrositeHtml({ client: { name: 'X' }, monthLabel: 'April 2026' });
  assertContains(html, '<!DOCTYPE html>');
  assertContains(html, '</html>');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
