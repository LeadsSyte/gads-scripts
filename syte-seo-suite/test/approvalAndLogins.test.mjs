// Chris, 12 Nov 2026 call: (1) per client "needs approval" or not for
// technical and AEO work — without approval, what the suite can't do goes to
// the Grok bot after each monthly run (lib/grokQueue.js); (2) a website login
// for sites with no API, stored server-side and given to the bot only for a
// job it has claimed (lib/siteLogin.js, site-login.js, /grok-jobs/:id/login).

import { techForBot, aeoForBot, autoSendToBot } from '../netlify/functions/lib/grokQueue.js';
import { publicLoginInfo, mergeLogin } from '../netlify/functions/lib/siteLogin.js';
import { handler as siteLogin } from '../netlify/functions/site-login.js';
import { createApi } from '../netlify/functions/lib/apiRouter.js';
import { memoryDb, createApiKey, FIXER_SCOPES } from '../netlify/functions/lib/apiCore.js';
import { getPublishingProfile } from '../src/modules/cms/publishingProfile.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const entry = (id, fix_type, verdict = 'confirmed') => ({ task: { id, title: 'Task ' + id, fix_type, page_url: 'https://x.co.za/' + id + '/', description: 'd', copy_paste_fix: 'c' }, check: { verdict } });
const ENTRIES = [entry('h1', 'h1'), entry('title', 'meta_title'), entry('alt', 'image_alt'), entry('wrong', 'h1', 'false_alarm'), entry('closed', 'canonical')];
const OPEN = new Set(['h1', 'title', 'alt', 'wrong']);

await t('defaults: every client needs approval (nothing goes to the bot on its own)', () => {
  const p = getPublishingProfile({});
  eq([p.techfix_auto, p.techgrok_auto, p.aeofix_auto, p.aeogrok_auto], [false, false, false, false]);
});

await t('technical: what the suite cannot do goes to the bot; what it can do stays with it until it gives up', () => {
  const pick = (opts) => techForBot({ entries: ENTRIES, openIds: OPEN, fixes: new Map(Object.entries(opts.fixes || {})), siteConnected: opts.site ?? true, suiteAuto: opts.auto ?? false }).map(e => e.task.id);
  eq(pick({}), ['h1'], 'connected site: only the H1 (suite cannot), never an unconfirmed or closed task');
  eq(pick({ site: false }), ['h1', 'title', 'alt'], 'no connection: everything confirmed goes to the bot');
  eq(pick({ auto: true, fixes: { title: { status: 'manual' }, alt: { status: 'applied' } } }), ['h1', 'title'], 'suite gave up on the title; alt is done');
  eq(pick({ auto: false, fixes: { title: { status: 'failed' } } }), ['h1'], 'without suite auto, a failed suite fix waits for a person');
});

await t('AEO: only confirmed additions; structure changes always go to the bot', () => {
  const rows = [{ url: 'https://x/a/', optimizations: [{ type: 'content', name: 'FAQ', check: { verdict: 'confirmed' } }, { type: 'structure', name: 'Split page', check: { verdict: 'confirmed' } }, { type: 'schema', name: 'S', check: { verdict: 'needs_human' } }] }];
  const keyOf = (u, k) => u + '|' + k;
  eq(aeoForBot({ rows, fixes: new Map(), keyOf, siteConnected: true, suiteAuto: false }).map(p => p.optKey), ['structure::Split page']);
  eq(aeoForBot({ rows, fixes: new Map([['https://x/a/|content::FAQ', { status: 'manual' }]]), keyOf, siteConnected: true, suiteAuto: true }).map(p => p.optKey), ['content::FAQ', 'structure::Split page']);
});

// A tiny Supabase stand-in for the end-of-run step.
function fakeSupabase(tables) {
  return {
    tables,
    from(name) {
      const rows = tables[name] = tables[name] || [];
      let filters = [];
      const q = {
        select() { return q; },
        eq(k, v) { filters.push(r => r[k] === v); return q; },
        like(k, pattern) { const re = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'); filters.push(r => re.test(r[k])); return q; },
        then(resolve) { resolve({ data: rows.filter(r => filters.every(f => f(r))), error: null }); },
        insert(row) { rows.push(row); return Promise.resolve({ error: null }); }
      };
      return q;
    }
  };
}

await t('end of a monthly run: jobs are queued once, only when the client runs without approval', async () => {
  const sb = fakeSupabase({ syte_suite_tseo_tasks: [...OPEN].map(id => ({ id, client_id: 'c1', status: 'open' })), syte_suite_settings: [] });
  const deps = { getPublishingProfile, loadFixes: async () => new Map(), hasSite: () => true };
  const state = { status: 'done', tasks: ENTRIES };
  eq(await autoSendToBot(sb, { id: 'c1', name: 'K', publishing_profile: {} }, 'tech', state, deps), null, 'needs approval: nothing sent');
  eq(sb.tables.syte_suite_settings.length, 0);
  const client = { id: 'c1', name: 'K', url: 'https://x.co.za', cms_type: 'WordPress', publishing_profile: { techgrok_auto: true } };
  const out = await autoSendToBot(sb, client, 'tech', state, deps);
  eq([out.queued, sb.tables.syte_suite_settings.length, sb.tables.syte_suite_settings[0].data.ref], [1, 1, { task_id: 'h1' }]);
  eq(sb.tables.syte_suite_settings[0].data.requested_by, 'Tech Autopilot (monthly run)');
  const again = await autoSendToBot(sb, client, 'tech', { status: 'done', tasks: ENTRIES }, deps);
  eq([again.queued, again.skipped, sb.tables.syte_suite_settings.length], [0, 1, 1], 'an open job is not queued twice');
  eq(await autoSendToBot(sb, client, 'tech', { status: 'failed', tasks: ENTRIES }, deps), null, 'a failed run sends nothing');
});

await t('login: the browser never gets the password; a blank password keeps the stored one', () => {
  eq(publicLoginInfo(null), { set: false });
  const a = mergeLogin(null, { login_url: 'https://x.co.za/admin', username: 'chris@syte', password: 'pw1', notes: '2FA to Chris' }, { by: 'kristan', now: new Date('2026-11-14T10:00:00Z') });
  ok(!JSON.stringify(publicLoginInfo(a)).includes('pw1'), 'password leaked');
  eq(publicLoginInfo(a).has_password, true);
  eq(mergeLogin(a, { username: 'chris@syte', password: '' }).password, 'pw1');
  let bad = 0;
  for (const x of [{ password: 'p' }, { username: 'u' }, { username: 'u', password: 'p', login_url: 'ftp://x' }]) { try { mergeLogin(null, x); } catch { bad++; } }
  eq(bad, 3);
});

await t('site-login function: a person saves and reads back without the password; bot keys are refused', async () => {
  const store = { syte_suite_clients: [{ id: 'c1' }], syte_suite_client_secrets: [] };
  const sb = {
    from(name) {
      const rows = store[name];
      let f = () => true;
      const q = {
        select() { return q; },
        eq(k, v) { f = r => r[k] === v; return q; },
        maybeSingle: async () => ({ data: rows.find(f) || null, error: null }),
        upsert: async (row) => { const i = rows.findIndex(r => r.client_id === row.client_id); if (i >= 0) Object.assign(rows[i], row); else rows.push(row); return { error: null }; }
      };
      return q;
    }
  };
  process.env.WP_PROXY_AUTH = 'staffhash'; process.env.LEGACY_SUITE_AUTH = '1';
  const call = (body, headers = { 'x-suite-auth': 'staffhash' }) => siteLogin({ httpMethod: 'POST', headers, body: JSON.stringify(body) }, { supabase: sb });
  const saved = await call({ clientId: 'c1', action: 'save', login_url: 'https://x.co.za/login', username: 'admin', password: 's3cret' });
  eq(saved.statusCode, 200);
  ok(!saved.body.includes('s3cret'), 'password returned to the browser');
  eq(store.syte_suite_client_secrets[0].site_login.password, 's3cret');
  const got = JSON.parse((await call({ clientId: 'c1', action: 'get' })).body);
  eq([got.set, got.username, got.has_password, got.password], [true, 'admin', true, undefined]);
  eq((await call({ clientId: 'c1', action: 'get' }, {})).statusCode, 401, 'no credentials');
  eq((await call({ clientId: 'nope', action: 'get' })).statusCode, 404);
  eq(JSON.parse((await call({ clientId: 'c1', action: 'clear' })).body).set, false);
});

await t('bot API: the login is given only for a job the bot has claimed, and every read is audited', async () => {
  const db = memoryDb({
    syte_suite_clients: [{ id: 'c1', name: 'Custom Co', url: 'https://custom.co.za', created_at: '2026-01-01' }],
    syte_suite_tseo_tasks: [{ id: 't1', client_id: 'c1', status: 'open', title: 'Missing H1', page_url: 'https://custom.co.za/', fix_type: 'h1', description: 'x', created_at: '2026-11-01' }],
    syte_suite_client_secrets: [{ client_id: 'c1', site_login: { login_url: 'https://custom.co.za/admin', username: 'admin', password: 's3cret', notes: '' } }],
    syte_suite_settings: [],
    syte_suite_audit_log: []
  });
  const { key: fixer } = await createApiKey(db, { name: 'Fixer', scopes: FIXER_SCOPES });
  const { key: other } = await createApiKey(db, { name: 'Other bot', scopes: FIXER_SCOPES });
  const api = createApi({ db, env: { URL: 'https://suite.test', WP_PROXY_AUTH: 'staffhash', LEGACY_SUITE_AUTH: '1' }, fetchImpl: async () => ({ status: 202 }), deps: { findApiKey: async h => db.tables.syte_suite_api_keys.find(k => k.key_hash === h) || null, getUser: async () => null }, mailer: async () => {} });
  let n = 0;
  const call = (method, path, { body, key, staff } = {}) => api(new Request('https://suite.test/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(staff ? { 'X-Suite-Auth': 'staffhash' } : {}), ...(method === 'POST' ? { 'Idempotency-Key': 'k' + (++n) } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  const job = await (await call('POST', '/clients/c1/grok-jobs', { staff: true, body: { kind: 'tech', taskId: 't1' } })).json();
  ok(job.brief.includes('/grok-jobs/' + job.job_id + '/login'), 'brief tells the bot where the login is');
  eq((await call('GET', '/grok-jobs/' + job.job_id + '/login', { key: fixer })).status, 409, 'not claimed yet');
  await call('POST', '/grok-jobs/' + job.job_id + '/claim', { key: fixer });
  eq((await call('GET', '/grok-jobs/' + job.job_id + '/login', { key: other })).status, 403, 'another bot cannot read it');
  const res = await call('GET', '/grok-jobs/' + job.job_id + '/login', { key: fixer });
  const login = await res.json();
  eq([res.status, login.username, login.password], [200, 'admin', 's3cret']);
  ok(db.tables.syte_suite_audit_log.some(a => a.action === 'GET /grok-jobs/:id/login' && a.result === 'given' && a.actor.name === 'Fixer'), 'audited');
  db.tables.syte_suite_client_secrets[0].site_login = null;
  eq((await call('GET', '/grok-jobs/' + job.job_id + '/login', { key: fixer })).status, 404, 'none stored');
});

console.log(`\napprovalAndLogins: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
