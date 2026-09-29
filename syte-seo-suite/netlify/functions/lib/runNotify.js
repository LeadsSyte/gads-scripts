// The team email at the end of a Technical SEO or AEO run: what was done on
// the site, and what needs a person. Sent after the scan when nothing is
// applied automatically, or after the fixes have been applied when it is.
// Never fails the run; the outcome is kept on the state for the panel.

import { reportRecipients, sendReport, buildTechSummaryEmail, buildAeoSummaryEmail } from './reportEmail.js';
import { loadTechFixes, saveTechState } from './techStore.js';
import { loadAeoFixes, saveAeoState } from './aeoStore.js';
import { signedUrl } from './previewSig.js';

async function send(supabase, state, build, saveState) {
  try {
    const to = await reportRecipients(supabase);
    if (!to.length) return;
    await sendReport({ to, ...(await build()) });
    state.report = { sent_at: new Date().toISOString(), to };
  } catch (e) {
    state.report = { error: String(e.message || e).slice(0, 200) };
  }
  try { await saveState(supabase, state); } catch { /* best effort */ }
}

export function emailTechSummary(supabase, client, state, base) {
  return send(supabase, state, async () => buildTechSummaryEmail(client, state, base, {
    fixes: await loadTechFixes(supabase, client.id),
    fixSheetUrl: signedUrl('fix-sheet', 's', client.id)
  }), saveTechState);
}

export function emailAeoSummary(supabase, client, state, base) {
  return send(supabase, state, async () => buildAeoSummaryEmail(client, state, base, {
    fixes: await loadAeoFixes(supabase, client.id),
    fixSheetUrl: signedUrl('fix-sheet', 's', client.id)
  }), saveAeoState);
}

// Hand the finished run to the fix function, which applies what it can and
// then sends the email itself. Returns false when the hand-off failed (the
// caller then sends the plain summary).
export async function startAutoFixes(fnName, clientId, base, auth) {
  try {
    const r = await fetch(base + '/.netlify/functions/' + fnName, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': auth },
      body: JSON.stringify({ clientId, action: 'auto_all', by: 'schedule' }),
      signal: AbortSignal.timeout(15000)
    });
    return r.status === 202;
  } catch { return false; }
}
