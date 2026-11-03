// Where the browser sends Claude requests (security brief §1.3).
//
// Through netlify/functions/anthropic-proxy: the browser proves it is an
// unlocked suite session (lib/suiteAuth.js) and the function adds the
// provider key from the Netlify environment. The direct call to
// api.anthropic.com with the key from the lock screen remains only as the
// fallback for a deploy where the proxy is missing (404) — so a half-rolled
// deploy cannot take the suite down — and goes away in Deploy B with the key.
import { getStoredApiKey } from './auth.js';
import { suiteAuthHeaders } from './suiteAuth.js';

export const PROXY_URL = '/.netlify/functions/anthropic-proxy';
export const DIRECT_URL = 'https://api.anthropic.com/v1/messages';

export function directHeaders() {
  const key = getStoredApiKey();
  if (!key) throw new Error('API key not unlocked. Refresh and enter password.');
  return {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
    'x-api-key': key
  };
}

// fetchImpl(url, init) → Response. Tries the proxy; falls back to the direct
// call only when the proxy itself is absent (404 from Netlify, not from
// Anthropic, whose errors come back as JSON with a `type`).
export async function claudeRequest(body, fetchImpl) {
  const init = { method: 'POST', body: JSON.stringify(body) };
  if (globalThis.__SYTE_CLAUDE_DIRECT !== true) {
    const res = await fetchImpl(PROXY_URL, { ...init, headers: { 'Content-Type': 'application/json', ...(await suiteAuthHeaders()) } });
    if (res.status !== 404) return res;
  }
  return fetchImpl(DIRECT_URL, { ...init, headers: directHeaders() });
}
