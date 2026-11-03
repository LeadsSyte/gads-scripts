// The credentials the browser sends to the suite's own functions.
//
// Today: the legacy X-Suite-Auth hash (cms/proxyAuth.js). After Deploy B of
// the security plan (docs/security-and-bot-api-plan.md) staff sign in with
// Supabase Auth and this sends their token instead; the functions accept
// either through netlify/functions/lib/requireAuth.js, so the switch needs
// no function change.
//
// Modules that the node tests copy into a temp folder (verification.js,
// imageGen.js, sitemap.js, crawler.js) cannot import this file, so the
// browser also installs it as globalThis.__SYTE_AUTH_HEADERS and they call
// that; the server installs its own (requireAuth.installServerAuthGlobals).
import { proxyAuthHash } from '../modules/cms/proxyAuth.js';

export async function suiteAuthHeaders() {
  // Server-side (Autopilot reusing browser code): the function already set it.
  if (globalThis.__SYTE_PROXY_AUTH) return { 'X-Suite-Auth': globalThis.__SYTE_PROXY_AUTH };
  try {
    const { supabase } = await import('./supabase.js');
    const session = supabase?.auth ? (await supabase.auth.getSession())?.data?.session : null;
    if (session?.access_token) return { Authorization: 'Bearer ' + session.access_token };
  } catch { /* fall through to the legacy header */ }
  const hash = await proxyAuthHash();
  return hash ? { 'X-Suite-Auth': hash } : {};
}

// fetch() to a suite function with the credentials added.
export async function suiteFetch(url, options = {}) {
  const auth = await suiteAuthHeaders();
  return fetch(url, { ...options, headers: { ...(options.headers || {}), ...auth } });
}

if (typeof window !== 'undefined' && !globalThis.__SYTE_AUTH_HEADERS) {
  globalThis.__SYTE_AUTH_HEADERS = suiteAuthHeaders;
}
