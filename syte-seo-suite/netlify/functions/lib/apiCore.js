// Building blocks of the bot API (/api/v1, security brief Phase 2): service
// keys, jobs, idempotent replays, audit rows, rate limits and completion
// webhooks. Everything here talks to the database through the small `db`
// adapter below so test/apiCore.test.mjs can run it against an in-memory one.

import crypto from 'node:crypto';
import { hashApiKey } from './requireAuth.js';

export const SCOPES = ['read', 'scan', 'fix:plan', 'fix:apply', 'content', 'queue:approve', 'publish', 'settings'];
export const RILEY_SCOPES = ['read', 'scan', 'fix:plan', 'content'];
export const JOB_STATUSES = ['queued', 'running', 'planning', 'applying', 'undoing', 'done', 'error', 'failed'];
export const TERMINAL = new Set(['done', 'error', 'failed']);

// ── db adapter ─────────────────────────────────────────────────────────────
// { insert(table, row) → row, update(table, match, patch) → rows,
//   one(table, match) → row|null, many(table, match, { order, desc, limit }) → rows,
//   rpc(name, args) → value }
export function supaDb(supabase) {
  const applyMatch = (q, match) => { for (const [k, v] of Object.entries(match || {})) q = v === null ? q.is(k, null) : q.eq(k, v); return q; };
  const unwrap = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };
  return {
    insert: async (table, row) => unwrap(await supabase.from(table).insert(row).select().single()),
    update: async (table, match, patch) => unwrap(await applyMatch(supabase.from(table).update(patch), match).select()),
    one: async (table, match) => unwrap(await applyMatch(supabase.from(table).select('*'), match).maybeSingle()),
    many: async (table, match, { order = 'created_at', desc = true, limit = 100, like, columns = '*' } = {}) => {
      let q = applyMatch(supabase.from(table).select(columns), match);
      for (const [k, v] of Object.entries(like || {})) q = q.like(k, v);
      if (order) q = q.order(order, { ascending: !desc });
      return unwrap(await q.limit(limit));
    },
    rpc: async (name, args) => unwrap(await supabase.rpc(name, args))
  };
}

// In-memory adapter for tests (and a dry-run mode).
export function memoryDb(seed = {}) {
  const tables = { ...seed };
  const rows = t => (tables[t] ||= []);
  const matches = (r, m) => Object.entries(m || {}).every(([k, v]) => (r[k] ?? null) === v);
  return {
    tables,
    insert: async (t, row) => { const r = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row }; rows(t).push(r); return r; },
    update: async (t, m, patch) => rows(t).filter(r => matches(r, m)).map(r => Object.assign(r, patch)),
    one: async (t, m) => rows(t).find(r => matches(r, m)) || null,
    many: async (t, m, { order = 'created_at', desc = true, limit = 100, like } = {}) => {
      // Like the real database: sorting by a column the table doesn't have
      // is an error, not a no-op, so tests catch a wrong sort column.
      const all = rows(t);
      if (order && all.length && !all.some(r => order in r)) throw new Error('column ' + t + '.' + order + ' does not exist');
      const likeRe = Object.entries(like || {}).map(([k, v]) => [k, new RegExp('^' + String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$')]);
      return rows(t).filter(r => matches(r, m) && likeRe.every(([k, re]) => re.test(String(r[k] ?? ''))))
        .sort((a, b) => (order && a[order] !== b[order] ? ((a[order] < b[order] ? -1 : 1) * (desc ? -1 : 1)) : 0)).slice(0, limit);
    },
    rpc: async (name, { p_key_id, p_bucket, p_window }) => {
      if (name !== 'syte_suite_rate_hit') throw new Error('unknown rpc ' + name);
      const r = rows('syte_suite_rate_limits').find(x => x.key_id === p_key_id && x.bucket === p_bucket && x.window_start === p_window);
      if (r) { r.count++; return r.count; }
      rows('syte_suite_rate_limits').push({ key_id: p_key_id, bucket: p_bucket, window_start: p_window, count: 1 });
      return 1;
    }
  };
}

// ── API keys (2.1) ─────────────────────────────────────────────────────────
const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function generateApiKey() {
  const bytes = crypto.randomBytes(40);
  let body = '';
  for (const b of bytes) body += B62[b % 62];
  const key = 'sk_syte_' + body.slice(0, 40);
  return { key, prefix: key.slice(0, 12), key_hash: hashApiKey(key) };
}
export function validScopes(scopes) {
  const list = Array.isArray(scopes) ? scopes.map(String) : [];
  const bad = list.filter(s => !SCOPES.includes(s));
  if (bad.length) throw new Error('Unknown scope: ' + bad.join(', ') + '. Allowed: ' + SCOPES.join(', ') + '.');
  return [...new Set(list)];
}
// → { row (without hash), key } — the key is shown this once.
export async function createApiKey(db, { name, scopes, created_by, webhook_url, webhook_secret }) {
  if (!name || !String(name).trim()) throw new Error('A key needs a name.');
  const gen = generateApiKey();
  const row = await db.insert('syte_suite_api_keys', { name: String(name).trim(), key_hash: gen.key_hash, prefix: gen.prefix, scopes: validScopes(scopes), created_by: created_by || null, webhook_url: webhook_url || null, webhook_secret: webhook_secret || null });
  const { key_hash, webhook_secret: _s, ...safe } = row;
  return { row: safe, key: gen.key };
}
export async function revokeApiKey(db, id) {
  const rows = await db.update('syte_suite_api_keys', { id }, { revoked_at: new Date().toISOString() });
  return rows.length > 0;
}
export const publicKeyRow = r => { const { key_hash, webhook_secret, ...safe } = r; return safe; };

// ── jobs (2.3) ─────────────────────────────────────────────────────────────
export async function createJob(db, { type, client_id, params = {}, actor }) {
  return db.insert('syte_suite_jobs', { type, client_id: client_id || null, params, status: 'queued', actor: actor || null, log: [], updated_at: new Date().toISOString() });
}
export async function updateJob(db, id, patch) {
  const now = new Date().toISOString();
  const p = { ...patch, updated_at: now };
  if (patch.status === 'running' && !patch.started_at) p.started_at = now;
  if (TERMINAL.has(patch.status)) p.finished_at = now;
  const rows = await db.update('syte_suite_jobs', { id }, p);
  return rows[0] || null;
}
export async function appendJobLog(db, id, message) {
  const job = await db.one('syte_suite_jobs', { id });
  if (!job) return null;
  const log = [...(job.log || []), { at: new Date().toISOString(), message: String(message).slice(0, 500) }].slice(-200);
  return updateJob(db, id, { log });
}
export const getJob = (db, id) => db.one('syte_suite_jobs', { id });
export async function listJobs(db, { client_id, status, limit = 50 } = {}) {
  const match = {};
  if (client_id) match.client_id = client_id;
  if (status) match.status = status;
  return db.many('syte_suite_jobs', match, { limit: Math.min(Number(limit) || 50, 200) });
}
// A second identical request while one is in flight returns the existing job (2.4).
export async function findInFlightJob(db, { type, client_id, target }) {
  const open = (await db.many('syte_suite_jobs', { type, client_id }, { limit: 50 })).filter(j => !TERMINAL.has(j.status));
  return open.find(j => !target || jobTarget(j) === target) || null;
}
export const jobTarget = j => j?.params?.taskId || (j?.params?.url ? j.params.url + '#' + (j.params.optKey || '') : '') || '';

// ── idempotency (2.4) ──────────────────────────────────────────────────────
export const requestHash = (method, path, body) => crypto.createHash('sha256').update(method + ' ' + path + ' ' + JSON.stringify(body ?? null)).digest('hex');
const IDEM_TTL_MS = 24 * 3600 * 1000;
// → { replay: { status, body } } | { conflict: reason } | {}
export async function idempotencyLookup(db, { key, actorId, hash }) {
  if (!key) return {};
  const row = await db.one('syte_suite_idempotency', { idem_key: key, actor_id: actorId });
  if (!row) return {};
  if (Date.now() - new Date(row.created_at).getTime() > IDEM_TTL_MS) return {};
  if (row.request_hash !== hash) return { conflict: 'This Idempotency-Key was already used for a different request.' };
  return { replay: { status: row.status, body: row.response } };
}
export async function idempotencyStore(db, { key, actorId, hash, status, body }) {
  if (!key) return;
  try { await db.insert('syte_suite_idempotency', { idem_key: key, actor_id: actorId, request_hash: hash, status, response: body }); } catch { /* a race stored it first */ }
}

// ── audit (2.7) ────────────────────────────────────────────────────────────
export async function audit(db, { actor, action, client_id, target, hash, result, ip }) {
  try { await db.insert('syte_suite_audit_log', { actor: actor || {}, action, client_id: client_id || null, target: target || null, request_hash: hash || null, result: result || null, ip: ip || null }); } catch { /* auditing never breaks the call */ }
}

// ── rate limits (2.8) ──────────────────────────────────────────────────────
export const DEFAULT_LIMITS = { scans: 10, fixes: 60, reads: 600, writes: 120 };
export function limitsFromEnv(env = process.env) {
  const out = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(out)) { const v = Number(env['API_LIMIT_' + k.toUpperCase()]); if (v > 0) out[k] = v; }
  return out;
}
// bucket class: 'scans' is per client; the others per key. → { ok, retryAfter }
export async function rateHit(db, { keyId, cls, clientId, limits = DEFAULT_LIMITS, now = Date.now() }) {
  const windowStart = new Date(Math.floor(now / 3600000) * 3600000).toISOString();
  const bucket = cls === 'scans' ? 'scans:' + (clientId || '-') : cls;
  let count;
  try { count = await db.rpc('syte_suite_rate_hit', { p_key_id: keyId, p_bucket: bucket, p_window: windowStart }); } catch { return { ok: true }; }
  const limit = limits[cls] ?? DEFAULT_LIMITS.reads;
  if (count <= limit) return { ok: true, remaining: limit - count };
  return { ok: false, retryAfter: Math.max(1, Math.ceil((new Date(windowStart).getTime() + 3600000 - now) / 1000)) };
}

// ── webhooks (2.6) ─────────────────────────────────────────────────────────
export function signWebhook(secret, bodyText, ts = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', String(secret)).update(ts + '.' + bodyText).digest('hex');
  return { 'X-Syte-Signature': 't=' + ts + ',v1=' + sig, 'X-Syte-Timestamp': String(ts) };
}
export function verifyWebhook(secret, bodyText, header, { now = Math.floor(Date.now() / 1000), tolerance = 300 } = {}) {
  const m = /t=(\d+),v1=([0-9a-f]+)/.exec(header || '');
  if (!m) return false;
  if (Math.abs(now - Number(m[1])) > tolerance) return false;
  const expect = crypto.createHmac('sha256', String(secret)).update(m[1] + '.' + bodyText).digest('hex');
  return expect.length === m[2].length && crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(m[2]));
}
// POSTs the event, retrying with backoff. → attempts made (0 when no URL).
export async function sendWebhook({ url, secret, event }, { fetchImpl = fetch, delays = [1000, 5000, 20000], sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (!url) return 0;
  const bodyText = JSON.stringify(event);
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? signWebhook(secret, bodyText) : {}) }, body: bodyText, signal: AbortSignal.timeout(10000) });
      if (res.ok) return attempt;
    } catch { /* retry */ }
    if (attempt > delays.length) return attempt;
    await sleep(delays[attempt - 1]);
  }
}

// ── client rows the API may return ─────────────────────────────────────────
// Credentials never leave the server (brief §1.2, 2.2). Anything not listed
// here that looks like a secret is also dropped.
// syte_suite_clients holds two secrets (wp_app_password, shopify_token) and
// one login name (wp_username); the Google refresh tokens live in
// syte_suite_google_accounts and are never read by the API.
export const CLIENT_SECRET_COLUMNS = new Set(['wp_app_password', 'shopify_token', 'wp_username']);
const SECRET_RE = /(password|secret|token|api_key|apikey|private_key)/i;
export function stripClientSecrets(client) {
  if (!client || typeof client !== 'object') return client;
  const out = {};
  for (const [k, v] of Object.entries(client)) {
    if (CLIENT_SECRET_COLUMNS.has(k) || SECRET_RE.test(k)) { if (v && SECRET_RE.test(k)) out[k.replace(/_(app_)?(password|token|secret|key)$/i, '') + '_configured'] = true; continue; }
    out[k] = v;
  }
  return out;
}
