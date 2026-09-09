// Tests for the Search Console readiness gate. This is what stands between
// a client and a monthly SEO report full of blank or wrong numbers, so each
// failure mode gets its own case.
//
// Run: npm test  (from syte-seo-suite/)

import { evaluateGscReadiness } from '../src/modules/reports/gscGuard.js';
import { SCOPES } from '../src/modules/technical/googleAuth.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(actual, expected, label) {
  if (actual !== expected) throw new Error((label || '') + ' expected ' + expected + ', got ' + actual);
}

const CLIENT = { name: 'Acme', gsc_property: 'sc-domain:acme.co.za' };
const TOKEN = { access_token: 'x', scope: SCOPES.gsc + ' ' + SCOPES.ga4 };
const MONTH = '2026-04';
const GOOD_DATA = {
  period: { current: { startDate: '2026-04-01', endDate: '2026-04-30' } },
  keywords: [{ query: 'shelving', position: 3, clicks: 40, impressions: 900 }],
  topPages: [{ page: 'https://acme.co.za/shelving', clicks: 40, impressions: 900, position: 3 }],
  errors: []
};

t('passes when property, token, data and rows are all present', () => {
  const r = evaluateGscReadiness({ client: CLIENT, reportData: GOOD_DATA, month: MONTH, token: TOKEN });
  assert(r.ok, 'should be ok: ' + JSON.stringify(r.blocker));
  assertEq(r.blocker, null, 'blocker');
  assert(r.checks.every(c => c.pass), 'every check passes');
});

t('blocks when the client has no GSC property configured', () => {
  const r = evaluateGscReadiness({ client: { name: 'Acme' }, reportData: GOOD_DATA, month: MONTH, token: TOKEN });
  assert(!r.ok, 'should block');
  assertEq(r.blocker.code, 'no-property', 'code');
  assertEq(r.blocker.action, 'configure', 'action');
});

t('blocks when there is no Google token at all', () => {
  const r = evaluateGscReadiness({ client: CLIENT, reportData: GOOD_DATA, month: MONTH, token: null });
  assert(!r.ok, 'should block');
  assertEq(r.blocker.code, 'not-connected', 'code');
  assertEq(r.blocker.action, 'connect', 'action');
});

t('blocks when the token lacks the Search Console scope', () => {
  const r = evaluateGscReadiness({
    client: CLIENT, reportData: GOOD_DATA, month: MONTH,
    token: { access_token: 'x', scope: SCOPES.ga4 }
  });
  assert(!r.ok, 'GA4-only token must not unlock an SEO report');
  assertEq(r.blocker.code, 'not-connected', 'code');
});

t('blocks when no report data has been pulled yet', () => {
  const r = evaluateGscReadiness({ client: CLIENT, reportData: null, month: MONTH, token: TOKEN });
  assert(!r.ok, 'should block');
  assertEq(r.blocker.code, 'no-data', 'code');
});

t('blocks when GSC returned an error, and surfaces it', () => {
  const r = evaluateGscReadiness({
    client: CLIENT, month: MONTH, token: TOKEN,
    reportData: { ...GOOD_DATA, errors: ['GSC: 403 does not have sufficient permission'] }
  });
  assert(!r.ok, 'should block');
  assertEq(r.blocker.code, 'fetch-error', 'code');
  assert(/sufficient permission/.test(r.blocker.message), 'error text surfaced');
});

t('ignores GA4 errors — they do not block the Search Console gate', () => {
  const r = evaluateGscReadiness({
    client: CLIENT, month: MONTH, token: TOKEN,
    reportData: { ...GOOD_DATA, errors: ['GA4: No property ID configured'] }
  });
  assert(r.ok, 'GA4 problems are reported elsewhere, not by this gate');
});

// Reporting runs a month in arrears — August is when the July report goes
// out — so the loaded window routinely isn't the month named in the picker.
// This used to block the report; it must not.
t('does NOT block when the loaded data covers a different month', () => {
  const r = evaluateGscReadiness({
    client: CLIENT, month: '2026-05', token: TOKEN, reportData: GOOD_DATA
  });
  assert(r.ok, 'a different loaded month must not block the report');
  assertEq(r.blocker, null, 'blocker');
  assert(!r.checks.some(c => c.key === 'month'), 'the month check is gone entirely');
});

t('shows which window is loaded so it can still be eyeballed', () => {
  const r = evaluateGscReadiness({
    client: CLIENT, month: MONTH, token: TOKEN, reportData: GOOD_DATA
  });
  const fetched = r.checks.find(c => c.key === 'fetched');
  assert(/Loaded window: /.test(fetched.note), 'fetched note should name the window: ' + fetched.note);
});

t('blocks when GSC is connected but returns nothing for the month', () => {
  const r = evaluateGscReadiness({
    client: CLIENT, month: MONTH, token: TOKEN,
    reportData: { ...GOOD_DATA, keywords: [], topPages: [] }
  });
  assert(!r.ok, 'should block');
  assertEq(r.blocker.code, 'no-rows', 'code');
});

t('blocks when rows exist but every row is zero clicks and zero impressions', () => {
  const r = evaluateGscReadiness({
    client: CLIENT, month: MONTH, token: TOKEN,
    reportData: {
      ...GOOD_DATA,
      keywords: [{ query: 'shelving', position: 0, clicks: 0, impressions: 0 }],
      topPages: []
    }
  });
  assert(!r.ok, 'connected but reading nothing is still not accurate');
  assertEq(r.blocker.code, 'no-rows', 'code');
});

t('passes on page data alone when the query dimension is empty', () => {
  const r = evaluateGscReadiness({
    client: CLIENT, month: MONTH, token: TOKEN,
    reportData: { ...GOOD_DATA, keywords: [] }
  });
  assert(r.ok, 'top pages with impressions is real GSC data');
});

t('reports the first failing check as the blocker (fix order)', () => {
  const r = evaluateGscReadiness({ client: {}, reportData: null, month: MONTH, token: null });
  assertEq(r.blocker.code, 'no-property', 'property comes first');
});

// ── Server-managed Google accounts (VITE_GOOGLE_SERVER_AUTH) ──────────────
// In this mode the browser never holds a Google token — the proxy does. The
// gate used to ask "is this browser signed in?", so every client on every
// report read "Search Console is not connected", and report generation was
// blocked outright. What counts here is the client's account binding.
const SERVER_CLIENT = {
  name: 'Acme',
  gsc_property: 'sc-domain:acme.co.za',
  gsc_account_email: 'admin@syte.co.za'
};

t('server auth: passes with a bound account and no browser token', () => {
  const r = evaluateGscReadiness({
    client: SERVER_CLIENT, reportData: GOOD_DATA, month: MONTH,
    token: null, serverAuth: true
  });
  assert(r.ok, 'should be ok: ' + JSON.stringify(r.blocker));
});

t('server auth: falls back to the legacy single account field', () => {
  const r = evaluateGscReadiness({
    client: { name: 'Acme', gsc_property: 'sc-domain:acme.co.za', google_account_email: 'admin@syte.co.za' },
    reportData: GOOD_DATA, month: MONTH, token: null, serverAuth: true
  });
  assert(r.ok, 'legacy binding still counts as connected');
});

t('server auth: blocks when no account is bound to the client', () => {
  const r = evaluateGscReadiness({
    client: CLIENT, reportData: GOOD_DATA, month: MONTH, token: null, serverAuth: true
  });
  assert(!r.ok, 'should block');
  assertEq(r.blocker.code, 'not-connected', 'code');
  // 'connect' would send the operator to a browser sign-in that does nothing
  // in this mode — the fix is binding the client to a connected account.
  assertEq(r.blocker.action, 'configure', 'action');
});

t('server auth: a real fetch error still blocks, with its own message', () => {
  const r = evaluateGscReadiness({
    client: SERVER_CLIENT, month: MONTH, token: null, serverAuth: true,
    reportData: { ...GOOD_DATA, errors: ['GSC: 403 permission denied'] }
  });
  assert(!r.ok, 'should block');
  assertEq(r.blocker.code, 'fetch-error', 'code');
});

t('browser mode is unchanged when serverAuth is not passed', () => {
  const r = evaluateGscReadiness({ client: SERVER_CLIENT, reportData: GOOD_DATA, month: MONTH, token: null });
  assert(!r.ok, 'a bound account is not a browser token');
  assertEq(r.blocker.code, 'not-connected', 'code');
  assertEq(r.blocker.action, 'connect', 'action');
});

t('does not crash on an empty call', () => {
  const r = evaluateGscReadiness();
  assert(!r.ok, 'nothing configured = blocked');
  assert(Array.isArray(r.checks), 'checks array present');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
