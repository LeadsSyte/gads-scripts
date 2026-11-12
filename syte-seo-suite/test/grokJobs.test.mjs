// "Send to Grok bot" (lib/grokJobs.js + the /grok-jobs routes): a technical
// fix or AEO addition is queued for the Fixer bot, which claims it, does it
// on the site and reports what changed; the reviewer is emailed; a finished
// job can be undone.

import { createApi } from '../netlify/functions/lib/apiRouter.js';
import { memoryDb, createApiKey, RILEY_SCOPES, FIXER_SCOPES } from '../netlify/functions/lib/apiCore.js';
import { techItem, aeoItem, renderJobBrief, normalizeReport, undoItem, jobDoneEmail, isStaleClaim, STALE_CLAIM_MS } from '../netlify/functions/lib/grokJobs.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const json = async res => ({ status: res.status, body: await res.json().catch(() => null) });

const CLIENT = { id: 'c1', name: 'Krost', url: 'https://krost.co.za', cms_type: 'WordPress', created_at: '2026-01-01T00:00:00Z' };
const H1 = { id: 't1', client_id: 'c1', status: 'open', title: 'Missing H1 on the news listing page', page_url: 'https://krost.co.za/news/', fix_type: 'h1', priority: 'high', description: 'The page has no H1.', copy_paste_fix: '<h1>Latest News</h1>', created_at: '2026-11-02T00:00:00Z' };
const AEO_ROW = { id: 'a1', client_id: 'c1', url: 'https://krost.co.za/racking/', generated_at: '2026-11-03T00:00:00Z', optimizations: [{ type: 'content', name: 'Comparison table', description: 'No comparison of racking types.', implementation: '<table>…</table>', where: 'after the intro', check: { verdict: 'confirmed', reason: 'fits the page' } }, { type: 'faq', name: 'Unchecked', check: { verdict: 'needs_human' } }] };

await t('a technical item is briefed even when the suite could not apply it; a wrong fix is refused', () => {
  const a = techItem(CLIENT, H1, { status: 'manual', reason: 'The page has 0 main H1 headings.' });
  ok(a.item && a.item.where.includes("The suite couldn't do it: The page has 0 main H1"), JSON.stringify(a));
  ok(techItem(CLIENT, { ...H1, description: 'x\n\n⚠ Independent check: the fix itself looks wrong — no' }).refuse, 'wrong fix must be refused');
  ok(techItem(CLIENT, { ...H1, status: 'done' }).refuse && techItem(CLIENT, null).refuse);
});

await t('an AEO addition is briefed only when the independent check confirmed it', () => {
  ok(aeoItem(CLIENT, AEO_ROW, 'content::Comparison table').item.change.includes('<table>'));
  ok(/not confirmed/.test(aeoItem(CLIENT, AEO_ROW, 'faq::Unchecked').refuse));
  ok(aeoItem(CLIENT, AEO_ROW, 'content::Nope').refuse && aeoItem(CLIENT, AEO_ROW, 'content::Comparison table', { status: 'applied' }).refuse);
});

await t("the bot's report must say what changed, with before and after", () => {
  let threw = 0;
  for (const b of [{ result: 'ok' }, { result: 'done' }, { result: 'failed' }, { result: 'done', changes: [{ url: 'x' }] }]) { try { normalizeReport(b); } catch { threw++; } }
  eq(threw, 4);
  const r = normalizeReport({ result: 'done', changes: [{ url: 'u', what: 'Added the H1', before: '', after: '<h1>Latest News</h1>' }] });
  eq([r.result, r.changes.length, r.changes[0].after], ['done', 1, '<h1>Latest News</h1>']);
  eq(normalizeReport({ result: 'skipped', note: 'Login failed' }).changes, []);
});

async function setup() {
  let T = Date.parse('2026-11-12T12:00:00Z');
  const db = memoryDb({
    syte_suite_clients: [CLIENT],
    syte_suite_tseo_tasks: [H1],
    syte_suite_aeo_results: [AEO_ROW],
    syte_suite_settings: [{ id: 'autopilot-config', data: { report_email: 'chrisb@syte.co.za' } }, { id: 'techfix:c1:t1', data: { task_id: 't1', status: 'manual', reason: 'The page has 0 main H1 headings.' } }],
    syte_suite_external_work: []
  });
  const { key: riley } = await createApiKey(db, { name: 'Riley', scopes: RILEY_SCOPES });
  const { key: fixer } = await createApiKey(db, { name: 'Fixer', scopes: FIXER_SCOPES });
  const mails = [];
  const api = createApi({ db, env: { URL: 'https://suite.test', WP_PROXY_AUTH: 'staffhash', LEGACY_SUITE_AUTH: '1' }, fetchImpl: async () => ({ status: 202, ok: true }), deps: { findApiKey: async h => db.tables.syte_suite_api_keys.find(k => k.key_hash === h) || null, getUser: async () => null }, now: () => T, mailer: async m => { mails.push(m); } });
  let n = 0;
  const call = (method, path, { body, key, staff } = {}) => api(new Request('https://suite.test/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(staff ? { 'X-Suite-Auth': 'staffhash' } : {}), ...(method === 'POST' ? { 'Idempotency-Key': 'k' + (++n) } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  return { db, call, riley, fixer, mails, tick: ms => { T += ms; } };
}

await t('button → queue → bot claims → reports → reviewer emailed, work logged', async () => {
  const { db, call, riley, fixer, mails } = await setup();
  const made = await json(await call('POST', '/clients/c1/grok-jobs', { staff: true, body: { kind: 'tech', taskId: 't1' } }));
  eq([made.status, made.body.status, made.body.requested_by], [201, 'queued', 'the suite']);
  ok(made.body.brief.includes('Missing H1 on the news listing page') && made.body.brief.includes('"before"'), 'brief');
  const again = await json(await call('POST', '/clients/c1/grok-jobs', { staff: true, body: { kind: 'tech', taskId: 't1' } }));
  eq([again.status, again.body.existing, again.body.job_id], [200, true, made.body.job_id], 'no second job for the same item');

  const q = await json(await call('GET', '/grok-jobs?status=queued', { key: fixer }));
  eq(q.body.map(j => j.job_id), [made.body.job_id]);
  const id = made.body.job_id;
  eq((await call('POST', '/grok-jobs/' + id + '/claim', { key: riley })).status, 403, 'Riley cannot take bot work');
  eq((await json(await call('POST', '/grok-jobs/' + id + '/claim', { key: fixer }))).body.status, 'claimed');
  eq((await call('POST', '/grok-jobs/' + id + '/claim', { key: fixer })).status, 409, 'cannot be claimed twice');
  eq((await call('POST', '/grok-jobs/' + id + '/complete', { key: fixer, body: { result: 'done' } })).status, 400, 'done needs changes');
  const done = await json(await call('POST', '/grok-jobs/' + id + '/complete', { key: fixer, body: { result: 'done', note: 'Added the heading in the archive template.', changes: [{ url: H1.page_url, what: 'Added the H1 "Latest News"', before: '', after: '<h1>Latest News</h1>' }] } }));
  eq([done.status, done.body.status, done.body.claimed_by, done.body.emailed_to], [200, 'done', 'Fixer', ['chrisb@syte.co.za']]);
  eq(mails.length, 1);
  ok(mails[0].subject.includes('Krost') && mails[0].html.includes('Latest News') && mails[0].html.includes('Undo via Grok bot'), mails[0].subject);
  eq(db.tables.syte_suite_external_work.map(w => [w.tool, w.done_by]), [['Grok bot', 'Fixer']]);
  eq((await call('POST', '/grok-jobs/' + id + '/complete', { key: fixer, body: { result: 'skipped', note: 'x' } })).status, 409, 'already finished');
});

await t('undo queues a job that puts the before values back, once', async () => {
  const { call, fixer, mails } = await setup();
  const made = (await json(await call('POST', '/clients/c1/grok-jobs', { staff: true, body: { kind: 'aeo', url: AEO_ROW.url, optKey: 'content::Comparison table' } }))).body;
  eq((await call('POST', '/grok-jobs/' + made.job_id + '/undo', { staff: true })).status, 409, 'only a finished job can be undone');
  await call('POST', '/grok-jobs/' + made.job_id + '/claim', { key: fixer });
  await call('POST', '/grok-jobs/' + made.job_id + '/complete', { key: fixer, body: { result: 'done', changes: [{ url: AEO_ROW.url, what: 'Added the comparison table after the intro', before: '<p>Intro.</p>', after: '<p>Intro.</p><table>…</table>' }] } });
  const undo = await json(await call('POST', '/grok-jobs/' + made.job_id + '/undo', { staff: true }));
  eq([undo.status, undo.body.kind, undo.body.ref.undo_of], [201, 'undo', made.job_id]);
  ok(undo.body.brief.includes('Put back:') && undo.body.brief.includes('<p>Intro.</p>'), undo.body.brief);
  eq((await call('POST', '/grok-jobs/' + made.job_id + '/undo', { staff: true })).status, 409, 'not twice');
  await call('POST', '/grok-jobs/' + undo.body.job_id + '/claim', { key: fixer });
  await call('POST', '/grok-jobs/' + undo.body.job_id + '/complete', { key: fixer, body: { result: 'done', changes: [{ url: AEO_ROW.url, what: 'Removed the comparison table', before: '<p>Intro.</p><table>…</table>', after: '<p>Intro.</p>' }] } });
  const orig = await json(await call('GET', '/grok-jobs/' + made.job_id, { key: fixer }));
  ok(orig.body.undone_at, 'original marked undone');
  ok(mails[1].html.includes('undid a change') && !mails[1].html.includes('Undo via Grok bot'), 'undo email');
});

await t('refusals: unconfirmed AEO item, unknown task; a failed job still emails the reviewer', async () => {
  const { call, fixer, mails } = await setup();
  eq((await call('POST', '/clients/c1/grok-jobs', { staff: true, body: { kind: 'aeo', url: AEO_ROW.url, optKey: 'faq::Unchecked' } })).status, 409);
  eq((await call('POST', '/clients/c1/grok-jobs', { staff: true, body: { kind: 'tech', taskId: 'nope' } })).status, 404);
  const made = (await json(await call('POST', '/clients/c1/grok-jobs', { staff: true, body: { kind: 'tech', taskId: 't1' } }))).body;
  const out = await json(await call('POST', '/grok-jobs/' + made.job_id + '/complete', { key: fixer, body: { result: 'skipped', note: 'The saved login was rejected.' } }));
  eq([out.body.status, mails.length], ['skipped', 1]);
  ok(mails[0].subject.includes('SKIPPED'), mails[0].subject);
});

await t('a job the bot took and never finished goes back in the queue', async () => {
  const { call, fixer, tick } = await setup();
  const made = (await json(await call('POST', '/clients/c1/grok-jobs', { staff: true, body: { kind: 'tech', taskId: 't1' } }))).body;
  await call('POST', '/grok-jobs/' + made.job_id + '/claim', { key: fixer });
  eq((await json(await call('GET', '/grok-jobs?status=queued', { key: fixer }))).body.length, 0);
  tick(STALE_CLAIM_MS + 1000);
  eq((await json(await call('GET', '/grok-jobs?status=queued', { key: fixer }))).body.map(j => j.job_id), [made.job_id]);
  ok(isStaleClaim({ status: 'claimed', claimed_at: '2026-11-12T00:00:00Z' }, Date.parse('2026-11-12T04:00:00Z')));
});

await t('brief and email are readable on their own', () => {
  const job = { job_id: 'j1', client_name: 'Krost', site_url: 'https://krost.co.za', cms: 'WordPress', kind: 'tech', title: H1.title, page_url: H1.page_url, item: techItem(CLIENT, H1).item, status: 'done', result: 'done', note: 'ok', changes: [{ url: H1.page_url, what: 'Added H1', before: '', after: '<h1>x</h1>' }], requested_by: 'Chris', claimed_by: 'Fixer' };
  const b = renderJobBrief(job);
  ok(b.includes('RULES') && b.includes('Never publish drafts') && b.includes('/grok-jobs/j1/complete'), b);
  ok(undoItem(job).item.change.includes('remove what was added'));
  ok(jobDoneEmail(job, 'https://suite.test').html.includes('&lt;h1&gt;x&lt;/h1&gt;'), 'html escaped');
});

console.log(`\ngrokJobs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
