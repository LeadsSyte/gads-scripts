// Weekly progress summary email — sends every Monday at 08:00 SAST (06:00 UTC).
// Queries all implementation records from the past 7 days + all outstanding
// (pending/failed) items, groups by client, and sends a formatted HTML email
// to the leadership team via Resend.
//
// Env vars required:
//   RESEND_API_KEY  — from resend.com
//   SUPABASE_URL    — same as VITE_SUPABASE_URL but server-side
//   SUPABASE_KEY    — anon or service_role key
//
// Schedule: every Monday 06:00 UTC (08:00 SAST)

import { createClient } from '@supabase/supabase-js';

export const config = {
  schedule: '0 6 * * 1' // every Monday at 06:00 UTC
};

const RECIPIENTS = ['michaelh@syte.co.za', 'chrisf@syte.co.za'];
const FROM = 'Syte SEO Suite <noreply@syte.co.za>';

export default async function handler() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[weekly-progress] Missing SUPABASE_URL or SUPABASE_KEY');
    return { statusCode: 500, body: 'Missing Supabase env vars' };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Fetch all implementations from the last 7 days + all still pending/failed.
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Explicit column list — NEVER select('*') here. verification_detail can
  // hold a multi-hundred-KB base64 proof screenshot ([SCREENSHOT]…), and this
  // email needs none of it (only status, title, who, when). Pulling it for
  // every row — especially the unbounded pending/failed set below — bloated
  // the payload until the query timed out (HTTP 500) and the Monday email
  // stopped going out. The same select=* on this table broke the dashboard.
  const IMPL_COLS = 'id, client_id, module, change_type, title, implemented_by, implemented_at, verification_status, created_at';

  const [recentRes, pendingRes, clientsRes] = await Promise.all([
    supabase
      .from('syte_suite_implementations')
      .select(IMPL_COLS)
      .gte('created_at', weekAgo)
      .order('created_at', { ascending: false }),
    supabase
      .from('syte_suite_implementations')
      .select(IMPL_COLS)
      .in('verification_status', ['pending', 'failed'])
      .order('created_at', { ascending: false }),
    supabase
      .from('syte_suite_clients')
      .select('id, name, url')
  ]);

  const recent = recentRes.data || [];
  const pending = pendingRes.data || [];
  const clients = clientsRes.data || [];
  const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));

  // Merge and dedupe.
  const allIds = new Set();
  const all = [];
  for (const r of [...recent, ...pending]) {
    if (allIds.has(r.id)) continue;
    allIds.add(r.id);
    all.push(r);
  }

  // 2. Group by client.
  const grouped = {};
  for (const impl of all) {
    const cid = impl.client_id;
    if (!grouped[cid]) grouped[cid] = { client: clientMap[cid] || { name: cid }, items: [] };
    grouped[cid].items.push(impl);
  }

  // 3. Compute stats.
  const totalVerified = all.filter(r => r.verification_status === 'verified').length;
  const totalFailed = all.filter(r => r.verification_status === 'failed').length;
  const totalPending = all.filter(r => r.verification_status === 'pending').length;
  const totalClients = Object.keys(grouped).length;

  const moduleBreakdown = {};
  for (const r of all) {
    moduleBreakdown[r.module] = (moduleBreakdown[r.module] || 0) + 1;
  }

  // 4. Build HTML email.
  const now = new Date();
  const weekLabel = `${new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-ZA')} — ${now.toLocaleDateString('en-ZA')}`;

  const clientRows = Object.values(grouped)
    .sort((a, b) => b.items.length - a.items.length)
    .map(g => {
      const v = g.items.filter(r => r.verification_status === 'verified').length;
      const f = g.items.filter(r => r.verification_status === 'failed').length;
      const p = g.items.filter(r => r.verification_status === 'pending').length;
      const itemRows = g.items.map(r => {
        const statusColor = r.verification_status === 'verified' ? '#34d399'
                          : r.verification_status === 'failed' ? '#ff4d4d'
                          : '#ff9f43';
        const statusLabel = r.verification_status === 'verified' ? '✓ Verified'
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
              ${v} verified · ${f} failed · ${p} pending
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

    <div style="display:flex;gap:16px;margin-bottom:24px">
      <div style="background:#111316;border:1px solid #2a2a32;border-radius:10px;padding:16px;flex:1;text-align:center">
        <div style="font-size:36px;font-weight:700;color:#34d399">${totalVerified}</div>
        <div style="font-size:11px;color:#8b8b96;text-transform:uppercase">Verified</div>
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

    <div style="color:#8b8b96;font-size:12px;margin-bottom:16px">By module: ${moduleStats}</div>

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
        ${clientRows || '<tr><td colspan="5" style="padding:24px;text-align:center;color:#8b8b96">No implementations logged this week.</td></tr>'}
      </tbody>
    </table>

    <div style="margin-top:24px;color:#5a5a66;font-size:11px;text-align:center">
      Syte SEO Suite · Automated weekly progress · hello@syte.co.za
    </div>
  </div>
</body>
</html>`;

  // 5. Send via Resend (or log if no key).
  if (!resendKey) {
    console.log('[weekly-progress] No RESEND_API_KEY — email not sent. HTML preview logged.');
    console.log(html);
    return { statusCode: 200, body: JSON.stringify({ sent: false, reason: 'no RESEND_API_KEY', totalItems: all.length }) };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + resendKey
      },
      body: JSON.stringify({
        from: FROM,
        to: RECIPIENTS,
        subject: `Syte SEO Progress — ${weekLabel} · ${totalVerified} verified, ${totalPending} pending`,
        html
      })
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error('[weekly-progress] Resend error:', txt);
      return { statusCode: 502, body: 'Resend error: ' + txt.slice(0, 300) };
    }
    const data = await res.json();
    console.log('[weekly-progress] Email sent:', data.id);
    return { statusCode: 200, body: JSON.stringify({ sent: true, emailId: data.id, totalItems: all.length }) };
  } catch (e) {
    console.error('[weekly-progress] Send failed:', e);
    return { statusCode: 502, body: e.message };
  }
}

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
