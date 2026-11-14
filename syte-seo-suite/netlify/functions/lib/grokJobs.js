// "Send to Grok bot": one technical fix or AEO addition, handed to the Fixer
// bot to do on the client's site by logging in like a person would.
//
// Why (Chris, 12 Nov 2026 call): items the suite cannot apply itself said
// "apply by hand" and stopped there. He wants a button on each technical and
// AEO item that sends the whole request to the Grok bot, which makes the
// change on the site and emails him what to review. He also wants an undo.
//
// A job is one settings row, id 'grokjob:<clientId>:<jobId>' (no schema
// change):
//   queued → claimed (the bot picked it up) → done | failed | skipped
// The bot records what it changed, with the value before and after, so the
// change can be reversed: "undo" queues a new job that puts the before
// values back. The bot works through the API (lib/apiRouter.js, scope
// grok:work); a person starts jobs from the suite.
//
// Pure; tested in test/grokJobs.test.mjs.

import { buildFixSheet } from '../../../src/modules/technical/fixSheet.js';

export const JOB_PREFIX = 'grokjob:';
export const OPEN = ['queued', 'claimed'];
export const RESULTS = ['done', 'failed', 'skipped'];
export const jobRowId = (clientId, jobId) => JOB_PREFIX + clientId + ':' + jobId;
export const refKey = ref => ref?.task_id ? 'tech:' + ref.task_id : ref?.undo_of ? 'undo:' + ref.undo_of : 'aeo:' + (ref?.url || '') + '|' + (ref?.opt_key || '');

// The single fix-sheet item for one technical task, whatever the suite
// could or could not do with it. → { item } | { refuse: reason }
export function techItem(client, task, fix) {
  if (!task) return { refuse: 'No such task.' };
  if (task.status !== 'open') return { refuse: 'That task is already ' + task.status + '.' };
  const sheet = buildFixSheet({ client, techTasks: [task], techFixes: { [task.id]: { status: 'manual', reason: fix?.status === 'manual' ? fix.reason : '' } } });
  if (!sheet.items.length) return { refuse: 'The independent check thinks this fix is wrong, so it is not sent to the bot. Correct the task first.' };
  return { item: sheet.items[0] };
}

// The item for one AEO optimisation on one page.
export function aeoItem(client, row, optKey, fix) {
  const opt = (row?.optimizations || []).find(o => (o.type || '') + '::' + (o.name || o.title || '') === optKey);
  if (!row || !opt) return { refuse: 'No such AEO optimisation on that page.' };
  if (fix?.status === 'applied') return { refuse: 'That addition is already on the page.' };
  if (opt.check && opt.check.verdict !== 'confirmed') return { refuse: 'The independent check has not confirmed this addition, so it is not sent to the bot.' };
  const sheet = buildFixSheet({ client, aeoRows: [{ ...row, optimizations: [opt] }], aeoFixes: { [row.url + '|' + optKey]: { status: 'manual', reason: fix?.status === 'manual' ? fix.reason : '' } } });
  if (!sheet.items.length) return { refuse: 'This addition cannot be briefed.' };
  return { item: sheet.items[0] };
}

export function newJob({ jobId, client, kind, ref, item, by, now }) {
  return {
    job_id: jobId, client_id: client.id, client_name: client.name || '', site_url: client.url || '', cms: client.cms_type || '',
    kind, ref, title: item.title || '', page_url: item.page_url || '', priority: item.priority || 'medium', item,
    status: 'queued', requested_by: by || '', requested_at: now,
    claimed_by: null, claimed_at: null, finished_at: null, result: null, note: '', changes: [], email_error: null, emailed_to: []
  };
}

// What the bot reads. Everything it needs for this one change, and what to
// report back.
export function renderJobBrief(job) {
  const it = job.item || {};
  const lines = [
    'JOB ' + job.job_id + ' — ' + job.client_name + ' (' + job.site_url + ')' + (job.cms ? ' · ' + job.cms : ''),
    job.kind === 'undo' ? 'UNDO an earlier change: put the page back exactly as it was.' : 'ONE change to make on the client\'s website.',
    '',
    (it.source ? '[' + it.source + '] ' : '') + job.title,
    'Page: ' + job.page_url
  ];
  if (it.problem) lines.push('What\'s wrong: ' + it.problem);
  if (it.where) lines.push('Where to change it: ' + it.where);
  if (it.change) { lines.push('The change:'); lines.push(String(it.change).trim()); }
  if (it.how_to_check) lines.push('Check: ' + it.how_to_check);
  if (it.check) lines.push('(' + it.check + ')');
  lines.push(
    '',
    'RULES',
    '- Log in with the saved Vault login for this site. If the Vault has none, GET /grok-jobs/' + job.job_id + '/login gives the login stored in the suite (type it in; never post it in a chat). If there is none or it fails, do not try another way in: report result "skipped" with the reason.',
    '- Before you change anything, copy the current value (the text, title, heading or code you are about to change). You must report it as "before" so the change can be undone.',
    '- Change only what is described. Do not touch other content, settings, plugins or themes.',
    '- Save the change (this is a live page; that is intended). Never publish drafts, never delete anything.',
    '- Do the Check step. If it does not pass, put the page back as it was and report result "failed".',
    '',
    'REPORT BACK (POST /grok-jobs/' + job.job_id + '/complete)',
    '{"result": "done" | "failed" | "skipped", "note": "<one or two lines: what you did, or why not>",',
    ' "changes": [{"url": "<page changed>", "what": "<what you changed, plainly>", "before": "<value before>", "after": "<value now>"}]}'
  );
  return lines.join('\n');
}

// Validates the bot's report. → { result, note, changes } or throws Error(message).
export function normalizeReport(body) {
  const result = String(body?.result || '');
  if (!RESULTS.includes(result)) throw new Error('`result` must be done, failed or skipped.');
  const note = String(body?.note || '').trim().slice(0, 1000);
  if (result !== 'done' && !note) throw new Error('`note` must say why the job was ' + result + '.');
  const changes = (Array.isArray(body?.changes) ? body.changes : []).slice(0, 20).map(c => ({
    url: String(c?.url || '').slice(0, 500), what: String(c?.what || '').trim().slice(0, 500),
    before: String(c?.before ?? '').slice(0, 20000), after: String(c?.after ?? '').slice(0, 20000)
  })).filter(c => c.what);
  if (result === 'done' && !changes.length) throw new Error('A done job must list what changed in `changes` (url, what, before, after).');
  return { result, note, changes };
}

// The undo of a finished job: put each change's "before" back.
export function undoItem(job) {
  if (job.status !== 'done') return { refuse: 'Only a finished job can be undone; this one is ' + job.status + '.' };
  if (job.kind === 'undo') return { refuse: 'This job is itself an undo. Send the original item again instead.' };
  if (job.undone_by) return { refuse: 'An undo for this job was already sent.' };
  if (!(job.changes || []).length) return { refuse: 'The bot recorded no changes for this job, so there is nothing to put back.' };
  const change = job.changes.map((c, i) => (i + 1) + '. On ' + (c.url || job.page_url) + ' — "' + c.what + '"\n   It is now:\n' + indent(c.after) + '\n   Put back:\n' + indent(c.before || '(it was empty: remove what was added)')).join('\n');
  return {
    item: {
      source: 'Undo', title: 'Undo: ' + job.title, page_url: job.page_url, priority: 'high',
      problem: 'The change made by job ' + job.job_id + ' on ' + String(job.finished_at || '').slice(0, 10) + ' is to be reversed.',
      where: 'The same place the change was made.', change,
      how_to_check: 'Open the page: it shows the "put back" value again and the earlier change is gone.', check: ''
    }
  };
}
const indent = s => String(s).split('\n').map(l => '      ' + l).join('\n');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n = 600) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };

// "The bot finished: please review" — what changed, on which links.
export function jobDoneEmail(job, siteUrl) {
  const word = job.result === 'done' ? (job.kind === 'undo' ? 'undid a change' : 'made a change') : job.result === 'skipped' ? 'skipped a job' : 'could not finish a job';
  const subject = '[Grok bot] ' + job.client_name + ': ' + (job.result === 'done' ? '' : job.result.toUpperCase() + ' — ') + job.title;
  const changes = (job.changes || []).map(c =>
    '<div style="border:1px solid #ddd;border-radius:6px;padding:10px 12px;margin:0 0 10px">'
    + '<div><a href="' + esc(c.url || job.page_url) + '">' + esc(c.url || job.page_url) + '</a></div>'
    + '<div style="margin:4px 0 6px"><strong>' + esc(c.what) + '</strong></div>'
    + '<div style="font-size:12px;color:#666">Before</div><pre style="white-space:pre-wrap;font-size:12px;background:#f6f6f6;padding:6px;border-radius:4px;margin:2px 0 6px">' + esc(clip(c.before) || '(empty)') + '</pre>'
    + '<div style="font-size:12px;color:#666">Now</div><pre style="white-space:pre-wrap;font-size:12px;background:#f6f6f6;padding:6px;border-radius:4px;margin:2px 0 0">' + esc(clip(c.after) || '(empty)') + '</pre></div>').join('');
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:680px">'
    + '<p style="margin:0 0 12px">The Grok bot ' + word + ' on <strong>' + esc(job.client_name) + '</strong>' + (job.result === 'done' ? '. Please review it on the site.' : '.') + '</p>'
    + '<p style="margin:0 0 12px"><strong>' + esc(job.title) + '</strong><br><a href="' + esc(job.page_url) + '">' + esc(job.page_url) + '</a></p>'
    + (job.note ? '<p style="margin:0 0 12px">' + esc(job.note) + '</p>' : '')
    + (changes ? '<p style="margin:0 0 6px"><strong>What changed</strong></p>' + changes : '')
    + (job.result === 'done' && job.kind !== 'undo' ? '<p style="margin:12px 0 0">Not happy with it? Open the item in the suite and click <strong>Undo via Grok bot</strong>: the bot puts the page back as it was.</p>' : '')
    + '<p style="color:#888;font-size:12px;margin-top:24px">Sent by ' + esc(job.requested_by || 'the suite') + ' · finished by ' + esc(job.claimed_by || 'the bot') + ' · ' + esc(siteUrl) + '</p></div>';
  return { subject, html };
}

// Jobs the bot should not see twice at once: oldest first, a few at a time.
export function nextJobs(jobs, limit = 5) {
  return jobs.filter(j => j.status === 'queued').sort((a, b) => String(a.requested_at).localeCompare(String(b.requested_at))).slice(0, limit);
}

// A claimed job the bot never finished goes back in the queue.
export const STALE_CLAIM_MS = 3 * 60 * 60 * 1000;
export const isStaleClaim = (job, nowMs) => job.status === 'claimed' && nowMs - new Date(job.claimed_at || 0).getTime() > STALE_CLAIM_MS;
