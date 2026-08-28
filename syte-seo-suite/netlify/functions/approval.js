// One-click approval endpoint for client-approved drafts. Links are sent
// by notify-draft.js and carry a per-draft random token — no login needed,
// and the token only works for its own queue row.
//
//   GET ?id=<queueId>&token=<uuid>&action=approve  → status 'approved'
//   GET ?id=<queueId>&token=<uuid>&action=changes  → status 'changes_requested'
//
// 'approved' rows are taken live by the publish-approved scheduled
// function within 15 minutes. 'changes_requested' also notifies the team.

import { createClient } from '@supabase/supabase-js';

export async function handler(event) {
  // Params come from the query string (GET links in the email) or, for the
  // Request-changes form submit, from an urlencoded POST body.
  let params = event.queryStringParameters || {};
  if (event.httpMethod === 'POST') {
    const form = new URLSearchParams(event.body || '');
    params = {
      id: form.get('id') || params.id,
      token: form.get('token') || params.token,
      action: form.get('action') || params.action,
      comment: (form.get('comment') || '').slice(0, 2000)
    };
  }
  const { id, token, action, comment } = params;
  if (!id || !token || !['approve', 'changes', 'changes-submit'].includes(action || '')) {
    return page(400, 'Invalid link', 'This approval link is incomplete. Please use the buttons from the email.');
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return page(500, 'Configuration error', 'Please contact the team.');
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: row } = await supabase
    .from('syte_suite_cms_queue')
    .select('id, page_title, status, payload, client_id')
    .eq('id', id)
    .single();

  if (!row || row.payload?.approval_token !== token) {
    return page(403, 'Link not valid', 'This approval link is not valid or has been replaced by a newer one.');
  }
  if (['approved', 'published'].includes(row.status)) {
    return page(200, 'Already approved', '"' + (row.page_title || 'This post') + '" was already approved. No further action needed.');
  }

  if (action === 'approve') {
    await supabase.from('syte_suite_cms_queue')
      .update({ status: 'approved', payload: { ...(row.payload || {}), approved_via: 'client-email', approved_at: new Date().toISOString() } })
      .eq('id', row.id);
    return page(200, 'Approved — thank you!',
      '"' + (row.page_title || 'The post') + '" has been approved and will be published on your website shortly.');
  }

  if (action === 'changes') {
    // Show the feedback form — the actual status change happens on submit,
    // so a stray click on the email button doesn't reject the draft.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Request changes</title></head>
<body style="font-family:Arial,sans-serif;background:#f6f6f7;margin:0;padding:40px 16px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,.06)">
    <h1 style="margin:0 0 12px;font-size:22px;color:#111">Request changes</h1>
    <p style="color:#444;line-height:1.6">Let the team know what you'd like adjusted on "${esc(row.page_title || 'this post')}". Nothing will be published until it's been revised.</p>
    <form method="POST" action="/.netlify/functions/approval">
      <input type="hidden" name="id" value="${esc(row.id)}"/>
      <input type="hidden" name="token" value="${esc(token)}"/>
      <input type="hidden" name="action" value="changes-submit"/>
      <textarea name="comment" rows="6" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;font-family:inherit;font-size:14px" placeholder="e.g. Please soften the intro and use our product name spelling 'WidgetPro'"></textarea>
      <button type="submit" style="margin-top:14px;background:#111;color:#fff;border:0;padding:10px 22px;border-radius:6px;font-size:14px;cursor:pointer">Send to the team</button>
    </form>
  </div>
</body></html>`
    };
  }

  // action === 'changes-submit'
  await supabase.from('syte_suite_cms_queue')
    .update({
      status: 'changes_requested',
      payload: {
        ...(row.payload || {}),
        changes_requested_at: new Date().toISOString(),
        change_comment: comment || ''
      }
    })
    .eq('id', row.id);

  // Best-effort heads-up to the team.
  try {
    const resendKey = process.env.RESEND_API_KEY;
    const { data: client } = await supabase.from('syte_suite_clients').select('name, publishing_profile').eq('id', row.client_id).single();
    let prof = client?.publishing_profile;
    if (typeof prof === 'string') { try { prof = JSON.parse(prof); } catch { prof = {}; } }
    prof = prof && typeof prof === 'object' ? prof : {};
    // Same opt-in rule as notify-draft: no hardcoded recipient, and nothing
    // is sent unless notifications are switched on for this client.
    const teamEmail = prof.notifications_enabled ? prof.notify_email : null;
    if (resendKey && teamEmail) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + resendKey },
        body: JSON.stringify({
          from: 'Syte SEO Suite <noreply@syte.co.za>',
          to: [teamEmail],
          subject: 'Changes requested: ' + (client?.name || '') + ' — ' + (row.page_title || ''),
          html: '<p>The client requested changes on "' + esc(row.page_title || '') + '".</p>'
            + (comment ? '<p><strong>Their feedback:</strong></p><blockquote style="border-left:3px solid #ccc;margin:8px 0;padding:6px 12px;color:#444">' + esc(comment) + '</blockquote>' : '<p>(No specific feedback was given — check in with them.)</p>')
            + '<p>Update the draft, then hit "Re-send for approval" on the row in CMS → Push History.</p>'
        })
      });
    }
  } catch (e) { console.error('[approval] changes notice failed:', e.message); }

  return page(200, 'Thanks — the team is on it',
    'Your feedback request for "' + (row.page_title || 'the post') + '" has been sent to the team. Nothing will be published until it has been revised.');
}

function page(status, heading, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title></head>
<body style="font-family:Arial,sans-serif;background:#f6f6f7;margin:0;padding:40px 16px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,.06)">
    <h1 style="margin:0 0 12px;font-size:22px;color:#111">${heading}</h1>
    <p style="color:#444;line-height:1.6;margin:0">${body}</p>
  </div>
</body></html>`
  };
}
