// Google OAuth (implicit) for GSC and GA4. Same client ID as the original tools.
export const GOOGLE_CLIENT_ID =
  '377465514344-ve8jabk68rl333p7p2n9ieo0pj0ruivt.apps.googleusercontent.com';

const TOKEN_KEY_PREFIX = 'syte-suite:google-token:';

export function getGoogleToken(scope) {
  const raw = sessionStorage.getItem(TOKEN_KEY_PREFIX + scope);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.expires_at && parsed.expires_at < Date.now()) return null;
    return parsed.access_token;
  } catch {
    return null;
  }
}

export function signInWithGoogle(scope) {
  return new Promise((resolve, reject) => {
    const redirect = window.location.origin + window.location.pathname;
    const state = Math.random().toString(36).slice(2);
    sessionStorage.setItem('syte-suite:oauth-state', state);
    const url =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirect)}` +
      `&response_type=token` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${state}` +
      `&include_granted_scopes=true`;

    const popup = window.open(url, 'google-oauth', 'width=500,height=700');
    if (!popup) {
      reject(new Error('Popup blocked'));
      return;
    }

    const timer = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(timer);
          reject(new Error('Popup closed'));
          return;
        }
        const hash = popup.location.hash;
        if (hash && hash.includes('access_token=')) {
          const params = new URLSearchParams(hash.slice(1));
          const token = params.get('access_token');
          const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
          sessionStorage.setItem(
            TOKEN_KEY_PREFIX + scope,
            JSON.stringify({
              access_token: token,
              expires_at: Date.now() + expiresIn * 1000,
            })
          );
          popup.close();
          clearInterval(timer);
          resolve(token);
        }
      } catch {
        /* cross-origin — wait for redirect */
      }
    }, 400);
  });
}
