// What a bot API job is doing right now (brief 2.3).
//
// Netlify answers 202 to a background function before its code runs, and
// the functions report progress only into their own state rows in
// syte_suite_settings. So a job's status is DERIVED from those rows — the
// same rows the suite's own panels read — and written back to the job row
// whenever it changes. Terminal transitions fire the key's webhook (2.6).

import { updateJob, TERMINAL, sendWebhook } from './apiCore.js';

const STATE_PREFIX = { aeo_scan: 'aeoscan:', tech_scan: 'techscan:', autopilot: 'autopilot:', aeo_report: 'aeoreport:', report: 'reportscan:' };
const RUN_DONE = new Set(['done', 'skipped', 'blocked']);
const FIX_DONE = new Set(['planned', 'applied', 'undone', 'removed', 'not_needed', 'manual']);
const FIX_RUNNING = { planning: 'planning', applying: 'applying', undoing: 'undoing', waiting: 'running' };
const SLACK_MS = 60 * 1000;          // state may be stamped a little before the job row
const NEVER_STARTED_MS = 20 * 60 * 1000;

const ts = s => (s ? new Date(s).getTime() : 0);
const tailLog = log => (Array.isArray(log) ? log.slice(-5) : []);

function notStartedYet(job, now) {
  return now - ts(job.created_at) > NEVER_STARTED_MS
    ? { status: 'failed', error: 'The background run never started (no state after 20 minutes).' }
    : { status: 'queued' };
}

// → { status, progress?, result?, error? }
export async function deriveJobStatus(db, job, { now = Date.now() } = {}) {
  const cid = job.client_id;
  const params = job.params || {};

  if (STATE_PREFIX[job.type] || params.action === 'auto_all') {
    const prefix = STATE_PREFIX[job.type] || (job.type === 'aeo_fix' ? 'aeoscan:' : 'techscan:');
    const state = (await db.one('syte_suite_settings', { id: prefix + cid }))?.data;
    if (params.action === 'auto_all') {
      const auto = state?.auto;
      if (!auto || ts(auto.started_at) < ts(job.created_at) - SLACK_MS) return notStartedYet(job, now);
      if (auto.status === 'failed') return { status: 'failed', error: auto.reason || 'Automatic fixes failed.', result: auto };
      if (auto.status === 'done' || auto.status === 'skipped') return { status: 'done', result: auto };
      return { status: 'applying', progress: auto };
    }
    if (!state || ts(state.started_at || state.updated_at) < ts(job.created_at) - SLACK_MS) return notStartedYet(job, now);
    const progress = { status: state.status, stage: state.stage || null, month: state.month || null, updated_at: state.updated_at || null, log: tailLog(state.log) };
    if (state.status === 'failed') return { status: 'failed', error: state.error || 'The run failed.', progress };
    if (RUN_DONE.has(state.status)) return { status: 'done', progress, result: summariseRun(job.type, state) };
    return { status: 'running', progress };
  }

  if (job.type === 'aeo_fix' || job.type === 'tech_fix') {
    const like = (job.type === 'aeo_fix' ? 'aeofix:' : 'techfix:') + cid + ':%';
    // syte_suite_settings has no created_at: sorting by it made every fix-job
    // poll fail with a database error (found in Riley's first trial run).
    const rows = (await db.many('syte_suite_settings', {}, { like: { id: like }, order: 'id', limit: 1000 })).map(r => r.data).filter(Boolean);
    const row = job.type === 'tech_fix'
      ? rows.find(r => r.task_id === params.taskId)
      : rows.find(r => r.url === params.url && r.opt_key === params.optKey);
    if (!row || ts(row.at) < ts(job.created_at) - SLACK_MS) return notStartedYet(job, now);
    const { client_id, task_id, url, opt_key, key, ...status } = row;
    if (status.status === 'failed') return { status: 'failed', error: status.error || status.reason || 'The fix failed.', result: status };
    if (FIX_DONE.has(status.status)) return { status: 'done', result: status };
    return { status: FIX_RUNNING[status.status] || 'running', progress: status };
  }

  return { status: job.status };
}

function summariseRun(type, state) {
  switch (type) {
    case 'tech_scan': return { status: state.status, tasks: Array.isArray(state.tasks) ? state.tasks.length : undefined, pages: state.crawl?.pages?.length ?? state.crawl?.count, auto: state.auto || null };
    case 'aeo_scan': return { status: state.status, pages: Array.isArray(state.rows) ? state.rows.length : undefined, auto: state.auto || null };
    case 'autopilot': return { status: state.status, articles: state.articles ? Object.keys(state.articles).length : undefined, push_note: state.push_note || null };
    default: return { status: state.status, stage: state.stage || null, report: state.report ? true : undefined };
  }
}

// Re-derive, persist when changed, fire the webhook on a terminal transition.
// → the (possibly updated) job row
export async function refreshJob(db, job, { now = Date.now(), fetchImpl = fetch, webhook = sendWebhook } = {}) {
  if (!job || TERMINAL.has(job.status)) return job;
  const d = await deriveJobStatus(db, job, { now });
  const changed = d.status !== job.status || JSON.stringify(d.progress || null) !== JSON.stringify(job.progress || null);
  if (!changed) return job;
  const updated = await updateJob(db, job.id, { status: d.status, progress: d.progress ?? job.progress ?? null, result: d.result ?? null, error: d.error ?? null }) || { ...job, ...d };
  if (TERMINAL.has(d.status) && job.actor?.kind === 'api_key' && job.actor.id) {
    const key = await db.one('syte_suite_api_keys', { id: job.actor.id }).catch(() => null);
    if (key?.webhook_url) {
      await webhook({ url: key.webhook_url, secret: key.webhook_secret, event: { type: 'job.' + d.status, job: { id: job.id, type: job.type, client_id: job.client_id, status: d.status, result: d.result ?? null, error: d.error ?? null } } }, { fetchImpl }).catch(() => {});
    }
  }
  return updated;
}

// Every open job, refreshed. Used by GET /jobs and the jobs-sweep schedule.
export async function refreshOpenJobs(db, { client_id, limit = 200, ...opts } = {}) {
  const out = [];
  for (const status of ['queued', 'running', 'planning', 'applying', 'undoing']) {
    const match = { status }; if (client_id) match.client_id = client_id;
    for (const job of await db.many('syte_suite_jobs', match, { limit })) out.push(await refreshJob(db, job, opts));
  }
  return out;
}
