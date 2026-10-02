// One Tech Autopilot fix, start to finish: preview, apply, undo — and
// "auto", which is preview + apply in one go for clients whose fixes are
// applied without waiting for a person (publishing_profile.techfix_auto, or
// "Apply all" in the panel). Used by techfix-background.js for both a single
// fix and a whole client. Everything outside is injected:
//
//   wp(path[, body])            the site's API: WordPress REST (techFix.js)
//                               or Shopify Admin (shopifyFix.js)
//   ops                         { plan, apply, undo[, live] } for that site;
//                               WordPress when left out
//   fetchHtml(url)              the live page
//   save(status)                write this fix's status row
//   recordApplied({ entry, results, live, by }) → implementation id
//   recordUndone({ entry, implId })

import { planFix, applyPlan, undoResults, checkLive, AUTO_FIX_TYPES } from './techFix.js';

const WP_OPS = { plan: planFix, apply: applyPlan, undo: undoResults };

export const canAutoFix = entry => entry?.check?.verdict === 'confirmed' && AUTO_FIX_TYPES.includes(entry?.task?.fix_type);

const sameChanges = (a, b) => JSON.stringify((a || []).map(c => [c.target, c.to])) === JSON.stringify((b || []).map(c => [c.target, c.to]));

// prev: this fix's saved status (or null). Returns the final status.
export async function runTechFix({ entry, action, prev = null, by = 'approved in the suite' }, deps) {
  const { wp, fetchHtml, save, recordApplied, recordUndone } = deps;
  const ops = deps.ops || WP_OPS;

  if (entry.check?.verdict !== 'confirmed') {
    return save({ status: 'manual', reason: 'Only fixes the independent check confirmed are applied automatically.' });
  }

  if (action === 'plan') {
    await save({ status: 'planning' });
    const plan = await ops.plan(entry.task, wp);
    return save(plan.applicable ? { status: 'planned', plan } : { status: 'manual', reason: plan.reason });
  }

  if (action === 'undo') {
    if (prev?.status !== 'applied' || !prev.results?.length) return save({ ...(prev || {}), error: 'Nothing to undo.' });
    await save({ ...prev, status: 'undoing', error: '' });
    const undone = await ops.undo(prev.results, wp);
    const failed = undone.filter(r => !r.undone && !r.kept);
    if (failed.length) {
      return save({ ...prev, status: 'applied', error: 'Could not put it back (' + (failed[0].error || 'the site kept the new value') + ') — change it on the site by hand.' });
    }
    await recordUndone({ entry, implId: prev.impl_id || null });
    const kept = undone.filter(r => r.kept).length;
    return save({
      status: 'undone', plan: prev.plan, results: prev.results,
      note: kept ? kept + ' value(s) had been edited on the site since — those were left as they are.' : ''
    });
  }

  // apply (a person approved the preview) or auto (no preview step)
  if (prev?.status === 'applied') return prev;
  let approved = prev?.plan;
  if (action === 'apply') {
    if (prev?.status !== 'planned' || !approved) return save({ ...(prev || {}), error: 'Preview the change before applying it.' });
  }
  await save({ status: 'applying', plan: approved || null });
  const fresh = await ops.plan(entry.task, wp);
  if (action === 'auto') {
    if (!fresh.applicable) return save({ status: 'manual', reason: fresh.reason });
    approved = fresh;
  } else if (!fresh.applicable || !sameChanges(fresh.changes, approved.changes)) {
    return save({ status: 'planned', plan: fresh.applicable ? fresh : approved, error: 'The page changed since the preview — check the new preview and apply again.' });
  }
  // Nothing to do when the site already has the new value.
  if (approved.changes.every(c => (c.from || '') === c.to)) {
    return save({ status: 'not_needed', reason: 'The site already has this value — nothing to change.' });
  }

  const results = await ops.apply(approved, wp);
  const allOk = results.every(r => r.ok);
  if (!allOk) {
    // Put back anything that did stick, so a half-applied fix isn't left behind.
    if (results.some(r => r.ok)) { try { await ops.undo(results, wp); } catch { /* reported below */ } }
    return save({ status: 'failed', plan: approved, results, live: { status: 'failed', detail: 'The site did not keep the change.' }, reason: results.find(r => !r.ok)?.error || 'The site did not keep the change.' });
  }
  const live = ops.live ? await ops.live({ entry, results, fetchHtml }) : checkLive(await fetchHtml(entry.task.page_url), results);
  const implId = await recordApplied({ entry, results, live, by });
  return save({ status: 'applied', plan: approved, results, live, impl_id: implId || null, by });
}

// Every fix the suite can apply itself, one after another. Stops early when
// time runs short (the rest stay as they are for the next call).
// fixes: Map taskId → saved status. Returns [{ entry, status }].
export async function runAllTechFixes({ entries, fixes, by }, depsFor, { timeLeftMs = () => Infinity, perFixMs = 45000 } = {}) {
  const out = [];
  for (const entry of entries.filter(canAutoFix)) {
    const prev = fixes.get(entry.task.id) || null;
    if (['applied', 'undone', 'not_needed'].includes(prev?.status)) { out.push({ entry, status: prev, skipped: true }); continue; }
    if (timeLeftMs() < perFixMs) { out.push({ entry, status: { status: 'waiting', reason: 'Ran out of time — run "Apply all" again.' } }); continue; }
    const deps = depsFor(entry);
    try {
      out.push({ entry, status: await runTechFix({ entry, action: 'auto', prev, by }, deps) });
    } catch (e) {
      out.push({ entry, status: await deps.save({ status: 'failed', reason: String(e.message || e).slice(0, 300) }) });
    }
  }
  return out;
}
