// The bot API, /api/v1 (security brief Phase 2). One route table drives the
// router, the scope checks and the OpenAPI document (lib/openapi.js).
// createApi() takes its database, environment and fetch as arguments so
// test/apiRouter.test.mjs runs the whole thing against the in-memory
// adapter; netlify/functions/api-v1.js wires the real ones.
//
// Every mutating call: scope check → rate limit → Idempotency-Key replay →
// handler → audit row. Background work returns 202 { jobId }; the job's
// status is derived from the suite's own state rows (lib/jobStatus.js).

import { authorize, fromRequest, corsHeaders, internalHeaders } from './requireAuth.js';
import { createJob, updateJob, getJob, listJobs, findInFlightJob, requestHash, idempotencyLookup, idempotencyStore, audit, rateHit, limitsFromEnv, stripClientSecrets, createApiKey, revokeApiKey, publicKeyRow, SCOPES } from './apiCore.js';
import { refreshJob, refreshOpenJobs } from './jobStatus.js';
import { buildOpenApi } from './openapi.js';
import { signedUrl } from './previewSig.js';
import { rewriteBlockReason } from './draftRewrite.js';
import crypto from 'node:crypto';
import { JOB_PREFIX, OPEN, jobRowId, refKey, techItem, aeoItem, newJob, renderJobBrief, normalizeReport, undoItem, jobDoneEmail, nextJobs, isStaleClaim } from './grokJobs.js';
import { getPublishingProfile } from '../../../src/modules/cms/publishingProfile.js';
import { buildFixSheet, renderFixSheetText } from '../../../src/modules/technical/fixSheet.js';

export class ApiError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const bad = (msg, extra) => new ApiError(400, msg, extra);

export const BACKGROUND_FN = { aeo_scan: 'aeoscan-run-background', tech_scan: 'techscan-run-background', aeo_fix: 'aeofix-background', tech_fix: 'techfix-background', autopilot: 'autopilot-run-background', aeo_report: 'aeoreport-run-background', report: 'report-run-background' };

// Columns a key with `settings` may write on a client. Credentials are not
// here and never will be: those move through the Connections UI only.
export const EDITABLE_CLIENT_FIELDS = ['name', 'url', 'industry', 'location', 'context', 'voice', 'audience', 'internal_links', 'ga4_property_id', 'gsc_property', 'wceo_project_id', 'sitemap_url', 'org_name', 'author', 'author_creds', 'pages_per_month', 'aeo_items_per_month', 'cms_type', 'wp_url', 'shopify_store', 'looker_url', 'client_type', 'brand_docs', 'account_manager', 'manager_technical', 'manager_content', 'manager_aeo', 'manager_reporting', 'reporting_email', 'start_date', 'aeo_probe_queries', 'competitors', 'rankscale_url', 'internal_notes', 'does_technical', 'does_content', 'does_aeo', 'does_reporting', 'content_rules', 'aeo_custom_queries', 'search_country', 'publishing_profile'];
// Settings rows the API may read or write, with the keys each accepts.
// 'global' holds provider keys and is never reachable.
export const SETTINGS_SCHEMAS = { 'autopilot-config': { report_email: 'string' } };
const FIX_ACTIONS = ['plan', 'apply', 'undo'];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// ── route table ────────────────────────────────────────────────────────────
// scope may be a string or a function(body) → string (fix actions).
// cls: rate-limit class — reads | writes | scans | fixes. staff: no API keys.
export const ROUTES = [
  r('GET', '/clients', 'read', 'reads', listClients, { summary: 'All clients, without credentials.', query: ['service'] }),
  r('POST', '/clients', 'settings', 'writes', createClient, { summary: 'Create a client.', body: clientBodySchema() }),
  r('GET', '/clients/:id', 'read', 'reads', getClient, { summary: 'One client, without credentials.' }),
  r('PATCH', '/clients/:id', 'settings', 'writes', patchClient, { summary: 'Update client fields (never credentials).', body: clientBodySchema() }),
  r('POST', '/clients/:id/scans/aeo', 'scan', 'scans', startAeoScan, { summary: 'Start the AEO scan (aeoscan-run-background).', body: obj({}), returns: '202 { jobId }' }),
  r('POST', '/clients/:id/scans/tech', 'scan', 'scans', startTechScan, { summary: 'Start the technical scan (techscan-run-background).', body: obj({ restart: { type: 'boolean', default: false } }), returns: '202 { jobId }' }),
  r('GET', '/clients/:id/aeo/results', 'read', 'reads', table('syte_suite_aeo_results', 'generated_at'), { summary: 'AEO page results with their optimisations.' }),
  r('GET', '/clients/:id/aeo/history', 'read', 'reads', table('syte_suite_aeo_history', 'created_at'), { summary: 'AEO snapshots.' }),
  r('GET', '/clients/:id/aeo/raw', 'read', 'reads', aeoRaw, { summary: 'One raw engine response by hash.', query: ['hash'] }),
  r('GET', '/clients/:id/aeo/deep', 'read', 'reads', table('syte_suite_aeo_deep', 'created_at'), { summary: 'Deep AEO results.' }),
  r('GET', '/clients/:id/aeo/rejections', 'read', 'reads', table('syte_suite_aeo_rejections', 'rejected_at'), { summary: 'AEO optimisations the team rejected.' }),
  r('GET', '/clients/:id/tech/tasks', 'read', 'reads', techTasks, { summary: 'Technical tasks (open | done | verified).', query: ['status'] }),
  r('GET', '/clients/:id/tech/rejections', 'read', 'reads', table('syte_suite_tseo_rejections', 'rejected_at'), { summary: 'Technical tasks the team rejected.' }),
  r('POST', '/clients/:id/aeo-fixes', fixScope, 'fixes', aeoFix, { summary: 'Plan, apply or undo one AEO addition (aeofix-background). apply/undo need fix:apply.', body: obj({ url: { type: 'string' }, optKey: { type: 'string', description: 'type::name of the optimisation' }, action: { type: 'string', enum: FIX_ACTIONS } }, ['url', 'optKey', 'action']), returns: '202 { jobId }' }),
  r('POST', '/clients/:id/tech-fixes', fixScope, 'fixes', techFix, { summary: 'Plan, apply or undo one technical task (techfix-background). apply/undo need fix:apply.', body: obj({ taskId: { type: 'string' }, action: { type: 'string', enum: FIX_ACTIONS } }, ['taskId', 'action']), returns: '202 { jobId }' }),
  r('POST', '/clients/:id/autopilot', 'content', 'writes', startAutopilot, { summary: "Run this month's content Autopilot, push the finished plan (mode: push), or write 1-3 more articles on top of a month that already ran (extra). Articles reach the site as drafts only.", body: obj({ mode: { type: 'string', enum: ['run', 'push'], default: 'run' }, restart: { type: 'boolean', default: false }, extra: { type: 'integer', minimum: 1, maximum: 3 } }), returns: '202 { jobId }' }),
  r('GET', '/clients/:id/autopilot', 'read', 'reads', settingsState('autopilot:'), { summary: "This month's Autopilot run state." }),
  r('POST', '/clients/:id/grok-jobs', 'content', 'writes', createGrokJob, { summary: "Send one technical fix or AEO addition to the Grok bot to do on the client's site by logging in (for work the suite cannot apply itself). Body: {kind:'tech', taskId} or {kind:'aeo', url, optKey}. An open job for the same item is returned instead of a second one.", body: obj({ kind: { type: 'string', enum: ['tech', 'aeo'] }, taskId: { type: 'string' }, url: { type: 'string' }, optKey: { type: 'string' } }, ['kind']) }),
  r('GET', '/clients/:id/grok-jobs', 'read', 'reads', listGrokJobs, { summary: "This client's Grok bot jobs, newest first.", query: ['status'] }),
  r('GET', '/grok-jobs', 'read', 'reads', listGrokJobs, { summary: 'Grok bot jobs across clients. ?status=queued is the work waiting for the bot, oldest first, each with its full `brief`.', query: ['status', 'client_id'] }),
  r('GET', '/grok-jobs/:id', 'read', 'reads', getGrokJob, { summary: 'One Grok bot job with its `brief` (what to change, where, how to check, what to report).' }),
  r('POST', '/grok-jobs/:id/claim', 'grok:work', 'writes', claimGrokJob, { summary: 'The bot takes a queued job before starting it, so no other bot does the same work.' }),
  r('POST', '/grok-jobs/:id/complete', 'grok:work', 'writes', completeGrokJob, { summary: "The bot's report when it has finished: result done | failed | skipped, a note, and for done the list of changes with the value before and after (needed for undo). The suite emails the reviewer what changed and logs it as external work.", body: obj({ result: { type: 'string', enum: ['done', 'failed', 'skipped'] }, note: { type: 'string' }, changes: { type: 'array', items: obj({ url: { type: 'string' }, what: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' } }, ['what']) } }, ['result']) }),
  r('GET', '/grok-jobs/:id/login', 'grok:work', 'reads', grokJobLogin, { summary: "The website login stored in the suite for this job's client (CMS → Connector → Website login), for sites with no Vault login. Only for a job the caller has claimed; every read is written to the audit log. Never post it in a chat." }),
  r('POST', '/grok-jobs/:id/undo', 'content', 'writes', undoGrokJob, { summary: 'Queue a job that puts back the "before" values of a finished job.' }),
  r('GET', '/clients/:id/blueprint', 'read', 'reads', getBlueprint, { summary: "The client's article blueprint (how their own published articles are written: structure, headings, tone, recurring elements) and the state of the last learn. New articles and rewrites follow it; check drafts against it." }),
  r('POST', '/clients/:id/blueprint', 'content', 'writes', learnBlueprintRoute, { summary: "Learn (or re-learn) the blueprint from the articles published on the client's own blog (blueprint-learn-background; read-only on the site). A blueprint the team edited is kept unless force is true. Poll GET /clients/{id}/blueprint until learn.status is done, skipped, not_enough or failed.", body: obj({ force: { type: 'boolean' } }, []) }),
  r('GET', '/clients/:id/fix-sheet', 'read', 'reads', fixSheet, { summary: "The client's fix sheet: technical and AEO work the suite can't apply itself, as items, plain text, and a signed link a person or computer-use bot can open without a login." }),
  r('GET', '/clients/:id/articles', 'read', 'reads', table('syte_suite_content_blogs', 'created_at'), { summary: 'Written articles (content_blogs).' }),
  r('GET', '/clients/:id/implementations', 'read', 'reads', table('syte_suite_implementations', 'created_at'), { summary: 'Logged implementations.' }),
  r('GET', '/clients/:id/external-work', 'read', 'reads', table('syte_suite_external_work', 'work_date'), { summary: 'Work done outside the suite.' }),
  r('POST', '/clients/:id/external-work', 'content', 'writes', addExternalWork, { summary: 'Log work done outside the suite.', body: obj({ tool: { type: 'string' }, category: { type: 'string' }, description: { type: 'string' }, work_url: { type: 'string' }, work_date: { type: 'string', format: 'date' }, done_by: { type: 'string' } }, ['tool', 'description']) }),
  r('GET', '/clients/:id/baseline', 'read', 'reads', baseline, { summary: 'Latest baseline audit.' }),
  r('GET', '/clients/:id/reports', 'read', 'reads', reports, { summary: 'Generated reports; ?month=YYYY-MM&type=seo|aeo returns one in full.', query: ['month', 'type'] }),
  r('POST', '/clients/:id/reports', 'content', 'writes', startReport, { summary: 'Generate the monthly SEO (type seo) or AEO (type aeo) report.', body: obj({ type: { type: 'string', enum: ['seo', 'aeo'], default: 'seo' }, month: { type: 'string', pattern: 'YYYY-MM' }, force: { type: 'boolean', default: false } }), returns: '202 { jobId }' }),
  r('GET', '/settings/:id', 'read', 'reads', getSettings, { summary: 'A settings row (autopilot-config only).' }),
  r('PUT', '/settings/:id', 'settings', 'writes', putSettings, { summary: 'Update a settings row (autopilot-config: { report_email }).', body: obj({ report_email: { type: 'string' } }) }),
  r('GET', '/jobs', 'read', 'reads', listJobsRoute, { summary: 'Jobs, newest first.', query: ['client_id', 'status', 'limit'] }),
  r('GET', '/jobs/:id', 'read', 'reads', getJobRoute, { summary: 'One job with its current (derived) status.' }),
  r('GET', '/queue', 'read', 'reads', listQueue, { summary: 'CMS approval queue.', query: ['status', 'client_id'] }),
  r('POST', '/queue/:id/approve', 'queue:approve', 'writes', approveQueue, { summary: 'Approve a pushed draft; publish-approved publishes it within 15 min.' }),
  r('POST', '/queue/:id/reject', 'queue:review', 'writes', rejectQueue, { summary: 'Request changes on a pushed draft. The reason goes to the writer: unless the client has rewrite_on_changes off, the article is rewritten against it and the same draft is updated for review again (draft-rewrite-background; progress in payload.rewrite_status).', body: obj({ reason: { type: 'string' } }, ['reason']) }),
  r('POST', '/queue/:id/resubmit', 'content', 'writes', resubmitQueue, { summary: 'Send a draft for review again (notify-draft).' }),
  r('POST', '/queue/:id/unpublish', 'publish', 'writes', () => { throw new ApiError(501, 'Unpublish is only available in the suite for now.'); }, { summary: 'Not available through the API yet (501).' }),
  r('POST', '/reports/bot-summary', 'content', 'writes', postBotSummary, { summary: "Post the bot's monthly summary. The suite keeps it and emails it to the team's report address (Chris).", body: obj({ subject: { type: 'string' }, summary: { type: 'string', description: 'Plain text; blank lines separate paragraphs, lines starting "- " become bullets.' }, month: { type: 'string', pattern: 'YYYY-MM' }, needs_chris: { type: 'array', items: { type: 'string' }, description: 'Decisions and approvals for Chris, one per item.' } }, ['subject', 'summary']) }),
  r('GET', '/reports/bot-summaries', 'read', 'reads', listBotSummaries, { summary: 'Bot summaries posted so far, newest first.', query: ['limit'] }),
  r('GET', '/audit', 'read', 'reads', listAudit, { summary: 'Audit log of mutating calls.', query: ['client_id', 'limit'] }),
  r('GET', '/keys', 'settings', 'reads', listKeys, { summary: 'Service API keys (staff only).', staff: true }),
  r('POST', '/keys', 'settings', 'writes', createKey, { summary: 'Create a service API key; the key is returned once (staff only).', staff: true, body: obj({ name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string', enum: SCOPES } }, webhook_url: { type: 'string' }, webhook_secret: { type: 'string' } }, ['name', 'scopes']) }),
  r('POST', '/keys/:id/revoke', 'settings', 'writes', revokeKey, { summary: 'Revoke a key (staff only).', staff: true })
];
function r(method, path, scope, cls, handler, doc = {}) { return { method, path, scope, cls, handler, doc, segments: path.split('/').filter(Boolean) }; }
function obj(props, required) { return { type: 'object', properties: props, ...(required ? { required } : {}) }; }
function clientBodySchema() { return obj(Object.fromEntries(EDITABLE_CLIENT_FIELDS.map(f => [f, { type: f === 'publishing_profile' ? 'object' : 'string' }]))); }
// apply and undo need fix:apply; plan (and anything invalid, which the
// handler then rejects with 400) needs fix:plan.
function fixScope(body) { return ['apply', 'undo'].includes(body?.action) ? 'fix:apply' : 'fix:plan'; }

export function matchRoute(method, path) {
  const segs = path.split('/').filter(Boolean);
  for (const route of ROUTES) {
    if (route.method !== method || route.segments.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      const s = route.segments[i];
      if (s.startsWith(':')) params[s.slice(1)] = decodeURIComponent(segs[i]);
      else if (s !== segs[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}
export const pathAllowed = (method, path) => ROUTES.some(x => x.method !== method && matchRoute(x.method, path));

// ── the function body ──────────────────────────────────────────────────────
export function createApi({ db, env = process.env, fetchImpl = fetch, deps, now = () => Date.now(), mailer = null }) {
  const base = String(env.URL || 'https://syte-seo-suite.netlify.app').replace(/\/+$/, '');
  const limits = limitsFromEnv(env);

  return async function handle(req) {
    const url = new URL(req.url);
    const path = ('/' + url.pathname.replace(/^\/\.netlify\/functions\/api-v1/, '').replace(/^\/api\/v1/, '')).replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    const cors = corsHeaders(req.headers.get('origin'), env);
    const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors, ...extra } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'GET' && (path === '/openapi.json' || path === '/')) return json(200, buildOpenApi(ROUTES, base + '/api/v1'));

    const m = matchRoute(req.method, path);
    if (!m) return json(pathAllowed(req.method, path) ? 405 : 404, { error: pathAllowed(req.method, path) ? 'Method not allowed.' : 'No such endpoint. The spec is at /api/v1/openapi.json.' });
    const { route, params } = m;

    let body = null;
    if (!['GET', 'HEAD'].includes(req.method)) {
      const text = await req.text();
      if (text.trim()) { try { body = JSON.parse(text); } catch { return json(400, { error: 'The body must be JSON.' }); } }
      body = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    }
    const scope = typeof route.scope === 'function' ? route.scope(body) : route.scope;
    const auth = await authorize(fromRequest(req), { scopes: [scope], env, deps });
    if (!auth.ok) return json(auth.status, { error: auth.reason });
    const actor = auth.actor;
    if (route.doc.staff && actor.kind === 'api_key') return json(403, { error: 'Keys are managed by staff, not by API keys.' });

    const mutating = req.method !== 'GET';
    const ctx = { db, env, params, query: url.searchParams, body, actor, fetchImpl, now, base, path, route, mailer, ip: req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || null };
    const hash = requestHash(req.method, path, body);
    const idemKey = req.headers.get('idempotency-key') || '';
    const actorId = actor.kind + ':' + actor.id;

    if (mutating && idemKey) {
      const found = await idempotencyLookup(db, { key: idemKey, actorId, hash });
      if (found.conflict) return json(409, { error: found.conflict });
      if (found.replay) return json(found.replay.status, found.replay.body, { 'Idempotency-Replayed': 'true' });
    }
    if (actor.kind === 'api_key') {
      const rl = await rateHit(db, { keyId: actor.id, cls: route.cls, clientId: params.id, limits, now: now() });
      if (!rl.ok) return json(429, { error: 'Rate limit reached for ' + route.cls + '. Try again in ' + rl.retryAfter + ' s.' }, { 'Retry-After': String(rl.retryAfter) });
    }

    let status = 200, out;
    try {
      const res = await route.handler(ctx);
      // Handlers return either a plain result or an envelope { status, body }.
      const envelope = res && typeof res === 'object' && typeof res.status === 'number' && 'body' in res && Object.keys(res).length === 2;
      status = envelope ? res.status : 200; out = envelope ? res.body : (res ?? {});
    } catch (e) {
      status = e instanceof ApiError ? e.status : 500;
      out = { error: e instanceof ApiError ? e.message : 'Something went wrong on our side.', ...(e?.extra || {}) };
      if (status === 500) console.error('[api-v1]', req.method, path, e);
    }
    if (mutating) {
      await audit(db, { actor: { kind: actor.kind, id: actor.id, name: actor.name || actor.email || null }, action: req.method + ' ' + route.path, client_id: params.id && route.path.startsWith('/clients/') ? params.id : null, target: params.id && !route.path.startsWith('/clients/') ? params.id : (out?.jobId || null), hash, result: status + (out?.jobId ? ' job:' + out.jobId : out?.error ? ' ' + String(out.error).slice(0, 120) : ''), ip: ctx.ip });
      if (idemKey && status < 500) await idempotencyStore(db, { key: idemKey, actorId, hash, status, body: out });
    }
    return json(status, out);
  };
}

// ── shared pieces ──────────────────────────────────────────────────────────
async function clientOr404(ctx) {
  const c = await ctx.db.one('syte_suite_clients', { id: ctx.params.id });
  if (!c) throw new ApiError(404, 'No client with that id.');
  return c;
}
const lim = (q, def = 100, max = 500) => Math.min(Math.max(Number(q.get('limit')) || def, 1), max);
function requireString(body, field, { maxLen = 2000 } = {}) {
  const v = body?.[field];
  if (typeof v !== 'string' || !v.trim()) throw bad('`' + field + '` is required.');
  if (v.length > maxLen) throw bad('`' + field + '` is too long.');
  return v.trim();
}
// Start a background function as a job. A second identical request while
// the first is in flight gets the existing job back (brief 2.4).
async function startBackground(ctx, { type, body, target }) {
  const client = await clientOr404(ctx);
  const existing = await findInFlightJob(ctx.db, { type, client_id: client.id, target });
  if (existing) {
    const fresh = await refreshJob(ctx.db, existing, { now: ctx.now(), fetchImpl: ctx.fetchImpl });
    if (!['done', 'error', 'failed'].includes(fresh.status)) return { status: 200, body: { jobId: fresh.id, job: fresh, existing: true } };
  }
  const job = await createJob(ctx.db, { type, client_id: client.id, params: body, actor: { kind: ctx.actor.kind, id: ctx.actor.id, name: ctx.actor.name || ctx.actor.email || null } });
  let res;
  try {
    res = await ctx.fetchImpl(ctx.base + '/.netlify/functions/' + BACKGROUND_FN[type], { method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders(ctx.env) }, body: JSON.stringify({ ...body, clientId: client.id }), signal: AbortSignal.timeout(15000) });
  } catch (e) { res = { status: 0, statusText: String(e?.message || e) }; }
  if (res.status !== 202) {
    const failed = await updateJob(ctx.db, job.id, { status: 'failed', error: 'The background function did not accept the request (HTTP ' + res.status + ').' });
    throw new ApiError(502, 'The background function did not accept the request (HTTP ' + res.status + ').', { jobId: job.id, job: failed });
  }
  return { status: 202, body: { jobId: job.id, job } };
}
function table(name, order) {
  return async ctx => { await clientOr404(ctx); return ctx.db.many(name, { client_id: ctx.params.id }, { order, limit: lim(ctx.query) }); };
}
function settingsState(prefix) {
  return async ctx => { await clientOr404(ctx); const row = await ctx.db.one('syte_suite_settings', { id: prefix + ctx.params.id }); return row?.data || { status: 'none' }; };
}

// ── clients ────────────────────────────────────────────────────────────────
async function listClients(ctx) {
  const rows = await ctx.db.many('syte_suite_clients', {}, { order: 'name', desc: false, limit: 1000 });
  const svc = ctx.query.get('service');
  return rows.filter(c => !svc || c['does_' + svc] !== false).map(stripClientSecrets);
}
async function getClient(ctx) { return stripClientSecrets(await clientOr404(ctx)); }
function pickClientFields(body) {
  const out = {};
  for (const k of Object.keys(body || {})) {
    if (!EDITABLE_CLIENT_FIELDS.includes(k)) throw bad('`' + k + '` cannot be set through the API.' + (/password|token|username/i.test(k) ? ' Credentials are entered in the suite (Connections).' : ''));
    out[k] = body[k];
  }
  return out;
}
async function createClient(ctx) {
  const fields = pickClientFields(ctx.body);
  if (!fields.name) throw bad('`name` is required.');
  const row = await ctx.db.insert('syte_suite_clients', { ...fields, updated_at: new Date(ctx.now()).toISOString() });
  return { status: 201, body: stripClientSecrets(row) };
}
async function patchClient(ctx) {
  const client = await clientOr404(ctx);
  const fields = pickClientFields(ctx.body);
  if (!Object.keys(fields).length) throw bad('Nothing to update.');
  if (fields.publishing_profile) fields.publishing_profile = { ...(client.publishing_profile || {}), ...fields.publishing_profile };
  const rows = await ctx.db.update('syte_suite_clients', { id: client.id }, { ...fields, updated_at: new Date(ctx.now()).toISOString() });
  return stripClientSecrets(rows[0] || { ...client, ...fields });
}

// ── scans, fixes, autopilot, reports ───────────────────────────────────────
function startAeoScan(ctx) { return startBackground(ctx, { type: 'aeo_scan', body: {} }); }
function startTechScan(ctx) { return startBackground(ctx, { type: 'tech_scan', body: { restart: !!ctx.body.restart } }); }
function fixAction(body) {
  const action = String(body.action || '');
  if (!FIX_ACTIONS.includes(action)) throw bad('`action` must be one of ' + FIX_ACTIONS.join(', ') + '.');
  return action;
}
async function aeoFix(ctx) {
  const url = requireString(ctx.body, 'url'), optKey = requireString(ctx.body, 'optKey'), action = fixAction(ctx.body);
  return startBackground(ctx, { type: 'aeo_fix', body: { url, optKey, action, by: 'api:' + (ctx.actor.name || ctx.actor.kind) }, target: url + '#' + optKey });
}
async function techFix(ctx) {
  const taskId = requireString(ctx.body, 'taskId', { maxLen: 100 }), action = fixAction(ctx.body);
  return startBackground(ctx, { type: 'tech_fix', body: { taskId, action, by: 'api:' + (ctx.actor.name || ctx.actor.kind) }, target: taskId });
}
// ── Grok bot jobs (lib/grokJobs.js) ────────────────────────────────────────
const grokRows = async (ctx, pattern) => ctx.db.many('syte_suite_settings', {}, { like: { id: pattern }, order: 'id', limit: 2000 });
const withBrief = j => ({ ...j, brief: renderJobBrief(j) });
async function grokJobOr404(ctx) {
  const id = String(ctx.params.id || '').replace(/[^a-zA-Z0-9-]/g, '');
  const rows = id ? await grokRows(ctx, JOB_PREFIX + '%:' + id) : [];
  if (!rows.length) throw new ApiError(404, 'No Grok bot job with that id.');
  return rows[0];
}
const saveGrokJob = async (ctx, rowId, job) => { await ctx.db.update('syte_suite_settings', { id: rowId }, { data: job, updated_at: new Date(ctx.now()).toISOString() }); return job; };
async function queueGrokJob(ctx, client, { kind, ref, item }) {
  const open = (await grokRows(ctx, JOB_PREFIX + client.id + ':%')).map(r => r.data).find(j => OPEN.includes(j.status) && refKey(j.ref) === refKey(ref));
  if (open) return { status: 200, body: { ...withBrief(open), existing: true } };
  const at = new Date(ctx.now()).toISOString();
  const job = newJob({ jobId: crypto.randomUUID(), client, kind, ref, item, by: ctx.actor.name || ctx.actor.email || (ctx.actor.kind === 'legacy' ? 'the suite' : ctx.actor.kind), now: at });
  await ctx.db.insert('syte_suite_settings', { id: jobRowId(client.id, job.job_id), data: job, updated_at: at });
  return { status: 201, body: withBrief(job) };
}
async function createGrokJob(ctx) {
  const client = await clientOr404(ctx);
  const kind = ctx.body.kind;
  if (kind === 'tech') {
    const taskId = requireString(ctx.body, 'taskId', { maxLen: 100 });
    const task = await ctx.db.one('syte_suite_tseo_tasks', { id: taskId, client_id: client.id });
    const fix = (await ctx.db.one('syte_suite_settings', { id: 'techfix:' + client.id + ':' + taskId }))?.data;
    const { item, refuse } = techItem(client, task, fix);
    if (refuse) throw new ApiError(task ? 409 : 404, refuse);
    return queueGrokJob(ctx, client, { kind, ref: { task_id: taskId }, item });
  }
  if (kind === 'aeo') {
    const url = requireString(ctx.body, 'url', { maxLen: 1000 }), optKey = requireString(ctx.body, 'optKey', { maxLen: 500 });
    const row = (await ctx.db.many('syte_suite_aeo_results', { client_id: client.id, url }, { order: 'generated_at', limit: 1 }))[0];
    const fix = (await grokRows(ctx, 'aeofix:' + client.id + ':%')).map(r => r.data).find(f => f?.url === url && f?.opt_key === optKey);
    const { item, refuse } = aeoItem(client, row, optKey, fix);
    if (refuse) throw new ApiError(row ? 409 : 404, refuse);
    return queueGrokJob(ctx, client, { kind, ref: { url, opt_key: optKey }, item });
  }
  throw bad('`kind` must be tech or aeo.');
}
async function listGrokJobs(ctx) {
  const clientId = ctx.params.id ? (await clientOr404(ctx)).id : (ctx.query.get('client_id') || '').replace(/[^a-zA-Z0-9-]/g, '');
  const rows = await grokRows(ctx, JOB_PREFIX + (clientId || '%') + ':%');
  // A job the bot claimed and never finished goes back in the queue.
  for (const r of rows) if (isStaleClaim(r.data, ctx.now())) r.data = await saveGrokJob(ctx, r.id, { ...r.data, status: 'queued', claimed_by: null, claimed_at: null, note: 'Put back in the queue: the bot took it and did not report back.' });
  const status = ctx.query.get('status');
  let jobs = rows.map(r => r.data).filter(j => j && (!status || j.status === status));
  jobs = status === 'queued' ? nextJobs(jobs, lim(ctx.query, 5, 20)) : jobs.sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at))).slice(0, lim(ctx.query, 100, 500));
  return jobs.map(withBrief);
}
async function getGrokJob(ctx) { return withBrief((await grokJobOr404(ctx)).data); }
async function claimGrokJob(ctx) {
  const row = await grokJobOr404(ctx);
  if (row.data.status !== 'queued') throw new ApiError(409, 'This job is ' + row.data.status + ', not waiting in the queue.');
  return withBrief(await saveGrokJob(ctx, row.id, { ...row.data, status: 'claimed', claimed_by: ctx.actor.name || ctx.actor.email || ctx.actor.kind, claimed_at: new Date(ctx.now()).toISOString(), note: '' }));
}
async function completeGrokJob(ctx) {
  const row = await grokJobOr404(ctx);
  if (!OPEN.includes(row.data.status)) throw new ApiError(409, 'This job is already ' + row.data.status + '.');
  let report;
  try { report = normalizeReport(ctx.body); } catch (e) { throw bad(e.message); }
  const at = new Date(ctx.now()).toISOString();
  const job = { ...row.data, ...report, status: report.result, finished_at: at, claimed_by: row.data.claimed_by || ctx.actor.name || ctx.actor.kind };
  const cfg = (await ctx.db.one('syte_suite_settings', { id: 'autopilot-config' }))?.data || {};
  const to = String(cfg.report_email || '').split(/[,;\s]+/).map(x => x.trim()).filter(x => /@/.test(x));
  if (!to.length) job.email_error = 'No report email is set (Settings → Autopilot report email).';
  else {
    try {
      const send = ctx.mailer || (await import('./sendMail.js')).sendMail;
      await send({ to, ...jobDoneEmail(job, ctx.base) });
      job.emailed_to = to;
    } catch (e) { job.email_error = 'Email failed: ' + String(e?.message || e).slice(0, 200); }
  }
  await saveGrokJob(ctx, row.id, job);
  if (job.result === 'done') {
    // Shows in the suite's work log like any other outside work.
    try { await ctx.db.insert('syte_suite_external_work', { client_id: job.client_id, client_name: job.client_name, tool: 'Grok bot', category: job.kind === 'undo' ? 'Undo' : 'Fix', description: (job.kind === 'undo' ? '' : 'Done on the site: ') + job.title + (job.note ? ' — ' + job.note : ''), work_url: job.page_url || null, done_by: job.claimed_by }); } catch { /* the job itself is the record */ }
    if (job.kind === 'undo' && job.ref?.undo_of) {
      const orig = (await grokRows(ctx, JOB_PREFIX + '%:' + job.ref.undo_of))[0];
      if (orig) await saveGrokJob(ctx, orig.id, { ...orig.data, undone_at: at });
    }
  }
  return withBrief(job);
}
async function grokJobLogin(ctx) {
  const row = await grokJobOr404(ctx);
  const job = row.data;
  const me = ctx.actor.name || ctx.actor.email || ctx.actor.kind;
  if (job.status !== 'claimed') throw new ApiError(409, 'Claim the job first; the login is only given for a job in progress.');
  if (ctx.actor.kind === 'api_key' && job.claimed_by !== me) throw new ApiError(403, 'This job was claimed by ' + job.claimed_by + '.');
  const secrets = await ctx.db.one('syte_suite_client_secrets', { client_id: job.client_id });
  const login = secrets?.site_login;
  await audit(ctx.db, { actor: { kind: ctx.actor.kind, id: ctx.actor.id, name: me }, action: 'GET /grok-jobs/:id/login', client_id: job.client_id, target: job.job_id, result: login?.username ? 'given' : 'none stored', ip: ctx.ip });
  if (!login?.username || !login?.password) throw new ApiError(404, 'No website login is stored in the suite for ' + job.client_name + '. Use the saved Vault login, or report the job "skipped".');
  return { login_url: login.login_url || job.site_url, username: login.username, password: login.password, notes: login.notes || '' };
}
async function undoGrokJob(ctx) {
  const row = await grokJobOr404(ctx);
  const { item, refuse } = undoItem(row.data);
  if (refuse) throw new ApiError(409, refuse);
  const client = await ctx.db.one('syte_suite_clients', { id: row.data.client_id });
  if (!client) throw new ApiError(404, 'The client for this job no longer exists.');
  const out = await queueGrokJob(ctx, client, { kind: 'undo', ref: { undo_of: row.data.job_id }, item });
  await saveGrokJob(ctx, row.id, { ...row.data, undone_by: out.body.job_id });
  return out;
}

// ── article blueprint (lib/articleBlueprint.js) ────────────────────────────
async function getBlueprint(ctx) {
  const client = await clientOr404(ctx);
  const learn = (await ctx.db.one('syte_suite_settings', { id: 'blueprint:' + client.id }))?.data || { status: 'none' };
  const { blueprint: _b, ...state } = learn;
  return { blueprint: getPublishingProfile(client).article_blueprint || null, learn: state };
}
async function learnBlueprintRoute(ctx) {
  const client = await clientOr404(ctx);
  let res;
  try {
    res = await ctx.fetchImpl(ctx.base + '/.netlify/functions/blueprint-learn-background', { method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders(ctx.env) }, body: JSON.stringify({ clientId: client.id, force: ctx.body?.force === true }), signal: AbortSignal.timeout(15000) });
  } catch (e) { res = { status: 0 }; }
  if (res.status !== 202) throw new ApiError(502, 'The blueprint function did not accept the request (HTTP ' + res.status + ').');
  return { status: 202, body: { started: true, poll: '/clients/' + client.id + '/blueprint' } };
}
async function startAutopilot(ctx) {
  const mode = ctx.body.mode || 'run';
  if (!['run', 'push'].includes(mode)) throw bad('`mode` must be run or push.');
  const extra = ctx.body.extra == null ? 0 : Number(ctx.body.extra);
  if (!Number.isInteger(extra) || extra < 0 || extra > 3) throw bad('`extra` must be a whole number from 1 to 3.');
  if (extra && mode !== 'run') throw bad('`extra` only goes with mode run.');
  return startBackground(ctx, { type: 'autopilot', body: mode === 'push' ? { mode: 'push' } : extra ? { extra } : { restart: !!ctx.body.restart }, target: extra ? 'extra' : mode });
}
async function startReport(ctx) {
  const type = ctx.body.type || 'seo';
  if (!['seo', 'aeo'].includes(type)) throw bad('`type` must be seo or aeo.');
  const body = { force: !!ctx.body.force };
  if (ctx.body.month != null) { if (!MONTH_RE.test(String(ctx.body.month))) throw bad('`month` must look like 2026-10.'); body.month = ctx.body.month; }
  return startBackground(ctx, { type: type === 'aeo' ? 'aeo_report' : 'report', body, target: body.month || 'last' });
}

// ── fix sheet ──────────────────────────────────────────────────────────────
// Same content as the suite's "Copy for Grok" button (fix-sheet.js), so a
// coordinating bot can hand it to the computer-use Fixer without the UI.
async function fixSheet(ctx) {
  const client = await clientOr404(ctx);
  const id = client.id;
  const [techTasks, techFixRows, aeoRows, aeoFixRows] = await Promise.all([
    ctx.db.many('syte_suite_tseo_tasks', { client_id: id, status: 'open' }, { order: 'created_at', limit: 2000 }),
    ctx.db.many('syte_suite_settings', {}, { like: { id: 'techfix:' + id + ':%' }, order: 'id', limit: 5000 }),
    ctx.db.many('syte_suite_aeo_results', { client_id: id }, { order: 'generated_at', limit: 2000 }),
    ctx.db.many('syte_suite_settings', {}, { like: { id: 'aeofix:' + id + ':%' }, order: 'id', limit: 5000 })
  ]);
  const sheet = buildFixSheet({
    client,
    techTasks,
    techFixes: Object.fromEntries(techFixRows.map(r => [r.data?.task_id, r.data])),
    aeoRows,
    aeoFixes: Object.fromEntries(aeoFixRows.map(r => [r.data?.url + '|' + r.data?.opt_key, r.data])),
    now: new Date(ctx.now())
  });
  return { ...sheet, count: sheet.items.length, text: renderFixSheetText(sheet), url: signedUrl('fix-sheet', 's', id, { base: ctx.base, key: ctx.env.WP_PROXY_AUTH }) || null };
}

// ── reads ──────────────────────────────────────────────────────────────────
async function aeoRaw(ctx) {
  await clientOr404(ctx);
  const hash = ctx.query.get('hash');
  if (!hash) throw bad('?hash= is required (from a result\'s raw hash).');
  const row = await ctx.db.one('syte_suite_aeo_raw', { hash, client_id: ctx.params.id });
  if (!row) throw new ApiError(404, 'No raw response with that hash for this client.');
  return row;
}
async function techTasks(ctx) {
  await clientOr404(ctx);
  const match = { client_id: ctx.params.id };
  const status = ctx.query.get('status');
  if (status) match.status = status;
  return ctx.db.many('syte_suite_tseo_tasks', match, { order: 'created_at', limit: lim(ctx.query, 200, 1000) });
}
async function addExternalWork(ctx) {
  const client = await clientOr404(ctx);
  const row = { client_id: client.id, client_name: client.name, tool: requireString(ctx.body, 'tool', { maxLen: 100 }), description: requireString(ctx.body, 'description'), category: ctx.body.category ? String(ctx.body.category).slice(0, 60) : null, work_url: ctx.body.work_url ? String(ctx.body.work_url).slice(0, 1000) : null, done_by: ctx.body.done_by ? String(ctx.body.done_by).slice(0, 100) : (ctx.actor.name || 'api') };
  if (ctx.body.work_date) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ctx.body.work_date))) throw bad('`work_date` must look like 2026-10-31.'); row.work_date = ctx.body.work_date; }
  return { status: 201, body: await ctx.db.insert('syte_suite_external_work', row) };
}
async function baseline(ctx) {
  await clientOr404(ctx);
  const rows = await ctx.db.many('syte_suite_baselines', { client_id: ctx.params.id }, { order: 'captured_at', limit: 1 });
  if (!rows.length) throw new ApiError(404, 'No baseline captured for this client.');
  return rows[0];
}
async function reports(ctx) {
  await clientOr404(ctx);
  const month = ctx.query.get('month'), type = ctx.query.get('type');
  if (month || type) {
    if (!month || !MONTH_RE.test(month) || !['seo', 'aeo'].includes(type || '')) throw bad('Give both ?month=YYYY-MM and ?type=seo|aeo.');
    const row = await ctx.db.one('syte_suite_report_generated_log', { client_id: ctx.params.id, month, report_type: type });
    if (!row) throw new ApiError(404, 'No ' + type + ' report for ' + month + '.');
    return row;
  }
  const rows = await ctx.db.many('syte_suite_report_generated_log', { client_id: ctx.params.id }, { order: 'created_at', limit: lim(ctx.query, 24, 200) });
  return rows.map(({ email_body, microsite_json, microsite_html_override, report_data, qa, aeo_probe, ...rest }) => ({ ...rest, has_microsite: !!microsite_json, has_email: !!email_body }));
}

// ── settings ───────────────────────────────────────────────────────────────
function settingsSchema(id) {
  const schema = SETTINGS_SCHEMAS[id];
  if (!schema) throw new ApiError(404, 'That settings row is not available through the API. Available: ' + Object.keys(SETTINGS_SCHEMAS).join(', ') + '.');
  return schema;
}
async function getSettings(ctx) { settingsSchema(ctx.params.id); return (await ctx.db.one('syte_suite_settings', { id: ctx.params.id }))?.data || {}; }
async function putSettings(ctx) {
  const schema = settingsSchema(ctx.params.id);
  const patch = {};
  for (const [k, v] of Object.entries(ctx.body)) {
    if (!schema[k]) throw bad('`' + k + '` is not a field of ' + ctx.params.id + '. Fields: ' + Object.keys(schema).join(', ') + '.');
    if (v !== null && typeof v !== schema[k]) throw bad('`' + k + '` must be a ' + schema[k] + '.');
    patch[k] = v;
  }
  const existing = await ctx.db.one('syte_suite_settings', { id: ctx.params.id });
  const data = { ...(existing?.data || {}), ...patch };
  if (existing) await ctx.db.update('syte_suite_settings', { id: ctx.params.id }, { data, updated_at: new Date(ctx.now()).toISOString() });
  else await ctx.db.insert('syte_suite_settings', { id: ctx.params.id, data, updated_at: new Date(ctx.now()).toISOString() });
  return data;
}

// ── jobs ───────────────────────────────────────────────────────────────────
async function listJobsRoute(ctx) {
  const client_id = ctx.query.get('client_id') || undefined, status = ctx.query.get('status') || undefined;
  if (!status || !['done', 'error', 'failed'].includes(status)) await refreshOpenJobs(ctx.db, { client_id, now: ctx.now(), fetchImpl: ctx.fetchImpl });
  return listJobs(ctx.db, { client_id, status, limit: lim(ctx.query, 50, 200) });
}
async function getJobRoute(ctx) {
  const job = await getJob(ctx.db, ctx.params.id);
  if (!job) throw new ApiError(404, 'No job with that id.');
  return refreshJob(ctx.db, job, { now: ctx.now(), fetchImpl: ctx.fetchImpl });
}

// ── approval queue ─────────────────────────────────────────────────────────
const safeQueueRow = row => { if (!row) return row; const { approval_token, ...payload } = row.payload || {}; return { ...row, payload }; };
async function listQueue(ctx) {
  const match = {};
  const status = ctx.query.get('status'), client_id = ctx.query.get('client_id');
  if (status) match.status = status;
  if (client_id) match.client_id = client_id;
  return (await ctx.db.many('syte_suite_cms_queue', match, { order: 'created_at', limit: lim(ctx.query, 100, 500) })).map(safeQueueRow);
}
async function queueRow(ctx) {
  const row = await ctx.db.one('syte_suite_cms_queue', { id: ctx.params.id });
  if (!row) throw new ApiError(404, 'No queue item with that id.');
  return row;
}
async function approveQueue(ctx) {
  const row = await queueRow(ctx);
  if (row.status !== 'pushed') throw new ApiError(409, 'Only a draft awaiting review (status pushed) can be approved; this one is ' + row.status + '.');
  const at = new Date(ctx.now()).toISOString();
  const rows = await ctx.db.update('syte_suite_cms_queue', { id: row.id }, { status: 'approved', payload: { ...(row.payload || {}), approved_via: 'api', approved_by: ctx.actor.name || ctx.actor.email || ctx.actor.kind, approved_at: at } });
  return safeQueueRow(rows[0]);
}
async function rejectQueue(ctx) {
  const row = await queueRow(ctx);
  const reason = requireString(ctx.body, 'reason');
  if (!['pushed', 'approved'].includes(row.status)) throw new ApiError(409, 'Only a draft awaiting review or approved can have changes requested; this one is ' + row.status + '.');
  const at = new Date(ctx.now()).toISOString();
  const rows = await ctx.db.update('syte_suite_cms_queue', { id: row.id }, { status: 'changes_requested', payload: { ...(row.payload || {}), change_comment: reason, changes_requested_at: at, changes_requested_by: ctx.actor.name || ctx.actor.email || ctx.actor.kind } });
  // Hand it to the writer (draftRewrite.js) unless it cannot be rewritten.
  const client = await ctx.db.one('syte_suite_clients', { id: rows[0].client_id });
  const blocked = rewriteBlockReason(rows[0], getPublishingProfile(client || {}));
  let rewrite = blocked ? 'not started: ' + blocked : 'started';
  if (!blocked) {
    let res;
    try {
      res = await ctx.fetchImpl(ctx.base + '/.netlify/functions/draft-rewrite-background', { method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders(ctx.env) }, body: JSON.stringify({ queueId: row.id }), signal: AbortSignal.timeout(15000) });
    } catch (e) { res = { status: 0 }; }
    if (res.status !== 202) rewrite = 'not started: the rewrite function did not accept the request (HTTP ' + res.status + ')';
  }
  return { ...safeQueueRow(rows[0]), rewrite };
}
async function resubmitQueue(ctx) {
  const row = await queueRow(ctx);
  if (!['changes_requested', 'pushed', 'publish_failed'].includes(row.status)) throw new ApiError(409, 'This item cannot be resubmitted from status ' + row.status + '.');
  const rows = await ctx.db.update('syte_suite_cms_queue', { id: row.id }, { status: 'pushed' });
  let notified = false;
  try {
    const res = await ctx.fetchImpl(ctx.base + '/.netlify/functions/notify-draft', { method: 'POST', headers: { 'Content-Type': 'application/json', ...internalHeaders(ctx.env) }, body: JSON.stringify({ queueId: row.id }), signal: AbortSignal.timeout(15000) });
    notified = res.ok;
  } catch { /* the row is pushed either way */ }
  return { ...safeQueueRow(rows[0]), notified };
}

// ── bot summaries ──────────────────────────────────────────────────────────
// Riley's monthly summary reaches Chris through the suite: stored as a
// settings row 'bot-summary:<iso time>' (no schema change) and emailed from
// automation@ to the report address (autopilot-config.report_email).
const escHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function botSummaryHtml({ subject, summary, month, needs_chris = [], by }, siteUrl) {
  const blocks = String(summary).replace(/\r/g, '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean).map(b => {
    const lines = b.split('\n');
    if (lines.every(l => /^\s*[-*•]\s+/.test(l))) return '<ul style="margin:6px 0 12px 18px;padding:0">' + lines.map(l => '<li>' + escHtml(l.replace(/^\s*[-*•]\s+/, '')) + '</li>').join('') + '</ul>';
    return '<p style="margin:0 0 12px">' + lines.map(escHtml).join('<br>') + '</p>';
  }).join('');
  const needs = needs_chris.length
    ? '<div style="border:2px solid #b45309;border-radius:8px;padding:12px 16px;margin:0 0 18px;background:#fffbeb"><strong>Needs Chris</strong><ol style="margin:8px 0 0 18px;padding:0">' + needs_chris.map(n => '<li style="margin:3px 0">' + escHtml(n) + '</li>').join('') + '</ol></div>'
    : '';
  return '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#222">'
    + '<h2 style="margin:0 0 4px">' + escHtml(subject) + '</h2>'
    + '<p style="color:#666;margin:0 0 16px">From ' + escHtml(by || 'the Grok bots') + (month ? ' · ' + escHtml(month) : '') + ' · posted through the Syte SEO Suite</p>'
    + needs + blocks
    + '<p style="color:#888;font-size:12px;margin-top:24px">Approvals and fixes are done in the suite: ' + escHtml(siteUrl) + '</p></div>';
}
async function postBotSummary(ctx) {
  const subject = requireString(ctx.body, 'subject', { maxLen: 200 });
  const summary = requireString(ctx.body, 'summary', { maxLen: 50000 });
  if (ctx.body.month != null && !MONTH_RE.test(String(ctx.body.month))) throw bad('`month` must look like 2026-11.');
  const needs = Array.isArray(ctx.body.needs_chris) ? ctx.body.needs_chris.map(x => String(x).trim()).filter(Boolean).slice(0, 50).map(x => x.slice(0, 500)) : [];
  const at = new Date(ctx.now()).toISOString();
  const by = ctx.actor.name || ctx.actor.email || ctx.actor.kind;
  const cfg = (await ctx.db.one('syte_suite_settings', { id: 'autopilot-config' }))?.data || {};
  const to = String(cfg.report_email || '').split(/[,;\s]+/).map(x => x.trim()).filter(x => /@/.test(x));
  const data = { subject, summary, month: ctx.body.month || at.slice(0, 7), needs_chris: needs, by, at, emailed_to: [], email_error: null };
  if (!to.length) data.email_error = 'No report email is set (Settings → Autopilot report email).';
  else {
    try {
      const send = ctx.mailer || (await import('./sendMail.js')).sendMail;
      await send({ to, subject: '[Grok bots] ' + subject, html: botSummaryHtml(data, ctx.base) });
      data.emailed_to = to;
    } catch (e) { data.email_error = 'Email failed: ' + String(e?.message || e).slice(0, 200); }
  }
  const id = 'bot-summary:' + at;
  await ctx.db.insert('syte_suite_settings', { id, data, updated_at: at });
  return { status: 201, body: { id, ...data } };
}
async function listBotSummaries(ctx) {
  const rows = await ctx.db.many('syte_suite_settings', {}, { like: { id: 'bot-summary:%' }, order: 'id', desc: true, limit: lim(ctx.query, 20, 100) });
  return rows.map(r => ({ id: r.id, ...(r.data || {}) }));
}

// ── audit, keys ────────────────────────────────────────────────────────────
async function listAudit(ctx) {
  const match = {};
  if (ctx.query.get('client_id')) match.client_id = ctx.query.get('client_id');
  return ctx.db.many('syte_suite_audit_log', match, { order: 'created_at', limit: lim(ctx.query, 100, 1000) });
}
async function listKeys(ctx) { return (await ctx.db.many('syte_suite_api_keys', {}, { order: 'created_at', limit: 200 })).map(publicKeyRow); }
async function createKey(ctx) {
  try {
    const { row, key } = await createApiKey(ctx.db, { name: ctx.body.name, scopes: ctx.body.scopes, created_by: ctx.actor.email || ctx.actor.name || ctx.actor.kind, webhook_url: ctx.body.webhook_url, webhook_secret: ctx.body.webhook_secret });
    return { status: 201, body: { ...row, key, note: 'Store this key now; it is not shown again.' } };
  } catch (e) { throw bad(e.message); }
}
async function revokeKey(ctx) {
  if (!(await revokeApiKey(ctx.db, ctx.params.id))) throw new ApiError(404, 'No key with that id.');
  return { revoked: true, id: ctx.params.id };
}
