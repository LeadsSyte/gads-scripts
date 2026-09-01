// AEO run history — what this client has already been given, per page.
//
// The engine rotates pages so a re-run reaches new parts of the site, but a
// page that IS revisited used to be generated from scratch: same page, same
// HTML, same prompt, so the model produced the same answer block and the same
// FAQ section it produced last month. Worse, those repeats then competed for
// the 10 site-wide shortlist slots and pushed genuinely new work out.
//
// This module builds the per-page record of prior work — items shipped in an
// earlier run, items marked implemented, items explicitly rejected — and uses
// it twice: as an exclusion list in the generation prompt (so Claude spends
// the page's slots on gaps it has not already filled) and as a hard filter on
// what comes back (so a reworded repeat never reaches the shortlist).

import {
  pageIdentity,
  normalizeLabel,
  matchesAnyLabel,
  implementedByPage
} from '../../lib/priorWork.js';

export { pageIdentity };

// How many prior items we carry forward per page. Deep enough to cover a
// year of monthly runs at 3 items/page, shallow enough that the jsonb column
// and the prompt exclusion list both stay small.
export const MAX_PRIOR_KEYS_PER_PAGE = 60;

// Canonical "kind" of an optimization. Two items of the same kind on the
// same page are the same piece of work however the model worded them: a page
// gets ONE answer block, and once it has one we do not ask for another.
// Schema patterns are tested first so "FAQ Schema JSON-LD" resolves to
// faq_schema rather than colliding with an FAQ content section.
const SCHEMA_KINDS = [
  [/faq/i, 'faq_schema'],
  [/article|blogposting/i, 'article_schema'],
  [/author|e-?e-?a-?t/i, 'author_schema'],
  [/how-?to/i, 'howto_schema'],
  [/organi[sz]ation|local\s*business/i, 'org_schema'],
  [/product|offer/i, 'product_schema'],
  [/breadcrumb/i, 'breadcrumb_schema'],
  [/speakable/i, 'speakable_schema'],
  [/webpage|website/i, 'webpage_schema']
];

const CONTENT_KINDS = [
  [/answer\s*block|lead\s*answer/i, 'answer_block'],
  [/key\s*takeaway|tl;?dr/i, 'key_takeaways'],
  [/faq|frequently\s*asked/i, 'faq'],
  [/snippet/i, 'snippet_paragraphs'],
  [/entity|definition/i, 'entity_definitions'],
  [/comparison|compare|table/i, 'comparison_tables'],
  [/checklist|numbered\s*list|list-?based/i, 'list_based_content'],
  [/citation|external\s*source/i, 'external_citations'],
  [/heading\s*(hierarchy|structure)|h2\s*→?\s*h3/i, 'heading_hierarchy'],
  [/internal\s*link/i, 'internal_linking'],
  [/freshness|last\s*updated|updated\s*\w+\s*20\d\d/i, 'freshness_markers']
];

export function optLabel(opt) {
  return String(opt?.name || opt?.title || '').trim();
}

// Stable key for an optimization: type + name. Mirrors aeoOptKey in
// AEOEngine.jsx (which the rejection blocklist uses) so the two vocabularies
// stay interchangeable.
export function optKey(opt) {
  return (opt?.type || '') + '::' + optLabel(opt);
}

// The name half of a "type::name" key — what the exclusion list shows Claude.
export function labelFromKey(key) {
  const s = String(key || '');
  const i = s.indexOf('::');
  return i === -1 ? s : s.slice(i + 2);
}

export function optKind(opt) {
  const name = optLabel(opt);
  const type = String(opt?.type || '').toLowerCase();
  const isSchema = type === 'schema' || /schema|json-?ld/i.test(name);
  if (isSchema) {
    for (const [re, kind] of SCHEMA_KINDS) if (re.test(name)) return kind;
    // An unrecognised schema type gets no kind: two different uncommon
    // schemas on one page are different work, and label matching still
    // catches a genuine repeat.
    return '';
  }
  for (const [re, kind] of CONTENT_KINDS) if (re.test(name)) return kind;
  return '';
}

function emptyRecord() {
  return { keys: new Set(), labels: [], kinds: new Set() };
}

function record(map, pageUrl) {
  const id = pageIdentity(pageUrl);
  if (!id) return null;
  if (!map.has(id)) map.set(id, emptyRecord());
  return map.get(id);
}

function addItem(rec, { key, label, kind }) {
  if (!rec) return;
  if (key) rec.keys.add(key);
  if (label && !rec.labels.some(l => normalizeLabel(l) === normalizeLabel(label))) {
    rec.labels.push(label);
  }
  if (kind) rec.kinds.add(kind);
}

// Build the per-page prior-work map for one client.
//
// Sources, all of them "already handed over, do not send again":
//   results        — the saved page rows: what the last run shipped, plus the
//                    prior_keys ledger carried forward from runs before it
//   impls          — the permanent implementation log (module 'aeo'), minus
//                    anything whose verification came back failed
//   rejectionsByPage — items an account manager explicitly threw out
export function priorWorkForClient({ results, impls, rejectionsByPage, clientId } = {}) {
  const map = new Map();

  const rows = results && typeof results === 'object' && !Array.isArray(results)
    ? Object.values(results)
    : (Array.isArray(results) ? results : []);
  for (const row of rows) {
    if (!row || !row.url) continue;
    if (clientId && row.client_id !== clientId) continue;
    const rec = record(map, row.url);
    if (!rec) continue;
    for (const key of Array.isArray(row.prior_keys) ? row.prior_keys : []) {
      addItem(rec, {
        key: String(key),
        label: labelFromKey(key),
        kind: optKind({ name: labelFromKey(key), type: String(key).split('::')[0] })
      });
    }
    for (const opt of Array.isArray(row.optimizations) ? row.optimizations : []) {
      addItem(rec, { key: optKey(opt), label: optLabel(opt), kind: optKind(opt) });
    }
  }

  for (const [pageId, items] of implementedByPage(impls, { module: 'aeo', clientId })) {
    if (!map.has(pageId)) map.set(pageId, emptyRecord());
    const rec = map.get(pageId);
    for (const item of items) {
      addItem(rec, {
        key: (item.changeType || '') + '::' + item.label,
        label: item.label,
        kind: optKind({ name: item.label, type: item.changeType })
      });
    }
  }

  // rejectionsByPage is the UI's Map of "clientId::url" → Set(optKey).
  if (rejectionsByPage instanceof Map) {
    for (const [mapKey, keys] of rejectionsByPage) {
      const sep = mapKey.indexOf('::');
      if (sep === -1) continue;
      if (clientId && mapKey.slice(0, sep) !== clientId) continue;
      const rec = record(map, mapKey.slice(sep + 2));
      for (const key of keys || []) {
        const label = labelFromKey(key);
        addItem(rec, { key, label, kind: optKind({ name: label, type: String(key).split('::')[0] }) });
      }
    }
  }

  return map;
}

// Is this optimization something the page has already been given?
export function isRepeatOptimization(opt, rec) {
  if (!rec) return false;
  if (rec.keys.has(optKey(opt))) return true;
  const kind = optKind(opt);
  if (kind && rec.kinds.has(kind)) return true;
  return matchesAnyLabel(optLabel(opt), rec.labels);
}

// Drop every optimization the client has already had, page by page. Runs
// BEFORE the site-wide ranker so repeats never occupy a shortlist slot.
// Returns the trimmed rows plus what was removed, for the progress line.
export function filterRepeatOptimizations(rows, priorByPage) {
  const list = Array.isArray(rows) ? rows : [];
  const map = priorByPage instanceof Map ? priorByPage : new Map();
  let removed = 0;
  const outRows = list.map(row => {
    // A page with no history still gets the intra-run pass below, so one
    // hand-off can't carry two answer blocks for the same page.
    const rec = map.get(pageIdentity(row?.url)) || emptyRecord();
    const opts = Array.isArray(row?.optimizations) ? row.optimizations : [];
    const kept = [];
    // Track kinds kept from THIS run too, so a page can't be handed two
    // answer blocks in a single hand-off either.
    const seenKinds = new Set();
    for (const opt of opts) {
      if (isRepeatOptimization(opt, rec)) { removed++; continue; }
      const kind = optKind(opt);
      if (kind && seenKinds.has(kind)) { removed++; continue; }
      if (kind) seenKinds.add(kind);
      kept.push(opt);
    }
    return { ...row, optimizations: kept };
  });
  return { rows: outRows, removed };
}

// The exclusion list handed to the model for one page. Newest last — the
// prompt asks for work that is NOT on this list.
export function priorLabelsForPage(priorByPage, pageUrl, limit = 25) {
  const rec = priorByPage instanceof Map ? priorByPage.get(pageIdentity(pageUrl)) : null;
  if (!rec || !rec.labels.length) return [];
  return rec.labels.slice(-limit);
}

// The ledger written back onto a saved page row: everything the page has
// ever been given, so the record survives the row's optimizations being
// replaced by the next run. Capped, oldest dropped first.
export function nextPriorKeys(existingRow, shippedOpts) {
  const keys = [];
  const seen = new Set();
  const push = (k) => {
    const key = String(k || '').trim();
    if (!key || key === '::' || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };
  for (const k of Array.isArray(existingRow?.prior_keys) ? existingRow.prior_keys : []) push(k);
  for (const opt of Array.isArray(existingRow?.optimizations) ? existingRow.optimizations : []) push(optKey(opt));
  for (const opt of Array.isArray(shippedOpts) ? shippedOpts : []) push(optKey(opt));
  return keys.slice(-MAX_PRIOR_KEYS_PER_PAGE);
}
