// SEO baseline webhook — server-side relay.
//
// The browser suite calls this function when a client's *baseline* (first)
// monthly report is approved. The function forwards the event to the Syte
// SuperAgent public hook, which flips that client's `seo_aeo` service to
// "live" and logs the event.
//
// Firing server-side (rather than straight from the browser) keeps the shared
// secret off the client and sidesteps cross-origin restrictions on the hook.
//
// POST body (from the suite): { clientId? | id? | slug?, report_url?, client_name?, month? }
//   — one identifier is required; report_url is optional but recommended.
//
// Env vars:
//   SEO_BASELINE_WEBHOOK_SECRET  — optional shared secret. When set, it's sent
//                                  to the hook as `Authorization: Bearer <secret>`.
//   SEO_BASELINE_WEBHOOK_URL     — optional override of the hook endpoint.

const DEFAULT_HOOK_URL =
  'https://sytesuperagent.sytedashboardai.xyz/api/public/hooks/seo-baseline';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  // Accept slug OR clientId OR id — the hook takes any one of them.
  const slug = payload.slug != null ? String(payload.slug).trim() : '';
  const clientId = payload.clientId != null ? String(payload.clientId).trim()
                 : payload.id != null ? String(payload.id).trim() : '';
  if (!slug && !clientId) {
    return json(400, { error: 'Missing identifier — provide slug, clientId, or id' });
  }

  // Build the hook body. Send whichever identifier we have; the report link is
  // best-effort. Extra fields (client_name, month) are harmless context.
  const body = {};
  if (slug) body.slug = slug;
  if (clientId) body.clientId = clientId;
  if (payload.report_url) body.report_url = String(payload.report_url);
  if (payload.client_name) body.client_name = String(payload.client_name);
  if (payload.month) body.month = String(payload.month);

  const hookUrl = process.env.SEO_BASELINE_WEBHOOK_URL || DEFAULT_HOOK_URL;
  const secret = process.env.SEO_BASELINE_WEBHOOK_SECRET;

  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers.Authorization = 'Bearer ' + secret;

  try {
    const res = await fetch(hookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('[seo-baseline-webhook] hook returned', res.status, text.slice(0, 300));
      return json(502, { ok: false, status: res.status, detail: text.slice(0, 300) });
    }
    return json(200, { ok: true, status: res.status, sent: body });
  } catch (e) {
    console.error('[seo-baseline-webhook] fetch failed:', e);
    return json(502, { ok: false, error: e.message });
  }
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(obj)
  };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
