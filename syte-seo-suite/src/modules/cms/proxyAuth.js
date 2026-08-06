// Shared proxy auth for the CMS proxy functions (wp-proxy, shopify-proxy).
// Proves to the Netlify function that the request comes from an unlocked
// suite session without shipping a secret in the JS bundle: we send
// SHA-256(stored suite key); the functions compare it against the
// WP_PROXY_AUTH env var. The hash is useless as an API key by itself.

let _authHashPromise = null;

export async function proxyAuthHash() {
  if (_authHashPromise) return _authHashPromise;
  _authHashPromise = (async () => {
    try {
      const { getStoredApiKey } = await import('../../lib/auth.js');
      const key = getStoredApiKey();
      if (!key || !globalThis.crypto?.subtle) return '';
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { return ''; }
  })();
  return _authHashPromise;
}
