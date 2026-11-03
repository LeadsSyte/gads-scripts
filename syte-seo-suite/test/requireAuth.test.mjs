// One authorisation check for every function (security brief §1.4–1.5).

import { authorize, fromEvent, fromRequest, corsHeaders, parseJsonPost, hashApiKey, internalHeaders } from '../netlify/functions/lib/requireAuth.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };

const ENV = { INTERNAL_FN_SECRET: 'internal-secret', WP_PROXY_AUTH: 'legacyhash', LEGACY_SUITE_AUTH: '1', URL: 'https://syte-seo-suite.netlify.app' };
const ev = (headers = {}, method = 'POST', body = '{"a":1}') => fromEvent({ httpMethod: method, headers, body });
const deps = {
  getUser: async tok => tok === 'good-jwt' ? { user: { id: 'u1', email: 'chris@syte.co.za' } } : tok === 'other-jwt' ? { user: { id: 'u2', email: 'stranger@example.com' } } : null,
  findApiKey: async hash => hash === hashApiKey('sk_syte_live') ? { id: 'k1', name: 'Riley', scopes: ['read', 'scan'] } : hash === hashApiKey('sk_syte_dead') ? { id: 'k2', name: 'old', scopes: ['*'], revoked_at: '2026-10-01' } : null
};

await t('no credentials → 401; every way in is checked, nothing else passes', async () => {
  eq((await authorize(ev({}), { env: ENV, deps })).status, 401);
  eq((await authorize(ev({ 'X-Suite-Auth': 'wrong' }), { env: ENV, deps })).status, 401);
  eq((await authorize(ev({ authorization: 'Bearer nope' }), { env: ENV, deps })).status, 401);
});

await t('server-to-server: X-Internal-Auth with the secret', async () => {
  const r = await authorize(ev({ 'x-internal-auth': 'internal-secret' }), { env: ENV, deps });
  eq([r.ok, r.actor.kind], [true, 'internal']);
  eq((await authorize(ev({ 'x-internal-auth': 'internal-secret' }), { env: { ...ENV, INTERNAL_FN_SECRET: '' }, deps })).status, 401, 'no secret configured → not accepted');
  eq(internalHeaders(ENV), { 'X-Internal-Auth': 'internal-secret' });
  eq(internalHeaders({ WP_PROXY_AUTH: 'legacyhash' }), { 'X-Suite-Auth': 'legacyhash' }, 'until the secret exists, servers keep using the old header');
});

await t('staff sign-in token: verified; the staff allowlist narrows it', async () => {
  const r = await authorize(ev({ Authorization: 'Bearer good-jwt' }), { env: ENV, deps });
  eq([r.ok, r.actor.kind, r.actor.email], [true, 'staff', 'chris@syte.co.za']);
  eq((await authorize(ev({ Authorization: 'Bearer expired' }), { env: ENV, deps })).status, 401);
  const narrow = { ...ENV, ALLOWED_STAFF_EMAILS: 'chris@syte.co.za, mike@syte.co.za' };
  eq((await authorize(ev({ Authorization: 'Bearer good-jwt' }), { env: narrow, deps })).ok, true);
  eq((await authorize(ev({ Authorization: 'Bearer other-jwt' }), { env: narrow, deps })).status, 403);
});

await t('API keys: hashed lookup, revoked → 401, missing scope → 403, never stored in clear', async () => {
  const r = await authorize(ev({ Authorization: 'Bearer sk_syte_live' }), { env: ENV, deps, scopes: ['read'] });
  eq([r.ok, r.actor.kind, r.actor.name], [true, 'api_key', 'Riley']);
  eq((await authorize(ev({ Authorization: 'Bearer sk_syte_live' }), { env: ENV, deps, scopes: ['fix:apply'] })).status, 403);
  eq((await authorize(ev({ Authorization: 'Bearer sk_syte_dead' }), { env: ENV, deps })).status, 401);
  eq((await authorize(ev({ Authorization: 'Bearer sk_syte_unknown' }), { env: ENV, deps })).status, 401);
  if (hashApiKey('sk_syte_live') === 'sk_syte_live' || hashApiKey('sk_syte_live').length !== 64) throw new Error('not hashed');
});

await t('legacy X-Suite-Auth works only while LEGACY_SUITE_AUTH is on', async () => {
  eq((await authorize(ev({ 'X-Suite-Auth': 'legacyhash' }), { env: ENV, deps })).actor.kind, 'legacy');
  eq((await authorize(ev({ 'X-Suite-Auth': 'legacyhash' }), { env: { ...ENV, LEGACY_SUITE_AUTH: '0' }, deps })).status, 401, 'switched off after Deploy B');
  eq((await authorize(ev({ 'X-Suite-Auth': 'legacyhash' }), { env: { ...ENV, WP_PROXY_AUTH: '' }, deps })).status, 401, 'no hash configured → nothing matches');
});

await t('v2 Requests work the same way', async () => {
  const req = new Request('https://x/fn', { method: 'POST', headers: { Authorization: 'Bearer good-jwt' } });
  eq((await authorize(fromRequest(req), { env: ENV, deps })).ok, true);
});

await t('background functions refuse anything but a POST with a JSON body (Netlify 202s probes otherwise)', () => {
  eq(parseJsonPost(ev({}, 'GET', '')).error.status, 405);
  eq(parseJsonPost(ev({}, 'OPTIONS', '')).error.status, 405);
  eq(parseJsonPost(ev({}, 'POST', '')).error.status, 400);
  eq(parseJsonPost(ev({}, 'POST', 'not json')).error.status, 400);
  eq(parseJsonPost(ev({}, 'POST', '{}')).error.status, 400);
  eq(parseJsonPost(ev({}, 'POST', '{"clientId":"c1"}')).body, { clientId: 'c1' });
});

await t('CORS: only the app\'s own origins are echoed', () => {
  eq(corsHeaders('https://syte-seo-suite.netlify.app', ENV)['Access-Control-Allow-Origin'], 'https://syte-seo-suite.netlify.app');
  eq(corsHeaders('https://deploy-preview-12--syte-seo-suite.netlify.app', ENV)['Access-Control-Allow-Origin'], 'https://deploy-preview-12--syte-seo-suite.netlify.app');
  eq(corsHeaders('http://localhost:5173', ENV)['Access-Control-Allow-Origin'], 'http://localhost:5173');
  eq(corsHeaders('https://evil.example', ENV)['Access-Control-Allow-Origin'], 'https://syte-seo-suite.netlify.app', 'a stranger gets the production origin, not theirs');
  if (!/Authorization/.test(corsHeaders('', ENV)['Access-Control-Allow-Headers'])) throw new Error('Authorization header not allowed');
});

console.log(`\nrequireAuth: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
