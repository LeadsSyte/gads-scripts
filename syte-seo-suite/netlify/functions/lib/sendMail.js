// The one way every suite email is sent.
//
// syte.co.za's mail is Google Workspace, and its SPF already includes
// _spf.google.com — so sending through the automation@ Gmail account needs
// no DNS change. Set in the Netlify environment:
//   GMAIL_APP_PASSWORD  — a Google App Password for automation@syte.co.za
//   GMAIL_USER          — optional, defaults to automation@syte.co.za
// Without it, Resend (RESEND_API_KEY) is used if set. Neither: nothing is
// sent and the caller gets an error saying so.

import { EMAIL_FROM } from './emailFrom.js';

export const GMAIL_USER_DEFAULT = 'automation@syte.co.za';

export function mailTransport(env = process.env) {
  if (env.GMAIL_APP_PASSWORD) return 'gmail';
  if (env.RESEND_API_KEY) return 'resend';
  return null;
}

// Gmail rewrites the From address to the signed-in account anyway, so keep
// the display name from EMAIL_FROM and pin the address to the account.
export function gmailFrom(from, user) {
  const name = String(from || '').match(/^\s*"?([^"<]*?)"?\s*</)?.[1]?.trim();
  return name ? `"${name}" <${user}>` : user;
}

async function sendViaGmail({ to, subject, html, replyTo }, env, deps) {
  const user = env.GMAIL_USER || GMAIL_USER_DEFAULT;
  const createTransport = deps.createTransport || (await import('nodemailer')).default.createTransport;
  const transport = createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user, pass: String(env.GMAIL_APP_PASSWORD).replace(/\s+/g, '') },
    connectionTimeout: 15000, socketTimeout: 20000
  });
  const info = await transport.sendMail({ from: gmailFrom(EMAIL_FROM, user), to, subject, html, ...(replyTo ? { replyTo } : {}) });
  return { id: info?.messageId || null, via: 'gmail' };
}

async function sendViaResend({ to, subject, html, replyTo }, env, deps) {
  const doFetch = deps.fetch || fetch;
  const res = await doFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.RESEND_API_KEY },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error('Resend ' + res.status + ': ' + (await res.text()).slice(0, 200));
  const data = await res.json().catch(() => ({}));
  return { id: data?.id || null, via: 'resend' };
}

// to: address or list. Returns { id, via }. Throws when nothing is set up
// or the send fails.
export async function sendMail({ to, subject, html, replyTo }, { env = process.env, ...deps } = {}) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) throw new Error('No email recipient');
  const via = mailTransport(env);
  if (via === 'gmail') return sendViaGmail({ to: list, subject, html, replyTo }, env, deps);
  if (via === 'resend') return sendViaResend({ to: list, subject, html, replyTo }, env, deps);
  throw new Error('Email is not set up: add GMAIL_APP_PASSWORD (automation@syte.co.za) in the Netlify environment');
}
