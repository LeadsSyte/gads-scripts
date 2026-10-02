// Is suite email set up on this deploy? Says which way mail would go
// (gmail / resend / none) — never a password, and never sends anything.
// GET /.netlify/functions/email-status

import { mailTransport, GMAIL_USER_DEFAULT } from './lib/sendMail.js';
import { visualCheckAvailable } from './lib/visualCheck.js';

export async function handler() {
  const via = mailTransport();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    body: JSON.stringify({
      via,
      sender: via === 'gmail' ? (process.env.GMAIL_USER || GMAIL_USER_DEFAULT) : null,
      // Screenshot check of live pages (PAGESPEED_API_KEY).
      visual_check: visualCheckAvailable()
    })
  };
}
