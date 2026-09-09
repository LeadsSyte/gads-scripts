// Guard: every <PushToCmsButton> must be told which client it is pushing for.
//
// WHY THIS EXISTS
// PushToCmsButton falls back to the globally selected client when no `client`
// prop is given. Several screens (Content Engine's quick flow, the Technical
// SEO client pipeline, the AEO Engine results list) render a push button per
// row, for a client that is NOT the dropdown selection. Without an explicit
// prop those buttons published one client's article to another client's live
// website — it happened once with a hotel article landing on a shelving
// company's site, and the same fault later turned up untouched in two more
// modules. Reading the code is not enough to catch it, so this test does.
//
// The rule: if a file renders <PushToCmsButton>, that element must set
// `client={...}`. Which client is correct is a judgement call this test can't
// make, but a missing prop is always a bug.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Comments mention <PushToCmsButton /> when explaining where pushing lives, so
// they must not be mistaken for real usages. Replace comment bodies with spaces
// rather than deleting them, so reported line numbers stay accurate.
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    // Line comments, but not the "//" inside a URL such as https://example.com
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

// Returns the source text of each <PushToCmsButton ...> element, from the
// opening tag to its closing "/>" or "</PushToCmsButton>".
function pushButtonElements(text) {
  const els = [];
  const re = /<PushToCmsButton\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const rest = text.slice(m.index);
    const selfClose = rest.indexOf('/>');
    const pairClose = rest.indexOf('</PushToCmsButton>');
    const ends = [selfClose, pairClose].filter(i => i !== -1);
    if (!ends.length) { els.push({ index: m.index, src: rest }); continue; }
    const end = Math.min(...ends);
    els.push({ index: m.index, src: rest.slice(0, end + 2) });
  }
  return els;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

t('every <PushToCmsButton> sets an explicit client prop', () => {
  const offenders = [];
  let found = 0;
  for (const file of walk(SRC)) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    if (!text.includes('<PushToCmsButton')) continue;
    for (const el of pushButtonElements(text)) {
      found++;
      if (!/\bclient=\{/.test(el.src)) {
        offenders.push(path.relative(SRC, file) + ':' + lineOf(text, el.index));
      }
    }
  }
  if (found === 0) throw new Error('no <PushToCmsButton> usages found — has it been renamed?');
  if (offenders.length) {
    throw new Error(
      'push button(s) with no client prop, so they would push to whatever the ' +
      'dropdown has selected: ' + offenders.join(', ')
    );
  }
});

// The fallback itself is deliberate (single-client screens rely on it), but it
// must stay the fallback and never the only source of truth.
t('PushToCmsButton still prefers an explicit client over the selection', () => {
  const src = fs.readFileSync(
    path.join(SRC, 'components', 'PushToCmsButton.jsx'), 'utf8'
  );
  if (!/clientProp\s*\|\|\s*selected/.test(src)) {
    throw new Error('expected `clientProp || selected` precedence in PushToCmsButton');
  }
});

console.log('pushButtonClient: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
