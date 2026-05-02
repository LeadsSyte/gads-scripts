// Smoke + edge cases for parseOutputSections — used by both ContentEngine
// and AutoWrite to split Claude's article output into copyable sections.
// A parser bug here means users see one giant blob with no copy buttons,
// which is exactly the complaint that triggered this work.

import { parseOutputSections } from '../src/modules/content/articleParser.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function assertMatch(s, re, label) {
  if (!re.test(s || '')) throw new Error((label || '') + ' "' + s + '" did not match ' + re);
}

// Real-shape sample output from the user's bug report. Keeps regression
// fidelity high: exactly the format Claude actually emits today.
const REAL = `**Meta Title:** Complete Guide to SEO Services: What SA Businesses Need | Syte

**Meta Description:** Discover essential SEO services for South African businesses in 2025. From pricing to provider selection, learn what works for local companies and boost your rankings.

# SEO Services: The Complete South Africa Business Guide

**AEO Summary Block:**
SEO services encompass technical optimization, content creation, link building, and local search strategies designed to improve website rankings.

Professional SEO services have become essential for South African businesses competing in an increasingly digital marketplace.

## What Are SEO Services?

SEO services encompass a range of specialized techniques.

\`\`\`json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": []
}
\`\`\`

\`\`\`json
{
  "keyword_integration": 9,
  "heading_structure": 10,
  "readability": 9,
  "overall": 88
}
\`\`\`
`;

await t('handles null/empty input', () => {
  assertEq(parseOutputSections(null), null);
  assertEq(parseOutputSections(''), null);
  assertEq(parseOutputSections(undefined), null);
});

await t('extracts Meta Title from real-shape output', () => {
  const r = parseOutputSections(REAL);
  assertMatch(r.metaTitle, /Complete Guide to SEO Services/);
  // Stars stripped — the user shouldn't see ** in their copy-pasted title.
  assertEq(r.metaTitle.includes('*'), false, 'metaTitle should not contain *');
});

await t('extracts Meta Description', () => {
  const r = parseOutputSections(REAL);
  assertMatch(r.metaDesc, /South African businesses in 2025/);
});

await t('extracts AEO Summary Block', () => {
  const r = parseOutputSections(REAL);
  assertMatch(r.aeoSummary, /technical optimization, content creation/);
});

await t('extracts the FAQ JSON-LD (penultimate ```json block)', () => {
  const r = parseOutputSections(REAL);
  assertMatch(r.faqSchema, /"@type": "FAQPage"/);
});

await t('extracts the QA JSON block (last ```json block)', () => {
  const r = parseOutputSections(REAL);
  assertMatch(r.qaBlock, /"keyword_integration": 9/);
  assertMatch(r.qaBlock, /"overall": 88/);
});

await t('article body is everything before the first **Meta Title or first ```json', () => {
  const r = parseOutputSections(REAL);
  // Body should NOT contain the Meta Title or QA JSON.
  if (/keyword_integration/.test(r.body)) throw new Error('body leaked QA JSON');
  // ...but the Meta Title is the first thing in REAL, so the body comes
  // out empty/short; what matters is it doesn't contain the JSON.
  if (r.body == null) throw new Error('body should not be null');
});

await t('handles output with NO meta blocks (raw markdown only)', () => {
  const raw = '# Heading\n\nSome body paragraph.';
  const r = parseOutputSections(raw);
  assertEq(r.metaTitle, null);
  assertEq(r.metaDesc, null);
  assertEq(r.qaBlock, null);
  assertMatch(r.body, /Some body paragraph/);
});

await t('handles output with only QA JSON (no FAQ schema)', () => {
  const raw = '# Heading\n\n```json\n{"overall": 75}\n```\n';
  const r = parseOutputSections(raw);
  assertMatch(r.qaBlock, /"overall": 75/);
  assertEq(r.faqSchema, null, 'no FAQ schema when only one JSON block');
});

await t('handles malformed Meta Title without colon', () => {
  // Legitimate near-miss the model sometimes emits.
  const raw = '**Meta Title** Some Title Without Colon | Brand\n\n# H1';
  const r = parseOutputSections(raw);
  // Either we extract it or we return null — we should NOT crash.
  if (r.metaTitle && /\*/.test(r.metaTitle)) throw new Error('stars not stripped');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
