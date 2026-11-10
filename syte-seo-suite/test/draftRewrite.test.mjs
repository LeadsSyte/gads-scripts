// A draft sent back with "request changes" is rewritten and the same draft
// updated for review (lib/draftRewrite.js); never published or approved.

import { rewriteDraft, rewriteBlockReason, buildRevisePrompt, sameRowQueueDeps, MAX_REWRITES, stripWrapper } from '../netlify/functions/lib/draftRewrite.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const ORIGINAL = 'Meta Title: VNA Racking | Krost\nMeta Description: All about VNA.\n\n# VNA Racking Explained\n\n' + 'Very narrow aisle racking stores more pallets per square metre. '.repeat(30);
const REVISED = ORIGINAL.replace('stores more pallets', 'stores far more pallets');
const client = { id: 'c1', name: 'Krost', url: 'https://krost.co.za', content_rules: 'Use South African English.' };
const row = (extra = {}, payload = {}) => ({ id: 'q1', client_id: 'c1', module: 'content', change_type: 'article', status: 'changes_requested', page_title: 'VNA Racking Explained', page_url: '', payload: { html: ORIGINAL, wp_id: 20874, rest_base: 'posts', primary_keyword: 'vna racking', change_comment: 'Use the brand name Krost Shelving in the intro.', changes_requested_by: 'Riley', ...payload }, ...extra });

function deps({ revised = REVISED, verdict = 'pass', pushThrows = null } = {}) {
  const calls = { saves: [], pushes: [], prompts: [] };
  return {
    calls,
    d: {
      now: () => new Date('2026-11-10T08:00:00Z'),
      complete: async (o) => { calls.prompts.push(o); return revised; },
      checkArticle: async () => ({ verdict, problems: verdict === 'pass' ? [] : [{ severity: 'error', issue: 'States a price the brand reference does not support.' }], summary: '' }),
      saveRow: async (id, patch) => { calls.saves.push([id, patch]); },
      push: async (c, item, r) => { if (pushThrows) throw new Error(pushThrows); calls.pushes.push({ c, item, r }); return { ok: true, verification: 'clean', warnings: [] }; }
    }
  };
}

await t('only content articles waiting for changes, with a draft, text and a reason, are rewritten', () => {
  eq(rewriteBlockReason(row()), '');
  ok(/switched off/.test(rewriteBlockReason(row(), { rewrite_on_changes: false })), 'profile off');
  ok(/only articles/.test(rewriteBlockReason(row({ module: 'technical' }))), 'technical');
  ok(/not waiting/.test(rewriteBlockReason(row({ status: 'pushed' }))), 'status');
  ok(/no draft/.test(rewriteBlockReason(row({}, { wp_id: null }))), 'no draft');
  ok(/no reason/.test(rewriteBlockReason(row({}, { change_comment: ' ' }))), 'no reason');
  ok(/2 times/.test(rewriteBlockReason(row({}, { rewrite_history: [{}, {}] }))), 'max rewrites');
  eq(MAX_REWRITES, 2);
});

await t('a passing rewrite updates the SAME draft, keeps the hero image, and records history', async () => {
  const { calls, d } = deps();
  const out = await rewriteDraft({ row: row(), client }, d);
  eq(out.result, 'rewritten');
  eq(calls.pushes.length, 1);
  const p = calls.pushes[0].item.payload;
  eq([p.update_wp_id, p.keep_hero, p.html === REVISED.trim(), p.previous_html === ORIGINAL, p.rewrite_status], [20874, true, true, true, 'done']);
  eq(p.rewrite_history.map(h => [h.result, h.requested_by]), [['rewritten', 'Riley']]);
  eq(calls.pushes[0].r.id, 'q1', 'pushes against the existing row');
  ok(calls.prompts[0].messages[0].content.includes('Use the brand name Krost Shelving'), 'reason in prompt');
  ok(calls.prompts[0].system.includes('Use South African English'), "client rules in the writer's instructions");
});

await t('a rewrite the independent checker fails is held for a person, not pushed', async () => {
  const { calls, d } = deps({ verdict: 'fail' });
  const out = await rewriteDraft({ row: row(), client }, d);
  eq([out.result, calls.pushes.length], ['held', 0]);
  const last = calls.saves[calls.saves.length - 1][1];
  eq([last.status, last.payload.rewrite_status, last.payload.html === ORIGINAL], [undefined, 'held', true], 'status untouched, original kept');
});

await t('stale topics and truncated rewrites are never pushed', async () => {
  const a = deps({ revised: REVISED + '\nDuring load shedding, plan your racking.' });
  eq((await rewriteDraft({ row: row(), client }, a.d)).result, 'held');
  const b = deps({ revised: 'Sure! Here is the article.' });
  const out = await rewriteDraft({ row: row(), client }, b.d);
  eq([out.result, b.calls.pushes.length], ['failed', 0]);
});

await t('a failed push leaves the draft waiting for changes with the original text', async () => {
  const { calls, d } = deps({ pushThrows: 'WordPress 500' });
  const out = await rewriteDraft({ row: row(), client }, d);
  eq(out.result, 'failed');
  const last = calls.saves[calls.saves.length - 1][1];
  eq([last.status, last.payload.html === ORIGINAL, last.payload.rewrite_status], ['changes_requested', true, 'failed']);
});

await t('blocked rows do nothing', async () => {
  const { calls, d } = deps();
  const out = await rewriteDraft({ row: row({ status: 'published' }), client }, d);
  eq([out.result, calls.saves.length, calls.pushes.length], ['blocked', 0, 0]);
});

await t('sameRowQueueDeps reuses the queue row instead of logging a new one', async () => {
  const updates = [];
  const base = { queue: async () => { throw new Error('must not insert'); }, update: async (id, patch) => updates.push([id, patch]), notify: async () => {} };
  const q = sameRowQueueDeps(base, row());
  const r = await q.queue({ page_title: 'X', payload: { html: 'new' } });
  eq([r.id, r.status, updates[0][0], updates[0][1].status], ['q1', 'pending', 'q1', 'pending']);
});

await t('the revise prompt asks for the same format and no notes', () => {
  const s = buildRevisePrompt(ORIGINAL, 'Shorter intro');
  ok(s.includes('Shorter intro') && s.includes('same format') && s.includes('no notes'), s.slice(0, 200));
});

await t("an article ending in its own code block keeps the closing fence; a wrapped reply is unwrapped", () => {
  const art = '# T\n\nBody.\n\n```json\n{"@type":"FAQPage"}\n```';
  eq(stripWrapper(art), art);
  eq(stripWrapper('```markdown\n# T\n\nBody.\n```'), '# T\n\nBody.');
});

console.log(`\ndraftRewrite: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
