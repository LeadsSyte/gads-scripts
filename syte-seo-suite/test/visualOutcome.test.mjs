// Nov 2026: the screenshot check called alt text, meta tags and schema
// "failed" because it could not see them in a picture. A screenshot can only
// confirm a visible change; anything else is inconclusive.

import { visualOutcome, invisibleInScreenshot } from '../src/lib/visualOutcome.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const has = (s, re) => { if (!re.test(String(s))) throw new Error('missing ' + re + ' in ' + String(s).slice(0, 160)); };

const notSeen = { visible: false, confidence: 'high', evidence: 'Alt text attributes are not visually visible on a webpage screenshot.' };

t('things a screenshot cannot show are never "failed" on that basis', () => {
  for (const change_type of ['alt_text', 'image_alt', 'meta_title', 'meta_description', 'schema', 'structured_data', 'canonical', 'robots', 'hreflang']) {
    eq(visualOutcome({ change_type }, notSeen).status, 'inconclusive', change_type);
  }
  has(visualOutcome({ change_type: 'alt_text' }, notSeen).detail, /cannot show this kind of change/);
  eq(invisibleInScreenshot({ change_type: 'fix', title: 'Add descriptive alt text to hero slider images on homepage' }), true, 'by title too');
  eq(invisibleInScreenshot({ change_type: 'fix', title: 'Add missing H1 heading to About page' }), false, 'a heading is visible');
});

t('a visible change that is missing still fails; low confidence is inconclusive', () => {
  const faq = { change_type: 'aeo_optimization', title: 'FAQ Content Section' };
  eq(visualOutcome(faq, { visible: false, confidence: 'high', evidence: 'No FAQ section on the page.' }).status, 'failed');
  eq(visualOutcome(faq, { visible: false, confidence: 'low', evidence: 'Hard to tell.' }).status, 'inconclusive');
  const ok = visualOutcome(faq, { visible: true, confidence: 'high', evidence: 'FAQ accordion present.' });
  eq(ok.status, 'verified'); has(ok.detail, /FAQ accordion present\. · Confidence: high/);
});

t('a visible result verifies even for code-level types (the model saw it rendered)', () => {
  eq(visualOutcome({ change_type: 'meta_title' }, { visible: true, confidence: 'medium', evidence: 'Title shown in the tab.' }).status, 'verified');
});

console.log(`\nvisualOutcome: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
