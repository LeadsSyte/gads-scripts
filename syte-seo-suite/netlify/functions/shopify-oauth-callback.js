// Shopify OAuth — step 2 of 2: check the callback, exchange the code for the
// store's access token, and save it on the client.
//
// Shopify redirects here with ?code&hmac&host&shop&state&timestamp. Every one
// of these checks must pass before the code is exchanged, because the result
// is written straight into a client record:
//   1. `state` opens with our key and hasn't expired (lib/shopifyOAuth.js)
//   2. the nonce cookie matches, so this browser is the one that started it
//   3. `shop` is a myshopify address AND the same store the flow started for
//   4. Shopify's HMAC verifies with the app's client secret
// The token is then stored as the client's `shopify_token`, which is what
// shopify-proxy, shopifyPush and publish-approved already read. The client
// secret is used here and discarded; it never reaches the database.
//
// Env vars: WP_PROXY_AUTH (state key material), SUPABASE_URL +
// SUPABASE_SERVICE_KEY (or the anon key fallbacks notify-draft uses).

import { createClient } from '@supabase/supabase-js';
import {
  NONCE_COOKIE, isValidShopDomain, stateKeyFromEnv, openState,
  verifyCallbackHmac, missingScopes, parseCookies
} from './lib/shopifyOAuth.js';

// Same version shopify-proxy uses, so a token that passes here works there.
const API_VERSION = '2024-01';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(title, message, ok, attempt) {
  // Tells the suite window the outcome. Unlike google-oauth-callback this
  // can't rely on window.opener: Shopify's pages send
  // Cross-Origin-Opener-Policy: same-origin, which severs the popup from the
  // suite as soon as it navigates there, so by the time we're back here
  // opener is null. A BroadcastChannel (and a localStorage write as a
  // fallback) reaches same-origin windows regardless. window.close() may also
  // be refused after that severing, hence the "you can close" wording.
  // `attempt` ties the outcome to the suite tab that started it; the esc on
  // '<' keeps the embedded JSON from closing the script tag.
  const signal = JSON.stringify({ type: 'syte-shopify-connected', ok: !!ok, attempt: attempt || '' })
    .replace(/</g, '\\u003c');
  return `<!doctype html><html><body style="font-family:system-ui;background:#0a0a0c;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
<div style="text-align:center;max-width:460px;padding:24px;">
  <div style="font-size:16px;font-weight:600;color:${ok ? '#34d399' : '#ff6b6b'};margin-bottom:8px;">${esc(title)}</div>
  <div style="font-size:13px;color:#aaa;line-height:1.5;">${esc(message)}</div>
</div>
<script>
  var msg = ${signal};
  try { window.opener && window.opener.postMessage(msg, window.location.origin); } catch (e) {}
  try { new BroadcastChannel('syte-shopify').postMessage(msg); } catch (e) {}
  try { localStorage.setItem('syte-shopify-connected', JSON.stringify({ ok: msg.ok, attempt: msg.attempt, at: Date.now() })); } catch (e) {}
  ${ok ? 'setTimeout(function(){ window.close(); }, 2500);' : ''}
</script>
</body></html>`;
}

// Expire the nonce cookie whatever the outcome — it is single-use.
const CLEAR_COOKIE = NONCE_COOKIE + '=; Path=/.netlify/functions/shopify-oauth-callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax';

function respond(statusCode, title, message, ok, attempt) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': CLEAR_COOKIE, 'Cache-Control': 'no-store' },
    body: page(title, message, ok, attempt)
  };
}

export async function handler(event) {
  const q = event.queryStringParameters || {};
  // Unknown until the state opens. Failures before that carry no attempt id,
  // so no suite tab acts on them — the reason is shown in this window instead.
  let attempt = '';
  const failure = (message, statusCode = 400) => respond(statusCode, 'Connection failed', message, false, attempt);

  if (q.error) return failure('Shopify returned: ' + (q.error_description || q.error));
  if (!q.code || !q.state || !q.shop || !q.hmac) {
    return failure('Shopify did not send back everything needed. Start again from the suite with the Connect button.');
  }

  const key = stateKeyFromEnv();
  if (!key) return failure('Shopify connect is not configured on the server.', 500);

  let st;
  try { st = openState(q.state, key); }
  catch (e) { return failure(e.message); }
  attempt = st.a || '';

  const cookieNonce = parseCookies(event.headers.cookie || event.headers.Cookie)[NONCE_COOKIE];
  if (!cookieNonce || cookieNonce !== st.n) {
    return failure('This approval did not start in this browser, or it was already used. Start again from the suite in the same browser.');
  }

  if (!isValidShopDomain(q.shop) || q.shop !== st.s) {
    return failure('Shopify answered for a different store than the one being connected. Nothing was saved.');
  }

  if (!verifyCallbackHmac(q, st.sec)) {
    return failure('Shopify\'s signature did not match this app\'s Client secret. Check the secret was copied in full from the Dev Dashboard, then try again.');
  }

  // Exchange the code. No `expiring` flag: custom apps are entitled to a
  // non-expiring offline token, which the background publisher relies on.
  let tokenData;
  try {
    const res = await fetch('https://' + q.shop + '/admin/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: st.id, client_secret: st.sec, code: q.code }),
      signal: AbortSignal.timeout(30000)
    });
    tokenData = await res.json().catch(() => ({}));
    if (!res.ok || !tokenData.access_token) {
      return failure('Shopify would not issue a token (' + (tokenData.error_description || tokenData.error || ('HTTP ' + res.status)) + '). The code may have been used already. Try Connect again.', 502);
    }
  } catch (e) {
    return failure('Could not reach Shopify to finish connecting: ' + e.message, 502);
  }

  const missing = missingScopes(tokenData.scope);
  if (missing.length) {
    return failure('The app is missing the ' + missing.join(' and ') + ' permission, so it could not create blog drafts. Add it to the app\'s access scopes in the Dev Dashboard, release a new version, then Connect again.');
  }

  // Save first, test second: a failed test must not throw away a good token.
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return failure('Server missing Supabase env vars.', 500);

  let clientName = '';
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from('syte_suite_clients')
      .update({ cms_type: 'Shopify', shopify_store: q.shop, shopify_token: tokenData.access_token })
      .eq('id', st.c)
      .select('id, name');
    if (error) return failure('Connected, but the token could not be saved: ' + error.message, 500);
    if (!data || data.length !== 1) return failure('Connected, but the suite client was not found, so nothing was saved. Start again from the client\'s CMS page.', 404);
    clientName = data[0].name || '';
  } catch (e) {
    return failure('Database error while saving: ' + e.message, 500);
  }

  // Prove the token actually works before telling anyone it does.
  let storeName = q.shop;
  let tested = false;
  let testNote = '';
  try {
    const res = await fetch('https://' + q.shop + '/admin/api/' + API_VERSION + '/shop.json', {
      headers: { 'X-Shopify-Access-Token': tokenData.access_token },
      signal: AbortSignal.timeout(20000)
    });
    if (res.ok) { storeName = (await res.json()).shop?.name || storeName; tested = true; }
    else testNote = 'The token was saved but a test call returned HTTP ' + res.status + '.';
  } catch (e) { testNote = 'The token was saved but the test call failed: ' + e.message; }

  const expiryNote = tokenData.expires_in
    ? ' Shopify issued a token that expires, which this suite does not renew yet, so this store will need reconnecting.'
    : '';

  if (!tested) {
    return respond(200, 'Saved, but not yet confirmed', testNote + ' Use Test Connection on the CMS page to check it.' + expiryNote, false, attempt);
  }
  return respond(200, 'Connected',
    storeName + ' is now connected' + (clientName ? ' to ' + clientName : '') + '. Blog drafts can be pushed from the suite. You can close this window.' + expiryNote, true, attempt);
}
