// Server-side Google OAuth — step 2 of 2: exchange the code for tokens and
// store the refresh token.
//
// Google redirects here with ?code=... We exchange it for a refresh_token +
// access_token, resolve the account email, and upsert the refresh token into
// Supabase (syte_suite_google_accounts). The browser popup then closes itself
// and notifies the opener so the connected-accounts list refreshes.
//
// Env vars required:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   — the Web application OAuth client
//   GOOGLE_REDIRECT_URI                      — optional; must match step 1
//   SUPABASE_URL                             — project url
//   SUPABASE_SERVICE_KEY (preferred) or SUPABASE_KEY — service role key so the
//       refresh-token table stays unreadable by the browser's anon key.

import { createClient } from '@supabase/supabase-js';

function page(message, ok = true) {
  // Self-closing popup that pings the opener so the UI can refresh.
  return `<!doctype html><html><body style="font-family:system-ui;background:#0a0a0c;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
<div style="text-align:center;max-width:420px;padding:24px;">
  <div style="font-size:16px;font-weight:600;color:${ok ? '#34d399' : '#ff6b6b'};margin-bottom:8px;">${ok ? 'Connected' : 'Connection failed'}</div>
  <div style="font-size:13px;color:#aaa;">${message}</div>
</div>
<script>
  try { window.opener && window.opener.postMessage({ type: 'syte-google-connected', ok: ${ok} }, '*'); } catch (e) {}
  setTimeout(function(){ window.close(); }, ${ok ? 1200 : 4000});
</script>
</body></html>`;
}

export async function handler(event) {
  const html = (body, statusCode = 200) => ({
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body
  });

  const code = event.queryStringParameters?.code;
  const oauthErr = event.queryStringParameters?.error;
  if (oauthErr) return html(page('Google returned: ' + oauthErr, false));
  if (!code) return html(page('No authorization code returned by Google.', false));

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return html(page('Server missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.', false), 500);
  }

  const proto = event.headers['x-forwarded-proto'] || 'https';
  const host = event.headers.host;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `${proto}://${host}/.netlify/functions/google-oauth-callback`;

  // 1. Exchange the authorization code for tokens.
  let tokenData;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    tokenData = await res.json();
    if (!res.ok) {
      return html(page('Token exchange failed: ' + (tokenData.error_description || tokenData.error || res.status), false), 502);
    }
  } catch (e) {
    return html(page('Token exchange error: ' + e.message, false), 502);
  }

  const refreshToken = tokenData.refresh_token;
  const accessToken = tokenData.access_token;
  if (!refreshToken) {
    // Happens when the account already granted consent and Google declines to
    // re-issue a refresh token. prompt=consent in step 1 should prevent this;
    // if it still occurs, the operator must remove the app from their Google
    // account's third-party access and reconnect.
    return html(page('Google did not return a refresh token. Remove this app under your Google Account → Security → Third-party access, then reconnect.', false));
  }

  // 2. Resolve which account this is for. Prefer the id_token (returned with
  //    the openid scope — no extra round-trip), fall back to userinfo.
  let email = null;
  if (tokenData.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(tokenData.id_token.split('.')[1], 'base64').toString('utf8'));
      email = payload.email || null;
    } catch {}
  }
  if (!email) {
    try {
      const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: 'Bearer ' + accessToken }
      });
      if (info.ok) email = (await info.json()).email || null;
    } catch {}
  }
  if (!email) return html(page('Could not resolve the Google account email. Reconnect — the consent screen must include the email/profile permission.', false), 502);

  // 3. Store the refresh token (service-role only table).
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return html(page('Server missing Supabase env vars.', false), 500);
  }
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { error } = await supabase
      .from('syte_suite_google_accounts')
      .upsert(
        {
          email: email.toLowerCase(),
          refresh_token: refreshToken,
          scopes: tokenData.scope || null,
          revoked: false,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'email' }
      );
    if (error) return html(page('Could not save account: ' + error.message, false), 500);
  } catch (e) {
    return html(page('Database error: ' + e.message, false), 500);
  }

  return html(page(email + ' is now connected. You can close this window.', true));
}
