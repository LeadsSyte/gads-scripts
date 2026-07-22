// Verifies the GSC data layer never triggers an interactive OAuth popup.
// The "GSC: popup_failed_to_open" bug was gscFetch acquiring its token with
// interactive:true (the default) deep inside the report fetch pipeline, where
// there's no user gesture, so the browser blocks the popup. This asserts the
// token is now requested SILENTLY (interactive:false).
//
// gsc.js imports browser-coupled modules, so we load it the way aeoEngines.test
// does: read the source, swap imports for stubs, then import.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/technical/gsc.js'), 'utf8');

// Record every ensureToken call so we can assert the options.
globalThis.__ensureCalls = [];
const PATCHED = SRC
  .replace("import { ensureToken, SCOPES } from './googleAuth.js';",
           "const SCOPES = { gsc: 'gsc', ga4: 'ga4' };\nconst ensureToken = async (scopes, opts = {}) => { globalThis.__ensureCalls.push(opts); return { access_token: 'tok' }; };")
  .replace("import { fetchWithTimeout } from '../../lib/http.js';",
           "const fetchWithTimeout = async () => ({ ok: true, json: async () => ({ rows: [{ keys: ['x'], clicks: 1 }] }) });")
  .replace("import { serverAuthEnabled, proxyGoogleFetch } from '../../lib/googleServerAuth.js';",
           "const serverAuthEnabled = () => false;\nconst proxyGoogleFetch = async () => ({ ok: true, json: async () => ({}) });");

const tmp = path.join(os.tmpdir(), 'gsc-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, PATCHED);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, l) { if (!v) throw new Error((l || 'assertion') + ' falsy'); }

await t('querySearchAnalytics requests its token SILENTLY (no popup)', async () => {
  globalThis.__ensureCalls = [];
  await mod.querySearchAnalytics('sc-domain:example.com', { dimensions: ['query'], rowLimit: 10 });
  ok(globalThis.__ensureCalls.length >= 1, 'ensureToken was called');
  ok(globalThis.__ensureCalls.every(o => o.interactive === false), 'every GSC token request must be interactive:false (silent) — got ' + JSON.stringify(globalThis.__ensureCalls));
});

await t('listSites also requests its token silently', async () => {
  globalThis.__ensureCalls = [];
  await mod.listSites();
  ok(globalThis.__ensureCalls.every(o => o.interactive === false), 'listSites must be silent too');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
