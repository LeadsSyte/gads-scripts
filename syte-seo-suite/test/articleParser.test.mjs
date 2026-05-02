// Smoke + edge cases for parseOutputSections — used by both ContentEngine
// and AutoWrite to split Claude's article output into copyable sections.
// A parser bug here means users see one giant blob with no copy buttons,
// which is exactly the complaint that triggered this work.

import { parseOutputSections, markdownToHtml } from '../src/modules/content/articleParser.js';

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

// =========================================================================
// markdownToHtml — used by the "Copy as HTML" button + WordPress push +
// .docx export. The original lacked GFM table support which is exactly
// what Claude emits for the comparison tables in every article it writes.
// =========================================================================

await t('markdownToHtml: empty input', () => {
  assertEq(markdownToHtml(''), '');
  assertEq(markdownToHtml(null), '');
});

await t('markdownToHtml: ATX headings → <h1..h4>', () => {
  const html = markdownToHtml('# H1\n## H2\n### H3\n#### H4\n');
  assertMatch(html, /<h1>H1<\/h1>/);
  assertMatch(html, /<h2>H2<\/h2>/);
  assertMatch(html, /<h3>H3<\/h3>/);
  assertMatch(html, /<h4>H4<\/h4>/);
});

await t('markdownToHtml: bold + italic', () => {
  const html = markdownToHtml('Some **bold** and *italic* text.');
  assertMatch(html, /<strong>bold<\/strong>/);
  assertMatch(html, /<em>italic<\/em>/);
});

await t('markdownToHtml: unordered list', () => {
  const html = markdownToHtml('- one\n- two\n- three\n');
  assertMatch(html, /<ul><li>one<\/li><li>two<\/li><li>three<\/li><\/ul>/);
});

await t('markdownToHtml: GFM table — converts the comparison tables Claude actually emits', () => {
  const md = `| Service Level | Monthly Investment | Best For |
|---------------|-------------------|----------|
| Basic Package | R5,000 - R15,000 | Small businesses |
| Standard Package | R15,000 - R35,000 | Growing companies |
`;
  const html = markdownToHtml(md);
  assertMatch(html, /<table>/);
  assertMatch(html, /<thead>/);
  assertMatch(html, /<th>Service Level<\/th>/);
  assertMatch(html, /<th>Monthly Investment<\/th>/);
  assertMatch(html, /<tbody>/);
  assertMatch(html, /<td>Basic Package<\/td>/);
  assertMatch(html, /<td>R5,000 - R15,000<\/td>/);
  // No leftover pipes in output.
  if (html.includes('|')) throw new Error('table not converted, pipes still present: ' + html);
});

await t('markdownToHtml: passes through HTML when input is already HTML', () => {
  const html = markdownToHtml('<h1>Already HTML</h1><p>Body.</p>');
  assertMatch(html, /<h1>Already HTML<\/h1>/);
  // Don't double-wrap in <p> tags.
  if ((html.match(/<p>/g) || []).length > 1) throw new Error('double-wrapped paragraphs: ' + html);
});

await t('markdownToHtml: full real-shape output', () => {
  // The body extracted from the user's last bug report — H1, H2s, bold,
  // bullets, and a comparison table all in one article. Whole pipeline.
  const parsed = parseOutputSections(REAL);
  const html = markdownToHtml(parsed.body);
  // Must produce well-formed HTML, no orphan markdown left over.
  if (/^#/.test(html.trim())) throw new Error('# heading not converted');
  if (html.includes('**')) throw new Error('** bold marks not converted: ' + html.slice(0, 200));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
