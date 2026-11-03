// page-proxy's fetch guard (security brief §1.6): no private, loopback,
// link-local or metadata addresses — checked after DNS and on every redirect —
// with a timeout and a size cap.

import { isForbiddenAddress, urlProblem, safeFetch } from '../netlify/functions/lib/safeFetch.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const has = (s, re) => { if (!re.test(String(s))) throw new Error('missing ' + re + ' in ' + s); };

const lookup = async host => ({ 'krost.example': ['41.76.1.10'], 'evil.example': ['41.76.1.10', '10.0.0.5'], 'v6.example': ['2a00:1450:4009::200e'], 'meta.example': ['169.254.169.254'] }[host] || (() => { throw new Error('ENOTFOUND'); })());

await t('forbidden addresses: metadata, loopback, private, link-local, multicast, mapped IPv4, unique-local IPv6', () => {
  for (const ip of ['169.254.169.254', '127.0.0.1', '10.0.0.1', '172.16.5.5', '192.168.1.1', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fd12::1', 'fe80::1']) eq(isForbiddenAddress(ip), true, ip);
  for (const ip of ['41.76.1.10', '8.8.8.8', '2a00:1450:4009::200e', '172.32.0.1', '192.169.0.1']) eq(isForbiddenAddress(ip), false, ip);
});

await t('URLs the brief lists are refused; a client site is allowed', async () => {
  for (const u of ['http://169.254.169.254/', 'http://localhost', 'http://localhost:8080/x', 'http://10.0.0.1', 'file:///etc/passwd', 'ftp://krost.example/', 'http://127.0.0.1/', 'http://[::1]/', 'http://user:pw@krost.example/', 'http://meta.example/', 'http://evil.example/']) {
    const p = await urlProblem(u, { lookup });
    if (!p) throw new Error('allowed: ' + u);
  }
  eq(await urlProblem('https://krost.example/racking/', { lookup }), '');
  eq(await urlProblem('https://v6.example/', { lookup }), '');
  has(await urlProblem('https://nope.example/', { lookup }), /could not be resolved/);
});

const resp = (status, body, headers = {}) => ({ status, headers: { get: n => headers[n.toLowerCase()] ?? null }, text: async () => body, body: null });

await t('redirects are followed one hop at a time and re-checked: a hop into a private range is refused', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return url.includes('krost') ? resp(302, '', { location: 'http://10.0.0.1/admin' }) : resp(200, 'secret'); };
  let err = '';
  try { await safeFetch('https://krost.example/', { lookup, fetchImpl }); } catch (e) { err = e.message; }
  has(err, /private or reserved/);
  eq(calls, ['https://krost.example/'], 'the private hop was never fetched');
});

await t('a normal page comes back with its final address; a redirect to a public page is followed', async () => {
  const fetchImpl = async (url) => url.endsWith('/old/') ? resp(301, '', { location: '/new/' }) : resp(200, '<html><body>' + 'content '.repeat(20) + '</body></html>');
  const r = await safeFetch('https://krost.example/old/', { lookup, fetchImpl });
  eq([r.status, r.finalUrl], [200, 'https://krost.example/new/']);
  has(r.html, /content/);
});

await t('timeouts and oversized pages are refused with a plain reason', async () => {
  const slow = async (url, { signal }) => new Promise((_, rej) => { signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }); });
  let err = '';
  try { await safeFetch('https://krost.example/', { lookup, fetchImpl: slow, timeoutMs: 30 }); } catch (e) { err = e.message; }
  has(err, /took longer than/);
  const big = async () => resp(200, 'x'.repeat(100), { 'content-length': String(10 * 1024 * 1024) });
  err = '';
  try { await safeFetch('https://krost.example/', { lookup, fetchImpl: big }); } catch (e) { err = e.message; }
  has(err, /larger than 3 MB/);
  err = '';
  try { await safeFetch('https://krost.example/', { lookup, fetchImpl: async () => resp(200, 'y'.repeat(50)), maxBytes: 10 }); } catch (e) { err = e.message; }
  has(err, /larger than/);
});

await t('too many redirects stop', async () => {
  const loop = async () => resp(302, '', { location: 'https://krost.example/again/' });
  let err = '';
  try { await safeFetch('https://krost.example/', { lookup, fetchImpl: loop }); } catch (e) { err = e.message; }
  has(err, /Too many redirects/);
});

console.log(`\nsafeFetch: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
