// The look before publishing (Mike's spec): an approved draft is screenshotted
// in the client's design before it goes live; one that looks wrong is held.
// Fake database and fake screenshot check — nothing real is touched.

import { prePublishDecision, startedPrecheck, heldPayload, PRECHECK_MAX_TRIES, PRECHECK_STALE_MS, PRECHECK_VALID_MS } from '../netlify/functions/lib/prePublishCheck.js';
import { lookBeforePublishing } from '../netlify/functions/visual-check-background.js';
import { buildPublishedEmail } from '../netlify/functions/lib/reportEmail.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
const eq = (a, b, label) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const has = (s, re, label) => { if (!re.test(String(s))) throw new Error((label || '') + ' missing ' + re + ' in ' + String(s).slice(0, 160)); };
const hasNot = (s, re, label) => { if (re.test(String(s))) throw new Error((label || '') + ' should not contain ' + re); };

const NOW = Date.parse('2026-10-13T10:00:00Z');
const ago = ms => new Date(NOW - ms).toISOString();
const row = precheck => ({ id: 'q1', payload: precheck ? { wp_id: 5, precheck } : { wp_id: 5 } });
const decide = (pc, available = true) => prePublishDecision(row(pc), { available, now: NOW });

await t('without the screenshot key, approved drafts publish as before', () => {
  eq(decide(undefined, false).action, 'publish');
  eq(decide({ status: 'problems', problems: ['x'] }, false).action, 'publish');
});

await t('a newly approved draft is looked at first, not published', () => {
  eq(decide(undefined).action, 'start');
});

await t('while the look runs it waits; a look that never reports back is retried, then given up on', () => {
  eq(decide({ status: 'running', tries: 1, started_at: ago(5 * 60e3) }).action, 'wait');
  eq(decide({ status: 'running', tries: 1, started_at: ago(PRECHECK_STALE_MS + 1) }).action, 'start');
  const d = decide({ status: 'running', tries: PRECHECK_MAX_TRIES, started_at: ago(PRECHECK_STALE_MS + 1) });
  eq(d.action, 'publish'); has(d.note, /did not report back/);
});

await t('looked right → publish (and the email says so); an old "ok" is looked at again', () => {
  const d = decide({ status: 'ok', checked_at: ago(60e3) });
  eq(d.action, 'publish'); has(d.note, /Looked right/);
  eq(decide({ status: 'ok', checked_at: ago(PRECHECK_VALID_MS + 1) }).action, 'start');
});

await t('looked wrong → held, with the reasons', () => {
  const d = decide({ status: 'problems', problems: ['The table runs off the right edge.', 'Raw ## showing above a heading.'] });
  eq(d.action, 'hold'); eq(d.problems.length, 2);
});

await t('no screenshot possible → one retry, then publish with a note (the live page is still checked)', () => {
  eq(decide({ status: 'unchecked', tries: 1, summary: 'PageSpeed 500' }).action, 'start');
  const d = decide({ status: 'unchecked', tries: PRECHECK_MAX_TRIES, summary: 'PageSpeed 500' });
  eq(d.action, 'publish'); has(d.note, /Not looked at before publishing \(PageSpeed 500\)/);
});

await t('payloads: starting counts tries and keeps the row; holding moves the result aside so re-approving looks again', () => {
  const s1 = startedPrecheck({ wp_id: 5 }, { now: new Date(NOW), previewUrl: 'https://s/p?q=q1' });
  eq([s1.wp_id, s1.precheck.status, s1.precheck.tries, s1.precheck.preview_url], [5, 'running', 1, 'https://s/p?q=q1']);
  eq(startedPrecheck({ precheck: { status: 'unchecked', tries: 1 } }).precheck.tries, 2);
  const h = heldPayload({ wp_id: 5, precheck: { status: 'problems', problems: ['x'] } });
  eq([h.wp_id, h.precheck, h.precheck_held.status], [5, undefined, 'problems']);
  eq(decide(undefined).action, 'start', 'a re-approved held draft gets a fresh look');
});

// ── The background step, against a fake database ──
function fakeDb(rowInit, client = { id: 'c1', name: 'Krost' }) {
  const db = { row: JSON.parse(JSON.stringify(rowInit)), client, updates: [] };
  db.from = table => {
    const q = { table, filters: {} };
    const api = {
      select: () => api,
      eq: (k, v) => { q.filters[k] = v; if (q.update) { db.updates.push(q.update); if (table === 'syte_suite_cms_queue') db.row = { ...db.row, ...q.update }; return Promise.resolve({ error: null }); } return api; },
      update: v => { q.update = v; return api; },
      maybeSingle: async () => ({ data: table === 'syte_suite_clients' ? db.client : (db.row && db.row.id === q.filters.id ? db.row : null) })
    };
    return api;
  };
  return db;
}
const approvedRow = { id: 'q1', client_id: 'c1', status: 'approved', page_title: 'How to "Store" Tyres', payload: { wp_id: 5, precheck: { status: 'running', tries: 1, started_at: ago(1000), preview_url: 'https://suite/.netlify/functions/draft-preview?q=q1&sig=abc' } } };

await t('the look screenshots the PREVIEW link (not a live page) and stores the result on the row', async () => {
  const db = fakeDb(approvedRow); let asked;
  const res = await lookBeforePublishing(db, 'q1', {
    check: async (args) => { asked = args; return { status: 'ok', problems: [], summary: 'Fine', checked_at: 'now' }; },
    reference: async () => 'https://krost.example/other-article/'
  });
  eq(res.status, 'ok');
  eq(asked.url, approvedRow.payload.precheck.preview_url, 'screenshots the signed preview');
  eq(asked.referenceUrl, 'https://krost.example/other-article/');
  has(asked.what, /about to be published/); has(asked.what, /How to 'Store' Tyres/); has(asked.what, /Syte draft preview.*ignore/i);
  eq([db.row.payload.precheck.status, db.row.payload.precheck.tries, db.row.payload.wp_id], ['ok', 1, 5], 'tries and other fields kept');
  eq(db.row.status, 'approved', 'it never publishes');
});

await t('problems are stored for the publisher to hold; a row no longer approved is left alone', async () => {
  const db = fakeDb(approvedRow);
  await lookBeforePublishing(db, 'q1', { check: async () => ({ status: 'problems', problems: ['Table runs off the page.'], summary: '' }), reference: async () => '' });
  eq(db.row.payload.precheck.status, 'problems');
  eq(prePublishDecision(db.row, { available: true }).action, 'hold');

  const db2 = fakeDb({ ...approvedRow, status: 'pushed' }); let called = false;
  await lookBeforePublishing(db2, 'q1', { check: async () => { called = true; return { status: 'ok' }; }, reference: async () => '' });
  eq([called, db2.updates.length], [false, 0], 'taken back to review meanwhile: nothing written');
});

await t('if the check itself crashes, the row says "unchecked" (so it retries) instead of staying stuck', async () => {
  const db = fakeDb(approvedRow);
  await lookBeforePublishing(db, 'q1', { check: async () => { throw new Error('boom'); }, reference: async () => '' });
  eq(db.row.payload.precheck.status, 'unchecked'); has(db.row.payload.precheck.summary, /boom/);
  eq(prePublishDecision(db.row, { available: true }).action, 'start', 'first try failed → look again');
});

// ── The email Chris gets ──
await t('email: held drafts come first as a to-do, with the reasons and a link to the preview; live ones say they were looked at', () => {
  const { subject, html } = buildPublishedEmail([
    { client: 'Krost', title: 'Racking Guide', held: ['Table runs off the page.'], previewUrl: 'https://suite/p?q=q1' },
    { client: 'Krost', title: 'Mezzanine Floors', liveUrl: 'https://krost.example/mezz/', check: { ok: true, problems: [] }, auto: true, lookNote: 'Looked right before publishing.' }
  ], 'https://suite');
  has(subject, /1 held back before publishing, 1 went live: Krost/);
  has(html, /Look at 1 draft held back/); has(html, /Table runs off the page\./); has(html, /href="https:\/\/suite\/p\?q=q1"/);
  has(html, /Looked right before publishing\./);
  hasNot(html.split('Now live')[1] || '', /Racking Guide/, 'held draft not listed as live');
});

await t('email: nothing held → same as before (no held section)', () => {
  const { subject, html } = buildPublishedEmail([{ client: 'Krost', title: 'A', liveUrl: 'https://k/a', check: { ok: true, problems: [] } }], 'https://suite');
  eq(subject, '1 post went live: Krost'); hasNot(html, /held back/);
});

console.log(`\nprePublishCheck: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
