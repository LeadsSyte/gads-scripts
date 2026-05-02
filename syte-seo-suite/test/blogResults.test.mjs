// saveBlogResult dedup behaviour. The bug: clicking "Generate Articles"
// twice (or research returning the same topic on a re-run) created
// duplicate rows in syte_suite_content_blogs, so the Articles Written
// pipeline section showed the same article twice. saveBlogResult is now
// upsert-by-(client_id, topic, generated_at month).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/lib/supabase.js'), 'utf8');

// Stub the Supabase client + its env vars so the module loads. We test the
// localStorage fallback path here (supabase=null) — that path mirrors the
// upsert logic we want to lock in. A second integration test could mock
// the supabase chain itself; for now, hitting the localStorage branch is
// enough to catch the duplicate-row regression.
const PATCHED = SRC
  .replace(
    "import { createClient } from '@supabase/supabase-js';",
    "const createClient = () => null;"
  )
  .replace(
    "const url = import.meta.env.VITE_SUPABASE_URL;",
    "const url = '';"
  )
  .replace(
    "const key = import.meta.env.VITE_SUPABASE_ANON_KEY;",
    "const key = '';"
  );

// Fake localStorage so the module can read/write.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};
// Node 22's globalThis.crypto is read-only; override randomUUID instead.
let nextId = 0;
const origRandomUUID = globalThis.crypto?.randomUUID;
globalThis.crypto.randomUUID = () => 'uuid-' + (++nextId);

const tmp = path.join(os.tmpdir(), 'supabase-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const sb = await import(tmp);
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
async function t(name, fn) {
  store.clear();
  nextId = 0;
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

const BLOG = {
  client_id: 'c1',
  client_name: 'Acme',
  topic: 'The Complete Guide to SEO',
  keyword: 'seo guide',
  output: 'first version',
  tab: 'Auto Write',
  generated_at: '2026-05-02T10:00:00Z'
};

// =========================================================================
// REGRESSION GUARD
// =========================================================================

await t('saveBlogResult: saving the same client+topic+month twice keeps ONE row, not two', async () => {
  await sb.saveBlogResult(BLOG);
  await sb.saveBlogResult(BLOG);
  const list = await sb.listBlogResults('c1');
  assertEq(list.length, 1, 'should have exactly one row after two identical saves');
});

await t('saveBlogResult: second save UPDATES output instead of inserting', async () => {
  await sb.saveBlogResult(BLOG);
  await sb.saveBlogResult({ ...BLOG, output: 'second version' });
  const list = await sb.listBlogResults('c1');
  assertEq(list.length, 1, 'one row');
  assertEq(list[0].output, 'second version', 'output is the latest version');
});

// =========================================================================
// Don't dedupe across genuinely different things
// =========================================================================

await t('different topics for the same client → separate rows', async () => {
  await sb.saveBlogResult({ ...BLOG, topic: 'SEO Guide A' });
  await sb.saveBlogResult({ ...BLOG, topic: 'SEO Guide B' });
  const list = await sb.listBlogResults('c1');
  assertEq(list.length, 2, 'two rows for two different topics');
});

await t('same topic for different clients → separate rows', async () => {
  await sb.saveBlogResult({ ...BLOG, client_id: 'c1' });
  await sb.saveBlogResult({ ...BLOG, client_id: 'c2', client_name: 'Other' });
  const all = await sb.listBlogResults();
  assertEq(all.length, 2, 'two rows across two clients');
});

await t('same topic regenerated next month → separate rows (each month gets one)', async () => {
  await sb.saveBlogResult({ ...BLOG, generated_at: '2026-04-15T10:00:00Z' });
  await sb.saveBlogResult({ ...BLOG, generated_at: '2026-05-15T10:00:00Z' });
  const list = await sb.listBlogResults('c1');
  assertEq(list.length, 2, 'one row per month for the same topic');
});

await t('saveBlogResult returns the saved row with an id', async () => {
  const saved = await sb.saveBlogResult(BLOG);
  if (!saved.id) throw new Error('returned row missing id');
  assertEq(saved.topic, BLOG.topic);
});

// =========================================================================
// Delete
// =========================================================================

await t('deleteBlogResult removes the row by id', async () => {
  const saved = await sb.saveBlogResult(BLOG);
  await sb.deleteBlogResult(saved.id);
  const list = await sb.listBlogResults('c1');
  assertEq(list.length, 0, 'row gone after delete');
});

// ===========================================================================
// REGRESSION — loadContentHistory must include the `output` column.
// The Articles Written expanded view renders the inline preview only
// when a.output is truthy. Earlier the select() left `output` out, so
// every preview was silently hidden. The user-facing symptom was
// "I can see the cards but there's no dropdown to view the article".
// ===========================================================================
await t('loadContentHistory: returns output field on each row', async () => {
  await sb.saveBlogResult({
    ...BLOG, output: '# Heading\n\nFull article body here.'
  });
  const all = await sb.loadContentHistory();
  assertEq(all.length, 1, 'one row');
  if (!('output' in all[0])) throw new Error('REGRESSION: output column missing from loadContentHistory');
  assertEq(all[0].output, '# Heading\n\nFull article body here.', 'full output text returned');
});

await t('loadContentHistory: empty-output rows still returned (so users can delete them)', async () => {
  // LogExternalWork saves with output:'' — those rows must show up so
  // the user can clean them up via the Delete button.
  await sb.saveBlogResult({ ...BLOG, output: '', tab: 'Manual' });
  const all = await sb.loadContentHistory();
  assertEq(all.length, 1);
  assertEq(all[0].output, '', 'empty output preserved (not undefined)');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
