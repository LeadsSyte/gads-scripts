// After a monthly technical or AEO run: send what the suite cannot do itself
// to the Grok bot, for clients that do not need approval.
//
// Chris, 12 Nov 2026: "an automation that runs the optimisations, technical
// and AEO, and sends an update with the links and what was updated", plus
// "on each client an option where we can say needs approval — it is still
// generated, but until it is approved it won't run". Per client:
//   techfix_auto / aeofix_auto    the suite makes the changes it can itself
//   techgrok_auto / aeogrok_auto  the rest goes to the Grok bot (grokJobs.js)
// All four off = needs approval: everything waits for a person's click.
//
// Only items the independent check confirmed are sent; items the suite can
// apply itself are left to it (they are sent only once it has tried and
// could not). Each job is the same as a "Send to Grok bot" click, so the bot
// emails what it changed and every change can be undone.

import crypto from 'node:crypto';
import { JOB_PREFIX, OPEN, jobRowId, refKey, techItem, aeoItem, newJob } from './grokJobs.js';
import { AUTO_FIX_TYPES } from './techFix.js';

const SUITE_GAVE_UP = ['manual', 'failed'];
const AEO_SUITE_TYPES = ['content', 'schema'];
const aeoKey = o => (o.type || '') + '::' + (o.name || o.title || '');

// state.tasks entries ({ task, check }) → the ones for the bot.
// openIds: ids of tasks still open on the board; fixes: Map taskId → status.
export function techForBot({ entries, openIds, fixes, siteConnected, suiteAuto }) {
  return (entries || []).filter(e => {
    if (e?.check?.verdict !== 'confirmed' || !e.task?.id || !openIds.has(e.task.id)) return false;
    const f = fixes.get(e.task.id);
    if (f?.status === 'applied') return false;
    const suiteCan = siteConnected && AUTO_FIX_TYPES.includes(e.task.fix_type);
    if (!suiteCan) return true;
    // The suite can do it: leave it to the suite unless it already tried.
    return suiteAuto && SUITE_GAVE_UP.includes(f?.status);
  }).map(e => ({ ...e, fix: fixes.get(e.task.id) }));
}

// state.rows ([{ url, optimizations }]) → [{ url, opt, optKey }] for the bot.
// fixes: Map fixKey(url, optKey) → status; keyOf(url, optKey) → that key.
export function aeoForBot({ rows, fixes, keyOf, siteConnected, suiteAuto }) {
  const out = [];
  for (const r of rows || []) {
    for (const opt of r.optimizations || []) {
      if (opt.check?.verdict !== 'confirmed') continue;
      const optKey = aeoKey(opt);
      const f = fixes.get(keyOf(r.url, optKey));
      if (f?.status === 'applied') continue;
      const suiteCan = siteConnected && AEO_SUITE_TYPES.includes(opt.type);
      if (suiteCan && !(suiteAuto && SUITE_GAVE_UP.includes(f?.status))) continue;
      out.push({ url: r.url, opt, optKey, fix: f });
    }
  }
  return out;
}

// Queue jobs for a client, skipping any item that already has an open job.
// → { queued, skipped }
export async function queueForBot(supabase, client, kind, picks, { by, now = new Date() } = {}) {
  const { data } = await supabase.from('syte_suite_settings').select('data').like('id', JOB_PREFIX + client.id + ':%');
  const openRefs = new Set((data || []).map(r => r.data).filter(j => j && OPEN.includes(j.status)).map(j => refKey(j.ref)));
  let queued = 0, skipped = 0;
  for (const p of picks) {
    const ref = kind === 'tech' ? { task_id: p.task.id } : { url: p.url, opt_key: p.optKey };
    if (openRefs.has(refKey(ref))) { skipped++; continue; }
    const { item, refuse } = kind === 'tech'
      ? techItem(client, { ...p.task, status: 'open' }, p.fix)
      : aeoItem(client, { url: p.url, optimizations: [p.opt] }, p.optKey, p.fix);
    if (refuse) { skipped++; continue; }
    const job = newJob({ jobId: crypto.randomUUID(), client, kind, ref, item, by, now: now.toISOString() });
    const { error } = await supabase.from('syte_suite_settings').insert({ id: jobRowId(client.id, job.job_id), data: job, updated_at: job.requested_at });
    if (error) { skipped++; continue; }
    openRefs.add(refKey(ref));
    queued++;
  }
  return { queued, skipped };
}

// The end-of-run step, for the monthly functions. Never throws: a failure is
// recorded on the run state and the run's own email still goes.
export async function autoSendToBot(supabase, client, kind, state, deps) {
  const { getPublishingProfile, loadFixes, keyOf, hasSite } = deps;
  const p = getPublishingProfile(client);
  const on = kind === 'tech' ? p.techgrok_auto : p.aeogrok_auto;
  if (!on || state?.status !== 'done') return null;
  try {
    const fixes = await loadFixes(supabase, client.id);
    const siteConnected = hasSite(client);
    let picks;
    if (kind === 'tech') {
      const { data } = await supabase.from('syte_suite_tseo_tasks').select('id').eq('client_id', client.id).eq('status', 'open');
      picks = techForBot({ entries: state.tasks, openIds: new Set((data || []).map(r => r.id)), fixes, siteConnected, suiteAuto: !!p.techfix_auto });
    } else {
      picks = aeoForBot({ rows: state.rows, fixes, keyOf, siteConnected, suiteAuto: !!p.aeofix_auto });
    }
    const out = await queueForBot(supabase, client, kind, picks, { by: kind === 'tech' ? 'Tech Autopilot (monthly run)' : 'AEO Autopilot (monthly run)' });
    state.grok = { ...out, at: new Date().toISOString() };
    return state.grok;
  } catch (e) {
    state.grok = { queued: 0, error: String(e?.message || e).slice(0, 200), at: new Date().toISOString() };
    return state.grok;
  }
}
