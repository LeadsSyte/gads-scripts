// Shared Google OAuth token handling. Covers the Technical SEO and AEO
// modules (GSC + GA4) AND the client modal's GA4/GSC property picker.
// Uses the Google OAuth 2.0 implicit flow — no backend required.

export const GOOGLE_CLIENT_ID = '377465514344-ve8jabk68rl333p7p2n9ieo0pj0ruivt.apps.googleusercontent.com';

const TOKEN_KEY = 'syte-suite-google-token';

// Custom event name fired when the saved token changes (set, refreshed,
// cleared). UI components listen for this so they can react to a silent
// refresh that completes after they've already mounted, instead of
// reading getToken() once and being stuck in the wrong state.
export const TOKEN_EVENT = 'syte-google-token-changed';

function notifyTokenChange() {
  try { window.dispatchEvent(new Event(TOKEN_EVENT)); } catch {}
}

function persistToken(token) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  notifyTokenChange();
}

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

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  notifyTokenChange();
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
//     different Google account (needed for the 6-account use case).
export async function requestToken(scopes, { forcePicker = false } = {}) {
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
      prompt: forcePicker ? 'select_account' : '',
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error)); return; }
        const token = {
          access_token: resp.access_token,
          expires_at: Date.now() + (resp.expires_in || 3600) * 1000,
          scope: resp.scope
        };
        persistToken(token);
        resolve(token);
      }
    });
    client.requestAccessToken(forcePicker ? { prompt: 'select_account' } : {});
  });
}

export async function ensureToken(scopes) {
  const t = getToken();
  const needed = Array.isArray(scopes) ? scopes : [scopes];
  if (t && needed.every(s => (t.scope || '').includes(s))) return t;
  // Try a silent refresh first — if the user is still signed into
  // Google in this browser they won't see any popup.
  const silent = await silentRefresh(needed);
  if (silent) return silent;
  return requestToken(needed);
}

// Attempt to renew the access token without showing any popup.
// Works when the user is still signed into Google in this browser
// AND has previously granted these scopes — which is the normal case
// after the initial consent. Returns null on failure (caller decides
// whether to fall back to a popup-based flow).
export async function silentRefresh(scopes, { timeoutMs = 4000 } = {}) {
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
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: scopeStr,
        prompt: '',          // empty → silent attempt
        callback: (resp) => {
          if (resp.error) { finish(null); return; }
          const token = {
            access_token: resp.access_token,
            expires_at: Date.now() + (resp.expires_in || 3600) * 1000,
            scope: resp.scope
          };
          persistToken(token);
          finish(token);
        },
        error_callback: () => finish(null)
      });
      client.requestAccessToken({ prompt: '' });
    } catch {
      finish(null);
    }
  });
}

// On app start, kick off a background silent refresh if the saved
// token is expired or missing. Doesn't await — the caller should not
// block UI on this. If it succeeds the next call to getToken() will
// return the fresh token; if it fails the user will be prompted only
// when they trigger an action that needs Google.
export function backgroundSilentRefresh(scopes = ALL_READ_SCOPES) {
  silentRefresh(scopes).catch(() => {});
}

// Force the account picker to show (used by the "Switch account" button).
export async function switchAccount(scopes) {
  await signOut();
  return requestToken(scopes, { forcePicker: true });
}
