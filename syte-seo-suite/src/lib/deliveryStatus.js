// Which implementation statuses mean "this month's work is done".
//
// A change handed to the client's developer by email is DELIVERED work: on
// those accounts the handover is the deliverable we committed to — we don't
// have write access to the site, so "live on the page" is the developer's
// step, not ours. Waiting for it left handed-over clients parked in
// "Fixes Generated" / "Articles Written" forever, even though the month's
// work was finished and evidenced by the email.
//
// So every "is this done?" count treats a handover exactly like an on-page
// verification. The two stay TELLABLE APART — the row keeps its
// 'sent_to_developer' status and its 📧 badge, and email-verified rows carry
// the HANDOVER_MARKER in verification_detail (see verification.js) — they
// just both count.
//
// Deliberately dependency-free: pipelineStatus.js is imported by plain-node
// tests, so this must not drag in supabase/anthropic/browser globals.

export const DELIVERED_STATUSES = Object.freeze(['verified', 'sent_to_developer']);

// True when the record represents finished work — verified on the live page,
// or handed to the client's developer.
export function isDelivered(status) {
  return DELIVERED_STATUSES.includes(status);
}

// True for the handover half of the above. Used for wording ("incl. 2 handed
// to dev") and for guards that must not demote a handover — never to exclude
// it from a completion count.
export function isHandoverStatus(status) {
  return status === 'sent_to_developer';
}
