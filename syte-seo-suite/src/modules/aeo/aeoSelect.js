// Site-wide shortlist for AEO optimizations.
//
// The engine used to ship every optimization it generated: 5 per page ×
// `pages_per_month` pages, which on a 12-page client meant 60 items landing
// in one monthly hand-off. Nobody briefs a developer on 60 changes, so the
// tail was never implemented and the genuinely high-impact items were buried
// in it.
//
// The run now generates a small buffer across a handful of pages and ranks
// it down to ONE shortlist for the whole site — the best N items, wherever
// they happen to live. Ranking is deterministic (no model call): category
// weight, the model's own best-first ordering within a page, and how much
// traffic the page actually gets.

import { AEO_ITEMS_PER_RUN, MAX_OPTS_PER_PAGE } from './aeoTypes.js';

export { AEO_ITEMS_PER_RUN, MAX_OPTS_PER_PAGE };

// Content is what makes a page citable; schema only supports it. These
// weights are the whole reason a strong answer block on page 4 outranks a
// WebPage schema on the homepage.
const CATEGORY_WEIGHT = {
  content: 100,
  structure: 60,
  meta: 50,
  schema: 30
};

// Within a category, the specific optimization still matters — an answer
// block earns its slot more reliably than a freshness marker. Keyed by
// substrings of the optimization name so it survives model wording drift.
const NAME_BONUS = [
  [/answer\s*block/i, 18],
  [/key\s*takeaway|tl;?dr/i, 14],
  [/faq/i, 12],
  [/snippet/i, 10],
  [/comparison|table/i, 8],
  [/entity|definition/i, 6],
  [/internal\s*link/i, 5],
  [/freshness|updated/i, 2]
];

// How many pages to generate for, given a target shortlist size. Two pages'
// worth of headroom per slot would be wasteful; asking ~2 usable items per
// page gives the ranker real choice without paying for a 60-item generation.
export function pagesForTarget(target = AEO_ITEMS_PER_RUN, available = Infinity) {
  const t = Math.max(1, Math.round(Number(target) || AEO_ITEMS_PER_RUN));
  return Math.max(1, Math.min(Math.ceil(t / 2), available));
}

// The client's shortlist size. `aeo_items_per_month` lets an account that
// genuinely wants more (or fewer) override the default without touching
// `pages_per_month`, which the content module also reads.
export function aeoItemTarget(client) {
  const raw = Number(client?.aeo_items_per_month);
  if (!Number.isFinite(raw) || raw < 1) return AEO_ITEMS_PER_RUN;
  return Math.min(Math.round(raw), 50);
}

function categoryOf(opt) {
  const t = String(opt?.type || '').toLowerCase();
  if (CATEGORY_WEIGHT[t] != null) return t;
  // Some responses put the category in the name instead of the type.
  if (/schema|json-?ld/i.test(opt?.name || '')) return 'schema';
  return 'content';
}

export function scoreOptimization(opt, { sessions = 0, rankInPage = 0 } = {}) {
  const category = categoryOf(opt);
  let score = CATEGORY_WEIGHT[category] ?? 30;

  const name = String(opt?.name || opt?.title || '');
  for (const [re, bonus] of NAME_BONUS) {
    if (re.test(name)) { score += bonus; break; }
  }

  // Trust the model's own ordering within the page — index 0 is its pick.
  score -= rankInPage * 6;

  // Traffic, on a log scale so a 50k-session homepage doesn't drown out
  // every other page on the site.
  score += Math.log10(1 + Math.max(0, Number(sessions) || 0)) * 9;

  // An optimization with no pasteable implementation is not shippable —
  // push it below anything that is.
  const impl = String(opt?.implementation || opt?.code || '').trim();
  if (!impl) score -= 200;

  return score;
}

// Rank every optimization across every page and keep the best `limit`.
//
// `rows` is the per-page shape the engine already builds:
//   { url, path, sessions, optimizations: [...], ... }
// Returns { rows, kept, generated, dropped } where `rows` carries only the
// surviving optimizations and pages trimmed to nothing are removed — a page
// that contributes nothing this month stays "uncovered" so the rotation
// picks it up again next run.
export function selectTopOptimizations(rows, {
  limit = AEO_ITEMS_PER_RUN,
  maxPerPage = MAX_OPTS_PER_PAGE,
  maxSchemaShare = 0.3
} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const cap = Math.max(1, Math.round(Number(limit) || AEO_ITEMS_PER_RUN));
  const perPage = Math.max(1, Math.round(Number(maxPerPage) || MAX_OPTS_PER_PAGE));
  const schemaCap = Math.max(1, Math.round(cap * maxSchemaShare));

  const candidates = [];
  list.forEach((row, rowIndex) => {
    const opts = Array.isArray(row?.optimizations) ? row.optimizations : [];
    opts.forEach((opt, optIndex) => {
      candidates.push({
        rowIndex,
        optIndex,
        opt,
        category: categoryOf(opt),
        score: scoreOptimization(opt, { sessions: row?.sessions, rankInPage: optIndex })
      });
    });
  });

  // Deterministic order: score desc, then original position. No Math.random,
  // no Date — two runs over the same generation produce the same shortlist.
  candidates.sort((a, b) =>
    b.score - a.score || a.rowIndex - b.rowIndex || a.optIndex - b.optIndex
  );

  const perPageCount = new Map();
  const keptByRow = new Map();
  let schemaKept = 0;
  let kept = 0;

  for (const c of candidates) {
    if (kept >= cap) break;
    if ((perPageCount.get(c.rowIndex) || 0) >= perPage) continue;
    if (c.category === 'schema' && schemaKept >= schemaCap) continue;

    perPageCount.set(c.rowIndex, (perPageCount.get(c.rowIndex) || 0) + 1);
    if (!keptByRow.has(c.rowIndex)) keptByRow.set(c.rowIndex, []);
    keptByRow.get(c.rowIndex).push(c);
    if (c.category === 'schema') schemaKept++;
    kept++;
  }

  const outRows = [];
  list.forEach((row, rowIndex) => {
    const picks = keptByRow.get(rowIndex);
    if (!picks || !picks.length) {
      // Keep error rows so a failed fetch still surfaces in the UI.
      if (row?.error) outRows.push({ ...row, optimizations: [] });
      return;
    }
    picks.sort((a, b) => a.optIndex - b.optIndex);
    outRows.push({ ...row, optimizations: picks.map(p => p.opt) });
  });

  return {
    rows: outRows,
    kept,
    generated: candidates.length,
    dropped: Math.max(0, candidates.length - kept)
  };
}
