// URL of one of this site's Netlify functions. In the browser it is the
// relative path. The server-side Autopilot reuses the browser's CMS push
// code, and a relative URL means nothing under Node, so it sets
// globalThis.__SYTE_FN_BASE to the site origin first
// (netlify/functions/lib/serverPushEnv.js).
export function fnUrl(name) {
  return (globalThis.__SYTE_FN_BASE || '') + '/.netlify/functions/' + name;
}
