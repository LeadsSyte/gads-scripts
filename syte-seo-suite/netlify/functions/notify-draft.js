// Draft-ready notification. Called (fire-and-forget) by the app right
// after a push creates a CMS draft. Decides, from the client's publishing
// profile, who reviews this draft:
//
//   approval_mode 'internal' (default): emails the team ("draft ready,
//   review in the suite / wp-admin"), approval happens in Push History.
//
//   approval_mode 'client': emails the client the article itself with
//   one-click Approve / Request changes links (tokenized, no login).
//   Approve flips the queue row to 'approved'; the publish-approved
//   scheduled function then takes it live.
//
// Env vars: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY (or
// SUPABASE_KEY), NOTIFY_EMAIL (default internal recipient), URL
// (Netlify-provided site URL, used to build approval links).

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const FROM = 'Syte SEO Suite <noreply@syte.co.za>';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let queueId;
  try { queueId = JSON.parse(event.body || '{}').queueId; } catch { /* fall through */ }
  if (!queueId) return { statusCode: 400, body: 'Missing queueId' };

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!supabaseUrl || !supabaseKey || !resendKey) {
    console.error('[notify-draft] missing env vars');
    return { statusCode: 500, body: 'Missing env vars' };
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: row, error } = await supabase
    .from('syte_suite_cms_queue')
    .select('id, client_id, page_title, payload, status')
    .eq('id', queueId)
    .single();
  if (error || !row) return { statusCode: 404, body: 'Queue row not found' };

  const { data: client } = await supabase
    .from('syte_suite_clients')
    .select('id, name, url, publishing_profile')
    .eq('id', row.client_id)
    .single();
  if (!client) return { statusCode: 404, body: 'Client not found' };

  let profile = client.publishing_profile;
  if (typeof profile === 'string') { try { profile = JSON.parse(profile); } catch { profile = {}; } }
  profile = profile && typeof profile === 'object' ? profile : {};

  const siteUrl = (process.env.URL || 'https://syte-seo-suite.netlify.app').replace(/\/+$/, '');
  const title = row.page_title || 'New article';

  try {
    if (profile.approval_mode === 'client' && profile.client_approval_email) {
      // Client-facing approval email with tokenized one-click links.
      const token = randomUUID();
      await supabase.from('syte_suite_cms_queue')
        .update({ payload: { ...(row.payload || {}), approval_token: token } })
        .eq('id', row.id);

      const approveUrl = siteUrl + '/.netlify/functions/approval?id=' + row.id + '&token=' + token + '&action=approve';
      const changesUrl = siteUrl + '/.netlify/functions/approval?id=' + row.id + '&token=' + token + '&action=changes';
      const preview = articlePreviewHtml(row.payload);

      await sendEmail(resendKey, {
        to: [profile.client_approval_email],
        subject: 'New blog post ready for your approval: ' + title,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#222">
            <p>Hi,</p>
            <p>A new blog post has been prepared for <strong>${esc(client.name)}</strong> and is ready for your review:</p>
            <h2 style="margin:16px 0 4px">${esc(title)}</h2>
            <div style="border:1px solid #ddd;border-radius:8px;padding:16px;margin:12px 0;background:#fafafa">${preview}</div>
            <p>
              <a href="${approveUrl}" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Approve &amp; publish</a>
              &nbsp;&nbsp;
              <a href="${changesUrl}" style="display:inline-block;background:#eee;color:#333;padding:10px 22px;border-radius:6px;text-decoration:none">Request changes</a>
            </p>
            <p style="color:#777;font-size:12px">Approving publishes this post on your website. If you'd like anything adjusted, use Request changes and the team will get back to you.</p>
          </div>`
      });
      console.log('[notify-draft] client approval email sent for', client.name, '-', title);
    } else {
      // Internal notification.
      const to = profile.notify_email || process.env.NOTIFY_EMAIL || 'chrisb@syte.co.za';
      const adminUrl = row.payload?.admin_url || '';
      const warnings = Array.isArray(row.payload?.warnings) ? row.payload.warnings : [];
      await sendEmail(resendKey, {
        to: [to],
        subject: 'Draft ready for review: ' + client.name + ' — ' + title,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#222">
            <p>A new draft is ready for review.</p>
            <p><strong>Client:</strong> ${esc(client.name)}<br/>
               <strong>Title:</strong> ${esc(title)}</p>
            ${warnings.length ? '<p style="color:#b45309"><strong>Warnings:</strong> ' + warnings.map(esc).join('; ') + '</p>' : ''}
            <p>
              ${adminUrl ? `<a href="${adminUrl}">Open the draft in the CMS</a> · ` : ''}
              <a href="${siteUrl}">Open the suite to approve</a>
            </p>
            <p style="color:#777;font-size:12px">Approve it in CMS → Push History and it goes live automatically within 15 minutes.</p>
          </div>`
      });
      console.log('[notify-draft] internal email sent to', to, 'for', client.name, '-', title);
    }
    return { statusCode: 200, body: 'sent' };
  } catch (e) {
    console.error('[notify-draft] email failed:', e.message);
    return { statusCode: 502, body: 'Email failed: ' + e.message };
  }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Very light preview: the queue payload carries the raw generated article
// (markdown-ish). Render headings/paragraphs plainly — the email is a
// review copy, not the final theme rendering.
function articlePreviewHtml(payload) {
  const raw = payload?.html || payload?.code || payload?.fix || '';
  if (!raw) return '<em>(content preview unavailable)</em>';
  const text = String(raw)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\*\*Meta (Title|Description)[\s\S]*$/i, '')
    .trim();
  return text.split(/\n{2,}/).slice(0, 40).map(block => {
    const b = block.trim();
    if (/^###\s+/.test(b)) return '<h4>' + esc(b.replace(/^###\s+/, '')) + '</h4>';
    if (/^##\s+/.test(b))  return '<h3>' + esc(b.replace(/^##\s+/, '')) + '</h3>';
    if (/^#\s+/.test(b))   return '<h2>' + esc(b.replace(/^#\s+/, '')) + '</h2>';
    return '<p>' + esc(b).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') + '</p>';
  }).join('');
}

async function sendEmail(resendKey, { to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + resendKey },
    body: JSON.stringify({ from: FROM, to, subject, html })
  });
  if (!res.ok) throw new Error('Resend ' + res.status + ': ' + await res.text());
}
