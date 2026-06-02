// Client side of the server-side ("connect once") Google auth flow.
//
// When VITE_GOOGLE_SERVER_AUTH is on, Google API calls are routed through the
// google-proxy Netlify function, which holds each account's refresh token and
// mints access tokens server-side. The browser never handles Google tokens —
// so there's no per-session re-authentication and no token-expiry popups.
//
// When the flag is off (default), this module is inert and the app keeps using
// the in-browser GIS token flow in googleAuth.js. That makes the whole feature
// additive: nothing changes until the backend env vars are configured and the
// flag is flipped.

import { fetchWithTimeout } from './http.js';

const PROXY = '/.netlify/functions/google-proxy';
const CONNECT_URL = '/.netlify/functions/google-oauth-start';
const PROXY_TIMEOUT_MS = 60000;

// Optional shared secret — only sent if configured. Kept optional because the
// link is internal / password-protected (no strict gate required).
const GATE = import.meta.env.VITE_PROXY_SHARED_SECRET || undefined;

export function serverAuthEnabled() {
  const v = import.meta.env.VITE_GOOGLE_SERVER_AUTH;
  return v === true || v === 'true' || v === '1';
}

async function callProxy(payload) {
  const res = await fetchWithTimeout(PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, gate: GATE })
  }, PROXY_TIMEOUT_MS);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Proxy error ' + res.status));
  return data;
}

// List connected accounts (emails + status only — never tokens).
export async function listConnectedAccounts() {
  const { accounts } = await callProxy({ action: 'list' });
  return accounts || [];
}

export async function revokeConnectedAccount(email) {
  return callProxy({ action: 'revoke', accountEmail: email });
}

// Open the consent popup and resolve when the callback page pings back.
export function connectGoogleAccount() {
  return new Promise((resolve) => {
    const popup = window.open(CONNECT_URL, 'syte-google-connect', 'width=520,height=640');
    let done = false;
    const onMsg = (e) => {
      if (e.data?.type === 'syte-google-connected') {
        done = true;
        cleanup();
        resolve({ ok: !!e.data.ok });
      }
    };
    const cleanup = () => {
      window.removeEventListener('message', onMsg);
      clearInterval(poll);
    };
    window.addEventListener('message', onMsg);
    // Fallback: if the popup closes without postMessage (blocked opener etc.),
    // resolve so the caller can re-list and see whether it landed.
    const poll = setInterval(() => {
      if (popup?.closed && !done) { cleanup(); resolve({ ok: true, closed: true }); }
    }, 700);
  });
}

// Fetch a Google API URL through the proxy. Returns a minimal Response-like
// object so existing callers (gscFetch, fetchGA4Period) can keep their
// res.ok / res.status / res.text() / res.json() error handling unchanged.
export async function proxyGoogleFetch(url, { method = 'GET', body = null } = {}, accountEmail) {
  if (!accountEmail) {
    throw new Error('Server Google auth is on but this client has no Google account bound. Set its GA4/GSC account, then connect that account under Google accounts.');
  }
  const data = await callProxy({ action: 'request', accountEmail, url, method, body });
  const status = data.status;
  const text = typeof data.body === 'string' ? data.body : JSON.stringify(data.body ?? '');
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text)
  };
}
