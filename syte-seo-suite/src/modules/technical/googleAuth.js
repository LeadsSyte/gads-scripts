// Shared Google OAuth token handling. Covers the Technical SEO and AEO
// modules (GSC + GA4) AND the client modal's GA4/GSC property picker.
// Uses the Google OAuth 2.0 implicit flow — no backend required.

export const GOOGLE_CLIENT_ID = '377465514344-ve8jabk68rl333p7p2n9ieo0pj0ruivt.apps.googleusercontent.com';

// We keep TWO storage slots for Google tokens:
//
// 1) TOKEN_KEY  — the "current" token. Most consumers read this without
//    knowing or caring which Google account it's bound to. Backwards
//    compatible with all the call sites that pre-date multi-account.
// 2) TOKENS_KEY — a map of { [email]: token } so we can keep a live
//    token for every account the operator has signed into. When a client
//    has a saved google_account_email and the cached token for that
//    address is still valid, we use it directly — no chooser, no switch.
//
// The agency runs ~6 client Google accounts; with the map we sign into
// each one ONCE, then every client open uses the right token transparently.
const TOKEN_KEY = 'syte-suite-google-token';
const TOKENS_KEY = 'syte-suite-google-tokens';

// Custom event name fired when the saved token changes (set, refreshed,
// cleared). UI components listen for this so they can react to a silent
// refresh that completes after they've already mounted, instead of
// reading getToken() once and being stuck in the wrong state.
export const TOKEN_EVENT = 'syte-google-token-changed';

function notifyTokenChange() {
  try { window.dispatchEvent(new Event(TOKEN_EVENT)); } catch {}
}

function readTokensMap() {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeTokensMap(map) {
  try { localStorage.setItem(TOKENS_KEY, JSON.stringify(map)); } catch {}
}

function persistToken(token) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  // Also stash under the email-keyed map when we know which account this
  // is for. Tokens land in two places — silentRefresh / requestToken — so
  // funnelling both through persistToken keeps both slots consistent.
  if (token?.email) {
    const map = readTokensMap();
    map[token.email.toLowerCase()] = token;
    writeTokensMap(map);
  }
  notifyTokenChange();
}

// Look up a stored token for a specific Google account, regardless of
// which one is "current". Returns null when the stored token is missing,
// expired, or under-scoped for the requested API surface.
export function getTokenForEmail(email, requiredScopes = []) {
  if (!email) return null;
  const map = readTokensMap();
  const t = map[email.toLowerCase()];
  if (!t?.access_token) return null;
  if (t.expires_at && Date.now() > t.expires_at) return null;
  if (requiredScopes.length && !requiredScopes.every(s => (t.scope || '').includes(s))) return null;
  return t;
}

// Promote a stored token to the "current" slot so getToken() etc. see it
// without re-issuing through Google. Used when switching between clients
// bound to different accounts — picks the right cached token instantly.
function setCurrentToken(token) {
  if (!token) return;
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
// Cached on the token itself so repeated calls don't hammer Google. Routes
// through persistToken so the per-email map gets seeded whenever we
// resolve an address — without that, a first-time sign-in (no client
// google_account_email yet, so no expectedEmail trigger) would never end
// up in the map and we'd lose the multi-account fast path.
export async function getCurrentEmail() {
  const t = getToken();
  if (!t?.access_token) return null;
  if (t.email) return t.email;
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(t.access_token));
    if (!res.ok) return null;
    const data = await res.json();
    if (data.email) {
      persistToken({ ...t, email: data.email });
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
        persistToken(token);
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
//
// Resolution order:
//  1. Cached token for expectedEmail in the per-account map → promote it to
//     the current slot and return. Fully silent, no Google round-trip.
//  2. Current single-slot token, when its scopes match (and email matches
//     expectedEmail if one was supplied).
//  3. Silent refresh (prompt:'none') with login_hint = expectedEmail.
//  4. Interactive picker with the same hint.
//
// Step 1 is the multi-account win: once the operator has signed into all
// six client accounts, switching between clients is instant — the map
// holds a live token per email and we just hand back the right one.
export async function ensureToken(scopes, { expectedEmail = null } = {}) {
  const needed = Array.isArray(scopes) ? scopes : [scopes];

  // (1) Per-email cache — only consulted when the caller knows which
  //     account this client should use.
  if (expectedEmail) {
    const cached = getTokenForEmail(expectedEmail, needed);
    if (cached) {
      setCurrentToken(cached);
      return cached;
    }
  }

  // (2) Current single-slot token, if it satisfies scope + (when given)
  //     the expected email.
  const t = getToken();
  if (t && needed.every(s => (t.scope || '').includes(s))) {
    if (expectedEmail) {
      try {
        await assertEmailMatches(t, expectedEmail);
        return t;
      } catch (e) {
        if (!e?.accountMismatch) throw e;
        // Mismatch — fall through to silent / interactive with the hint
        // so we can issue (or pick) a token bound to expectedEmail.
      }
    } else {
      return t;
    }
  }

  // (3) Silent refresh with login_hint.
  const hint = expectedEmail || getLastKnownEmail();
  const silent = await silentRefresh(needed, { loginHint: hint });
  let fresh;
  if (silent) {
    fresh = silent;
  } else {
    // (4) Interactive — last resort.
    fresh = await requestToken(needed, { loginHint: hint });
  }
  if (expectedEmail) await assertEmailMatches(fresh, expectedEmail);
  return fresh;
}

// Resolve the actual email Google issued the token for (round-trips to
// tokeninfo) and throw a structured mismatch error if it doesn't match
// the expected one. The error carries both emails so the UI can render
// a useful "Switch to X" prompt.
//
// We always verify against tokeninfo when a token's email field
// disagrees with expectedEmail — silentRefresh / requestToken
// optimistically pre-fill email from the loginHint, which is wrong if
// the user picked a different account in the interactive picker. Without
// re-verifying, the per-email token map gets keyed under the wrong
// address and subsequent client opens silently grab the wrong token.
async function assertEmailMatches(token, expectedEmail) {
  let actual = token.email;
  // Force a verification round-trip when the cached email doesn't match
  // what we expect — covers the "user picked a different account than
  // the hint" case where the token was optimistically labelled wrong.
  const needsVerify = !actual || actual.toLowerCase() !== expectedEmail.toLowerCase();
  if (needsVerify) {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(token.access_token));
      if (res.ok) {
        const data = await res.json();
        if (data.email) {
          actual = data.email;
          // Re-persist with the verified email so the per-account map
          // gets keyed correctly. If the optimistic email was wrong,
          // also drop the wrong key from the map so we don't leak it.
          if (token.email && token.email.toLowerCase() !== actual.toLowerCase()) {
            const map = readTokensMap();
            delete map[token.email.toLowerCase()];
            writeTokensMap(map);
          }
          persistToken({ ...token, email: actual });
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

// Attempt to renew the access token without showing any popup.
// Works when the user is still signed into Google in this browser
// AND has previously granted these scopes — which is the normal case
// after the initial consent. Returns null on failure (caller decides
// whether to fall back to a popup-based flow).
export async function silentRefresh(scopes, { timeoutMs = 4000, loginHint = null } = {}) {
  try {
    await loadGis();
  } catch { return null; }

  const scopeStr = Array.isArray(scopes) ? scopes.join(' ') : scopes;
  const hint = loginHint || getLastKnownEmail();
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
      const clientCfg = {
        client_id: GOOGLE_CLIENT_ID,
        scope: scopeStr,
        // 'none' guarantees Google never pops UI — if a silent re-issue
        // isn't possible (no session, multi-account without hint, blocked
        // third-party cookies, etc.) GIS rejects with `interaction_required`
        // and we resolve null. The previous '' prompt was Google's "default
        // mode", which pops a chooser when it can't decide silently — that
        // looked exactly like the tool was demanding sign-in on every visit.
        prompt: 'none',
        callback: (resp) => {
          if (resp.error) { finish(null); return; }
          const token = {
            access_token: resp.access_token,
            expires_at: Date.now() + (resp.expires_in || 3600) * 1000,
            scope: resp.scope,
            // Carry forward the hinted email so callers don't have to round
            // trip to tokeninfo before checking it against expectedEmail.
            email: hint || undefined
          };
          persistToken(token);
          finish(token);
        },
        error_callback: () => finish(null)
      };
      if (hint) clientCfg.hint = hint;
      const client = window.google.accounts.oauth2.initTokenClient(clientCfg);
      const opts = { prompt: 'none' };
      if (hint) opts.hint = hint;
      client.requestAccessToken(opts);
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
// Notably does NOT revoke or wipe the per-email token map — switching to a
// different account shouldn't blow away cached tokens for accounts the
// operator might still need (the agency runs ~6 client Google accounts;
// keeping their cached tokens alive is the whole point of the map).
// Just drops the "current" pointer so requestToken's fresh issue lands as
// the new current.
export async function switchAccount(scopes, { loginHint = null } = {}) {
  localStorage.removeItem(TOKEN_KEY);
  notifyTokenChange();
  return requestToken(scopes, { forcePicker: true, loginHint });
}

// Wipe everything — the current single-slot token AND every cached
// per-account token. Used when the operator wants to truly sign out of
// the suite (vs just switching between accounts).
export function clearAllTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKENS_KEY);
  notifyTokenChange();
}
