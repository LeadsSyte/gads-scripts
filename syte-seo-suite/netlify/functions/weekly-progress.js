// Weekly progress summary email — sends every Monday at 08:00 SAST (06:00 UTC).
// Queries all implementation records from the past 7 days + all outstanding
// (pending/failed) items, groups by client, and sends a formatted HTML email
// to the leadership team (lib/sendMail.js). Changes handed to a client's developer
// count as delivered — see DELIVERED_STATUSES below.
//
// Env vars required:
//   GMAIL_APP_PASSWORD — App Password for automation@syte.co.za (lib/sendMail.js)
//   SUPABASE_URL    — same as VITE_SUPABASE_URL but server-side
//   SUPABASE_KEY    — anon or service_role key
//
// Schedule: every Monday 06:00 UTC (08:00 SAST)

import { sendMail, mailTransport } from './lib/sendMail.js';
import { createClient } from '@supabase/supabase-js';
import { buildWeeklyProgress, groupByClient, weeklySubject, ATTENTION_DAYS, isDelivered } from '../../src/lib/weeklyProgressData.js';

export const config = {
  schedule: '0 6 * * 1' // every Monday at 06:00 UTC
};

const RECIPIENTS = ['michaelh@syte.co.za', 'chrisb@syte.co.za'];

// isDelivered (verified or sent to the client's developer) comes from
// src/lib/weeklyProgressData.js, which mirrors src/lib/deliveryStatus.js.

export default async function handler() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[weekly-progress] Missing SUPABASE_URL or SUPABASE_KEY');
    return { statusCode: 500, body: 'Missing Supabase env vars' };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Fetch this week's records, every record still open, and the pool of
  //    technical records by named people (to spot phantom copies). Each read
  //    is paged: the database returns at most 1,000 rows per request.
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Explicit column list — NEVER select('*') here. verification_detail can
  // hold a multi-hundred-KB base64 proof screenshot ([SCREENSHOT]…), and this
  // email needs none of it (only status, title, who, when). Pulling it for
  // every row bloated the payload until the query timed out (HTTP 500) and
  // the Monday email stopped going out. The same select=* broke the dashboard.
  const IMPL_COLS = 'id, client_id, module, change_type, title, implemented_by, implemented_at, verification_status, created_at';
  const PAGE = 1000;
  async function allRows(build) {
    const rows = [];
    for (let page = 0; page < 20; page++) {
      const { data, error } = await build().order('created_at', { ascending: false }).order('id', { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) { console.error('[weekly-progress] query failed:', error.message); break; }
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  }
  const impls = () => supabase.from('syte_suite_implementations').select(IMPL_COLS);

  const [recent, open, pool, clientsRes] = await Promise.all([
    allRows(() => impls().gte('created_at', weekAgo)),
    // 'sent_to_developer' is deliberately NOT here: a handover is finished
    // work, not an outstanding item to chase every Monday.
    allRows(() => impls().in('verification_status', ['pending', 'failed', 'inconclusive'])),
    allRows(() => impls().eq('module', 'technical').neq('implemented_by', 'Team member')),
    supabase.from('syte_suite_clients').select('id, name, url')
  ]);
  const clients = clientsRes.data || [];
  const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));

  // 2. The numbers (src/lib/weeklyProgressData.js): this week up top, what
  //    needs attention from the last 30 days, older open items as one line.
  const { week, thisWeek, attention, olderSummary, moduleBreakdown } = buildWeeklyProgress({ recent, open, pool });
  const groups = groupByClient([...thisWeek, ...attention], clientMap);
  const all = [...thisWeek, ...attention];

  // 4. Build HTML email.
  const now = new Date();
  const weekLabel = `${new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-ZA')} — ${now.toLocaleDateString('en-ZA')}`;
  const totalVerified = week.verified, totalSentToDev = week.sentToDev, totalFailed = week.failed, totalPending = week.pending, totalClients = week.clients;

  const clientRows = groups
    .map(g => {
      const v = g.items.filter(r => isDelivered(r.verification_status)).length;
      const f = g.items.filter(r => r.verification_status === 'failed').length;
      const p = g.items.filter(r => r.verification_status === 'pending').length;
      const s = g.items.filter(r => r.verification_status === 'sent_to_developer').length;
      const itemRows = g.items.map(r => {
        const statusColor = r.verification_status === 'verified' ? '#34d399'
                          : r.verification_status === 'sent_to_developer' ? '#4da3ff'
                          : r.verification_status === 'failed' ? '#ff4d4d'
                          : '#ff9f43';
        const statusLabel = r.verification_status === 'verified' ? '✓ Verified'
                          : r.verification_status === 'sent_to_developer' ? '📧 Sent to Developer'
                          : r.verification_status === 'failed' ? '✗ Failed'
                          : '⏳ Pending';
        return `<tr>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a32;font-size:13px">${esc(r.title || '')}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a32;font-size:12px;color:#8b8b96">${esc(r.module)} · ${esc(r.change_type || '')}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a32;font-size:12px;color:${statusColor};font-weight:600">${statusLabel}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a32;font-size:11px;color:#8b8b96">${esc(r.implemented_by || '')}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #2a2a32;font-size:11px;color:#8b8b96">${r.implemented_at ? new Date(r.implemented_at).toLocaleDateString('en-ZA') : '—'}</td>
        </tr>`;
      }).join('');
      return `
        <tr style="background:#191b1f">
          <td colspan="5" style="padding:12px 10px;font-weight:700;font-size:14px;border-bottom:1px solid #2a2a32">
            ${esc(g.client.name || '?')}
            <span style="color:#8b8b96;font-weight:400;font-size:12px;margin-left:10px">
              ${v} verified${s > 0 ? ` (incl. ${s} sent to dev)` : ''} · ${f} failed · ${p} pending
            </span>
          </td>
        </tr>
        ${itemRows}
      `;
    }).join('');

  const moduleStats = Object.entries(moduleBreakdown)
    .map(([mod, count]) => `<span style="margin-right:16px">${mod}: <strong>${count}</strong></span>`)
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0a0c;color:#e8e8ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:800px;margin:0 auto;padding:32px 24px">
    <div style="font-size:22px;font-weight:700;margin-bottom:4px">Syte SEO Suite</div>
    <div style="color:#8b8b96;font-size:13px;margin-bottom:24px">Weekly Implementation Progress · ${esc(weekLabel)}</div>
    <div style="color:#8b8b96;font-size:12px;margin-bottom:10px">This week: ${week.total} change${week.total === 1 ? '' : 's'} logged across ${week.clients} client${week.clients === 1 ? '' : 's'}.</div>

    <div style="display:flex;gap:16px;margin-bottom:24px">
      <div style="background:#111316;border:1px solid #2a2a32;border-radius:10px;padding:16px;flex:1;text-align:center">
        <div style="font-size:36px;font-weight:700;color:#34d399">${totalVerified}</div>
        <div style="font-size:11px;color:#8b8b96;text-transform:uppercase">Verified</div>
      </div>
      <div style="background:#111316;border:1px solid #2a2a32;border-radius:10px;padding:16px;flex:1;text-align:center">
        <div style="font-size:36px;font-weight:700;color:#4da3ff">${totalSentToDev}</div>
        <div style="font-size:11px;color:#8b8b96;text-transform:uppercase">Sent to Dev</div>
      </div>
      <div style="background:#111316;border:1px solid #2a2a32;border-radius:10px;padding:16px;flex:1;text-align:center">
        <div style="font-size:36px;font-weight:700;color:#ff4d4d">${totalFailed}</div>
        <div style="font-size:11px;color:#8b8b96;text-transform:uppercase">Failed</div>
      </div>
      <div style="background:#111316;border:1px solid #2a2a32;border-radius:10px;padding:16px;flex:1;text-align:center">
        <div style="font-size:36px;font-weight:700;color:#ff9f43">${totalPending}</div>
        <div style="font-size:11px;color:#8b8b96;text-transform:uppercase">Pending</div>
      </div>
      <div style="background:#111316;border:1px solid #2a2a32;border-radius:10px;padding:16px;flex:1;text-align:center">
        <div style="font-size:36px;font-weight:700">${totalClients}</div>
        <div style="font-size:11px;color:#8b8b96;text-transform:uppercase">Clients</div>
      </div>
    </div>

    <div style="color:#8b8b96;font-size:12px;margin-bottom:16px">By module this week: ${moduleStats || 'nothing logged'}</div>
    <div style="font-size:14px;font-weight:700;margin:8px 0 6px">This week, plus anything still open from the last ${ATTENTION_DAYS} days${attention.length ? ' (' + attention.length + ' to look at)' : ''}</div>

    <table style="width:100%;border-collapse:collapse;background:#111316;border:1px solid #2a2a32;border-radius:10px;overflow:hidden">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px 10px;font-size:11px;color:#8b8b96;text-transform:uppercase;border-bottom:1px solid #2a2a32">Change</th>
          <th style="text-align:left;padding:8px 10px;font-size:11px;color:#8b8b96;text-transform:uppercase;border-bottom:1px solid #2a2a32">Module</th>
          <th style="text-align:left;padding:8px 10px;font-size:11px;color:#8b8b96;text-transform:uppercase;border-bottom:1px solid #2a2a32">Status</th>
          <th style="text-align:left;padding:8px 10px;font-size:11px;color:#8b8b96;text-transform:uppercase;border-bottom:1px solid #2a2a32">By</th>
          <th style="text-align:left;padding:8px 10px;font-size:11px;color:#8b8b96;text-transform:uppercase;border-bottom:1px solid #2a2a32">Date</th>
        </tr>
      </thead>
      <tbody>
        ${clientRows || '<tr><td colspan="5" style="padding:24px;text-align:center;color:#8b8b96">Nothing logged this week and nothing open from the last ' + ATTENTION_DAYS + ' days.</td></tr>'}
      </tbody>
    </table>
    ${olderSummary.total ? `<div style="margin-top:14px;color:#8b8b96;font-size:12px">Older open items, not listed: ${olderSummary.failed} failed, ${olderSummary.pending} pending${olderSummary.inconclusive ? ', ' + olderSummary.inconclusive + ' inconclusive' : ''} from before ${new Date(Date.now() - ATTENTION_DAYS * 86400000).toLocaleDateString('en-ZA')}${olderSummary.oldest ? ' (oldest ' + new Date(olderSummary.oldest).toLocaleDateString('en-ZA') + ')' : ''}. They are in the suite under Implementation Progress; most are old verification results, not work that is failing now.</div>` : ''}

    <div style="margin-top:24px;color:#5a5a66;font-size:11px;text-align:center">
      Syte SEO Suite · Automated weekly progress · hello@syte.co.za
    </div>
  </div>
</body>
</html>`;

  // 5. Send (or log if email is not set up).
  if (!mailTransport()) {
    console.log('[weekly-progress] Email not set up (GMAIL_APP_PASSWORD) — not sent. HTML preview logged.');
    console.log(html);
    return { statusCode: 200, body: JSON.stringify({ sent: false, reason: 'email not set up', totalItems: all.length }) };
  }

  try {
    let data;
    try {
      data = await sendMail({
        to: RECIPIENTS,
        subject: weeklySubject({ week, attention, weekLabel }),
        html
      });
    } catch (err) {
      console.error('[weekly-progress] send error:', err.message);
      return { statusCode: 502, body: 'Email error: ' + err.message.slice(0, 300) };
    }
    console.log('[weekly-progress] Email sent:', data.id);
    return { statusCode: 200, body: JSON.stringify({ sent: true, emailId: data.id, totalItems: all.length }) };
  } catch (e) {
    console.error('[weekly-progress] Send failed:', e);
    return { statusCode: 502, body: e.message };
  }
}

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
