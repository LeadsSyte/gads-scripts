// auth.js contract tests. Lock-screen + API-key storage. Pins:
//   • getStoredApiKey reads localStorage
//   • Legacy sessionStorage value is migrated to localStorage on first read
//     (so users who were already unlocked don't get logged out on the
//     sessionStorage → localStorage migration)
//   • setStoredApiKey writes to localStorage AND wipes the legacy entry
//   • clearStoredApiKey clears both storages
//   • decryptApiKey throws on wrong password (no silent return of garbage)
//
// We don't test that decryptApiKey returns the actual key — that would
// require shipping the real password in the test. We test the contract:
// wrong password → throw; right shape of the encrypted blob is preserved.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/lib/auth.js'), 'utf8');

// Node 22 has globalThis.crypto.subtle (= webcrypto.subtle), but
// globalThis.crypto is read-only. Use Object.defineProperty if needed.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
// atob is also a global in Node ≥ 16.
if (!globalThis.atob) globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');

// In-memory localStorage AND sessionStorage.
function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    _map: m
  };
}
globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();

const tmp = path.join(os.tmpdir(), 'auth-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, SRC);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
async function t(name, fn) {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
async function expectThrow(fn, label) {
  try { await fn(); }
  catch { return; }
  throw new Error((label || '') + ' expected throw, did not throw');
}

await t('getStoredApiKey: returns null when nothing stored', () => {
  eq(mod.getStoredApiKey(), null);
});

await t('getStoredApiKey: returns the key when set in localStorage', () => {
  mod.setStoredApiKey('sk-test');
  eq(mod.getStoredApiKey(), 'sk-test');
});

await t('getStoredApiKey: legacy sessionStorage entry is migrated to localStorage', () => {
  // Simulate the pre-migration state: only sessionStorage has the key.
  globalThis.sessionStorage.setItem('syte-suite-api-key', 'sk-legacy');
  // First read should pick it up AND copy it to localStorage.
  eq(mod.getStoredApiKey(), 'sk-legacy', 'returned legacy value');
  eq(globalThis.localStorage.getItem('syte-suite-api-key'), 'sk-legacy', 'copied to localStorage');
  eq(globalThis.sessionStorage.getItem('syte-suite-api-key'), null, 'sessionStorage cleaned');
});

await t('getStoredApiKey: localStorage takes precedence — no migration if both set', () => {
  globalThis.localStorage.setItem('syte-suite-api-key', 'sk-current');
  globalThis.sessionStorage.setItem('syte-suite-api-key', 'sk-stale');
  eq(mod.getStoredApiKey(), 'sk-current');
  // sessionStorage should remain untouched (we only migrate when ls is empty).
  eq(globalThis.sessionStorage.getItem('syte-suite-api-key'), 'sk-stale');
});

await t('setStoredApiKey: writes to localStorage AND clears sessionStorage', () => {
  globalThis.sessionStorage.setItem('syte-suite-api-key', 'sk-old');
  mod.setStoredApiKey('sk-new');
  eq(globalThis.localStorage.getItem('syte-suite-api-key'), 'sk-new');
  eq(globalThis.sessionStorage.getItem('syte-suite-api-key'), null);
});

await t('clearStoredApiKey: wipes both storages', () => {
  mod.setStoredApiKey('sk-x');
  globalThis.sessionStorage.setItem('syte-suite-api-key', 'sk-y');
  mod.clearStoredApiKey();
  eq(mod.getStoredApiKey(), null);
  eq(globalThis.sessionStorage.getItem('syte-suite-api-key'), null);
});

await t('ENCRYPTED_KEY_B64: looks like base64 and is non-trivially long', () => {
  if (!/^[A-Za-z0-9+/=]+$/.test(mod.ENCRYPTED_KEY_B64)) throw new Error('not base64');
  if (mod.ENCRYPTED_KEY_B64.length < 100) throw new Error('suspiciously short');
});

await t('decryptApiKey: wrong password throws (does not return garbage)', async () => {
  // Critical contract — if AES-GCM authentication is broken, the lock
  // screen would let any password through and persist random bytes as
  // the API key. This must throw.
  await expectThrow(() => mod.decryptApiKey('definitely-wrong-password-' + Math.random()),
    'wrong password should throw');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
