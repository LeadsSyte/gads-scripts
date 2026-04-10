// Shared Google OAuth token handling (used by both Technical SEO for GSC
// and AEO Engine for GA4). Uses the Google OAuth 2.0 implicit flow so it
// works from a static single-page app without any backend.

export const GOOGLE_CLIENT_ID = '377465514344-ve8jabk68rl333p7p2n9ieo0pj0ruivt.apps.googleusercontent.com';

const TOKEN_KEY = 'syte-suite-google-token';

export const SCOPES = {
  gsc:  'https://www.googleapis.com/auth/webmasters.readonly',
  ga4:  'https://www.googleapis.com/auth/analytics.readonly'
};

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
}

// Load the Google Identity Services script.
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

export async function requestToken(scopes) {
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error)); return; }
        const token = {
          access_token: resp.access_token,
          expires_at: Date.now() + (resp.expires_in || 3600) * 1000,
          scope: resp.scope
        };
        localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
        resolve(token);
      }
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export async function ensureToken(scopes) {
  const t = getToken();
  if (t && (!scopes || scopes.every(s => (t.scope || '').includes(s)))) return t;
  return requestToken(scopes);
}
