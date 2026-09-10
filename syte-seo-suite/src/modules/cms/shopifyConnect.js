// "Connect with Shopify" — browser side of netlify/functions/shopify-oauth-*.
//
// Hands the store's Dev Dashboard credentials to shopify-oauth-start over a
// POST (the client secret must never ride in a URL), then walks a popup
// through Shopify's approval screen. The callback page saves the token on the
// client and announces the outcome on the 'syte-shopify' BroadcastChannel.
//
// Why not window.opener / popup.closed like the Google flow: Shopify sends
// Cross-Origin-Opener-Policy: same-origin, which severs the popup from this
// window the moment it reaches Shopify. After that `popup.closed` reads true
// even while the approval screen is still open, and the callback's
// window.opener is null. Only same-origin broadcast survives, so that is the
// signal we wait for; the caller offers Cancel in case the user abandons it.

import { proxyAuthHash } from './proxyAuth.js';

const START_URL = '/.netlify/functions/shopify-oauth-start';
const TIMEOUT_MS = 15 * 60 * 1000; // matches the sealed state's lifetime

// Must be called synchronously from the click handler: the popup is opened
// before any await, because browsers block window.open() once the click's
// user-activation has been spent on a network round trip.
//
// Returns a promise for { ok } (or { ok: false, cancelled | timedOut }), with
// a .cancel() method to stop waiting.
export function connectShopify({ clientId, shop, appClientId, appClientSecret }) {
  const popup = window.open('', 'syte-shopify-connect', 'width=720,height=800');
  if (popup) {
    try { popup.document.write('<p style="font-family:system-ui;padding:24px;color:#555">Opening Shopify…</p>'); }
    catch { /* already navigated — harmless */ }
  }

  let cancel = () => {};
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    let channel = null;
    let timer = null;
    // Set once the server has started this attempt. The broadcast reaches
    // every suite tab, so only the outcome carrying our id is ours.
    let attemptId = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
      try { channel && channel.close(); } catch { /* ignore */ }
      clearTimeout(timer);
      fn(value);
    };
    const accept = data => {
      if (!data || data.type !== 'syte-shopify-connected') return;
      if (!attemptId || data.attempt !== attemptId) return;
      finish(resolve, { ok: !!data.ok });
    };

    function onMessage(e) { if (e.origin === window.location.origin) accept(e.data); }
    function onStorage(e) {
      if (e.key !== 'syte-shopify-connected' || !e.newValue) return;
      try {
        const v = JSON.parse(e.newValue);
        accept({ type: 'syte-shopify-connected', ok: v.ok, attempt: v.attempt });
      } catch { /* ignore */ }
    }

    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
    try { channel = new BroadcastChannel('syte-shopify'); channel.onmessage = e => accept(e.data); }
    catch { /* older browser — storage event still covers it */ }

    timer = setTimeout(() => finish(resolve, { ok: false, timedOut: true }), TIMEOUT_MS);
    cancel = () => finish(resolve, { ok: false, cancelled: true });

    (async () => {
      if (!popup) {
        throw new Error('Your browser blocked the Shopify window. Allow pop-ups for this site, then press Connect again.');
      }
      const res = await fetch(START_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
        body: JSON.stringify({ clientId, shop, appClientId, appClientSecret })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.url) throw new Error(out.error || ('Could not start the Shopify connection (HTTP ' + res.status + ').'));
      attemptId = out.attempt || null;
      popup.location.href = out.url;
    })().catch(e => {
      try { popup && popup.close(); } catch { /* ignore */ }
      finish(reject, e);
    });
  });

  promise.cancel = () => cancel();
  return promise;
}

// What to paste into the Dev Dashboard as the app's redirect URL. Shown in
// the suite so nobody has to guess the exact string Shopify matches against.
export function shopifyCallbackUrl() {
  return window.location.origin + '/.netlify/functions/shopify-oauth-callback';
}
