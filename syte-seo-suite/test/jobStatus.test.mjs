// Job status is derived from the background functions' own state rows (brief 2.3).

import { memoryDb, createJob } from '../netlify/functions/lib/apiCore.js';
import { deriveJobStatus, refreshJob, refreshOpenJobs } from '../netlify/functions/lib/jobStatus.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };

const T0 = Date.UTC(2026, 10, 3, 9, 0, 0);
const iso = ms => new Date(ms).toISOString();
const setState = (db, id, data) => { db.tables.syte_suite_settings ||= []; const i = db.tables.syte_suite_settings.findIndex(r => r.id === id); const row = { id, data, updated_at: iso(Date.now()) }; if (i >= 0) db.tables.syte_suite_settings[i] = row; else db.tables.syte_suite_settings.push(row); };
const actor = { kind: 'api_key', id: 'k1', name: 'Riley' };

await t('a scan job: queued until its state row is newer than the job, running while it works, done/failed from the state', async () => {
  const db = memoryDb();
  const job = await createJob(db, { type: 'tech_scan', client_id: 'c1', params: {}, actor }); job.created_at = iso(T0);
  setState(db, 'techscan:c1', { client_id: 'c1', status: 'done', started_at: iso(T0 - 3600_000), updated_at: iso(T0 - 3000_000), tasks: [1, 2] });
  eq((await deriveJobStatus(db, job, { now: T0 + 5000 })).status, 'queued', 'an OLD finished run does not count');
  setState(db, 'techscan:c1', { client_id: 'c1', status: 'triaging', started_at: iso(T0 + 2000), updated_at: iso(T0 + 9000), log: ['a', 'b'] });
  const r = await deriveJobStatus(db, job, { now: T0 + 10_000 });
  eq([r.status, r.progress.status, r.progress.log], ['running', 'triaging', ['a', 'b']]);
  setState(db, 'techscan:c1', { client_id: 'c1', status: 'done', started_at: iso(T0 + 2000), updated_at: iso(T0 + 90_000), tasks: [1, 2, 3] });
  const d = await deriveJobStatus(db, job, { now: T0 + 100_000 });
  eq([d.status, d.result.tasks], ['done', 3]);
  setState(db, 'techscan:c1', { client_id: 'c1', status: 'failed', error: 'crawl blocked', started_at: iso(T0 + 2000) });
  eq((await deriveJobStatus(db, job, { now: T0 + 100_000 })).error, 'crawl blocked');
});

await t('a job whose run never starts fails after 20 minutes instead of staying queued forever', async () => {
  const db = memoryDb();
  const job = await createJob(db, { type: 'aeo_scan', client_id: 'c1', actor }); job.created_at = iso(T0);
  eq((await deriveJobStatus(db, job, { now: T0 + 19 * 60_000 })).status, 'queued');
  eq((await deriveJobStatus(db, job, { now: T0 + 21 * 60_000 })).status, 'failed');
});

await t('fix jobs read their own status row: planning → planned (done), applying → applied, failed', async () => {
  const db = memoryDb();
  const tj = await createJob(db, { type: 'tech_fix', client_id: 'c1', params: { taskId: 't9', action: 'apply' }, actor }); tj.created_at = iso(T0);
  setState(db, 'techfix:c1:t9', { client_id: 'c1', task_id: 't9', status: 'applying', at: iso(T0 + 3000) });
  setState(db, 'techfix:c1:t8', { client_id: 'c1', task_id: 't8', status: 'failed', at: iso(T0 + 3000) });
  eq((await deriveJobStatus(db, tj, { now: T0 + 5000 })).status, 'applying');
  setState(db, 'techfix:c1:t9', { client_id: 'c1', task_id: 't9', status: 'applied', at: iso(T0 + 30_000), summary: 'title fixed' });
  const d = await deriveJobStatus(db, tj, { now: T0 + 31_000 });
  eq([d.status, d.result.summary], ['done', 'title fixed']);
  const aj = await createJob(db, { type: 'aeo_fix', client_id: 'c1', params: { url: 'https://x/p', optKey: 'content::FAQ', action: 'plan' }, actor }); aj.created_at = iso(T0);
  setState(db, 'aeofix:c1:abc', { client_id: 'c1', url: 'https://x/p', opt_key: 'content::FAQ', key: 'abc', status: 'failed', error: 'no match', at: iso(T0 + 2000) });
  const f = await deriveJobStatus(db, aj, { now: T0 + 5000 });
  eq([f.status, f.error], ['failed', 'no match']);
});

await t('auto_all jobs follow state.auto on the scan row', async () => {
  const db = memoryDb();
  const job = await createJob(db, { type: 'tech_fix', client_id: 'c1', params: { action: 'auto_all' }, actor }); job.created_at = iso(T0);
  setState(db, 'techscan:c1', { client_id: 'c1', status: 'done', started_at: iso(T0 - 100_000), auto: { status: 'applying', started_at: iso(T0 + 1000) } });
  eq((await deriveJobStatus(db, job, { now: T0 + 5000 })).status, 'applying');
  setState(db, 'techscan:c1', { client_id: 'c1', status: 'done', started_at: iso(T0 - 100_000), auto: { status: 'done', started_at: iso(T0 + 1000), finished_at: iso(T0 + 50_000) } });
  eq((await deriveJobStatus(db, job, { now: T0 + 60_000 })).status, 'done');
});

await t('refreshJob persists the change and fires the key webhook once, on the terminal transition', async () => {
  const db = memoryDb();
  db.tables.syte_suite_api_keys = [{ id: 'k1', name: 'Riley', webhook_url: 'https://riley.example/hook', webhook_secret: 'shh' }];
  const job = await createJob(db, { type: 'tech_scan', client_id: 'c1', actor }); job.created_at = iso(T0);
  const sent = [];
  const webhook = async ({ url, event }) => { sent.push([url, event.type, event.job.status]); return 1; };
  setState(db, 'techscan:c1', { client_id: 'c1', status: 'scanning', started_at: iso(T0 + 1000), updated_at: iso(T0 + 1000) });
  let j = await refreshJob(db, job, { now: T0 + 5000, webhook });
  eq([j.status, sent.length], ['running', 0]);
  setState(db, 'techscan:c1', { client_id: 'c1', status: 'done', started_at: iso(T0 + 1000), updated_at: iso(T0 + 50_000) });
  j = await refreshJob(db, j, { now: T0 + 60_000, webhook });
  eq([j.status, !!j.finished_at], ['done', true]);
  eq(sent, [['https://riley.example/hook', 'job.done', 'done']]);
  j = await refreshJob(db, j, { now: T0 + 70_000, webhook });
  eq(sent.length, 1, 'terminal jobs are left alone');
  eq((await refreshOpenJobs(db, { now: T0 + 70_000, webhook })).length, 0);
});

console.log(`\njobStatus: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
