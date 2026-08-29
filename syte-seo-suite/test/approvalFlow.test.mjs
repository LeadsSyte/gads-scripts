// Approval-mode profile settings + notify-draft preview rendering logic.
// The functions themselves need Netlify/Supabase; here we lock down the
// pure decision inputs they rely on.

import { getPublishingProfile } from '../src/modules/cms/publishingProfile.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

await t('default approval mode is internal', () => {
  assertEq(getPublishingProfile({}).approval_mode, 'internal');
  assertEq(getPublishingProfile({}).client_approval_email, null);
  assertEq(getPublishingProfile({}).notify_email, null);
});

await t('email notifications are OFF unless switched on per client', () => {
  // Nobody should receive automated mail about a client until someone
  // deliberately enables it. There is no global fallback recipient.
  assertEq(getPublishingProfile({}).notifications_enabled, false, 'default off');
  assertEq(getPublishingProfile({ publishing_profile: {} }).notifications_enabled, false, 'empty profile off');
  assertEq(getPublishingProfile({ publishing_profile: { approval_mode: 'client', client_approval_email: 'x@y.com' } }).notifications_enabled,
    false, 'still off even with an address set');
  assertEq(getPublishingProfile({ publishing_profile: { notifications_enabled: true } }).notifications_enabled, true, 'opt-in works');
});

await t('client approval mode round-trips', () => {
  const p = getPublishingProfile({ publishing_profile: { approval_mode: 'client', client_approval_email: 'ceo@client.co.za' } });
  assertEq(p.approval_mode, 'client');
  assertEq(p.client_approval_email, 'ceo@client.co.za');
  assertEq(p.strip_leading_h1, true, 'other defaults intact');
});

await t('notify_email override survives for internal clients', () => {
  const p = getPublishingProfile({ publishing_profile: { notify_email: 'kenny@syte.co.za' } });
  assertEq(p.approval_mode, 'internal');
  assertEq(p.notify_email, 'kenny@syte.co.za');
});

console.log(`\napprovalFlow: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
