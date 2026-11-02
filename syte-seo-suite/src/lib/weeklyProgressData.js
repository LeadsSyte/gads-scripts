// The numbers and lists in the Monday "Syte SEO Progress" email (Nov 2026).
//
// The email used to put EVERY open item ever logged in one table, with one
// red "Failed" box counting all of them: on 2 Nov 2026 it said 116 failed and
// 264 pending when the week had 9 verified, 1 failed and 0 pending, and
// Mike read it as "the system isn't working at all". The 116 went back to
// April (48 from April alone), and 228 of the "pending" were the phantom
// copies that phantomImpls.js hides, which the email's own lookup had
// silently failed to find.
//
// Now: the headline is THIS WEEK. "Needs attention" is what is still open
// from the last 30 days. Anything older is one line with a count. Pure.

import { dropPhantomImpls } from './phantomImpls.js';

export const ATTENTION_DAYS = 30;
export const DELIVERED_STATUSES = ['verified', 'sent_to_developer'];
export const isDelivered = status => DELIVERED_STATUSES.includes(status);
const isOpen = r => ['pending', 'failed', 'inconclusive'].includes(r.verification_status);

// recent: records created in the last 7 days. open: every record still
// pending / failed / inconclusive. pool: records to find phantom twins in
// (technical records by named people). now: ms.
export function buildWeeklyProgress({ recent = [], open = [], pool = [], now = Date.now() }) {
  const byId = new Map();
  for (const r of [...recent, ...open]) if (r && !byId.has(r.id)) byId.set(r.id, r);
  const all = dropPhantomImpls([...byId.values()], [...byId.values(), ...pool]);

  const weekAgo = now - 7 * 86400000;
  const attentionFrom = now - ATTENTION_DAYS * 86400000;
  const at = r => Date.parse(r.created_at) || 0;

  const thisWeek = all.filter(r => at(r) >= weekAgo);
  const count = (rows, test) => rows.filter(test).length;
  const week = {
    total: thisWeek.length,
    verified: count(thisWeek, r => r.verification_status === 'verified'),
    sentToDev: count(thisWeek, r => r.verification_status === 'sent_to_developer'),
    failed: count(thisWeek, r => r.verification_status === 'failed'),
    pending: count(thisWeek, r => r.verification_status === 'pending'),
    clients: new Set(thisWeek.map(r => r.client_id)).size
  };

  // Still open, logged in the last 30 days (this week's open items included).
  const attention = all.filter(r => isOpen(r) && at(r) >= attentionFrom)
    .sort((a, b) => at(b) - at(a));
  const older = all.filter(r => isOpen(r) && at(r) < attentionFrom);
  const olderSummary = {
    total: older.length,
    failed: count(older, r => r.verification_status === 'failed'),
    pending: count(older, r => r.verification_status === 'pending'),
    inconclusive: count(older, r => r.verification_status === 'inconclusive'),
    oldest: older.length ? older.map(r => r.created_at).sort()[0] : null
  };

  const moduleBreakdown = {};
  for (const r of thisWeek) moduleBreakdown[r.module] = (moduleBreakdown[r.module] || 0) + 1;

  return { week, thisWeek, attention, olderSummary, moduleBreakdown };
}

// Rows grouped by client, most items first. rows: this week's records plus
// the attention list (deduped), so a client shows its wins and its open items.
export function groupByClient(rows, clientMap = {}) {
  const byId = new Map();
  for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
  const groups = {};
  for (const r of byId.values()) {
    const cid = r.client_id;
    if (!groups[cid]) groups[cid] = { client: clientMap[cid] || { name: cid }, items: [] };
    groups[cid].items.push(r);
  }
  return Object.values(groups).sort((a, b) => b.items.length - a.items.length);
}

export function weeklySubject({ week, attention, weekLabel }) {
  const parts = [week.verified + ' verified this week'];
  if (week.sentToDev) parts.push(week.sentToDev + ' sent to dev');
  parts.push(attention.length ? attention.length + ' need attention' : 'nothing outstanding');
  return 'Syte SEO Progress — ' + weekLabel + ' · ' + parts.join(', ');
}
