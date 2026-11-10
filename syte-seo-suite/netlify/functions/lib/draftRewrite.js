// Rewrite a draft that someone (a person or a Grok bot) sent back with
// "request changes", then put it back on the site for review.
//
//   changes_requested (with a reason) → Claude revises the article against
//   the reason and the client's rules → the independent checker reads it →
//   pass: the SAME draft on the site is updated in place (featured image
//   kept) and the queue row goes back to "pushed" (awaiting review), with
//   the usual draft-ready email; fail: the row stays "changes_requested"
//   and the checker's problems are recorded for a person.
//
// Never publishes and never approves: the push code only ever writes drafts
// (WordPress status draft, Shopify published:false), and approval stays a
// person's click. At most MAX_REWRITES rewrites per draft, so a bot and the
// writer can never loop. Per client: publishing_profile.rewrite_on_changes.
//
// Pure apart from the injected deps; tested in test/draftRewrite.test.mjs.

import { buildSystemPrompt } from '../../../src/modules/content/prompts.js';
import { staleTopicReason } from '../../../src/modules/content/staleTopics.js';
import { CHECKER_SYSTEM, buildCheckerInput, normalizeCheck } from './autopilot.js';

export const MAX_REWRITES = 2;

// '' when the row may be rewritten, otherwise the reason it may not.
export function rewriteBlockReason(row, profile = {}) {
  const p = row?.payload || {};
  if (!row) return 'no such draft';
  if (profile.rewrite_on_changes === false) return 'automatic rewrites are switched off for this client';
  if (row.module !== 'content' || row.change_type !== 'article') return 'only articles are rewritten automatically';
  if (row.status !== 'changes_requested') return 'the draft is "' + row.status + '", not waiting for changes';
  if (!(p.wp_id || p.shopify_article_id)) return 'there is no draft on the site to update';
  if (!String(p.html || '').trim()) return 'the article text is not stored with this draft';
  if (!String(p.change_comment || '').trim()) return 'no reason was given for the changes';
  if ((p.rewrite_history || []).length >= MAX_REWRITES) return 'already rewritten ' + MAX_REWRITES + ' times; a person needs to look at it';
  return '';
}

export function buildRevisePrompt(original, reason) {
  return `This article was written for the client above and pushed to their website as a draft. A reviewer sent it back with these requested changes:

"""
${String(reason).slice(0, 4000)}
"""

Revise the article so it does what the reviewer asked, and so it follows every client rule in your instructions. Change only what the feedback and the rules require; keep everything else as it is.

Return the complete revised article in exactly the same format as the original: the same sections in the same order, the same meta lines (Meta Title, Meta Description and any others), and the same H1 title unless the feedback asks for a new title. Return only the article: no notes, no explanation of what you changed, no placeholders.

ORIGINAL ARTICLE:
"""
${String(original).slice(0, 60000)}
"""`;
}

// Unwrap only a reply wrapped whole in a code fence. Articles often END
// with their own ```json schema block, whose closing fence must stay
// (seen on the first live rewrite, Krost 10 Nov 2026).
export function stripWrapper(s) {
  const t = String(s || '').trim();
  if (!/^```/.test(t)) return t;
  return t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
}
const strip = stripWrapper;

// deps: complete(opts) → text (Claude), checkArticle({system,user}) → raw JSON,
//       saveRow(id, patch), push(client, item, row) → { ok, verification, warnings }, now() → Date
// → { result: 'rewritten' | 'held' | 'blocked' | 'failed', reason?, problems? }
export async function rewriteDraft({ row, client, profile = {} }, deps) {
  const blocked = rewriteBlockReason(row, profile);
  if (blocked) return { result: 'blocked', reason: blocked };
  const p = row.payload || {};
  const at = (deps.now ? deps.now() : new Date()).toISOString();
  const history = [...(p.rewrite_history || [])];
  const entry = { at, requested_by: p.changes_requested_by || null, reason: String(p.change_comment).slice(0, 2000) };
  await deps.saveRow(row.id, { payload: { ...p, rewrite_status: 'running', rewrite_started_at: at } });

  try {
    const revised = strip(await deps.complete({
      system: buildSystemPrompt(client, ''),
      messages: [{ role: 'user', content: buildRevisePrompt(p.html, p.change_comment) }],
      max_tokens: 6000,
      temperature: 0.4
    }));
    if (revised.length < Math.min(400, String(p.html).length / 3)) throw new Error('the rewrite came back too short to be the whole article');

    let check;
    try {
      check = normalizeCheck(await deps.checkArticle({ system: CHECKER_SYSTEM, user: buildCheckerInput(client, revised, { topic_title: row.page_title || '', primary_keyword: p.primary_keyword || '' }) }));
    } catch (e) {
      check = { verdict: 'fail', problems: [{ severity: 'error', issue: 'Independent check did not run: ' + String(e?.message || e).slice(0, 200) }], summary: '' };
    }
    const stale = staleTopicReason(revised);
    if (stale) check = { ...check, verdict: 'fail', problems: [{ severity: 'error', issue: stale.slice(0, 300) }, ...(check.problems || [])] };

    if (check.verdict !== 'pass') {
      history.push({ ...entry, result: 'held', problems: check.problems });
      await deps.saveRow(row.id, { payload: { ...p, rewrite_status: 'held', rewrite_history: history, rewrite_problems: check.problems } });
      return { result: 'held', problems: check.problems };
    }

    history.push({ ...entry, result: 'rewritten' });
    const payload = {
      ...p,
      html: revised,
      previous_html: p.html,
      update_wp_id: p.wp_id || null,
      update_shopify_article_id: p.shopify_article_id || null,
      keep_hero: true,
      rewrite_status: 'done',
      rewrite_history: history,
      rewrite_problems: [],
      check_warnings: check.problems
    };
    const out = await deps.push(client, {
      module: row.module, page_url: row.page_url || client.url || '', page_title: row.page_title, change_type: row.change_type, payload
    }, row);
    return { result: 'rewritten', verification: out?.verification, warnings: out?.warnings || [] };
  } catch (e) {
    const reason = String(e?.message || e).slice(0, 300);
    history.push({ ...entry, result: 'failed', error: reason });
    await deps.saveRow(row.id, { status: 'changes_requested', payload: { ...p, rewrite_status: 'failed', rewrite_history: history } });
    return { result: 'failed', reason };
  }
}

// pushItemInline deps that reuse the existing queue row instead of logging a
// new one, so the draft keeps one history row. base = serverQueueDeps(...).
export function sameRowQueueDeps(base, row) {
  return {
    ...base,
    queue: async (r) => {
      await base.update(row.id, { status: 'pending', payload: r.payload, page_title: r.page_title });
      return { ...row, ...r, id: row.id, status: 'pending' };
    }
  };
}
