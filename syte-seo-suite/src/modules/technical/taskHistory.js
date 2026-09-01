// Technical SEO work history — what has already been fixed, per page.
//
// A re-scan replaces a client's OPEN tasks and keeps done/verified ones as
// history, but nothing stopped the fresh triage from recreating a task for a
// fix that shipped last month. The crawler re-reports the issue whenever the
// change hasn't propagated (or the page can't be fetched cleanly), the model
// has no memory, and the account manager gets last month's brief again.
//
// This module turns completed tasks and the permanent implementation log
// into a per-page record of finished work. It is used as an exclusion list in
// the triage prompt and as a filter on the tasks that come back, so the
// month's shortlist is spent on issues that are genuinely still open.

import {
  pageIdentity,
  normalizeLabel,
  matchesAnyLabel,
  implementedByPage
} from '../../lib/priorWork.js';

export { pageIdentity };

// Fix types a page can only have one of. Once the meta title on /pricing has
// been rewritten, "rewrite the meta title on /pricing" is done — the wording
// of the next suggestion is irrelevant.
export const SINGLE_INSTANCE_FIX_TYPES = new Set([
  'meta_title',
  'meta_description',
  'canonical',
  'h1',
  'robots',
  'sitemap',
  'sitemap_submission',
  'gsc_setup',
  'domain_ownership',
  'analytics_setup',
  'gtm_setup'
]);

// Everything else (image_alt, internal_link, schema, redirect, page_speed…)
// can legitimately recur on the same page for a different image, link or
// entity, so those are matched on the task wording instead.

function emptyRecord() {
  return { labels: [], fixTypes: new Set() };
}

function addItem(map, pageUrl, { label, fixType }) {
  const id = pageIdentity(pageUrl);
  if (!id) return;
  if (!map.has(id)) map.set(id, emptyRecord());
  const rec = map.get(id);
  if (label && !rec.labels.some(l => normalizeLabel(l) === normalizeLabel(label))) {
    rec.labels.push(label);
  }
  const ft = String(fixType || '').toLowerCase();
  if (SINGLE_INSTANCE_FIX_TYPES.has(ft)) rec.fixTypes.add(ft);
}

// Build the per-page completed-work map for one client.
//
// A task that was marked done and then FAILED verification is not counted —
// the fix didn't land, so the next scan should raise it again. Same rule for
// implementation rows: 'failed' means it isn't on the page.
export function completedWorkForClient({ tasks, impls, clientId } = {}) {
  const map = new Map();

  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!t) continue;
    if (clientId && t.client_id !== clientId) continue;
    if (t.status !== 'done' && t.status !== 'verified') continue;
    addItem(map, t.page_url || t.url, {
      label: t.title || t.action_summary,
      fixType: t.fix_type
    });
  }

  for (const [pageId, items] of implementedByPage(impls, { module: 'technical', clientId })) {
    if (!map.has(pageId)) map.set(pageId, emptyRecord());
    for (const item of items) {
      const rec = map.get(pageId);
      if (item.label && !rec.labels.some(l => normalizeLabel(l) === normalizeLabel(item.label))) {
        rec.labels.push(item.label);
      }
      const ft = String(item.changeType || '').toLowerCase();
      if (SINGLE_INSTANCE_FIX_TYPES.has(ft)) rec.fixTypes.add(ft);
    }
  }

  return map;
}

export function isRepeatTask(task, rec) {
  if (!rec) return false;
  const ft = String(task?.fix_type || '').toLowerCase();
  if (ft && SINGLE_INSTANCE_FIX_TYPES.has(ft) && rec.fixTypes.has(ft)) return true;
  return matchesAnyLabel(task?.title || task?.action_summary, rec.labels);
}

// Drop tasks that repeat completed work. Returns the surviving tasks and the
// count removed, so the scan can say so rather than silently shrinking the
// hand-off.
export function filterRepeatTasks(tasks, completedByPage) {
  const list = Array.isArray(tasks) ? tasks : [];
  const map = completedByPage instanceof Map ? completedByPage : new Map();
  const kept = [];
  let removed = 0;
  for (const t of list) {
    const rec = map.get(pageIdentity(t?.page_url || t?.url));
    if (rec && isRepeatTask(t, rec)) { removed++; continue; }
    kept.push(t);
  }
  return { tasks: kept, removed };
}

// Render the completed-work map as the exclusion block for the triage
// prompt. Capped hard: the audit data is the expensive half of the context
// window and this is only a hint — the filter above is the guarantee.
export function completedWorkPrompt(completedByPage, { maxPages = 40, maxPerPage = 8 } = {}) {
  const map = completedByPage instanceof Map ? completedByPage : new Map();
  const lines = [];
  let pages = 0;
  for (const [pageId, rec] of map) {
    if (!rec.labels.length) continue;
    if (pages >= maxPages) break;
    pages++;
    lines.push(pageId + ':');
    for (const label of rec.labels.slice(-maxPerPage)) lines.push('  - ' + label);
  }
  return lines.join('\n');
}
