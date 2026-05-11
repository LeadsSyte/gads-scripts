// googleAuth.js contract tests. Pins the OAuth-token state machine the
// suite relies on across modules. Mocks `window.google.accounts.oauth2`,
// localStorage, and `fetch` so we exercise the real source without ever
// hitting Google.
//
// The big invariants covered:
//   • getToken returns null for missing AND expired entries
//   • persistToken (via requestToken/silentRefresh) fires TOKEN_EVENT
//   • ensureToken short-circuits when scopes already match
//   • silentRefresh resolves to null on error/timeout (never throws)
//   • signOut revokes via google API + clears local + fires event
//   • requestToken propagates response.error and forcePicker scope
//
// Run: npm test  (from syte-seo-suite/)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/technical/googleAuth.js'), 'utf8');

// Stub window + document the module touches at import time.
const eventListeners = new Map(); // event → Set<handler>
globalThis.window = {
  google: undefined,
  dispatchEvent(event) {
    const set = eventListeners.get(event.type) || new Set();
    for (const h of set) h(event);
    return true;
  },
  addEventListener(type, h) {
    if (!eventListeners.has(type)) eventListeners.set(type, new Set());
    eventListeners.get(type).add(h);
  },
  removeEventListener(type, h) {
    eventListeners.get(type)?.delete(h);
  }
};
globalThis.document = {
  head: { appendChild: () => {} },
  createElement: () => ({})
};
class FakeEvent {
  constructor(type) { this.type = type; }
}
globalThis.Event = FakeEvent;

// In-memory localStorage.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};

// fetch stub.
let fetchHandler = () => { throw new Error('fetch not configured'); };
globalThis.fetch = async (...a) => fetchHandler(...a);

// Module loads cleanly — no patches needed. googleAuth.js is pure JS
// (no env vars, no imports outside what we've stubbed).
const tmp = path.join(os.tmpdir(), 'googleAuth-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, SRC);
const mod = await import(tmp);
fs.unlinkSync(tmp);

const { getToken, clearToken, signOut, getCurrentEmail, requestToken, ensureToken,
        silentRefresh, switchAccount, TOKEN_EVENT, SCOPES, ALL_READ_SCOPES } = mod;

// ─── Test runner ────────────────────────────────────────────────
let pass = 0, fail = 0;
function reset() {
  store.clear();
  eventListeners.clear();
  fetchHandler = () => { throw new Error('fetch not configured'); };
  // Default: a working oauth2 stub. Tests override per-case.
  globalThis.window.google = {
    accounts: { oauth2: {
      initTokenClient: () => ({ requestAccessToken: () => {} }),
      revoke: (token, cb) => cb()
    } }
  };
}
async function t(name, fn) {
  reset();
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
async function expectThrow(fn, regex, label) {
  try { await fn(); }
  catch (e) {
    if (regex && !regex.test(e.message)) throw new Error((label || '') + ' wrong error: ' + e.message);
    return;
  }
  throw new Error((label || '') + ' expected throw, did not throw');
}
// Helper: write a token directly to localStorage (bypasses persistToken).
function seedToken(t) {
  store.set('syte-suite-google-token', JSON.stringify(t));
}

// ============================================================================
// getToken
// ============================================================================
await t('getToken: returns null when nothing stored', () => {
  eq(getToken(), null);
});

await t('getToken: returns the parsed token when fresh', () => {
  seedToken({ access_token: 'a', expires_at: Date.now() + 3600_000, scope: 's' });
  eq(getToken().access_token, 'a');
});

await t('getToken: returns null when token is EXPIRED', () => {
  seedToken({ access_token: 'a', expires_at: Date.now() - 1, scope: 's' });
  eq(getToken(), null);
});

await t('getToken: returns null + does not throw on corrupt JSON', () => {
  store.set('syte-suite-google-token', 'this is not json');
  eq(getToken(), null);
});

// ============================================================================
// clearToken — fires TOKEN_EVENT
// ============================================================================
await t('clearToken: removes the stored entry', () => {
  seedToken({ access_token: 'a', expires_at: Date.now() + 3600_000 });
  clearToken();
  eq(getToken(), null);
});

await t('clearToken: dispatches TOKEN_EVENT so UI listeners react', () => {
  let fired = 0;
  window.addEventListener(TOKEN_EVENT, () => fired++);
  clearToken();
  eq(fired, 1, 'event fired exactly once');
});

await t('TOKEN_EVENT name is the public string the picker listens for', () => {
  // The picker imports TOKEN_EVENT and binds to it. If this string ever
  // changes silently, every listener breaks. Pin the value.
  eq(TOKEN_EVENT, 'syte-google-token-changed');
});

// ============================================================================
// requestToken
// ============================================================================
await t('requestToken: stores the token + fires TOKEN_EVENT on success', async () => {
  let lastConfig = null;
  let fired = 0;
  window.addEventListener(TOKEN_EVENT, () => fired++);
  window.google.accounts.oauth2.initTokenClient = (cfg) => {
    lastConfig = cfg;
    return { requestAccessToken: () => {
      cfg.callback({ access_token: 'tok', expires_in: 3600, scope: 's1 s2' });
    } };
  };
  const t = await requestToken(['s1', 's2']);
  eq(t.access_token, 'tok');
  eq(getToken().access_token, 'tok', 'persisted to storage');
  eq(fired, 1);
  eq(lastConfig.scope, 's1 s2', 'scopes joined with space');
});

await t('requestToken: rejects when callback receives an error', async () => {
  window.google.accounts.oauth2.initTokenClient = (cfg) => ({
    requestAccessToken: () => cfg.callback({ error: 'access_denied' })
  });
  await expectThrow(() => requestToken(['s']), /access_denied/);
  // No token stored on failure.
  eq(getToken(), null);
});

await t('requestToken: forcePicker=true forwards prompt:select_account', async () => {
  let promptFlag = null;
  window.google.accounts.oauth2.initTokenClient = (cfg) => ({
    requestAccessToken: (opts) => {
      promptFlag = opts.prompt;
      cfg.callback({ access_token: 't', expires_in: 3600, scope: 's' });
    }
  });
  await requestToken(['s'], { forcePicker: true });
  eq(promptFlag, 'select_account');
});

// ============================================================================
// silentRefresh
// ============================================================================
await t('silentRefresh: returns the token on success + fires TOKEN_EVENT', async () => {
  let fired = 0;
  window.addEventListener(TOKEN_EVENT, () => fired++);
  window.google.accounts.oauth2.initTokenClient = (cfg) => ({
    requestAccessToken: () => cfg.callback({ access_token: 'silent', expires_in: 3600, scope: 's' })
  });
  const t = await silentRefresh(['s']);
  eq(t.access_token, 'silent');
  eq(fired, 1);
});

await t('silentRefresh: returns null when callback errors (no throw)', async () => {
  window.google.accounts.oauth2.initTokenClient = (cfg) => ({
    requestAccessToken: () => cfg.callback({ error: 'consent_required' })
  });
  const t = await silentRefresh(['s']);
  eq(t, null);
});

await t('silentRefresh: returns null when error_callback fires', async () => {
  window.google.accounts.oauth2.initTokenClient = (cfg) => ({
    requestAccessToken: () => cfg.error_callback()
  });
  const t = await silentRefresh(['s']);
  eq(t, null);
});

await t('silentRefresh: resolves null on timeout (never hangs)', async () => {
  // Token client never fires its callback → timeout path must complete.
  window.google.accounts.oauth2.initTokenClient = () => ({ requestAccessToken: () => {} });
  const t = await silentRefresh(['s'], { timeoutMs: 30 });
  eq(t, null);
});

await t('silentRefresh: returns null when initTokenClient throws (no crash)', async () => {
  window.google.accounts.oauth2.initTokenClient = () => { throw new Error('GIS not loaded'); };
  const t = await silentRefresh(['s'], { timeoutMs: 30 });
  eq(t, null);
});

// ============================================================================
// ensureToken — the orchestrator
// ============================================================================
await t('ensureToken: returns existing token when scopes already covered', async () => {
  seedToken({ access_token: 'have', expires_at: Date.now() + 3600_000, scope: 'a b c' });
  let initCalled = false;
  window.google.accounts.oauth2.initTokenClient = () => {
    initCalled = true;
    return { requestAccessToken: () => {} };
  };
  const t = await ensureToken(['a', 'b']);
  eq(t.access_token, 'have');
  eq(initCalled, false, 'no token client created when scopes already covered');
});

await t('ensureToken: requests fresh token when scopes are missing', async () => {
  seedToken({ access_token: 'old', expires_at: Date.now() + 3600_000, scope: 'just-a' });
  // Silent succeeds; ensureToken should accept it.
  window.google.accounts.oauth2.initTokenClient = (cfg) => ({
    requestAccessToken: () => cfg.callback({ access_token: 'new', expires_in: 3600, scope: 'a b' })
  });
  const t = await ensureToken(['a', 'b']);
  eq(t.access_token, 'new');
});

await t('ensureToken: when silent fails, falls back to requestToken (which prompts)', async () => {
  let calls = 0;
  window.google.accounts.oauth2.initTokenClient = (cfg) => ({
    requestAccessToken: () => {
      calls++;
      if (calls === 1) {
        // First call is the silent attempt — fail it.
        cfg.callback({ error: 'consent_required' });
      } else {
        // Second call is the popup (requestToken) — succeed.
        cfg.callback({ access_token: 'popup', expires_in: 3600, scope: 'a' });
      }
    }
  });
  const t = await ensureToken(['a']);
  eq(t.access_token, 'popup');
  eq(calls, 2, 'silent then popup');
});

// ============================================================================
// signOut — revoke + clear + event
// ============================================================================
await t('signOut: revokes the token via google AND clears storage', async () => {
  seedToken({ access_token: 'tok', expires_at: Date.now() + 3600_000 });
  let revokedWith = null;
  window.google.accounts.oauth2.revoke = (token, cb) => { revokedWith = token; cb(); };
  await signOut();
  eq(revokedWith, 'tok');
  eq(getToken(), null);
});

await t('signOut: dispatches TOKEN_EVENT (via clearToken)', async () => {
  seedToken({ access_token: 'tok', expires_at: Date.now() + 3600_000 });
  let fired = 0;
  window.addEventListener(TOKEN_EVENT, () => fired++);
  await signOut();
  eq(fired, 1);
});

await t('signOut: handles missing token / missing google API gracefully', async () => {
  // No token, no google global — must not throw.
  window.google = undefined;
  await signOut();
  eq(getToken(), null);
});

// ============================================================================
// switchAccount: signOut → requestToken with forcePicker
// ============================================================================
await t('switchAccount: revokes existing then requests with forcePicker', async () => {
  seedToken({ access_token: 'old', expires_at: Date.now() + 3600_000, scope: 'a' });
  let revoked = false, lastPrompt = null;
  window.google.accounts.oauth2.revoke = (token, cb) => { revoked = true; cb(); };
  window.google.accounts.oauth2.initTokenClient = (cfg) => ({
    requestAccessToken: (opts) => {
      lastPrompt = opts.prompt;
      cfg.callback({ access_token: 'new', expires_in: 3600, scope: 'a' });
    }
  });
  const t = await switchAccount(['a']);
  eq(revoked, true, 'old token revoked');
  eq(lastPrompt, 'select_account', 'forcePicker passed through');
  eq(t.access_token, 'new');
});

// ============================================================================
// getCurrentEmail
// ============================================================================
await t('getCurrentEmail: returns null when no token', async () => {
  eq(await getCurrentEmail(), null);
});

await t('getCurrentEmail: returns cached email without hitting fetch', async () => {
  seedToken({ access_token: 't', expires_at: Date.now() + 3600_000, email: 'cached@example.com' });
  let called = false;
  fetchHandler = () => { called = true; throw new Error('should not fetch'); };
  eq(await getCurrentEmail(), 'cached@example.com');
  eq(called, false);
});

await t('getCurrentEmail: queries tokeninfo + caches the email back to the stored token', async () => {
  seedToken({ access_token: 't', expires_at: Date.now() + 3600_000, scope: 's' });
  fetchHandler = async () => ({
    ok: true,
    json: async () => ({ email: 'fresh@example.com' })
  });
  eq(await getCurrentEmail(), 'fresh@example.com');
  // Second call should NOT re-fetch — uses the cached email.
  let secondFetch = false;
  fetchHandler = () => { secondFetch = true; throw new Error('should not fetch'); };
  eq(await getCurrentEmail(), 'fresh@example.com');
  eq(secondFetch, false, 'no second fetch');
});

await t('getCurrentEmail: returns null when tokeninfo fails (no throw)', async () => {
  seedToken({ access_token: 't', expires_at: Date.now() + 3600_000, scope: 's' });
  fetchHandler = async () => ({ ok: false, status: 401, json: async () => ({}) });
  eq(await getCurrentEmail(), null);
});

// ============================================================================
// SCOPES + ALL_READ_SCOPES — public constants used across modules
// ============================================================================
await t('SCOPES contains gsc + ga4 readonly URLs', () => {
  eq(SCOPES.gsc, 'https://www.googleapis.com/auth/webmasters.readonly');
  eq(SCOPES.ga4, 'https://www.googleapis.com/auth/analytics.readonly');
});

await t('ALL_READ_SCOPES bundles both scopes', () => {
  if (!ALL_READ_SCOPES.includes(SCOPES.gsc)) throw new Error('gsc not in bundle');
  if (!ALL_READ_SCOPES.includes(SCOPES.ga4)) throw new Error('ga4 not in bundle');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
