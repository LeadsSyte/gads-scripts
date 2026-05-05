// Shared Google OAuth token handling. Covers the Technical SEO and AEO
// modules (GSC + GA4) AND the client modal's GA4/GSC property picker.
// Uses the Google OAuth 2.0 implicit flow — no backend required.

export const GOOGLE_CLIENT_ID = '377465514344-ve8jabk68rl333p7p2n9ieo0pj0ruivt.apps.googleusercontent.com';

const TOKEN_KEY = 'syte-suite-google-token';

export const SCOPES = {
  gsc:  'https://www.googleapis.com/auth/webmasters.readonly',
  ga4:  'https://www.googleapis.com/auth/analytics.readonly'
};

// All the scopes needed for the combined GA4 + GSC picker. Requesting both
// at once means the user only has to consent one time.
export const ALL_READ_SCOPES = [SCOPES.gsc, SCOPES.ga4];

export function getToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (t.expires_at && Date.now() > t.expires_at) return null;
    return t;
  } catch { return null; }
}

// Read the token even if expired — used to recover the last known email
// so we can pass login_hint when silently refreshing.
function getTokenAllowExpired() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Revoke + clear so the next sign-in forces a full account picker.
export async function signOut() {
  const t = getToken();
  if (t?.access_token && window.google?.accounts?.oauth2) {
    try {
      await new Promise((resolve) => {
        window.google.accounts.oauth2.revoke(t.access_token, () => resolve());
      });
    } catch {}
  }
  clearToken();
}

// Fetch the current token's email + scope via Google's tokeninfo endpoint.
// Cached on the token itself so repeated calls don't hammer Google.
export async function getCurrentEmail() {
  const t = getToken();
  if (!t?.access_token) return null;
  if (t.email) return t.email;
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(t.access_token));
    if (!res.ok) return null;
    const data = await res.json();
    if (data.email) {
      // Persist email back onto the stored token so we don't re-fetch every time.
      const merged = { ...t, email: data.email };
      localStorage.setItem(TOKEN_KEY, JSON.stringify(merged));
      return data.email;
    }
  } catch {}
  return null;
}

// Last-known email even when the token has expired. Used as login_hint when
// silently refreshing so Google picks the right account out of the user's
// signed-in set without showing the picker.
export function getLastKnownEmail() {
  const t = getTokenAllowExpired();
  return t?.email || null;
}

// Load the Google Identity Services script on demand.
let gisLoaded;
function loadGis() {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return gisLoaded;
}

// Request an access token. Options:
//   scopes: string or array of scope URLs
//   forcePicker: if true, show the account chooser so the user can pick a
//     different Google account (needed for the multi-account use case).
//   loginHint: email to pre-select when the picker is shown OR for silent
//     re-auth — Google will use the matching session if available.
//   silent: if true, request with prompt:'none' — no UI. Resolves with the
//     token if Google can issue one without interaction, otherwise rejects
//     with an error tagged `requiresInteraction = true`.
export async function requestToken(scopes, { forcePicker = false, loginHint = null, silent = false } = {}) {
  await loadGis();
  return new Promise((resolve, reject) => {
    const clientConfig = {
      client_id: GOOGLE_CLIENT_ID,
      scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
      prompt: forcePicker ? 'select_account' : (silent ? 'none' : ''),
      callback: (resp) => {
        if (resp.error) {
          const err = new Error(resp.error);
          // GIS reports these when it can't silently refresh.
          if (silent || ['interaction_required', 'login_required', 'consent_required', 'access_denied'].includes(resp.error)) {
            err.requiresInteraction = true;
          }
          reject(err);
          return;
        }
        const token = {
          access_token: resp.access_token,
          expires_at: Date.now() + (resp.expires_in || 3600) * 1000,
          scope: resp.scope,
          // Carry forward the previously known email so callers can match it
          // to a client's expected account before the tokeninfo round-trip.
          email: loginHint || getLastKnownEmail() || undefined
        };
        localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
        resolve(token);
      },
      error_callback: (err) => {
        const e = new Error(err?.type || err?.message || 'oauth_error');
        if (silent) e.requiresInteraction = true;
        reject(e);
      }
    };
    if (loginHint) clientConfig.hint = loginHint;
    const client = window.google.accounts.oauth2.initTokenClient(clientConfig);

    const requestOpts = {};
    if (forcePicker) requestOpts.prompt = 'select_account';
    if (silent) requestOpts.prompt = 'none';
    if (loginHint) requestOpts.hint = loginHint;
    client.requestAccessToken(requestOpts);
  });
}

// Try to obtain a valid token without showing UI. Falls back to interactive
// only when Google says interaction is required. The optional expectedEmail
// is passed as login_hint so when the picker DOES show up (or when GIS is
// silently re-issuing) Google selects the right account.
export async function ensureToken(scopes, { expectedEmail = null } = {}) {
  const t = getToken();
  const needed = Array.isArray(scopes) ? scopes : [scopes];
  if (t && needed.every(s => (t.scope || '').includes(s))) {
    if (expectedEmail) await assertEmailMatches(t, expectedEmail);
    return t;
  }
  // Try silent first using the last-known email (or expected) as the hint.
  const hint = expectedEmail || getLastKnownEmail();
  let fresh;
  try {
    fresh = await requestToken(needed, { silent: true, loginHint: hint });
  } catch (silentErr) {
    // Fall through to interactive only if silent refresh isn't possible.
    fresh = await requestToken(needed, { loginHint: hint });
  }
  if (expectedEmail) await assertEmailMatches(fresh, expectedEmail);
  return fresh;
}

// Resolve the actual email Google issued the token for (round-trips to
// tokeninfo on first call, then cached) and throw a structured mismatch
// error if it doesn't match the expected one. The error carries both
// emails so the UI can render a useful "Switch to X" prompt.
async function assertEmailMatches(token, expectedEmail) {
  let actual = token.email;
  if (!actual) {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(token.access_token));
      if (res.ok) {
        const data = await res.json();
        actual = data.email;
        if (actual) {
          const merged = { ...token, email: actual };
          localStorage.setItem(TOKEN_KEY, JSON.stringify(merged));
        }
      }
    } catch {}
  }
  if (actual && actual.toLowerCase() !== expectedEmail.toLowerCase()) {
    const err = new Error('account_mismatch');
    err.accountMismatch = true;
    err.currentEmail = actual;
    err.expectedEmail = expectedEmail;
    throw err;
  }
}

// Force the account picker to show (used by the "Switch account" button).
export async function switchAccount(scopes, { loginHint = null } = {}) {
  await signOut();
  return requestToken(scopes, { forcePicker: true, loginHint });
}
