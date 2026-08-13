// Test runner — executes every *.test.mjs in this directory in series and
// reports a combined pass/fail. Each test file already prints its own
// results and exits non-zero on failure; this runner aggregates so a CI
// gate can rely on a single exit code.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.test.mjs'))
  .sort();

let totalFailed = 0;
const summary = [];

for (const f of files) {
  console.log('\n=== ' + f + ' ===');
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], {
    stdio: 'inherit'
  });
  const failed = r.status !== 0;
  if (failed) totalFailed++;
  summary.push({ file: f, ok: !failed });
}

console.log('\n=== Summary ===');
for (const s of summary) console.log((s.ok ? '✓' : '✗') + ' ' + s.file);
console.log((totalFailed === 0 ? '\nAll suites passed' : '\n' + totalFailed + ' suite(s) failed'));
process.exit(totalFailed === 0 ? 0 : 1);
