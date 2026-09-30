// One AEO addition, start to finish: preview, add to the page, undo — and
// "auto", which previews and adds in one go for clients whose additions go on
// the page without waiting for a person (publishing_profile.aeofix_auto, or
// "Add all" in the panel). Used by aeofix-background.js. Injected:
//
//   wp(path[, body])  the site's API (WordPress REST, or Shopify Admin)
//   ops               { plan, apply, undo } for that site (aeoFix.js /
//                     shopifyAeo.js); WordPress when left out
//   fetchHtml(url), save(status), previewUrlFor(key)
//   recordApplied({ opt, plan, live, by }) → implementation id
//   recordUndone(implId)

import { planAeoFix, applyAeoFix, undoAeoFix, aeoLiveCheck } from './aeoFix.js';

const WP_OPS = { plan: planAeoFix, apply: applyAeoFix, undo: undoAeoFix };

export const aeoOptKey = o => (o.type || '') + '::' + (o.name || o.title || ''); // = aeoOptKey in AEOEngine.jsx

// Sections and schema only — never anything that rewrites what's on the page.
export const canAutoAdd = opt => opt?.check?.verdict === 'confirmed' && ['content', 'schema'].includes(opt.type);

export async function runAeoFix({ url, opt, optKey, action, prev = null, by = 'approved in the suite' }, deps) {
  const { wp, fetchHtml, save, previewUrlFor, recordApplied, recordUndone } = deps;
  const ops = deps.ops || WP_OPS;

  if (!opt) return save({ status: 'manual', reason: 'This optimisation is no longer in the AEO Engine for that page.' });
  if (opt.check && opt.check.verdict !== 'confirmed') {
    return save({ status: 'manual', reason: 'Only optimisations the independent check confirmed are added automatically.' });
  }
  // Autopilot never adds what nobody checked.
  if (action === 'auto' && !opt.check) return save({ status: 'manual', reason: 'This optimisation has not been through the independent check.' });

  if (action === 'undo') {
    const plan = prev?.plan;
    if (!plan || prev?.status !== 'applied') return save({ ...(prev || {}), error: 'Nothing to undo.' });
    await save({ ...prev, status: 'undoing' });
    const r = await ops.undo(plan, wp);
    if (!r.ok) return save({ ...prev, status: 'applied', error: 'Could not remove it — remove it on the site by hand.' });
    await recordUndone(prev.impl_id || null);
    return save({ status: 'removed', plan });
  }

  if (action === 'plan' || action === 'auto') {
    if (prev?.status === 'applied') return prev;
    await save({ status: 'planning' });
    const plan = await ops.plan({ url, opt, optKey }, wp, fetchHtml);
    if (!plan.applicable) return save({ status: 'manual', reason: plan.reason });
    prev = await save({ status: 'planned', plan, preview_url: previewUrlFor(plan.key) });
    if (action === 'plan') return prev;
  }

  // apply
  const plan = prev?.plan;
  if (prev?.status !== 'planned' || !plan) return save({ ...(prev || {}), error: 'Preview it before adding it to the page.' });
  await save({ ...prev, status: 'applying', error: '' });
  const r = await ops.apply(plan, wp);
  if (!r.ok) return save({ ...prev, status: r.changed ? 'planned' : 'failed', error: r.reason || 'The site did not keep the change.' });
  const live = aeoLiveCheck(await fetchHtml(url), plan);
  const implId = await recordApplied({ opt, plan, live, by });
  return save({ ...prev, status: 'applied', error: '', live, impl_id: implId || null, by });
}

// items: [{ url, opt }] from the run. fixes: Map key → saved status, keyOf(url, optKey).
export async function runAllAeoFixes({ items, fixes, keyOf, by }, depsFor, { timeLeftMs = () => Infinity, perFixMs = 60000 } = {}) {
  const out = [];
  for (const { url, opt } of items.filter(x => canAutoAdd(x.opt))) {
    const optKey = aeoOptKey(opt);
    const prev = fixes.get(keyOf(url, optKey)) || null;
    // Added already, or a person took it off again: leave it.
    if (prev?.status === 'applied' || prev?.status === 'removed') { out.push({ url, opt, status: prev, skipped: true }); continue; }
    if (timeLeftMs() < perFixMs) { out.push({ url, opt, status: { status: 'waiting', reason: 'Ran out of time — run "Add all" again.' } }); continue; }
    const deps = depsFor(url, optKey);
    try {
      out.push({ url, opt, status: await runAeoFix({ url, opt, optKey, action: 'auto', prev, by }, deps) });
    } catch (e) {
      out.push({ url, opt, status: await deps.save({ status: 'failed', error: String(e.message || e).slice(0, 300) }) });
    }
  }
  return out;
}
