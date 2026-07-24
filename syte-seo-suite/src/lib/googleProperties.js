// Fetch + normalize GA4 properties and GSC sites for the current Google
// token, plus format validation helpers for manual entry fallback.

import { ensureToken, SCOPES, GOOGLE_CLIENT_ID } from '../modules/technical/googleAuth.js';
import { proxyGoogleFetch } from './googleServerAuth.js';

// Google's "API not enabled" errors come back as 403 with a message that
// includes the phrase "has not been used in project" followed by the project
// number. We throw a structured error the UI can render with a clickable
// enable link instead of dumping the raw message on the operator.
function extractProjectNumber() {
  // Client IDs are shaped like "<project_number>-<hash>.apps.googleusercontent.com"
  const m = GOOGLE_CLIENT_ID.match(/^(\d+)-/);
  return m ? m[1] : null;
}

function makeApiDisabledError(service, apiLibraryPath) {
  const project = extractProjectNumber();
  const url = project
    ? `https://console.cloud.google.com/apis/library/${apiLibraryPath}?project=${project}`
    : `https://console.cloud.google.com/apis/library/${apiLibraryPath}`;
  const err = new Error(`${service} API is not enabled on your Google Cloud project. Open the link below and click Enable, wait ~60 seconds, then hit Refresh.`);
  err.enableUrl = url;
  err.apiDisabled = true;
  return err;
}

// Returns true if a raw API error response looks like an API-not-enabled 403.
async function handleApiError(res, service, apiLibraryPath) {
  if (res.ok) return null;
  const txt = await res.text().catch(() => '');
  if (res.status === 403 && /has not been used in project|API has not been used|disabled/i.test(txt)) {
    throw makeApiDisabledError(service, apiLibraryPath);
  }
  throw new Error(`${service} ${res.status} ${txt.slice(0, 200)}`);
}

// ---------------------------------------------------------------------------
// Session-level cache for property lists so they aren't re-fetched every
// time a client modal opens. Survives tab navigation but clears on refresh.
// Cache TTL = 30 minutes. Hit Refresh or Switch Account to force re-fetch.
// ---------------------------------------------------------------------------

const GA4_CACHE_KEY = 'syte-suite-ga4-props-cache';
const GSC_CACHE_KEY = 'syte-suite-gsc-sites-cache';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCached(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}
function setCache(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}
export function clearPropertyCache() {
  sessionStorage.removeItem(GA4_CACHE_KEY);
  sessionStorage.removeItem(GSC_CACHE_KEY);
}

// ---------------------------------------------------------------------------
// GA4 — flatten account summaries into a single property list, with full
// pagination. The endpoint returns up to 200 per page; some agency-style
// accounts have dozens of GA4 accounts + hundreds of properties total, so
// we loop on nextPageToken until Google stops sending one.
// ---------------------------------------------------------------------------

export async function fetchGa4Properties({ bypassCache = false } = {}) {
  if (!bypassCache) {
    const cached = getCached(GA4_CACHE_KEY);
    if (cached) { console.log('[GA4] returning', cached.length, 'cached properties'); return cached; }
  }
  const token = await ensureToken([SCOPES.ga4]);

  const all = [];
  let pageToken = null;
  let safety = 0;

  do {
    const params = new URLSearchParams({ pageSize: '200' });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(
      'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?' + params.toString(),
      { headers: { Authorization: 'Bearer ' + token.access_token } }
    );
    await handleApiError(res, 'GA4 Admin', 'analyticsadmin.googleapis.com');
    const data = await res.json();

    for (const acc of data.accountSummaries || []) {
      for (const p of acc.propertySummaries || []) {
        const id = (p.property || '').replace(/^properties\//, '');
        all.push({
          id,
          name: p.displayName || '(unnamed)',
          account: acc.displayName || '(no account name)',
          accountId: (acc.account || '').replace(/^accounts\//, '')
        });
      }
    }

    pageToken = data.nextPageToken || null;
    safety++;
    if (safety > 50) {
      // eslint-disable-next-line no-console
      console.warn('[GA4] stopped paginating after 50 pages; API may be returning an infinite token.');
      break;
    }
  } while (pageToken);

  // eslint-disable-next-line no-console
  console.log('[GA4] fetched', all.length, 'properties across', safety, 'page(s)');

  // Sort by account then by property name.
  all.sort((a, b) => {
    const a1 = (a.account || '').toLowerCase();
    const b1 = (b.account || '').toLowerCase();
    if (a1 !== b1) return a1.localeCompare(b1);
    return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
  });
  setCache(GA4_CACHE_KEY, all);
  return all;
}

// ---------------------------------------------------------------------------
// GSC — list every site the user has access to. We keep ALL permission
// levels now (including siteUnverifiedUser) so we never hide a legitimate
// property — the operator can judge for themselves whether to use it.
// ---------------------------------------------------------------------------

export async function fetchGscSites({ bypassCache = false } = {}) {
  if (!bypassCache) {
    const cached = getCached(GSC_CACHE_KEY);
    if (cached) { console.log('[GSC] returning', cached.length, 'cached sites'); return cached; }
  }
  const token = await ensureToken([SCOPES.gsc]);
  const res = await fetch(
    'https://searchconsole.googleapis.com/webmasters/v3/sites',
    { headers: { Authorization: 'Bearer ' + token.access_token } }
  );
  await handleApiError(res, 'Search Console', 'searchconsole.googleapis.com');
  const data = await res.json();
  const out = (data.siteEntry || []).map(s => ({
    siteUrl: s.siteUrl,
    permissionLevel: s.permissionLevel || 'unknown'
  }));
  // eslint-disable-next-line no-console
  console.log('[GSC] fetched', out.length, 'sites');
  out.sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
  setCache(GSC_CACHE_KEY, out);
  return out;
}

// ---------------------------------------------------------------------------
// Server-auth variants — list a SPECIFIC connected account's GA4 properties /
// GSC sites through the proxy (the proxy holds that account's token). Cached
// per account so switching the bound account in the picker re-fetches the
// right list instead of showing whatever the browser happened to be signed
// into. Used by the connections picker when VITE_GOOGLE_SERVER_AUTH is on.
// ---------------------------------------------------------------------------

export async function fetchGa4PropertiesForAccount(accountEmail, { bypassCache = false } = {}) {
  if (!accountEmail) return [];
  const cacheKey = GA4_CACHE_KEY + ':' + accountEmail.toLowerCase();
  if (!bypassCache) {
    const cached = getCached(cacheKey);
    if (cached) return cached;
  }
  const all = [];
  let pageToken = null;
  let safety = 0;
  do {
    const params = new URLSearchParams({ pageSize: '200' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await proxyGoogleFetch(
      'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?' + params.toString(),
      { method: 'GET' },
      accountEmail
    );
    await handleApiError(res, 'GA4 Admin', 'analyticsadmin.googleapis.com');
    const data = await res.json();
    for (const acc of data.accountSummaries || []) {
      for (const p of acc.propertySummaries || []) {
        all.push({
          id: (p.property || '').replace(/^properties\//, ''),
          name: p.displayName || '(unnamed)',
          account: acc.displayName || '(no account name)',
          accountId: (acc.account || '').replace(/^accounts\//, '')
        });
      }
    }
    pageToken = data.nextPageToken || null;
    safety++;
    if (safety > 50) break;
  } while (pageToken);
  all.sort((a, b) => {
    const a1 = (a.account || '').toLowerCase();
    const b1 = (b.account || '').toLowerCase();
    if (a1 !== b1) return a1.localeCompare(b1);
    return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
  });
  setCache(cacheKey, all);
  return all;
}

export async function fetchGscSitesForAccount(accountEmail, { bypassCache = false } = {}) {
  if (!accountEmail) return [];
  const cacheKey = GSC_CACHE_KEY + ':' + accountEmail.toLowerCase();
  if (!bypassCache) {
    const cached = getCached(cacheKey);
    if (cached) return cached;
  }
  const res = await proxyGoogleFetch(
    'https://searchconsole.googleapis.com/webmasters/v3/sites',
    { method: 'GET' },
    accountEmail
  );
  await handleApiError(res, 'Search Console', 'searchconsole.googleapis.com');
  const data = await res.json();
  const out = (data.siteEntry || []).map(s => ({
    siteUrl: s.siteUrl,
    permissionLevel: s.permissionLevel || 'unknown'
  }));
  out.sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
  setCache(cacheKey, out);
  return out;
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
