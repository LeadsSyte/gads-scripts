// Server-side Google OAuth — step 1 of 2: kick off the consent flow.
//
// Opens Google's consent screen requesting OFFLINE access so Google returns
// a long-lived refresh token (stored server-side by the callback). After this
// one-time grant per Google account, the app never has to prompt for that
// account again — google-proxy mints fresh access tokens from the stored
// refresh token on demand.
//
// Env vars required:
//   GOOGLE_CLIENT_ID      — the *Web application* OAuth client id
//   GOOGLE_REDIRECT_URI   — optional; defaults to this site's callback function
//
// Browser flow: window.open('/.netlify/functions/google-oauth-start') →
// Google consent → /.netlify/functions/google-oauth-callback.

const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly'
];

export async function handler(event) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return { statusCode: 500, body: 'Missing GOOGLE_CLIENT_ID env var' };
  }

  const proto = event.headers['x-forwarded-proto'] || 'https';
  const host = event.headers.host;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `${proto}://${host}/.netlify/functions/google-oauth-callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    // offline + consent → guarantees a refresh_token is issued (Google only
    // returns one on the first consent unless prompt=consent forces it).
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true'
  });

  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();

  // Debug mode: /.netlify/functions/google-oauth-start?debug=1 returns the
  // exact redirect_uri (and client id tail) the function will send to Google,
  // instead of redirecting — so a redirect_uri_mismatch can be diagnosed by
  // comparing this string against the Authorized redirect URIs in Google Cloud.
  if (event.queryStringParameters?.debug) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirectUri,
        clientIdTail: '…' + String(clientId).slice(-24),
        host,
        proto,
        note: 'Register redirectUri EXACTLY (under "Authorized redirect URIs") on the OAuth client whose id ends with clientIdTail.'
      }, null, 2)
    };
  }

  return { statusCode: 302, headers: { Location: url } };
}
