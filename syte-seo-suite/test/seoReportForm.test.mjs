// SEO report form: the Alice payload must carry the GA4 + GSC figures, and
// generation must refuse to run (not write a 1/10 refusal email) without them.

import { formFromReportData, generateSeoReport, hasSeoMetrics } from '../src/modules/reports/reportGenerate.js';
import { buildAlicePayload } from '../src/modules/reports/reportPrompts.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assert(c, m) { if (!c) throw new Error(m); }

const DATA = {
  traffic: { current: { users: 1200, sessions: 1500, conversions: 30 }, previous: { users: 1000, sessions: 1300, conversions: 25 }, yoy: { users: 900 } },
  keywords: [
    { query: 'steel shelving', position: 2, clicks: 80, impressions: 1000 },
    { query: 'racking', position: 8, clicks: 20, impressions: 1000 }
  ]
};

await t('form carries GA4 + GSC figures, including avg position', () => {
  const f = formFromReportData(DATA);
  assert(f.seoOrganicThis === '1200', 'organic users');
  assert(f.gscClicksThis === '100', 'clicks');
  assert(f.gscPosThis === '5.0', 'weighted position, got ' + f.gscPosThis);
  const payload = buildAlicePayload({ clientName: 'X', month: 'Oct 2026', hasSeo: true, ...f }, null, null);
  assert(payload.includes('Organic users: 1200'), 'payload organic users');
  assert(payload.includes('Clicks: 100'), 'payload clicks');
});

await t('hasSeoMetrics is false for an empty form, true with data', () => {
  assert(!hasSeoMetrics({ hasSeo: true, industry: 'x' }), 'empty');
  assert(hasSeoMetrics(formFromReportData(DATA)), 'with data');
});

await t('generateSeoReport refuses with no figures and makes no Claude call', async () => {
  let calls = 0;
  let threw = false;
  try {
    await generateSeoReport({ client: { name: 'X' }, form: {}, workSummary: null, monthLabel: 'Oct 2026', complete: async () => { calls++; return ''; } });
  } catch (e) { threw = /Refresh Data/.test(e.message); }
  assert(threw, 'should throw a clear error');
  assert(calls === 0, 'no Claude calls');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
