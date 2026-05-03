// Prompt linter — catches the "Output clean HTML" vs "Output Markdown"
// class of contradiction that bit us in the formatting bug hunt. Loads
// prompts.js, scans CORE_RULES + TAB_PROMPTS for conflicting format
// directives that target the article body.
//
// Run via `node test/promptLint.test.mjs` (also wired into run-all.mjs).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const promptsPath = resolve(here, '../src/modules/content/prompts.js');
const src = readFileSync(promptsPath, 'utf8');

const failures = [];

// ----- Check 1: format conflict in CORE_RULES + TAB_PROMPTS -----------------
// Article body output format must be consistent. Mixing "clean HTML" and
// "Markdown" instructions for the body confuses Claude — it emits a hybrid
// that the parser handles awkwardly.
const htmlBodyHints = [
  /Output clean HTML.*article/i,
  /Return.*HTML article/i,
  /Output.*HTML.*body/i,
  /article body in.*HTML/i
];
const markdownBodyHints = [
  /Article body in.*Markdown/i,
  /clean GitHub-flavoured Markdown/i,
  /clean GFM Markdown/i,
  /output.*markdown.*body/i
];

const htmlHits = htmlBodyHints.filter(re => re.test(src));
const mdHits   = markdownBodyHints.filter(re => re.test(src));

if (htmlHits.length > 0 && mdHits.length > 0) {
  failures.push(
    'Body-format conflict: prompts.js contains BOTH HTML directives and ' +
    'Markdown directives for the article body. Pick one.\n' +
    '  HTML hints matched: ' + htmlHits.map(r => r.source).join(' | ') + '\n' +
    '  MD hints matched:   ' + mdHits.map(r => r.source).join(' | ')
  );
}

// ----- Check 2: no naked "<h1>"/"<h2>" instructions when we expect markdown -
// If the HTML hint set is empty and we're committed to markdown, but a rule
// still says "Use <h2>/<h3> hierarchy" with HTML tags, that's mixed-format
// drift. Suggest swapping to markdown heading syntax.
if (htmlHits.length === 0 && /Use\s*<h[1-6]>/i.test(src)) {
  failures.push(
    'Mixed-format drift: prompts.js uses literal <h1>/<h2> tag references ' +
    'in a markdown-output context. Swap to "##/###" notation.'
  );
}

// ----- Check 3: required sections (sanity) ----------------------------------
const required = ['Meta Title', 'Meta Description', 'AEO Summary Block', 'FAQ', 'QA'];
for (const tag of required) {
  if (!src.includes(tag)) failures.push('Missing required prompt section: ' + tag);
}

// ----- Report ---------------------------------------------------------------
if (failures.length === 0) {
  console.log('PASS prompt-lint: no body-format conflicts, all required sections present');
  process.exit(0);
}

console.error('FAIL prompt-lint:');
for (const f of failures) console.error('  - ' + f);
process.exit(1);
