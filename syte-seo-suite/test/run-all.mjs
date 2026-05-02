// Test runner — executes every *.test.mjs in this directory AND the
// repo-root test/ directory (for Google Apps Script tests). Each test
// file already prints its own results and exits non-zero on failure;
// this runner aggregates so a CI gate can rely on a single exit code.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo-root test/ holds GAS tests (test/*.test.mjs at /home/user/gads-scripts/test/).
const REPO_ROOT_TESTS = path.resolve(__dirname, '..', '..', 'test');

const dirs = [
  { dir: __dirname, label: 'suite' },
  { dir: REPO_ROOT_TESTS, label: 'gas' }
];

const files = [];
for (const { dir, label } of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.test.mjs')).sort()) {
    files.push({ full: path.join(dir, f), display: label === 'gas' ? '[gas] ' + f : f });
  }
}

let totalFailed = 0;
const summary = [];

for (const { full, display } of files) {
  console.log('\n=== ' + display + ' ===');
  const r = spawnSync(process.execPath, [full], { stdio: 'inherit' });
  const failed = r.status !== 0;
  if (failed) totalFailed++;
  summary.push({ file: display, ok: !failed });
}

console.log('\n=== Summary ===');
for (const s of summary) console.log((s.ok ? '✓' : '✗') + ' ' + s.file);
console.log((totalFailed === 0 ? '\nAll suites passed' : '\n' + totalFailed + ' suite(s) failed'));
process.exit(totalFailed === 0 ? 0 : 1);
