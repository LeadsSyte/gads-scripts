// Regression test for the "100 tasks accumulated for one client" bug.
// dedupeTasks is the in-memory cleanup that runs on every load and
// after every scan. Pins the contract: dedupe by (client, url, action),
// cap per client at 25, never drop done/verified history.
//
// We import the function via a small loader because TechnicalSEO.jsx
// is a JSX file we can't import directly under Node ESM. The function
// is short enough to inline a copy here as a pinned spec — when the
// production source changes, this test re-pins it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolve(here, '../src/modules/technical/TechnicalSEO.jsx');
const src = readFileSync(SRC_PATH, 'utf8');

// Pull just the dedupeTasks function out of the module by regex —
// avoids transpiling the whole JSX file.
const fnMatch = src.match(/function dedupeTasks\([\s\S]*?^\}/m);
if (!fnMatch) {
  console.error('FAIL tseo-task-dedupe: dedupeTasks function not found in source');
  process.exit(1);
}
const ctx = vm.createContext({ });
vm.runInContext(fnMatch[0] + '\nglobalThis.__dedupe = dedupeTasks;', ctx);
const dedupeTasks = ctx.__dedupe;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.error('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ` expected ${b}, got ${a}`); }

const now = Date.now();
const iso = (n) => new Date(now - n * 1000).toISOString();

t('open duplicates collapse to the newest', () => {
  const list = [
    { client_id: 'c1', url: '/x', action_summary: 'a', status: 'open', created_at: iso(100) },
    { client_id: 'c1', url: '/x', action_summary: 'a', status: 'open', created_at: iso(50) },
    { client_id: 'c1', url: '/x', action_summary: 'a', status: 'open', created_at: iso(10) }
  ];
  const out = dedupeTasks(list);
  eq(out.length, 1, 'one row survives');
  eq(out[0].created_at, iso(10), 'newest kept');
});

t('different urls or actions stay separate', () => {
  const out = dedupeTasks([
    { client_id: 'c1', url: '/x', action_summary: 'a', status: 'open' },
    { client_id: 'c1', url: '/y', action_summary: 'a', status: 'open' },
    { client_id: 'c1', url: '/x', action_summary: 'b', status: 'open' }
  ]);
  eq(out.length, 3, 'three distinct rows');
});

t('per-client cap of 25 enforced', () => {
  const big = Array.from({ length: 60 }, (_, i) => ({
    client_id: 'c1', url: '/p' + i, action_summary: 'fix', status: 'open', created_at: iso(60 - i)
  }));
  const out = dedupeTasks(big);
  eq(out.length, 25, '25 capped');
});

t('done + verified rows are preserved in full', () => {
  const out = dedupeTasks([
    { client_id: 'c1', url: '/x', action_summary: 'a', status: 'done', created_at: iso(100) },
    { client_id: 'c1', url: '/x', action_summary: 'a', status: 'done', created_at: iso(50) },
    { client_id: 'c1', url: '/x', action_summary: 'a', status: 'verified', created_at: iso(10) }
  ]);
  // History is NOT deduped — every done/verified row matters as a
  // historical record of work done.
  eq(out.length, 3, 'all history kept');
});

t('open vs done with same key — open dedupes, done preserved separately', () => {
  const out = dedupeTasks([
    { client_id: 'c1', url: '/x', action_summary: 'a', status: 'open', created_at: iso(100) },
    { client_id: 'c1', url: '/x', action_summary: 'a', status: 'open', created_at: iso(50) },
    { client_id: 'c1', url: '/x', action_summary: 'a', status: 'done', created_at: iso(10) }
  ]);
  eq(out.length, 2, '1 open + 1 done');
});

t('multi-client cap is per-client', () => {
  const list = [];
  for (const c of ['c1', 'c2']) {
    for (let i = 0; i < 30; i++) {
      list.push({ client_id: c, url: '/p' + i, action_summary: 'fix', status: 'open', created_at: iso(30 - i) });
    }
  }
  const out = dedupeTasks(list);
  eq(out.length, 50, '25 per client × 2 clients');
});

t('non-array input returns empty', () => {
  eq(dedupeTasks(null).length, 0, 'null safe');
  eq(dedupeTasks(undefined).length, 0, 'undefined safe');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
