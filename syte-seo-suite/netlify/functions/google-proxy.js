// Server-side Google API proxy.
//
// The browser no longer holds Google tokens. It POSTs here with the target
// Google API URL + the account to use; this function loads that account's
// stored refresh token, mints a short-lived access token (cached in-memory
// while the function stays warm), calls Google, and returns the raw status +
// body so the client's existing error handling (403 permission hints, etc.)
// keeps working unchanged.
//
// Actions (POST JSON { action, ... }):
//   list                                   → { accounts: [email, ...] }
//   request { accountEmail, url, method, body }
//                                          → { status, body }  (raw Google response)
//   revoke  { accountEmail }               → { ok: true }
//
// Env vars:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_KEY (or SUPABASE_KEY)
//   PROXY_SHARED_SECRET — optional. If set, callers must send a matching
//       `gate` field. Left unset for the internal/password-protected case.

import { createClient } from '@supabase/supabase-js';

// Warm-instance access-token cache: email → { token, expiresAt }.
const tokenCache = new Map();

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

function json(statusCode, obj) {
  return { statusCode, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// Mint (or reuse) an access token for an account from its stored refresh token.
async function getAccessToken(supabase, email) {
  const key = email.toLowerCase();
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;

  const { data, error } = await supabase
    .from('syte_suite_google_accounts')
    .select('refresh_token, revoked')
    .eq('email', key)
    .single();
  if (error || !data) throw new Error('No connected Google account for ' + email + '. Connect it under Google accounts.');
  if (data.revoked) throw new Error('Google account ' + email + ' has been disconnected. Reconnect it.');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: data.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  const tok = await res.json();
  if (!res.ok || !tok.access_token) {
    // A refresh token can be revoked Google-side (password change, access
    // removed). Mark it so the UI can prompt a reconnect instead of looping.
    if (/invalid_grant/i.test(tok.error || '')) {
      await supabase.from('syte_suite_google_accounts').update({ revoked: true }).eq('email', key);
      throw new Error('Google sign-in for ' + email + ' expired (refresh token revoked). Reconnect the account.');
    }
    throw new Error('Token refresh failed for ' + email + ': ' + (tok.error_description || tok.error || res.status));
  }

  const token = tok.access_token;
  tokenCache.set(key, { token, expiresAt: Date.now() + (tok.expires_in || 3600) * 1000 });
  return token;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders() };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  // Diagnostics — answered BEFORE the gate so setup can be verified without
  // any secret. Reports only booleans/counts, never secret values, so it's
  // safe to expose. Used by the connected-accounts panel + manual debugging.
  if (payload.action === 'health') {
    const out = {
      env: {
        GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI: !!process.env.GOOGLE_REDIRECT_URI,
        SUPABASE_URL: !!(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
        SUPABASE_SERVICE_KEY: !!(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY),
        PROXY_SHARED_SECRET: !!process.env.PROXY_SHARED_SECRET
      },
      supabase: { reachable: false, tableExists: false, accountCount: null }
    };
    const sb = getSupabase();
    if (sb) {
      const { count, error } = await sb
        .from('syte_suite_google_accounts')
        .select('email', { count: 'exact', head: true });
      out.supabase.reachable = true;
      if (error) out.supabase.error = error.message;
      else { out.supabase.tableExists = true; out.supabase.accountCount = count ?? 0; }
    }
    out.ok = out.env.GOOGLE_CLIENT_ID && out.env.GOOGLE_CLIENT_SECRET && out.supabase.tableExists;
    return json(200, out);
  }

  // Optional shared-secret gate (off by default for the internal case).
  const gate = process.env.PROXY_SHARED_SECRET;
  if (gate && payload.gate !== gate) return json(401, { error: 'Unauthorized' });

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return json(500, { error: 'Server missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET' });
  }
  const supabase = getSupabase();
  if (!supabase) return json(500, { error: 'Server missing Supabase env vars' });

  const action = payload.action || 'request';

  try {
    if (action === 'list') {
      const { data, error } = await supabase
        .from('syte_suite_google_accounts')
        .select('email, scopes, revoked, updated_at')
        .order('email', { ascending: true });
      if (error) return json(500, { error: error.message });
      // Never return refresh tokens to the browser.
      return json(200, { accounts: data || [] });
    }

    if (action === 'revoke') {
      const email = (payload.accountEmail || '').toLowerCase();
      if (!email) return json(400, { error: 'Missing accountEmail' });
      tokenCache.delete(email);
      const { error } = await supabase.from('syte_suite_google_accounts').update({ revoked: true }).eq('email', email);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    if (action === 'request') {
      const { accountEmail, url, method = 'GET', body = null } = payload;
      if (!accountEmail) return json(400, { error: 'Missing accountEmail' });
      if (!url || !/^https:\/\/[a-z0-9.-]+\.googleapis\.com\//i.test(url)) {
        // Only allow Google API hosts through the proxy.
        return json(400, { error: 'url must be an https googleapis.com endpoint' });
      }
      const accessToken = await getAccessToken(supabase, accountEmail);
      const upstream = await fetch(url, {
        method,
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
      });
      const text = await upstream.text();
      return json(200, { status: upstream.status, body: text });
    }

    return json(400, { error: 'Unknown action: ' + action });
  } catch (e) {
    return json(502, { error: e.message });
  }
}
