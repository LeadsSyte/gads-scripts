// One authorisation check for every Netlify function (security brief,
// 2 Nov 2026, §1.4–1.5). Before this, each function had its own check — or
// none (gemini-proxy, webceo-proxy, openai-proxy, page-proxy took requests
// from anyone on the internet) — and the only credential was X-Suite-Auth,
// a hash of the provider key the lock screen hands to every browser.
//
// authorize() accepts, in this order:
//   1. X-Internal-Auth: INTERNAL_FN_SECRET        server-to-server (schedulers,
//                                                 self-continuing background runs)
//   2. Authorization: Bearer <Supabase JWT>       a signed-in staff member
//                                                 (ALLOWED_STAFF_EMAILS narrows it)
//   3. Authorization: Bearer sk_syte_…            a service API key (Phase 2):
//                                                 hashed, scoped, revocable
//   4. X-Suite-Auth: <hash> == WP_PROXY_AUTH      the legacy browser header —
//                                                 ONLY while LEGACY_SUITE_AUTH is
//                                                 not '0'. Deploy B turns it off.
// Nothing else gets through. Pure apart from the injected `deps`, so tested
// in test/requireAuth.test.mjs without a network.

import crypto from 'node:crypto';
import { getServerSupabase } from './serverSupabase.js';

const PUBLIC_ORIGIN_RE = /^https:\/\/(deploy-preview-\d+--)?syte-seo-suite\.netlify\.app$/i;
const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

// Normalise a v1 handler event ({ httpMethod, headers, body }) so the same
// code serves it and a v2 Request.
export function fromEvent(event) {
  const h = event?.headers || {};
  const lower = {};
  for (const k of Object.keys(h)) lower[k.toLowerCase()] = h[k];
  return { method: String(event?.httpMethod || 'GET').toUpperCase(), header: n => lower[n.toLowerCase()] || '', body: event?.body || '' };
}
export function fromRequest(req) {
  return { method: String(req?.method || 'GET').toUpperCase(), header: n => req?.headers?.get?.(n) || '', body: null };
}

// CORS: the app's own origins only (production, deploy previews, local dev).
// Echoes the request origin when it is allowed; otherwise the production one.
export function corsHeaders(origin, env = process.env) {
  const allowed = new Set([String(env.APP_ORIGIN || ''), String(env.URL || ''), String(env.DEPLOY_PRIME_URL || '')].filter(Boolean).map(s => s.replace(/\/+$/, '')));
  const o = String(origin || '').replace(/\/+$/, '');
  const ok = o && (allowed.has(o) || PUBLIC_ORIGIN_RE.test(o) || LOCAL_ORIGIN_RE.test(o));
  return {
    'Access-Control-Allow-Origin': ok ? o : (env.APP_ORIGIN || env.URL || 'https://syte-seo-suite.netlify.app'),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Suite-Auth, X-Internal-Auth, Idempotency-Key',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin'
  };
}
export const corsFor = (event, env) => corsHeaders(fromEvent(event).header('origin'), env);

export const hashApiKey = key => crypto.createHmac('sha256', 'syte-api-key').update(String(key)).digest('hex');
const legacyAllowed = env => String(env.LEGACY_SUITE_AUTH ?? '1') !== '0';
const sameSecret = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

// req: fromEvent(event) | fromRequest(request)
// deps.getUser(jwt) → { user: { id, email } } | null ;  deps.findApiKey(hash) → row | null
// → { ok: true, actor: { kind: 'internal' | 'staff' | 'api_key', id, email, name, scopes } }
//   | { ok: false, status: 401 | 403, reason }
export async function authorize(req, { scopes = [], env = process.env, deps } = {}) {
  deps ??= defaultDeps();
  const internal = req.header('x-internal-auth');
  if (env.INTERNAL_FN_SECRET && internal && sameSecret(internal, env.INTERNAL_FN_SECRET)) {
    return { ok: true, actor: { kind: 'internal', id: 'server', scopes: ['*'] } };
  }

  const authz = req.header('authorization');
  const bearer = /^Bearer\s+(.+)$/i.exec(authz || '')?.[1]?.trim();
  if (bearer) {
    if (bearer.startsWith('sk_syte_')) {
      const row = deps.findApiKey ? await deps.findApiKey(hashApiKey(bearer)).catch(() => null) : null;
      if (!row) return { ok: false, status: 401, reason: 'Unknown API key.' };
      if (row.revoked_at) return { ok: false, status: 401, reason: 'This API key was revoked.' };
      const have = new Set(row.scopes || []);
      const missing = scopes.filter(s => !have.has(s) && !have.has('*'));
      if (missing.length) return { ok: false, status: 403, reason: 'This API key lacks the scope: ' + missing.join(', ') + '.' };
      return { ok: true, actor: { kind: 'api_key', id: row.id, name: row.name, scopes: [...have] } };
    }
    const res = deps.getUser ? await deps.getUser(bearer).catch(() => null) : null;
    const user = res?.user || res?.data?.user || null;
    if (!user?.id) return { ok: false, status: 401, reason: 'Sign-in token is missing, expired or invalid.' };
    const allow = String(env.ALLOWED_STAFF_EMAILS || '').split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allow.length && !allow.includes(String(user.email || '').toLowerCase())) return { ok: false, status: 403, reason: 'This account is not on the staff list.' };
    return { ok: true, actor: { kind: 'staff', id: user.id, email: user.email || '', scopes: ['*'] } };
  }

  const legacy = req.header('x-suite-auth');
  if (legacy && env.WP_PROXY_AUTH && legacyAllowed(env) && sameSecret(legacy, env.WP_PROXY_AUTH)) {
    return { ok: true, actor: { kind: 'legacy', id: 'suite', scopes: ['*'] } };
  }
  return { ok: false, status: 401, reason: 'Unauthorized.' };
}

// Background functions: Netlify answers 202 to ANY request before the code
// runs, so a bodyless GET/OPTIONS probe still starts a run unless the
// function refuses it first (brief §1.5, §1.7).
export function parseJsonPost(req) {
  if (req.method !== 'POST') return { error: { status: 405, reason: 'POST only.' } };
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '') : req.body; } catch { return { error: { status: 400, reason: 'Invalid JSON.' } }; }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length) return { error: { status: 400, reason: 'A JSON body is required.' } };
  return { body };
}

// v1 response helper.
export const deny = (status, headers, reason) => ({ statusCode: status, headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify({ error: reason || 'Unauthorized' }) });

// Wire-up for real functions: verify JWTs and look up API keys with the
// service-role client (never the anon key).
export function liveDeps(supabase) {
  return {
    getUser: async token => supabase.auth.getUser(token).then(r => (r?.error ? null : r?.data)),
    findApiKey: async hash => {
      const { data, error } = await supabase.from('syte_suite_api_keys').select('id, name, scopes, revoked_at').eq('key_hash', hash).maybeSingle();
      if (error) return null;
      if (data?.id) supabase.from('syte_suite_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {}, () => {});
      return data || null;
    }
  };
}

// What authorize() uses when a function passes no deps: the service-role
// client, or nothing (legacy and internal headers still verify) without one.
export function defaultDeps() {
  try { return liveDeps(getServerSupabase()); } catch { return {}; }
}

// The header server-side callers send to each other.
export function internalHeaders(env = process.env) {
  const h = {};
  if (env.INTERNAL_FN_SECRET) h['X-Internal-Auth'] = env.INTERNAL_FN_SECRET;
  else if (env.WP_PROXY_AUTH) h['X-Suite-Auth'] = env.WP_PROXY_AUTH; // until the secret is set
  return h;
}

// Background functions reuse browser modules (crawler, sitemap, CMS push)
// that call other functions by URL. Those modules read their credentials
// from these globals (src/lib/suiteAuth.js installs the browser's).
export function installServerAuthGlobals(env = process.env) {
  globalThis.__SYTE_PROXY_AUTH = env.WP_PROXY_AUTH || '';
  globalThis.__SYTE_AUTH_HEADERS = async () => internalHeaders(env);
}
