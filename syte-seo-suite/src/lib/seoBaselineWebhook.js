// Fires the SEO baseline webhook when a client's first monthly report is
// approved. The actual HTTP call to the Syte SuperAgent hook happens inside
// the `seo-baseline-webhook` Netlify function so the shared secret stays
// server-side — this helper just hands the event to that function.
//
// Best-effort by design: a webhook failure must never block or break the
// "mark sent" flow, so this always resolves and never throws.

const FN_URL = '/.netlify/functions/seo-baseline-webhook';

// Pick the best "link to the report" we have for a client. The suite generates
// microsites as downloadable HTML (no hosted URL), so fall back through the
// hosted dashboards it does track, then the client's own site.
export function reportUrlFor(client) {
  return client?.looker_url || client?.rankscale_url || client?.url || '';
}

// Returns { ok: boolean, ...detail }. Never rejects.
export async function fireSeoBaselineWebhook({ clientId, slug, reportUrl, clientName, month } = {}) {
  if (!clientId && !slug) {
    return { ok: false, skipped: true, reason: 'no identifier' };
  }
  try {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: clientId || undefined,
        slug: slug || undefined,
        report_url: reportUrl || undefined,
        client_name: clientName || undefined,
        month: month || undefined
      })
    });
    let detail = {};
    try { detail = await res.json(); } catch {}
    if (!res.ok) {
      console.warn('[seo-baseline-webhook] relay failed:', res.status, detail);
      return { ok: false, status: res.status, ...detail };
    }
    return { ok: true, ...detail };
  } catch (e) {
    // Netlify functions aren't available in plain `vite dev`; swallow quietly.
    console.warn('[seo-baseline-webhook] relay unreachable:', e.message);
    return { ok: false, error: e.message };
  }
}
