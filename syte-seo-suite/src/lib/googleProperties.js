// Fetch + normalize GA4 properties and GSC sites for the current Google
// token, plus format validation helpers for manual entry fallback.

import { ensureToken, SCOPES } from '../modules/technical/googleAuth.js';

// ---------------------------------------------------------------------------
// GA4 — flatten account summaries into a single property list
// ---------------------------------------------------------------------------

export async function fetchGa4Properties() {
  const token = await ensureToken([SCOPES.ga4]);
  const res = await fetch(
    'https://analyticsadmin.googleapis.com/v1beta/accountSummaries',
    { headers: { Authorization: 'Bearer ' + token.access_token } }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('GA4 ' + res.status + ' ' + txt.slice(0, 200));
  }
  const data = await res.json();
  const out = [];
  for (const acc of data.accountSummaries || []) {
    for (const p of acc.propertySummaries || []) {
      const id = (p.property || '').replace(/^properties\//, '');
      out.push({
        id,
        name: p.displayName || '(unnamed)',
        account: acc.displayName || '(no account name)',
        accountId: (acc.account || '').replace(/^accounts\//, '')
      });
    }
  }
  // Sort by account then by property name.
  out.sort((a, b) => {
    const a1 = (a.account || '').toLowerCase();
    const b1 = (b.account || '').toLowerCase();
    if (a1 !== b1) return a1.localeCompare(b1);
    return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
  });
  return out;
}

// ---------------------------------------------------------------------------
// GSC — list sites (URL-prefix and domain) the user has access to
// ---------------------------------------------------------------------------

export async function fetchGscSites() {
  const token = await ensureToken([SCOPES.gsc]);
  const res = await fetch(
    'https://searchconsole.googleapis.com/webmasters/v3/sites',
    { headers: { Authorization: 'Bearer ' + token.access_token } }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('GSC ' + res.status + ' ' + txt.slice(0, 200));
  }
  const data = await res.json();
  const out = (data.siteEntry || []).map(s => ({
    siteUrl: s.siteUrl,
    permissionLevel: s.permissionLevel
  }));
  // Hide "unverifiedUser" entries since they can't query anything.
  const usable = out.filter(s => s.permissionLevel && s.permissionLevel !== 'siteUnverifiedUser');
  usable.sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
  return usable;
}

// ---------------------------------------------------------------------------
// GA4 Property ID validation + normalization
// ---------------------------------------------------------------------------
// The CORRECT format is a bare numeric ID: "123456789"
// Common mistakes we want to catch:
//   "G-XXXXXX"    -> measurement ID (for gtag), not a property ID
//   "UA-123-1"    -> Universal Analytics, deprecated
//   "properties/123456789" -> resource name, strip the prefix

export function normalizeGa4Id(raw) {
  if (raw == null) return { ok: false, reason: 'empty' };
  let v = String(raw).trim();
  if (!v) return { ok: false, reason: 'empty' };
  v = v.replace(/^properties\//i, '');
  if (/^G-/i.test(v)) {
    return { ok: false, reason: 'measurement-id', message: 'That looks like a Measurement ID (G-XXXXXX). We need the numeric Property ID, which you can find under GA4 Admin → Property Settings.' };
  }
  if (/^UA-/i.test(v)) {
    return { ok: false, reason: 'universal-analytics', message: 'That\'s a Universal Analytics ID. UA was deprecated — use the GA4 numeric Property ID instead.' };
  }
  if (!/^\d+$/.test(v)) {
    return { ok: false, reason: 'not-numeric', message: 'GA4 Property IDs are purely numeric, e.g. 123456789.' };
  }
  return { ok: true, value: v };
}

// ---------------------------------------------------------------------------
// GSC Property validation + normalization
// ---------------------------------------------------------------------------
// Valid formats:
//   "https://example.com/"       — URL-prefix property (must have trailing /)
//   "sc-domain:example.com"      — domain property

export function normalizeGscProperty(raw) {
  if (raw == null) return { ok: false, reason: 'empty' };
  let v = String(raw).trim();
  if (!v) return { ok: false, reason: 'empty' };

  // Domain property — case-insensitive prefix.
  if (/^sc-domain:/i.test(v)) {
    const domain = v.slice(10).toLowerCase().replace(/\/$/, '');
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
      return { ok: false, reason: 'bad-domain', message: 'sc-domain: entries need a bare domain, e.g. sc-domain:example.com' };
    }
    return { ok: true, value: 'sc-domain:' + domain };
  }

  // URL-prefix property — add https:// and trailing slash if missing.
  let normalized = v;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = 'https://' + normalized;
  }
  if (!/\/$/.test(normalized)) {
    normalized = normalized + '/';
  }
  try {
    const u = new URL(normalized);
    return { ok: true, value: u.protocol + '//' + u.hostname + u.pathname };
  } catch {
    return { ok: false, reason: 'invalid-url', message: 'Must be a valid URL like https://example.com/ or sc-domain:example.com' };
  }
}
