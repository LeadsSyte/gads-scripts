// The bot API end to end against the in-memory adapter: auth and scopes,
// jobs that start background functions, idempotent replays, rate limits,
// the approval queue, keys, and the OpenAPI document (brief Phase 2).

import { memoryDb, createApiKey, RILEY_SCOPES } from '../netlify/functions/lib/apiCore.js';
import { createApi, ROUTES, matchRoute } from '../netlify/functions/lib/apiRouter.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const ok = (c, l) => { if (!c) throw new Error(l || 'expected truthy'); };

const ENV = { URL: 'https://suite.test', WP_PROXY_AUTH: 'staffhash', LEGACY_SUITE_AUTH: '1', API_LIMIT_READS: '3' };
// The in-memory rows carry real timestamps, so the clock starts at now.
let T = Date.now();
const now = () => T;

async function setup() {
  const db = memoryDb({
    syte_suite_clients: [{ id: 'c1', name: 'Krost', url: 'https://krost.co.za', wp_url: 'https://krost.co.za', wp_username: 'syte', wp_app_password: 'abcd efgh ijkl', does_technical: true, publishing_profile: { approval_mode: 'client' }, created_at: '2026-01-01T00:00:00Z' }],
    syte_suite_tseo_tasks: [{ id: 't9', client_id: 'c1', title: 'Missing title', status: 'open', created_at: '2026-10-01T00:00:00Z' }],
    syte_suite_cms_queue: [{ id: 'q1', client_id: 'c1', status: 'pushed', payload: { approval_token: 'secret-token', title: 'Blog' }, created_at: '2026-10-02T00:00:00Z' }]
  });
  const { key: rileyKey } = await createApiKey(db, { name: 'Riley', scopes: RILEY_SCOPES, created_by: 'test' });
  const deps = { findApiKey: async h => db.tables.syte_suite_api_keys.find(k => k.key_hash === h) || null, getUser: async () => null };
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, headers: init.headers, body: JSON.parse(init.body || 'null') }); return { status: url.includes('notify-draft') ? 200 : 202, ok: true }; };
  const api = createApi({ db, env: ENV, fetchImpl, deps, now });
  const call = (method, path, { body, key = rileyKey, headers = {} } = {}) => api(new Request('https://suite.test/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
  const staff = { key: null, headers: { 'X-Suite-Auth': 'staffhash' } };
  return { db, api, call, calls, rileyKey, staff };
}
const json = async res => ({ status: res.status, body: await res.json(), headers: res.headers });

await t('no credentials → 401; the spec is public; unknown paths are 404', async () => {
  const { call } = await setup();
  eq((await call('GET', '/clients', { key: null })).status, 401);
  const spec = await json(await call('GET', '/openapi.json', { key: null }));
  eq([spec.status, spec.body.openapi, spec.body.servers[0].url], [200, '3.1.0', 'https://suite.test/api/v1']);
  eq((await call('GET', '/nothing-here')).status, 404);
  eq((await call('DELETE', '/clients')).status, 405);
});

await t('clients come back without credentials, and credentials cannot be written', async () => {
  const { call } = await setup();
  const list = await json(await call('GET', '/clients'));
  eq([list.status, list.body.length, list.body[0].wp_configured], [200, 1, true]);
  ok(!JSON.stringify(list.body).includes('abcd efgh') && !JSON.stringify(list.body).includes('"syte"'), 'password/login must not leak');
  eq((await call('GET', '/clients/nope')).status, 404);
  const p = await json(await call('PATCH', '/clients/c1', { body: { wp_app_password: 'x' }, ...{ key: null, headers: { 'X-Suite-Auth': 'staffhash' } } }));
  eq(p.status, 400); ok(/Connections/.test(p.body.error));
  eq((await call('PATCH', '/clients/c1', { body: { name: 'K' } })).status, 403, "Riley's key lacks settings");
});

await t('a scan starts the background function with the server credential and returns a job; the same request in flight returns that job', async () => {
  const { call, calls, db } = await setup();
  const r = await json(await call('POST', '/clients/c1/scans/tech', { body: { restart: true } }));
  eq([r.status, r.body.job.status, r.body.job.type], [202, 'queued', 'tech_scan']);
  eq(calls[0].url, 'https://suite.test/.netlify/functions/techscan-run-background');
  eq(calls[0].headers['X-Suite-Auth'], 'staffhash', 'server-to-server header, never the bot key');
  eq(calls[0].body, { restart: true, clientId: 'c1' });
  const again = await json(await call('POST', '/clients/c1/scans/tech', { body: { restart: true } }));
  eq([again.status, again.body.existing, again.body.jobId], [200, true, r.body.jobId]);
  eq(calls.length, 1, 'the background function ran once');
  eq(db.tables.syte_suite_audit_log.length, 2, 'both calls audited');
  eq(db.tables.syte_suite_audit_log[0].action, 'POST /clients/:id/scans/tech');
});

await t('a job is read with its derived status', async () => {
  const { call, db } = await setup();
  const r = await json(await call('POST', '/clients/c1/scans/aeo', { body: {} }));
  db.tables.syte_suite_settings = [{ id: 'aeoscan:c1', data: { client_id: 'c1', status: 'generating', started_at: new Date(T + 1000).toISOString(), updated_at: new Date(T + 5000).toISOString(), log: ['x'] } }];
  T += 10_000;
  const j = await json(await call('GET', '/jobs/' + r.body.jobId));
  eq([j.status, j.body.status, j.body.progress.status], [200, 'running', 'generating']);
  db.tables.syte_suite_settings[0].data.status = 'done'; db.tables.syte_suite_settings[0].data.rows = [1, 2];
  const all = await json(await call('GET', '/jobs?client_id=c1'));
  eq([all.body.length, all.body[0].status, all.body[0].result.pages], [1, 'done', 2]);
});

await t('Idempotency-Key: the replay returns the original 202 and starts nothing; a different body is a 409', async () => {
  const { call, calls } = await setup();
  const h = { 'Idempotency-Key': 'req-1' };
  const a = await json(await call('POST', '/clients/c1/tech-fixes', { body: { taskId: 't9', action: 'plan' }, headers: h }));
  eq(a.status, 202);
  const b = await json(await call('POST', '/clients/c1/tech-fixes', { body: { taskId: 't9', action: 'plan' }, headers: h }));
  eq([b.status, b.body.jobId, b.headers.get('Idempotency-Replayed')], [202, a.body.jobId, 'true']);
  eq(calls.length, 1);
  eq((await call('POST', '/clients/c1/tech-fixes', { body: { taskId: 't8', action: 'plan' }, headers: h })).status, 409);
});

await t('scopes: Riley may plan a fix but not apply it; validation errors are 400', async () => {
  const { call } = await setup();
  eq((await call('POST', '/clients/c1/tech-fixes', { body: { taskId: 't9', action: 'apply' } })).status, 403);
  eq((await call('POST', '/clients/c1/aeo-fixes', { body: { url: 'https://krost.co.za/p', optKey: 'content::FAQ', action: 'plan' } })).status, 202);
  const v = await json(await call('POST', '/clients/c1/aeo-fixes', { body: { url: 'https://krost.co.za/p', action: 'plan' } }));
  eq(v.status, 400); ok(/optKey/.test(v.body.error));
  eq((await call('POST', '/clients/c1/tech-fixes', { body: { taskId: 't9', action: 'delete' } })).status, 400);
});

await t('reads are rate limited per key with Retry-After', async () => {
  const { call } = await setup();
  for (let i = 0; i < 3; i++) eq((await call('GET', '/clients')).status, 200);
  const r = await json(await call('GET', '/clients'));
  eq(r.status, 429); ok(Number(r.headers.get('Retry-After')) > 0);
});

await t('queue: Riley cannot approve; staff can; approval tokens never leave; reject needs a reason; resubmit notifies', async () => {
  const { call, calls, staff, db } = await setup();
  const q = await json(await call('GET', '/queue?status=pushed'));
  eq(q.body.length, 1); ok(!JSON.stringify(q.body).includes('secret-token'));
  eq((await call('POST', '/queue/q1/approve')).status, 403, "Riley's key cannot approve");
  const a = await json(await call('POST', '/queue/q1/approve', staff));
  eq([a.status, a.body.status, a.body.payload.approved_via], [200, 'approved', 'api']);
  eq((await call('POST', '/queue/q1/approve', staff)).status, 409, 'only pushed can be approved');
  eq((await call('POST', '/queue/q1/reject', { ...staff, body: {} })).status, 400);
  const rj = await json(await call('POST', '/queue/q1/reject', { ...staff, body: { reason: 'Wrong tone' } }));
  eq([rj.body.status, rj.body.payload.change_comment], ['changes_requested', 'Wrong tone']);
  const rs = await json(await call('POST', '/queue/q1/resubmit'));
  eq([rs.status, rs.body.status, rs.body.notified], [200, 'pushed', true]);
  ok(calls.some(c => c.url.endsWith('/notify-draft') && c.body.queueId === 'q1'));
  eq(db.tables.syte_suite_cms_queue[0].payload.approval_token, 'secret-token', 'the stored row keeps its token');
  eq((await call('POST', '/queue/q1/unpublish', staff)).status, 501);
});

await t('queue: Riley can request changes (never approve); an article draft is handed to the rewriter', async () => {
  const { call, calls, db } = await setup();
  db.tables.syte_suite_cms_queue.push({ id: 'q2', client_id: 'c1', module: 'content', change_type: 'article', status: 'pushed', page_title: 'VNA', payload: { html: '# VNA\n\nText', wp_id: 5 }, created_at: '2026-11-09T00:00:00Z' });
  eq((await call('POST', '/queue/q2/approve')).status, 403, 'still cannot approve');
  const rj = await json(await call('POST', '/queue/q2/reject', { body: { reason: 'Name Krost Shelving in the intro' } }));
  eq([rj.status, rj.body.status, rj.body.payload.changes_requested_by, rj.body.rewrite], [200, 'changes_requested', 'Riley', 'started']);
  ok(calls.some(c => c.url.endsWith('/draft-rewrite-background') && c.body.queueId === 'q2'), 'rewrite started');
  // Not an article (q1) → recorded, not rewritten.
  const r1 = await json(await call('POST', '/queue/q1/reject', { body: { reason: 'x' } }));
  ok(/^not started: only articles/.test(r1.body.rewrite), r1.body.rewrite);
});

await t('keys: staff create (shown once) and list (never the hash); API keys may not manage keys; settings allowlist', async () => {
  const { call, staff } = await setup();
  eq((await call('POST', '/keys', { body: { name: 'x', scopes: ['read'] } })).status, 403);
  const k = await json(await call('POST', '/keys', { ...staff, body: { name: 'Riley 2', scopes: ['read', 'scan'] } }));
  eq(k.status, 201); ok(k.body.key.startsWith('sk_syte_')); ok(!('key_hash' in k.body));
  const bad = await json(await call('POST', '/keys', { ...staff, body: { name: 'x', scopes: ['admin'] } }));
  eq(bad.status, 400);
  const list = await json(await call('GET', '/keys', staff));
  eq(list.body.length, 2); ok(!JSON.stringify(list.body).includes('key_hash'));
  const rv = await json(await call('POST', '/keys/' + k.body.id + '/revoke', staff));
  eq(rv.body.revoked, true);
  eq((await call('GET', '/clients', { key: k.body.key })).status, 401, 'revoked key is dead');
  eq((await call('GET', '/settings/global', staff)).status, 404, 'provider keys row is unreachable');
  const s = await json(await call('PUT', '/settings/autopilot-config', { ...staff, body: { report_email: 'chris@syte.co.za' } }));
  eq(s.body, { report_email: 'chris@syte.co.za' });
  eq((await call('PUT', '/settings/autopilot-config', { ...staff, body: { other: 1 } })).status, 400);
});

await t('the OpenAPI document describes every route, and only routes', async () => {
  const { call } = await setup();
  const spec = (await json(await call('GET', '/openapi.json', { key: null }))).body;
  for (const r of ROUTES) {
    const p = r.path.replace(/:([a-zA-Z_]+)/g, '{$1}');
    ok(spec.paths[p]?.[r.method.toLowerCase()], 'missing ' + r.method + ' ' + r.path);
  }
  const count = Object.values(spec.paths).reduce((n, p) => n + Object.keys(p).length, 0);
  eq(count, ROUTES.length);
  ok(matchRoute('GET', '/clients/abc/aeo/results').params.id === 'abc');
  const brief = ['/clients', '/clients/:id', '/clients/:id/scans/aeo', '/clients/:id/scans/tech', '/clients/:id/aeo/results', '/clients/:id/aeo/history', '/clients/:id/aeo/raw', '/clients/:id/aeo/deep', '/clients/:id/aeo/rejections', '/clients/:id/tech/tasks', '/clients/:id/tech/rejections', '/clients/:id/aeo-fixes', '/clients/:id/tech-fixes', '/clients/:id/autopilot', '/clients/:id/articles', '/clients/:id/implementations', '/clients/:id/external-work', '/clients/:id/baseline', '/clients/:id/reports', '/settings/:id', '/jobs', '/jobs/:id', '/queue', '/queue/:id/approve', '/queue/:id/reject', '/queue/:id/unpublish', '/queue/:id/resubmit', '/audit'];
  for (const p of brief) ok(ROUTES.some(r => r.path === p), 'brief endpoint missing: ' + p);
});

await t('fix sheet: the same items and text as "Copy for Grok", plus a signed link', async () => {
  const { call, db } = await setup();
  db.tables.syte_suite_tseo_tasks.push({ id: 't10', client_id: 'c1', title: 'robots.txt blocks /blog/', status: 'open', fix_type: 'robots', priority: 'high', page_url: 'https://krost.co.za/robots.txt', copy_paste_fix: 'Remove Disallow: /blog/', created_at: '2026-10-03T00:00:00Z' });
  db.tables.syte_suite_settings = [];
  db.tables.syte_suite_aeo_results = [];
  const r = await json(await call('GET', '/clients/c1/fix-sheet'));
  eq(r.status, 200);
  ok(r.body.count >= 1 && r.body.items.some(i => i.title === 'robots.txt blocks /blog/'), 'robots item listed');
  ok(r.body.text.startsWith('FIX SHEET — Krost'), 'plain text for the bot');
  ok(/\/\.netlify\/functions\/fix-sheet\?s=c1&sig=[0-9a-f]{64}$/.test(r.body.url), 'signed link: ' + r.body.url);
  ok(!JSON.stringify(r.body).includes('abcd efgh'), 'no credentials');
  eq((await call('GET', '/clients/nope/fix-sheet')).status, 404);
});

await t("bot summary: stored, emailed to the report address with Chris's decisions first, and listed", async () => {
  const sent = [];
  const db = memoryDb({ syte_suite_clients: [], syte_suite_settings: [{ id: 'autopilot-config', data: { report_email: 'chrisb@syte.co.za' } }] });
  const { key } = await createApiKey(db, { name: 'Riley', scopes: RILEY_SCOPES });
  const deps = { findApiKey: async h => db.tables.syte_suite_api_keys.find(k => k.key_hash === h) || null, getUser: async () => null };
  const api = createApi({ db, env: ENV, deps, now, mailer: async m => { sent.push(m); } });
  const call = (method, path, body) => api(new Request('https://suite.test/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: body === undefined ? undefined : JSON.stringify(body) }));
  const r = await json(await call('POST', '/reports/bot-summary', { subject: 'November run', month: '2026-11', summary: 'Krost: 2 titles planned.\n\n- News H1 needs a hand\n- 4 schema items', needs_chris: ['Apply the 2 Krost titles', '<b>OK</b> the fix sheet'] }));
  eq([r.status, r.body.emailed_to], [201, ['chrisb@syte.co.za']]);
  eq(sent.length, 1);
  ok(sent[0].subject === '[Grok bots] November run');
  ok(sent[0].html.indexOf('Needs Chris') < sent[0].html.indexOf('Krost: 2 titles'), 'decisions come first');
  ok(sent[0].html.includes('<li>News H1 needs a hand</li>'), 'bullets rendered');
  ok(sent[0].html.includes('&lt;b&gt;OK&lt;/b&gt;') && !sent[0].html.includes('<b>OK</b>'), 'bot text is escaped');
  const list = await json(await call('GET', '/reports/bot-summaries'));
  eq([list.body.length, list.body[0].subject, list.body[0].by], [1, 'November run', 'Riley']);
  eq((await call('POST', '/reports/bot-summary', { subject: 'x' })).status, 400, 'summary required');
  eq((await call('POST', '/reports/bot-summary', { subject: 'x', summary: 'y', month: 'Nov' })).status, 400, 'bad month');
  db.tables.syte_suite_settings[0].data.report_email = '';
  const noTo = await json(await call('POST', '/reports/bot-summary', { subject: 'x', summary: 'y' }));
  eq([noTo.status, noTo.body.emailed_to.length, /No report email/.test(noTo.body.email_error)], [201, 0, true], 'kept even without a recipient');
});

console.log(`\napiRouter: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
