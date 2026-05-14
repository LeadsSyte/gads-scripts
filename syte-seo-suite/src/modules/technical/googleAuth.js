// Shared Google OAuth token handling. Covers the Technical SEO and AEO
// modules (GSC + GA4) AND the client modal's GA4/GSC property picker.
// Uses the Google OAuth 2.0 implicit flow — no backend required.
//
// Token storage is keyed by Google account email, NOT a single global slot.
// This lets us cache one valid token per Google account simultaneously, so
// switching between clients on different Google accounts does not force
// repeated sign-ins. Each client record carries a `google_email` so we can
// pass it as a login_hint and skip the account picker entirely.

export const GOOGLE_CLIENT_ID = '377465514344-ve8jabk68rl333p7p2n9ieo0pj0ruivt.apps.googleusercontent.com';

const STORE_KEY = 'syte-suite-google-tokens-v2';
const LEGACY_TOKEN_KEY = 'syte-suite-google-token';

// Custom event name fired when stored tokens or the active account change.
export const TOKEN_EVENT = 'syte-google-token-changed';

function notifyTokenChange() {
  try { window.dispatchEvent(new Event(TOKEN_EVENT)); } catch {}
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        activeEmail: s.activeEmail || null,
        byEmail: s.byEmail || {}
      };
    }
  } catch {}
  return { activeEmail: null, byEmail: {} };
}

function writeStore(s) {
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
  notifyTokenChange();
}

// Treat a stored token as null when it has expired. We subtract a small
// buffer so a token that is about to expire is treated as already gone —
// reduces the chance of a Google API call failing mid-request.
const EXPIRY_BUFFER_MS = 30 * 1000;
function isLive(t) {
  return !!(t && t.access_token && (!t.expires_at || Date.now() + EXPIRY_BUFFER_MS < t.expires_at));
}

export const SCOPES = {
  gsc:  'https://www.googleapis.com/auth/webmasters.readonly',
  ga4:  'https://www.googleapis.com/auth/analytics.readonly'
};

// All the scopes needed for the combined GA4 + GSC picker. Requesting both
// at once means the user only has to consent one time.
export const ALL_READ_SCOPES = [SCOPES.gsc, SCOPES.ga4];

// ---- active account selection -------------------------------------------

// Set which Google account is "active" — subsequent calls without an
// explicit email use this one. Pass null/undefined to clear.
export function setActiveEmail(email) {
  const s = readStore();
  const next = email || null;
  if (s.activeEmail === next) return;
  s.activeEmail = next;
  writeStore(s);
}

export function getActiveEmail() {
  return readStore().activeEmail;
}

// ---- token read/write ---------------------------------------------------

// Return the live token for the given email, or the active email if none
// is passed. Returns null if no live token is available.
export function getToken(email) {
  const s = readStore();
  const key = email || s.activeEmail;
  if (!key) return null;
  const t = s.byEmail[key];
  return isLive(t) ? t : null;
}

// Persist a freshly-minted token. If we don't yet know the email it belongs
// to, look it up via Google's tokeninfo endpoint so we can index it under
// the right account.
async function persistToken(rawToken, hintedEmail) {
  let email = hintedEmail || null;
  if (!email) {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(rawToken.access_token));
      if (res.ok) {
        const data = await res.json();
        if (data?.email) email = data.email;
      }
    } catch {}
  }
  if (!email) email = '__unknown__';

  const s = readStore();
  s.byEmail[email] = { ...rawToken, email };
  s.activeEmail = email;
  writeStore(s);
  return s.byEmail[email];
}

export function clearToken(email) {
  const s = readStore();
  if (email) {
    delete s.byEmail[email];
    if (s.activeEmail === email) s.activeEmail = null;
  } else {
    s.byEmail = {};
    s.activeEmail = null;
  }
  writeStore(s);
}

// Revoke a token with Google then drop it locally. With no email, revokes
// and clears every cached account.
export async function signOut(email) {
  const s = readStore();
  const targets = email
    ? (s.byEmail[email] ? [s.byEmail[email]] : [])
    : Object.values(s.byEmail);
  for (const t of targets) {
    if (t?.access_token && window.google?.accounts?.oauth2) {
      try {
        await new Promise((resolve) => {
          window.google.accounts.oauth2.revoke(t.access_token, () => resolve());
        });
      } catch {}
    }
  }
  clearToken(email);
}

// Email of the currently active account, falling back to tokeninfo lookup
// when we somehow stored a token without one (legacy callers / migration).
export async function getCurrentEmail() {
  const s = readStore();
  if (s.activeEmail && s.activeEmail !== '__unknown__') return s.activeEmail;
  const t = getToken();
  if (!t?.access_token) return null;
  if (t.email && t.email !== '__unknown__') return t.email;
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(t.access_token));
    if (!res.ok) return null;
    const data = await res.json();
    if (data.email) {
      const store = readStore();
      const old = store.byEmail['__unknown__'];
      if (old) {
        store.byEmail[data.email] = { ...old, email: data.email };
        delete store.byEmail['__unknown__'];
      }
      store.activeEmail = data.email;
      writeStore(store);
      return data.email;
    }
  } catch {}
  return null;
}

// ---- GIS script loader --------------------------------------------------

// Load the Google Identity Services script on demand. The previous version
// of this loader had no timeout, so if accounts.google.com was unreachable
// (network, CSP, browser extension blocking) the returned promise would
// never settle and every downstream auth call would hang forever. We add
// a hard timeout and reset the cached promise on failure so the next call
// retries instead of being permanently stuck.
const GIS_LOAD_TIMEOUT_MS = 8000;
let gisLoaded;
function loadGis() {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Google Identity Services script load timed out'));
    }, GIS_LOAD_TIMEOUT_MS);
    function cleanup() { clearTimeout(timer); }
    s.onload = () => { cleanup(); resolve(); };
    s.onerror = () => { cleanup(); reject(new Error('Google Identity Services script failed to load')); };
    document.head.appendChild(s);
  }).catch((e) => {
    gisLoaded = undefined;
    throw e;
  });
  return gisLoaded;
}

// ---- token request flows ------------------------------------------------

// Request an access token interactively. Options:
//   scopes:      string or array of scope URLs
//   forcePicker: show the Google account chooser (the "Switch account" use case)
//   hint:        login_hint email — Google skips the chooser and signs the
//                user straight into this account if they're already logged in
//                in this browser
export async function requestToken(scopes, { forcePicker = false, hint } = {}) {
  await loadGis();
  return new Promise((resolve, reject) => {
    const config = {
      client_id: GOOGLE_CLIENT_ID,
      scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
      prompt: forcePicker ? 'select_account' : '',
      callback: async (resp) => {
        if (resp.error) { reject(new Error(resp.error)); return; }
        const raw = {
          access_token: resp.access_token,
          expires_at: Date.now() + (resp.expires_in || 3600) * 1000,
          scope: resp.scope
        };
        try {
          const token = await persistToken(raw, forcePicker ? null : hint);
          resolve(token);
        } catch (e) {
          reject(e);
        }
      }
    };
    if (hint && !forcePicker) config.hint = hint;
    const client = window.google.accounts.oauth2.initTokenClient(config);
    const reqOpts = {};
    if (forcePicker) reqOpts.prompt = 'select_account';
    else if (hint) reqOpts.hint = hint;
    client.requestAccessToken(reqOpts);
  });
}

// Attempt to renew the access token without showing any popup. Works when
// the user is still signed into Google in this browser AND has previously
// granted these scopes. Returns null on failure (caller decides whether to
// fall back to an interactive flow).
//
// Passing `hint` makes silent refresh deterministically pick that account —
// without a hint, GIS picks "the most recently used Google account in this
// browser" which may not be the one the current client is wired to.
export async function silentRefresh(scopes, { timeoutMs = 4000, hint } = {}) {
  try {
    await loadGis();
  } catch { return null; }

  const scopeStr = Array.isArray(scopes) ? scopes.join(' ') : scopes;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      const config = {
        client_id: GOOGLE_CLIENT_ID,
        scope: scopeStr,
        prompt: '',
        callback: async (resp) => {
          if (resp.error) { finish(null); return; }
          const raw = {
            access_token: resp.access_token,
            expires_at: Date.now() + (resp.expires_in || 3600) * 1000,
            scope: resp.scope
          };
          try {
            const token = await persistToken(raw, hint);
            finish(token);
          } catch { finish(null); }
        },
        error_callback: () => finish(null)
      };
      if (hint) config.hint = hint;
      const client = window.google.accounts.oauth2.initTokenClient(config);
      const reqOpts = { prompt: '' };
      if (hint) reqOpts.hint = hint;
      client.requestAccessToken(reqOpts);
    } catch {
      finish(null);
    }
  });
}

// Ensure a live token exists for the given scopes, returning it.
// Options:
//   email: if provided, target a specific Google account — silent refresh
//          and any interactive fallback will both be hinted to this email
//          so Google skips the account chooser. Switching `active` to that
//          email is a side effect so subsequent getToken() calls return it.
export async function ensureToken(scopes, { email } = {}) {
  if (email) setActiveEmail(email);
  // Hint to the explicit email if given, otherwise fall back to whichever
  // account is currently marked active. Without a hint, Google would pick
  // "the last-used account in this browser" which may be wrong when the
  // user manages multiple Google accounts.
  const hint = email || getActiveEmail() || undefined;
  const targetEmail = hint && hint !== '__unknown__' ? hint : undefined;

  const t = getToken(targetEmail);
  const needed = Array.isArray(scopes) ? scopes : [scopes];
  if (t && needed.every(s => (t.scope || '').includes(s))) return t;

  // Silent first — invisible if the user is still signed into Google in
  // this browser AND already granted these scopes for that account.
  const silent = await silentRefresh(needed, { hint: targetEmail });
  if (silent) return silent;

  // Interactive fallback — with `hint` set, Google goes straight to the
  // right account; no chooser unless the hinted account isn't signed in.
  return requestToken(needed, { hint: targetEmail });
}

// On app start, kick off a background silent refresh for the active account
// if its token is expired or missing. Fire-and-forget — callers should not
// block UI on this.
export function backgroundSilentRefresh(scopes = ALL_READ_SCOPES) {
  const active = getActiveEmail();
  silentRefresh(scopes, { hint: active || undefined }).catch(() => {});
}

// Force the account picker to show (the "Switch account" button in the
// client modal). Always shows the chooser; never uses a hint.
export async function switchAccount(scopes) {
  // Don't revoke other accounts' tokens — just clear the active marker
  // so the picker isn't biased toward the current account.
  const s = readStore();
  s.activeEmail = null;
  writeStore(s);
  return requestToken(scopes, { forcePicker: true });
}

// One-shot legacy migration: if a token exists under the old single-slot
// key, fold it into the v2 store under its real email (tokeninfo lookup)
// and remove the legacy entry. Safe to call multiple times.
export async function migrateLegacyTokenIfAny() {
  try {
    const raw = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (!raw) return;
    const t = JSON.parse(raw);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    if (!isLive(t)) return;
    await persistToken({
      access_token: t.access_token,
      expires_at: t.expires_at,
      scope: t.scope
    }, t.email || null);
  } catch {
    try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch {}
  }
}
