// Where wp-proxy and shopify-proxy get a client's CMS credentials
// (security brief §1.2, plan Deploy A item 5).
//
// Preferred: the caller sends { clientId } and the credentials are read here,
// server-side, with the service key — so app passwords and Shopify tokens no
// longer travel in request bodies, and the site address comes from the
// client record instead of the caller.
//
// Raw credentials ({ wpUrl, username, appPassword } / { store, token }) are
// still accepted from STAFF callers only (signed-in staff, the suite header,
// server-internal calls): the Connections page tests a login before it is
// saved, so there is no client record to read yet. A service API key (the
// bot) must always use clientId.
//
// Either way the site address passes the same private-network check as
// page-proxy (lib/safeFetch.urlProblem): a client record edited to point at
// 169.254.169.254 or localhost is refused, not fetched.
//
// Pure apart from the injected deps; tested in test/cmsCreds.test.mjs.

import { urlProblem } from './safeFetch.js';
import { withClientSecrets } from './clientSecrets.js';

export class CredsError extends Error { constructor(status, message) { super(message); this.status = status; } }

const RAW_ALLOWED = new Set(['staff', 'legacy', 'internal']);
const CLIENT_COLUMNS = 'id, name, wp_url, wp_username, wp_app_password, shopify_store, shopify_token';

// deps.loadClient(id) → row | null ; deps.lookup → DNS resolver (tests)
async function clientFor(clientId, deps) {
  const id = String(clientId || '').trim();
  if (!id || id.length > 64) throw new CredsError(400, 'Invalid clientId.');
  const row = await deps.loadClient(id).catch(() => null);
  if (!row) throw new CredsError(404, 'No client with that id.');
  return row;
}
function requireRawAllowed(actor) {
  if (!RAW_ALLOWED.has(actor?.kind)) throw new CredsError(403, 'Send clientId; credentials in the request are only accepted from staff.');
}
async function checkAddress(url, deps) {
  const problem = await urlProblem(url, deps.lookup ? { lookup: deps.lookup } : {});
  if (problem) throw new CredsError(400, 'Site address refused: ' + problem);
}

// → { wpUrl, username, appPassword, clientId? }
export async function resolveWordPress(payload, actor, deps) {
  let wpUrl, username, appPassword, clientId = null;
  if (payload.clientId) {
    const c = await clientFor(payload.clientId, deps);
    clientId = c.id;
    wpUrl = c.wp_url; username = c.wp_username || ''; appPassword = c.wp_app_password || '';
    if (!wpUrl) throw new CredsError(400, 'This client has no WordPress site URL set.');
  } else {
    requireRawAllowed(actor);
    ({ wpUrl, username = '', appPassword = '' } = payload);
    if (!wpUrl) throw new CredsError(400, 'Missing clientId (or wpUrl).');
  }
  wpUrl = String(wpUrl).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(wpUrl)) wpUrl = 'https://' + wpUrl;
  await checkAddress(wpUrl + '/', deps);
  return { wpUrl, username: String(username), appPassword: String(appPassword), clientId };
}

// → { store, token, clientId? }  (store is the bare host, e.g. x.myshopify.com)
export async function resolveShopify(payload, actor, deps) {
  let store, token, clientId = null;
  if (payload.clientId) {
    const c = await clientFor(payload.clientId, deps);
    clientId = c.id;
    store = c.shopify_store; token = c.shopify_token;
    if (!store || !token) throw new CredsError(400, 'This client has no Shopify store connected.');
  } else {
    requireRawAllowed(actor);
    ({ store, token } = payload);
    if (!store || !token) throw new CredsError(400, 'Missing clientId (or store and token).');
  }
  store = String(store).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').split(/[/?#]/)[0];
  await checkAddress('https://' + store + '/', deps);
  return { store, token: String(token), clientId };
}

// The API path a caller asks for stays under /wp-json/ or /admin/api/…/.
export function cleanApiPath(path) {
  const p = String(path || '').replace(/^\/+/, '');
  if (!p) throw new CredsError(400, 'Missing path.');
  if (/^[a-z]+:/i.test(p) || p.split(/[/?#]/).includes('..')) throw new CredsError(400, 'Invalid path.');
  return p;
}

// fetch() that follows redirects itself so every hop passes the address
// check (a site that redirects http→https or to www keeps working; one that
// redirects into a private range is refused). Mirrors the fetch spec: 307/308
// keep method and body, 301/302/303 on a non-GET become a GET without body,
// and credentials (Authorization / X-Shopify-Access-Token) are dropped when
// the redirect leaves the original origin.
const CRED_HEADERS = ['authorization', 'x-shopify-access-token'];
export async function guardedFetch(url, init = {}, { lookup, fetchImpl = fetch, maxRedirects = 5 } = {}) {
  let current = url, opts = { ...init, redirect: 'manual' };
  const origin = new URL(url).origin;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetchImpl(current, opts);
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) return res;
    const next = new URL(loc, current).href;
    await checkAddress(next, { lookup });
    if (![307, 308].includes(res.status) && (opts.method || 'GET').toUpperCase() !== 'GET') {
      const { body, ...rest } = opts;
      opts = { ...rest, method: 'GET' };
      if (opts.headers) opts.headers = Object.fromEntries(Object.entries(opts.headers).filter(([k]) => !/^content-(type|disposition)$/i.test(k)));
    }
    if (new URL(next).origin !== origin && opts.headers) {
      opts.headers = Object.fromEntries(Object.entries(opts.headers).filter(([k]) => !CRED_HEADERS.includes(k.toLowerCase())));
    }
    current = next;
  }
  throw new CredsError(502, 'Too many redirects from the site.');
}

// Live deps: read the client with the service-role key.
export function liveCredDeps(supabase) {
  return {
    loadClient: async id => {
      const { data, error } = await supabase.from('syte_suite_clients').select(CLIENT_COLUMNS).eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? withClientSecrets(supabase, data) : null;
    }
  };
}
