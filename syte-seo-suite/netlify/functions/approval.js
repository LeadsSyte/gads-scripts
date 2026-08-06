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
  const { id, token, action } = event.queryStringParameters || {};
  if (!id || !token || !['approve', 'changes'].includes(action || '')) {
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

  // action === 'changes'
  await supabase.from('syte_suite_cms_queue')
    .update({ status: 'changes_requested', payload: { ...(row.payload || {}), changes_requested_at: new Date().toISOString() } })
    .eq('id', row.id);

  // Best-effort heads-up to the team.
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const { data: client } = await supabase.from('syte_suite_clients').select('name').eq('id', row.client_id).single();
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + resendKey },
        body: JSON.stringify({
          from: 'Syte SEO Suite <noreply@syte.co.za>',
          to: [process.env.NOTIFY_EMAIL || 'chrisb@syte.co.za'],
          subject: 'Changes requested: ' + (client?.name || '') + ' — ' + (row.page_title || ''),
          html: '<p>The client requested changes on "' + (row.page_title || '') + '". Check in with them, update the draft, and re-push.</p>'
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
