// The look before going live (Mike's "check it visually before publishing").
// An approved draft is first shown inside the client's own design (the signed
// in-theme preview, draft-preview.js ?q=), screenshotted and judged by the
// same visual check used on live pages (lib/visualCheck.js). Only then does
// publish-approved take it live. A draft that looks wrong is held back as
// 'changes_requested' with the reasons, and the team is told.
//
// The screenshot takes ~30 s, longer than the 15-minute publisher may run, so
// it happens in visual-check-background and the publisher acts on the result
// on its next pass. State lives on the queue row: payload.precheck =
//   { status: 'running' | 'ok' | 'problems' | 'unchecked', tries, started_at,
//     checked_at, problems, summary, preview_url }
// Pure: the publisher and the background function call it; tests too.

export const PRECHECK_MAX_TRIES = 2;
export const PRECHECK_STALE_MS = 40 * 60 * 1000;     // a check that never reported back
export const PRECHECK_VALID_MS = 24 * 60 * 60 * 1000; // an 'ok' older than this is looked at again

// What the publisher should do with one approved row.
//   publish — go live now (note: optional text for the email)
//   start   — start (or retry) the look; skip this pass
//   wait    — a look is running; skip this pass
//   hold    — it looked wrong: move it back to the team
export function prePublishDecision(row, { available, now = Date.now() } = {}) {
  if (!available) return { action: 'publish' };
  const pc = row?.payload?.precheck;
  if (!pc) return { action: 'start' };
  const age = t => now - (Date.parse(t || '') || 0);
  if (pc.status === 'running') {
    if (age(pc.started_at) < PRECHECK_STALE_MS) return { action: 'wait' };
    return (pc.tries || 0) >= PRECHECK_MAX_TRIES
      ? { action: 'publish', note: 'Not looked at before publishing: the check did not report back. The live page is still checked.' }
      : { action: 'start' };
  }
  if (pc.status === 'ok') return age(pc.checked_at) < PRECHECK_VALID_MS ? { action: 'publish', note: 'Looked right before publishing.' } : { action: 'start' };
  if (pc.status === 'problems') return { action: 'hold', problems: (pc.problems || []).slice(0, 6) };
  // 'unchecked' (the screenshot could not be taken): try again, then go ahead —
  // the text checks passed and the live page is still checked afterwards.
  return (pc.tries || 0) >= PRECHECK_MAX_TRIES
    ? { action: 'publish', note: 'Not looked at before publishing (' + String(pc.summary || 'no screenshot').slice(0, 120) + '). The live page is still checked.' }
    : { action: 'start' };
}

// The payload written when a look starts.
export function startedPrecheck(payload, { now = new Date(), previewUrl = '' } = {}) {
  const prev = payload?.precheck || {};
  return { ...(payload || {}), precheck: { status: 'running', tries: (prev.tries || 0) + 1, started_at: now.toISOString(), preview_url: previewUrl } };
}

// The payload written when a draft is held back: the result moves to
// precheck_held, so approving it again starts a fresh look.
export function heldPayload(payload) {
  const { precheck, ...rest } = payload || {};
  return { ...rest, precheck_held: precheck || null };
}

export const PRECHECK_WHAT = 'A new blog article titled "%TITLE%" is about to be published. This is a PREVIEW of it rebuilt inside one of the site\'s own published articles, so it shows the site\'s real header, footer and styles. A small grey "Syte draft preview" note on the page is expected — ignore it. The hero image may belong to another article; ignore that too. Judge whether the ARTICLE (its title, headings, text, lists, tables and images) looks like it belongs on this site.';
