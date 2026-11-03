// Bot API building blocks (brief Phase 2): keys, jobs, idempotency, audit,
// rate limits, webhooks, secret stripping — against the in-memory adapter.

import { memoryDb, createApiKey, revokeApiKey, generateApiKey, validScopes, RILEY_SCOPES, createJob, updateJob, appendJobLog, getJob, listJobs, findInFlightJob, requestHash, idempotencyLookup, idempotencyStore, audit, rateHit, signWebhook, verifyWebhook, sendWebhook, stripClientSecrets } from '../netlify/functions/lib/apiCore.js';
import { authorize, fromEvent, hashApiKey } from '../netlify/functions/lib/requireAuth.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const ok = (c, l) => { if (!c) throw new Error(l || 'expected truthy'); };

await t('keys: shown once, stored hashed, usable through authorize, revocable, scoped', async () => {
  const db = memoryDb();
  const { row, key } = await createApiKey(db, { name: 'Riley', scopes: RILEY_SCOPES, created_by: 'kristan@syte' });
  ok(key.startsWith('sk_syte_') && key.length === 48, 'key shape ' + key);
  eq(row.prefix, key.slice(0, 12));
  ok(!('key_hash' in row), 'hash not returned');
  eq(db.tables.syte_suite_api_keys[0].key_hash, hashApiKey(key));
  ok(!JSON.stringify(db.tables).includes(key), 'plaintext key never stored');
  const deps = { findApiKey: async h => db.tables.syte_suite_api_keys.find(k => k.key_hash === h) || null };
  const env = { WP_PROXY_AUTH: 'x' };
  const a = await authorize(fromEvent({ httpMethod: 'POST', headers: { authorization: 'Bearer ' + key } }), { env, deps, scopes: ['scan'] });
  eq([a.ok, a.actor.name], [true, 'Riley']);
  eq((await authorize(fromEvent({ httpMethod: 'POST', headers: { authorization: 'Bearer ' + key } }), { env, deps, scopes: ['queue:approve'] })).status, 403, "Riley's key cannot approve");
  eq(await revokeApiKey(db, row.id), true);
  eq((await authorize(fromEvent({ httpMethod: 'POST', headers: { authorization: 'Bearer ' + key } }), { env, deps, scopes: ['read'] })).status, 401, 'revoked → 401');
  let err = ''; try { validScopes(['read', 'admin']); } catch (e) { err = e.message; } ok(/Unknown scope: admin/.test(err));
  ok(generateApiKey().key !== generateApiKey().key);
});

await t('jobs: created queued, status moves set started/finished, log appends, in-flight dedupe by target', async () => {
  const db = memoryDb();
  const j = await createJob(db, { type: 'tech_fix', client_id: 'c1', params: { taskId: 't9', action: 'apply' }, actor: { kind: 'api_key', id: 'k1' } });
  eq(j.status, 'queued');
  const r = await updateJob(db, j.id, { status: 'running' }); ok(r.started_at && !r.finished_at);
  await appendJobLog(db, j.id, 'planning the change');
  eq((await getJob(db, j.id)).log.length, 1);
  eq((await findInFlightJob(db, { type: 'tech_fix', client_id: 'c1', target: 't9' }))?.id, j.id, 'same task in flight → same job');
  eq(await findInFlightJob(db, { type: 'tech_fix', client_id: 'c1', target: 't10' }), null);
  const d = await updateJob(db, j.id, { status: 'done', result: { changed: 1 } }); ok(d.finished_at);
  eq(await findInFlightJob(db, { type: 'tech_fix', client_id: 'c1', target: 't9' }), null, 'finished → not in flight');
  eq((await listJobs(db, { client_id: 'c1', status: 'done' })).length, 1);
});

await t('idempotency: replay returns the original response; a different body with the same key is a conflict', async () => {
  const db = memoryDb();
  const h = requestHash('POST', '/clients/c1/scans/aeo', { restart: false });
  eq(await idempotencyLookup(db, { key: 'abc', actorId: 'k1', hash: h }), {});
  await idempotencyStore(db, { key: 'abc', actorId: 'k1', hash: h, status: 202, body: { jobId: 'j1' } });
  eq((await idempotencyLookup(db, { key: 'abc', actorId: 'k1', hash: h })).replay, { status: 202, body: { jobId: 'j1' } });
  ok((await idempotencyLookup(db, { key: 'abc', actorId: 'k1', hash: requestHash('POST', '/clients/c1/scans/aeo', { restart: true }) })).conflict);
  eq(await idempotencyLookup(db, { key: 'abc', actorId: 'other', hash: h }), {}, 'keys are per actor');
  eq(await idempotencyLookup(db, { key: '', actorId: 'k1', hash: h }), {}, 'no header → nothing');
});

await t('audit rows are written and never throw', async () => {
  const db = memoryDb();
  await audit(db, { actor: { kind: 'api_key', id: 'k1' }, action: 'POST /clients/{id}/scans/aeo', client_id: 'c1', result: '202 job:j1' });
  eq(db.tables.syte_suite_audit_log.length, 1);
  await audit({ insert: async () => { throw new Error('db down'); } }, { actor: {}, action: 'x' });
});

await t('rate limits: per key and class, scans per client, 429 with Retry-After once over', async () => {
  const db = memoryDb();
  const limits = { scans: 2, fixes: 60, reads: 600 };
  const now = Date.UTC(2026, 10, 3, 10, 15);
  eq((await rateHit(db, { keyId: 'k1', cls: 'scans', clientId: 'c1', limits, now })).ok, true);
  eq((await rateHit(db, { keyId: 'k1', cls: 'scans', clientId: 'c1', limits, now })).ok, true);
  const over = await rateHit(db, { keyId: 'k1', cls: 'scans', clientId: 'c1', limits, now });
  eq(over.ok, false); eq(over.retryAfter, 45 * 60, 'seconds to the end of the hour window');
  eq((await rateHit(db, { keyId: 'k1', cls: 'scans', clientId: 'c2', limits, now })).ok, true, 'another client has its own scan bucket');
  eq((await rateHit(db, { keyId: 'k2', cls: 'scans', clientId: 'c1', limits, now })).ok, true, 'another key has its own');
});

await t('webhooks: signed, verifiable, stale signatures rejected, retries with backoff then gives up', async () => {
  const body = JSON.stringify({ jobId: 'j1', status: 'done' });
  const h = signWebhook('shh', body, 1000);
  ok(verifyWebhook('shh', body, h['X-Syte-Signature'], { now: 1000 }));
  ok(!verifyWebhook('other', body, h['X-Syte-Signature'], { now: 1000 }));
  ok(!verifyWebhook('shh', body, h['X-Syte-Signature'], { now: 1000 + 400 }), 'older than tolerance');
  ok(!verifyWebhook('shh', body + ' ', h['X-Syte-Signature'], { now: 1000 }), 'body changed');
  let calls = 0;
  const attempts = await sendWebhook({ url: 'https://riley.example/hook', secret: 'shh', event: { a: 1 } }, { fetchImpl: async () => { calls++; return { ok: calls >= 3 }; }, delays: [0, 0, 0], sleep: async () => {} });
  eq([attempts, calls], [3, 3]);
  const gaveUp = await sendWebhook({ url: 'https://riley.example/hook', event: {} }, { fetchImpl: async () => ({ ok: false }), delays: [0, 0], sleep: async () => {} });
  eq(gaveUp, 3, 'initial try + 2 retries');
  eq(await sendWebhook({ url: '', event: {} }), 0);
});

await t('client rows: credentials are replaced by *_configured flags', () => {
  const c = stripClientSecrets({ id: 'c1', name: 'Krost', wp_url: 'https://krost.co.za', wp_username: 'syte', wp_app_password: 'abcd efgh', shopify_token: '', gsc_refresh_token: 'r', publishing_profile: { approval_mode: 'client' }, some_api_key: 'k' });
  eq(c, { id: 'c1', name: 'Krost', wp_url: 'https://krost.co.za', wp_configured: true, gsc_refresh_configured: true, publishing_profile: { approval_mode: 'client' }, some_api_configured: true });
  ok(!JSON.stringify(c).includes('abcd efgh') && !JSON.stringify(c).includes('syte'), 'password and login name gone');
});

console.log(`\napiCore: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
