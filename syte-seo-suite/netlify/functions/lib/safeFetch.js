// Fetching a page on a client's behalf without becoming an open proxy into
// our own network (security brief §1.6, SSRF). page-proxy used to fetch ANY
// URL — http://169.254.169.254/ (cloud metadata), http://localhost, private
// ranges — and followed redirects blindly, then fell back to a third-party
// relay. Now: http/https only, every hostname resolved and checked against
// the forbidden ranges, redirects followed one hop at a time with the same
// check, a timeout and a size cap. Pure apart from the injected deps.

import dns from 'node:dns';
import net from 'node:net';

export const MAX_BYTES = 3 * 1024 * 1024;
export const TIMEOUT_MS = 15000;
export const MAX_REDIRECTS = 5;

function ipv4Forbidden(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127                      // this host, private, loopback
    || (a === 100 && b >= 64 && b <= 127)                     // carrier NAT
    || (a === 169 && b === 254)                               // link-local + cloud metadata
    || (a === 172 && b >= 16 && b <= 31)                      // private
    || (a === 192 && b === 168) || (a === 192 && b === 0)     // private, IETF
    || (a === 198 && (b === 18 || b === 19))                  // benchmarking
    || a >= 224;                                              // multicast, reserved, broadcast
}
function ipv6Forbidden(ip) {
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return true;
  if (/^::ffff:(\d+\.\d+\.\d+\.\d+)$/.test(s)) return ipv4Forbidden(s.slice(7));   // mapped IPv4
  return /^(fc|fd)/.test(s)          // unique local
    || /^fe[89ab]/.test(s)           // link-local
    || /^ff/.test(s)                 // multicast
    || /^2001:db8/.test(s)           // documentation
    || /^64:ff9b:/.test(s);          // NAT64 of anything (checked above when mapped)
}
export function isForbiddenAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) return ipv4Forbidden(ip);
  if (v === 6) return ipv6Forbidden(ip);
  return true;
}

// Why a URL may not be fetched, or '' when it may. `lookup` resolves a host
// to its addresses (all of them: one private answer blocks the fetch).
export async function urlProblem(raw, { lookup = defaultLookup } = {}) {
  let u;
  try { u = new URL(String(raw)); } catch { return 'Not a valid address.'; }
  if (!/^https?:$/.test(u.protocol)) return 'Only http and https addresses can be fetched.';
  if (u.username || u.password) return 'Addresses with a username or password are not fetched.';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return 'Local addresses are not fetched.';
  if (net.isIP(host)) return isForbiddenAddress(host) ? 'That address is inside a private or reserved network.' : '';
  let addrs;
  try { addrs = await lookup(host); } catch { return 'The address could not be resolved.'; }
  if (!addrs?.length) return 'The address could not be resolved.';
  if (addrs.some(a => isForbiddenAddress(a))) return 'That host points into a private or reserved network.';
  return '';
}

async function defaultLookup(host) {
  const all = await dns.promises.lookup(host, { all: true, verbatim: true });
  return all.map(a => a.address);
}

// GET a page safely. Follows redirects itself so every hop is checked.
// → { status, html, finalUrl, headers } ; throws Error(reason) when refused.
export async function safeFetch(raw, { headers = {}, lookup = defaultLookup, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, maxRedirects = MAX_REDIRECTS } = {}) {
  let url = String(raw);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const problem = await urlProblem(url, { lookup });
    if (problem) throw new Error(problem);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, { method: 'GET', redirect: 'manual', headers, signal: ctl.signal });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(e?.name === 'AbortError' ? 'The page took longer than ' + Math.round(timeoutMs / 1000) + ' seconds.' : 'Could not fetch the page: ' + String(e?.message || e).slice(0, 120));
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      url = new URL(res.headers.get('location'), url).href;
      continue;
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) { clearTimeout(timer); throw new Error('The page is larger than ' + Math.round(maxBytes / 1048576) + ' MB.'); }
    let html = '';
    try {
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader(); const dec = new TextDecoder(); let got = 0; const parts = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.byteLength;
          if (got > maxBytes) { reader.cancel().catch(() => {}); throw new Error('The page is larger than ' + Math.round(maxBytes / 1048576) + ' MB.'); }
          parts.push(dec.decode(value, { stream: true }));
        }
        parts.push(dec.decode());
        html = parts.join('');
      } else {
        html = await res.text();
        if (html.length > maxBytes) throw new Error('The page is larger than ' + Math.round(maxBytes / 1048576) + ' MB.');
      }
    } finally { clearTimeout(timer); }
    return { status: res.status, html, finalUrl: url, headers: res.headers };
  }
  throw new Error('Too many redirects.');
}
