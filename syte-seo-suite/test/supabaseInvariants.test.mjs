// Phase A: invariant tests for every write/read path in src/lib/supabase.js.
// Pins the database-layer contracts so future refactors that break dedup,
// filtering, sorting, or empty-state behaviour fail the gate. Mirrors the
// localStorage fallback path — every path in supabase.js is structured so
// the localStorage branch matches the supabase branch's behaviour, so
// pinning one pins the other.
//
// Run: npm test  (from syte-seo-suite/)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/lib/supabase.js'), 'utf8');

// Patch out the supabase client + every import.meta.env read so the
// localStorage path runs end-to-end in plain Node (no Vite). Nothing
// else in the module is mocked.
const PATCHED = SRC
  .replace(
    "import { createClient } from '@supabase/supabase-js';",
    "const createClient = () => null;"
  )
  // Replace EVERY import.meta.env.X reference with empty-string so the
  // module works without Vite's transform.
  .replace(/import\.meta\.env\.[A-Z0-9_]+/g, "''");

// In-memory localStorage for the module to use.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};

let nextId = 0;
globalThis.crypto.randomUUID = () => 'uuid-' + (++nextId);

const tmp = path.join(os.tmpdir(), 'supabase-invariants-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const sb = await import(tmp);
fs.unlinkSync(tmp);

// ─── Test runner ────────────────────────────────────────────────
let pass = 0, fail = 0;
async function t(name, fn) {
  store.clear();
  nextId = 0;
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function len(arr, n, label) {
  if (!Array.isArray(arr)) throw new Error((label || '') + ' not an array: ' + typeof arr);
  if (arr.length !== n) throw new Error((label || '') + ' expected length ' + n + ' got ' + arr.length);
}
async function expectThrow(fn, regex, label) {
  try { await fn(); }
  catch (e) {
    if (regex && !regex.test(e.message)) throw new Error((label || '') + ' wrong error: ' + e.message);
    return;
  }
  throw new Error((label || '') + ' expected throw, did not throw');
}

// =========================================================================
// CLIENTS — upsert, list, delete
// =========================================================================
await t('clients: list is empty by default', async () => {
  len(await sb.listClients(), 0, 'fresh state');
});

await t('clients: upsert without id assigns one and inserts', async () => {
  const c = await sb.upsertClient({ name: 'Acme', url: 'https://acme.test/' });
  if (!c.id) throw new Error('id not assigned');
  len(await sb.listClients(), 1);
});

await t('clients: upsert with existing id UPDATES, does not duplicate', async () => {
  const c = await sb.upsertClient({ name: 'Acme' });
  await sb.upsertClient({ id: c.id, name: 'Acme Updated', industry: 'Hospitality' });
  const list = await sb.listClients();
  len(list, 1, 'one client after edit');
  eq(list[0].name, 'Acme Updated');
  eq(list[0].industry, 'Hospitality');
});

await t('clients: deleteClient removes the row', async () => {
  const c = await sb.upsertClient({ name: 'Goneski' });
  await sb.deleteClient(c.id);
  len(await sb.listClients(), 0);
});

await t('clients: deleteClient with bad id is a no-op (does not throw)', async () => {
  await sb.upsertClient({ name: 'Stay' });
  await sb.deleteClient('does-not-exist');
  len(await sb.listClients(), 1);
});

// =========================================================================
// CMS QUEUE — assertClientId guard, queue, list, update
// =========================================================================
await t('cms queue: queueCmsChange throws when client_id missing', async () => {
  await expectThrow(() => sb.queueCmsChange({ change_type: 'meta' }), /client_id/i);
});

await t('cms queue: queue + list returns inserted rows', async () => {
  await sb.queueCmsChange({ client_id: 'c1', change_type: 'meta_title', payload: { title: 'X' } });
  await sb.queueCmsChange({ client_id: 'c1', change_type: 'meta_desc',  payload: { desc: 'Y' } });
  len(await sb.listCmsQueue('c1'), 2);
});

await t('cms queue: list filters by clientId; null returns all', async () => {
  await sb.queueCmsChange({ client_id: 'c1', change_type: 'a' });
  await sb.queueCmsChange({ client_id: 'c2', change_type: 'b' });
  len(await sb.listCmsQueue('c1'), 1, 'c1 filtered');
  len(await sb.listCmsQueue('c2'), 1, 'c2 filtered');
  len(await sb.listCmsQueue(null), 2, 'null returns all');
});

await t('cms queue: queueCmsChange defaults status to "pending"', async () => {
  const item = await sb.queueCmsChange({ client_id: 'c1', change_type: 'meta' });
  eq(item.status, 'pending');
});

await t('cms queue: updateCmsQueueItem patches in place', async () => {
  const item = await sb.queueCmsChange({ client_id: 'c1', change_type: 'meta' });
  await sb.updateCmsQueueItem(item.id, { status: 'pushed', pushed_at: 'when' });
  const list = await sb.listCmsQueue('c1');
  eq(list[0].status, 'pushed');
  eq(list[0].pushed_at, 'when');
  // Original fields preserved.
  eq(list[0].change_type, 'meta');
});

// =========================================================================
// AEO SNAPSHOTS — append-only, listed by month desc, deletable
// =========================================================================
await t('aeo history: saveAeoSnapshot throws without client_id', async () => {
  await expectThrow(() => sb.saveAeoSnapshot({ month: '2026-05', overall_score: 70 }), /client_id/i);
});

await t('aeo history: save → list returns it', async () => {
  await sb.saveAeoSnapshot({ client_id: 'c1', month: '2026-05', overall_score: 70 });
  len(await sb.listAeoSnapshots('c1'), 1);
});

await t('aeo history: history is append-only — same client+month twice = TWO rows', async () => {
  // Snapshots are intentionally append-only so users can see how scores
  // changed across re-runs of a probe. Lock that contract in.
  await sb.saveAeoSnapshot({ client_id: 'c1', month: '2026-05', overall_score: 50 });
  await sb.saveAeoSnapshot({ client_id: 'c1', month: '2026-05', overall_score: 70 });
  len(await sb.listAeoSnapshots('c1'), 2, 'append-only');
});

await t('aeo history: list filters by clientId; null returns all', async () => {
  await sb.saveAeoSnapshot({ client_id: 'c1', month: '2026-05', overall_score: 70 });
  await sb.saveAeoSnapshot({ client_id: 'c2', month: '2026-05', overall_score: 80 });
  len(await sb.listAeoSnapshots('c1'), 1);
  len(await sb.listAeoSnapshots(), 2);
});

await t('aeo history: delete removes by id', async () => {
  const r = await sb.saveAeoSnapshot({ client_id: 'c1', month: '2026-05', overall_score: 70 });
  await sb.deleteAeoSnapshot(r.id);
  len(await sb.listAeoSnapshots('c1'), 0);
});

// =========================================================================
// SENT REPORTS — append-only history
// =========================================================================
await t('sent reports: log + list', async () => {
  await sb.logReportSent({ client_id: 'c1', month: '2026-05', email_subject: 'May report' });
  len(await sb.listSentReports('c1'), 1);
});

await t('sent reports: filter by clientId; null returns all', async () => {
  await sb.logReportSent({ client_id: 'c1', month: '2026-05' });
  await sb.logReportSent({ client_id: 'c2', month: '2026-05' });
  len(await sb.listSentReports('c1'), 1);
  len(await sb.listSentReports(), 2);
});

await t('sent reports: append-only across months', async () => {
  await sb.logReportSent({ client_id: 'c1', month: '2026-04' });
  await sb.logReportSent({ client_id: 'c1', month: '2026-05' });
  len(await sb.listSentReports('c1'), 2);
});

// =========================================================================
// GENERATED REPORTS — UPSERT by (client_id, month). One row per month per
// client — re-generating updates the row, doesn't duplicate.
// =========================================================================
await t('generated reports: upserts by (client_id, month) — same month twice = ONE row', async () => {
  await sb.logReportGenerated({ client_id: 'c1', month: '2026-05', report_type: 'full' });
  await sb.logReportGenerated({ client_id: 'c1', month: '2026-05', report_type: 'aeo' });
  const list = await sb.listGeneratedReports('c1');
  len(list, 1, 'upsert');
  eq(list[0].report_type, 'aeo', 'second save updates report_type');
});

await t('generated reports: different months → separate rows', async () => {
  await sb.logReportGenerated({ client_id: 'c1', month: '2026-04' });
  await sb.logReportGenerated({ client_id: 'c1', month: '2026-05' });
  len(await sb.listGeneratedReports('c1'), 2);
});

await t('generated reports: filter by clientId; null returns all', async () => {
  await sb.logReportGenerated({ client_id: 'c1', month: '2026-05' });
  await sb.logReportGenerated({ client_id: 'c2', month: '2026-05' });
  len(await sb.listGeneratedReports('c1'), 1);
  len(await sb.listGeneratedReports(), 2);
});

// =========================================================================
// IMPLEMENTATIONS
// =========================================================================
await t('implementations: logImplementation throws without client_id', async () => {
  await expectThrow(() => sb.logImplementation({ module: 'content' }), /client_id/i);
});

await t('implementations: log defaults verification_status to "pending"', async () => {
  const r = await sb.logImplementation({ client_id: 'c1', module: 'content', title: 'X' });
  eq(r.verification_status, 'pending');
});

await t('implementations: updateImplementation patches + preserves other fields', async () => {
  const r = await sb.logImplementation({ client_id: 'c1', module: 'content', title: 'X' });
  await sb.updateImplementation(r.id, { verification_status: 'verified', verification_detail: 'ok' });
  const list = await sb.listImplementations('c1');
  eq(list[0].verification_status, 'verified');
  eq(list[0].verification_detail, 'ok');
  eq(list[0].title, 'X', 'original field preserved');
});

await t('implementations: list filters by clientId', async () => {
  await sb.logImplementation({ client_id: 'c1', module: 'content', title: 'A' });
  await sb.logImplementation({ client_id: 'c2', module: 'content', title: 'B' });
  len(await sb.listImplementations('c1'), 1);
  len(await sb.listImplementations('c2'), 1);
});

await t('implementations: listAllImplementations returns every row across clients', async () => {
  await sb.logImplementation({ client_id: 'c1', module: 'content', title: 'A' });
  await sb.logImplementation({ client_id: 'c2', module: 'aeo',     title: 'B' });
  await sb.logImplementation({ client_id: 'c3', module: 'technical', title: 'C' });
  len(await sb.listAllImplementations(), 3);
});

// =========================================================================
// TECHNICAL SEO TASKS — saveTseoTasks does a per-client REPLACE
// =========================================================================
await t('tseo tasks: save then load returns same set', async () => {
  await sb.saveTseoTasks([
    { id: 't1', client_id: 'c1', title: 'Fix meta', status: 'open' },
    { id: 't2', client_id: 'c1', title: 'Fix h1',   status: 'open' }
  ]);
  len(await sb.loadTseoTasks(), 2);
});

await t('tseo tasks: empty array empties storage', async () => {
  await sb.saveTseoTasks([{ id: 't1', client_id: 'c1', title: 'X', status: 'open' }]);
  await sb.saveTseoTasks([]);
  len(await sb.loadTseoTasks(), 0);
});

// =========================================================================
// AEO RESULTS — keyed by (client_id, url), upsert on save
// =========================================================================
await t('aeo results: saveAeoResult + loadAeoResults returns keyed object', async () => {
  await sb.saveAeoResult({ client_id: 'c1', url: 'https://x.test/a', priority: 'high', optimizations: [{ kind: 'h1' }] });
  await sb.saveAeoResult({ client_id: 'c1', url: 'https://x.test/b', priority: 'low' });
  const obj = await sb.loadAeoResults();
  if (!obj['c1::https://x.test/a']) throw new Error('expected keyed entry for /a');
  if (!obj['c1::https://x.test/b']) throw new Error('expected keyed entry for /b');
});

await t('aeo results: deleteAeoResult removes the (client,url) entry', async () => {
  await sb.saveAeoResult({ client_id: 'c1', url: 'https://x.test/a' });
  await sb.deleteAeoResult('c1', 'https://x.test/a');
  const obj = await sb.loadAeoResults();
  if (obj['c1::https://x.test/a']) throw new Error('entry still present after delete');
});

// =========================================================================
// AEO DEEP — upsert by (client_id, page_url)
// =========================================================================
await t('deep aeo: saveDeepResult upserts by (client_id, page_url)', async () => {
  await sb.saveDeepResult({ client_id: 'c1', page_url: 'https://x.test/svc', faq: 'v1' });
  await sb.saveDeepResult({ client_id: 'c1', page_url: 'https://x.test/svc', faq: 'v2' });
  const list = await sb.listDeepResults('c1');
  len(list, 1, 'upsert');
  eq(list[0].faq, 'v2', 'second save wins');
});

await t('deep aeo: different pages → separate rows', async () => {
  await sb.saveDeepResult({ client_id: 'c1', page_url: 'https://x.test/a', faq: 'a' });
  await sb.saveDeepResult({ client_id: 'c1', page_url: 'https://x.test/b', faq: 'b' });
  len(await sb.listDeepResults('c1'), 2);
});

await t('deep aeo: list filter + delete by id', async () => {
  const r = await sb.saveDeepResult({ client_id: 'c1', page_url: 'https://x.test/a' });
  // listDeepResults converts row→ui shape, find the id from the store directly.
  const all = await sb.listDeepResults('c1');
  await sb.deleteDeepResult(all[0].id);
  len(await sb.listDeepResults('c1'), 0);
});

// =========================================================================
// REPORT CACHE — keyed by (client_id, month), upserts
// =========================================================================
await t('report cache: set + get round-trips data', async () => {
  await sb.setCachedReportData('c1', '2026-05', { traffic: { current: { users: 100 } } });
  const got = await sb.getCachedReportData('c1', '2026-05');
  if (!got || got.data.traffic.current.users !== 100) throw new Error('cache round-trip failed');
});

await t('report cache: setting same (client, month) twice OVERWRITES, does not duplicate', async () => {
  await sb.setCachedReportData('c1', '2026-05', { v: 1 });
  await sb.setCachedReportData('c1', '2026-05', { v: 2 });
  const got = await sb.getCachedReportData('c1', '2026-05');
  eq(got.data.v, 2);
});

await t('report cache: missing entry returns null', async () => {
  const got = await sb.getCachedReportData('c1', '2026-05');
  eq(got, null);
});

// =========================================================================
// CONTENT HISTORY — listBlogResults + loadContentHistory + delete
// (saveBlogResult dedup is covered in blogResults.test.mjs)
// =========================================================================
await t('content history: listBlogResults filters by clientId; null returns all', async () => {
  await sb.saveBlogResult({ client_id: 'c1', topic: 'A', generated_at: '2026-05-01T00:00:00Z' });
  await sb.saveBlogResult({ client_id: 'c2', topic: 'B', generated_at: '2026-05-01T00:00:00Z' });
  len(await sb.listBlogResults('c1'), 1);
  len(await sb.listBlogResults('c2'), 1);
  len(await sb.listBlogResults(), 2);
});

await t('content history: loadContentHistory returns the list', async () => {
  await sb.saveBlogResult({ client_id: 'c1', topic: 'A', generated_at: '2026-05-01T00:00:00Z' });
  await sb.saveBlogResult({ client_id: 'c1', topic: 'B', generated_at: '2026-05-01T00:00:00Z' });
  len(await sb.loadContentHistory(), 2);
});

await t('content history: deleteBlogResult removes by id', async () => {
  const saved = await sb.saveBlogResult({ client_id: 'c1', topic: 'A', generated_at: '2026-05-01T00:00:00Z' });
  await sb.deleteBlogResult(saved.id);
  len(await sb.listBlogResults('c1'), 0);
});

// =========================================================================
// DIAGNOSTICS — diagnoseSupabase reports the right state when no env vars
// =========================================================================
await t('diagnoseSupabase reports no-supabase when env vars empty', async () => {
  const r = await sb.diagnoseSupabase();
  eq(r.ok, false);
  eq(r.reason, 'no-supabase');
  if (!/localStorage fallback/.test(r.detail)) throw new Error('detail missing fallback note');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
