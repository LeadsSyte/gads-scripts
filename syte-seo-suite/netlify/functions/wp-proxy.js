// WordPress API proxy — routes all WP REST API calls through a Netlify
// serverless function so they happen server-side. This bypasses:
//   - Wordfence WAF blocking cross-origin API requests
//   - Cloudflare browser challenges
//   - Hosting providers stripping the Authorization header (WP Engine, Kinsta)
//   - CORS issues on wp-json endpoints
//
// Request body:
//   { clientId, method, path, body? }        credentials read server-side
//   { wpUrl, username, appPassword, … }      staff only — testing an unsaved login
// plus { isMediaUpload, mediaBase64, mediaFilename } for image uploads.
// See lib/cmsCreds.js. The function builds the WP REST URL, adds Basic
// Auth, forwards the request and returns the response verbatim.

import { authorize, fromEvent, deny } from './lib/requireAuth.js';
import { resolveWordPress, cleanApiPath, liveCredDeps, guardedFetch, CredsError } from './lib/cmsCreds.js';
import { getServerSupabase } from './lib/serverSupabase.js';
import { shrinkImage, withExt } from './lib/shrinkImage.js';

export async function handler(event, { credDeps } = {}) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  // Auth gate (lib/requireAuth.js): a signed-in staff token, a service API
  // key, the server's internal header, or — until Deploy B — the legacy
  // X-Suite-Auth hash. Without it this function is an open relay anyone on
  // the internet can push WP requests through.
  const auth = await authorize(fromEvent(event));
  if (!auth.ok) return deny(auth.status, corsHeaders(), auth.reason);

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: corsHeaders(), body: 'Invalid JSON' }; }

  let creds, path;
  try {
    path = cleanApiPath(payload.path);
    creds = await resolveWordPress(payload, auth.actor, credDeps || liveCredDeps(getServerSupabase()));
  } catch (e) {
    return deny(e instanceof CredsError ? e.status : 500, corsHeaders(), e.message);
  }

  const fullUrl = creds.wpUrl + '/wp-json/' + path;
  const { method, body } = payload;

  const reqHeaders = {};
  if (creds.username && creds.appPassword) {
    reqHeaders['Authorization'] = 'Basic ' + Buffer.from(creds.username + ':' + creds.appPassword).toString('base64');
  }

  // Handle media uploads: decode base64 and send as binary.
  const { isMediaUpload, mediaBase64, mediaFilename } = payload;

  try {
    let res;
    if (isMediaUpload && mediaBase64) {
      // Large PNGs become JPEGs: some sites reject ~2 MB uploads (413).
      const img = shrinkImage(Buffer.from(mediaBase64, 'base64'));
      const imageBuffer = img.buffer;
      reqHeaders['Content-Type'] = img.mime;
      reqHeaders['Content-Disposition'] = 'attachment; filename="' + withExt(mediaFilename || 'image.png', img.ext).replace(/["\r\n]/g, '') + '"';
      res = await guardedFetch(fullUrl, { method: 'POST', headers: reqHeaders, body: imageBuffer }, { lookup: credDeps?.lookup, fetchImpl: credDeps?.fetchImpl });
    } else {
      reqHeaders['Content-Type'] = 'application/json';
      res = await guardedFetch(fullUrl, {
        method: method || 'GET',
        headers: reqHeaders,
        body: body ? JSON.stringify(body) : undefined
      }, { lookup: credDeps?.lookup, fetchImpl: credDeps?.fetchImpl });
    }

    const text = await res.text();

    return {
      statusCode: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'application/json',
        ...corsHeaders()
      },
      body: text
    };
  } catch (e) {
    if (e instanceof CredsError) return deny(e.status, corsHeaders(), e.message);
    return {
      statusCode: 502,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'WP proxy fetch failed: ' + e.message })
    };
  }
}

function corsHeaders() {
  // Restrict browsers to the suite's own origin (overridable via env for
  // local dev). Server-to-server callers are unaffected by CORS; the auth
  // gate above is what actually blocks them.
  return {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://syte-seo-suite.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Suite-Auth, X-Internal-Auth',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
