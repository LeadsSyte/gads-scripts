// The Monday "Syte SEO Progress" email (Nov 2026): this week's numbers up
// top, open items from the last 30 days to look at, older ones as one line.
// On 2 Nov it said "116 failed, 264 pending" for a week with 9 verified,
// 1 failed and 0 pending.

import { buildWeeklyProgress, groupByClient, weeklySubject, ATTENTION_DAYS } from '../src/lib/weeklyProgressData.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };

const NOW = Date.parse('2026-11-02T06:00:00Z');
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();
let n = 0;
const row = (status, days, over = {}) => ({ id: 'r' + (++n), client_id: 'c1', module: 'technical', title: 'Fix ' + n, implemented_by: 'Nebiot', verification_status: status, created_at: daysAgo(days), ...over });

t('the headline counts only this week; old failures are a one-line summary, not the headline', () => {
  const recent = [row('verified', 1), row('verified', 2), row('failed', 3)];
  const open = [recent[2], row('failed', 40), row('failed', 200), row('pending', 100), row('failed', 20)];
  const r = buildWeeklyProgress({ recent, open, now: NOW });
  eq([r.week.verified, r.week.failed, r.week.pending, r.week.total], [2, 1, 0, 3], 'this week');
  eq(r.attention.map(x => x.verification_status), ['failed', 'failed'], 'open from the last 30 days (3 days + 20 days ago)');
  eq([r.olderSummary.total, r.olderSummary.failed, r.olderSummary.pending], [3, 2, 1], 'older, summarised');
  eq(r.olderSummary.oldest, daysAgo(200));
});

t('phantom "Team member / pending" copies are dropped using the named-person pool', () => {
  const twin = row('verified', 10, { title: 'Alt text on logo', implemented_by: 'Nebiot' });
  const phantom = row('pending', 10, { title: 'Alt text on logo', implemented_by: 'Team member', created_at: new Date(Date.parse(twin.created_at) + 30000).toISOString() });
  const lone = row('pending', 10, { title: 'Something else', implemented_by: 'Team member' });
  const r = buildWeeklyProgress({ recent: [], open: [phantom, lone], pool: [twin], now: NOW });
  eq(r.attention.map(x => x.id), [lone.id], 'phantom gone, real pending item kept');
});

t('a record both recent and open is counted once; grouping is per client, busiest first', () => {
  const a = row('failed', 2, { client_id: 'c1' });
  const r = buildWeeklyProgress({ recent: [a], open: [a, row('pending', 5, { client_id: 'c2' }), row('pending', 6, { client_id: 'c2' })], now: NOW });
  eq(r.attention.length, 3);
  const g = groupByClient([...r.thisWeek, ...r.attention], { c1: { name: 'Krost' }, c2: { name: 'Hamac' } });
  eq(g.map(x => x.client.name + ':' + x.items.length), ['Hamac:2', 'Krost:1']);
});

t('subject says what happened this week and how many items need attention', () => {
  const r = buildWeeklyProgress({ recent: [row('verified', 1), row('sent_to_developer', 1)], open: [row('failed', 4)], now: NOW });
  eq(weeklySubject({ ...r, weekLabel: '26/10 — 02/11' }), 'Syte SEO Progress — 26/10 — 02/11 · 1 verified this week, 1 sent to dev, 1 need attention');
  const quiet = buildWeeklyProgress({ recent: [], open: [row('failed', ATTENTION_DAYS + 5)], now: NOW });
  eq(weeklySubject({ ...quiet, weekLabel: 'w' }), 'Syte SEO Progress — w · 0 verified this week, nothing outstanding');
});

console.log(`\nweeklyProgressData: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
