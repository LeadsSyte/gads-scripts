// Verifies the GSC helpers thread the client's bound Google account email
// through to the server-auth proxy. The "Server Google auth is on but this
// client has no Google account bound" error came from the Content Engine
// research path calling topQueriesByImpression/topPagesWithQueries WITHOUT the
// account email, so proxyGoogleFetch got a null accountEmail and threw.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/technical/gsc.js'), 'utf8');

globalThis.__proxyCalls = [];
const PATCHED = SRC
  .replace("import { ensureToken, SCOPES } from './googleAuth.js';",
           "const SCOPES = { gsc: 'gsc' };\nconst ensureToken = async () => ({ access_token: 'tok' });")
  .replace("import { fetchWithTimeout } from '../../lib/http.js';",
           "const fetchWithTimeout = async () => ({ ok: true, json: async () => ({ rows: [] }) });")
  .replace("import { serverAuthEnabled, proxyGoogleFetch } from '../../lib/googleServerAuth.js';",
           // Server auth ON — mirror the real proxyGoogleFetch contract: throw when
           // no account email is supplied, otherwise record it.
           "const serverAuthEnabled = () => true;\n" +
           "const proxyGoogleFetch = async (url, opts, accountEmail) => {\n" +
           "  if (!accountEmail) throw new Error('Server Google auth is on but this client has no Google account bound.');\n" +
           "  globalThis.__proxyCalls.push(accountEmail);\n" +
           "  return { ok: true, json: async () => ({ rows: [] }) };\n" +
           "};");

const tmp = path.join(os.tmpdir(), 'gscEmail-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, l) { if (!v) throw new Error((l || 'assertion') + ' falsy'); }

await t('topQueriesByImpression forwards the account email to the proxy', async () => {
  globalThis.__proxyCalls = [];
  await mod.topQueriesByImpression('sc-domain:example.com', 90, 'client@acct.com');
  ok(globalThis.__proxyCalls.includes('client@acct.com'), 'account email reached proxy — got ' + JSON.stringify(globalThis.__proxyCalls));
});

await t('topPagesWithQueries forwards the account email to the proxy', async () => {
  globalThis.__proxyCalls = [];
  await mod.topPagesWithQueries('sc-domain:example.com', 90, 'client@acct.com');
  ok(globalThis.__proxyCalls.includes('client@acct.com'), 'account email reached proxy');
});

await t('THE REGRESSION: missing account email throws (as before) — proving the fix matters', async () => {
  let threw = false;
  try { await mod.topQueriesByImpression('sc-domain:example.com', 90 /* no email */); }
  catch (e) { threw = /no Google account bound/.test(e.message); }
  ok(threw, 'without an email the proxy still rejects — so threading it is what fixes real clients');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
