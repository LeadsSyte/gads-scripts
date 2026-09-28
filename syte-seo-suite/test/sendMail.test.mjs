// Every suite email goes through lib/sendMail.js: Gmail (automation@) when
// GMAIL_APP_PASSWORD is set, else Resend, else a clear error. Nothing is
// actually sent — the transports are faked.

import { sendMail, mailTransport, gmailFrom } from '../netlify/functions/lib/sendMail.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

function fakeGmail() {
  const calls = { options: null, mail: null };
  const createTransport = (options) => {
    calls.options = options;
    return { sendMail: async (mail) => { calls.mail = mail; return { messageId: '<m1@gmail>' }; } };
  };
  return { calls, createTransport };
}

await t('Gmail is used when the App Password is set, even if Resend is too', async () => {
  const g = fakeGmail();
  const env = { GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop', RESEND_API_KEY: 're_x' };
  assertEq(mailTransport(env), 'gmail');
  const r = await sendMail({ to: 'chrisb@syte.co.za', subject: 'S', html: '<p>h</p>' }, { env, createTransport: g.createTransport, fetch: () => { throw new Error('Resend must not be called'); } });
  assertEq(r, { id: '<m1@gmail>', via: 'gmail' });
  assertEq(g.calls.options.host, 'smtp.gmail.com');
  assertEq(g.calls.options.auth, { user: 'automation@syte.co.za', pass: 'abcdefghijklmnop' }, 'spaces Google shows in the App Password are removed');
  assertEq(g.calls.mail.to, ['chrisb@syte.co.za']);
  assertEq(g.calls.mail.from, '"Syte SEO Suite" <automation@syte.co.za>');
});

await t('the From address is pinned to the Gmail account, keeping the display name', () => {
  assertEq(gmailFrom('Syte SEO Suite <other@syte.co.za>', 'automation@syte.co.za'), '"Syte SEO Suite" <automation@syte.co.za>');
  assertEq(gmailFrom('other@syte.co.za', 'automation@syte.co.za'), 'automation@syte.co.za');
});

await t('Resend is the fallback when there is no App Password', async () => {
  let body = null;
  const env = { RESEND_API_KEY: 're_x' };
  const r = await sendMail({ to: ['a@b.co'], subject: 'S', html: 'h' }, { env, fetch: async (url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ id: 'r1' }) }; } });
  assertEq(r, { id: 'r1', via: 'resend' });
  assertEq(body.to, ['a@b.co']);
});

await t('a Resend refusal is an error, not a silent success', async () => {
  const env = { RESEND_API_KEY: 're_x' };
  let msg = '';
  try { await sendMail({ to: 'a@b.co', subject: 'S', html: 'h' }, { env, fetch: async () => ({ ok: false, status: 403, text: async () => 'domain is not verified' }) }); }
  catch (e) { msg = e.message; }
  if (!/Resend 403/.test(msg)) throw new Error('got ' + msg);
});

await t('nothing set up, or no recipient: a clear error and nothing sent', async () => {
  assertEq(mailTransport({}), null);
  let msg = '';
  try { await sendMail({ to: 'a@b.co', subject: 'S', html: 'h' }, { env: {} }); } catch (e) { msg = e.message; }
  if (!/GMAIL_APP_PASSWORD/.test(msg)) throw new Error('got ' + msg);
  msg = '';
  try { await sendMail({ to: [], subject: 'S', html: 'h' }, { env: { GMAIL_APP_PASSWORD: 'x' } }); } catch (e) { msg = e.message; }
  if (!/recipient/.test(msg)) throw new Error('got ' + msg);
});

console.log(`\nsendMail: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
