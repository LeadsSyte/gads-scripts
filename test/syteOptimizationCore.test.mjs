// syte_optimization_core.js (Google Ads Script) — Phase F.
// The big core. We focus on the pure-logic helpers — the ones that
// don't talk to AdsApp directly and have a clean contract:
//   • _calculateROAS — revenue / cost (with the cost=0 special case)
//   • _isProtectedTerm — substring match against CONFIG.PROTECTED_TERMS
//   • _isInformational — regex match against INFORMATIONAL_PATTERNS
//   • _isEcommerceMode / _isLeadGenMode — CONFIG.ACCOUNT_MODE routing
//   • _formatDate / _formatDatetime — Utilities.formatDate wrappers
//   • _getDateRange — startDate/endDate computation with conversion lag
//
// CONFIG is normally defined in the loader template; we inject a test
// CONFIG via the harness's `inject` option.

import { loadGasScript, makeStubs } from './gas-harness.mjs';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

// Default CONFIG injected for each test. Overrides per case as needed.
function injectConfig(cfg) {
  return `var CONFIG = ${JSON.stringify(cfg)};`;
}

const HELPERS = [
  '_calculateROAS', '_isProtectedTerm', '_isInformational',
  '_isEcommerceMode', '_isLeadGenMode',
  '_getDateRange', '_formatDate', '_formatDatetime'
];

// ============================================================================
// _calculateROAS
// ============================================================================
await t('_calculateROAS: revenue / cost', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ ACCOUNT_MODE: 'LEAD_GEN', PROTECTED_TERMS: [] })
  });
  eq(mod._calculateROAS(1000, 200), 5);
  eq(mod._calculateROAS(0, 100), 0);
});

await t('_calculateROAS: cost=0 with revenue → 999 (sentinel)', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ ACCOUNT_MODE: 'LEAD_GEN', PROTECTED_TERMS: [] })
  });
  eq(mod._calculateROAS(500, 0), 999);
});

await t('_calculateROAS: cost=0 + revenue=0 → 0 (no division)', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ ACCOUNT_MODE: 'LEAD_GEN', PROTECTED_TERMS: [] })
  });
  eq(mod._calculateROAS(0, 0), 0);
});

// ============================================================================
// _isProtectedTerm
// ============================================================================
await t('_isProtectedTerm: returns true for substring match in PROTECTED_TERMS', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ PROTECTED_TERMS: ['acme', 'syte', 'core service'] })
  });
  eq(mod._isProtectedTerm('Acme bicycles'), true);
  eq(mod._isProtectedTerm('SYTE digital'), true);
  eq(mod._isProtectedTerm('our core service offering'), true);
});

await t('_isProtectedTerm: case-insensitive', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ PROTECTED_TERMS: ['Brand'] })
  });
  eq(mod._isProtectedTerm('BRAND power'), true);
  eq(mod._isProtectedTerm('the brand'), true);
});

await t('_isProtectedTerm: false when no protected term substring is present', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ PROTECTED_TERMS: ['acme'] })
  });
  eq(mod._isProtectedTerm('something else'), false);
});

await t('_isProtectedTerm: empty PROTECTED_TERMS list → always false', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ PROTECTED_TERMS: [] })
  });
  eq(mod._isProtectedTerm('anything'), false);
});

// ============================================================================
// _isInformational — regex match against INFORMATIONAL_PATTERNS
// ============================================================================
await t('_isInformational: how to ... → true', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ PROTECTED_TERMS: [] })
  });
  eq(mod._isInformational('how to clean carpets'), true);
});

await t('_isInformational: what is ... → true', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ PROTECTED_TERMS: [] })
  });
  eq(mod._isInformational('What is SEO?'), true);
});

await t('_isInformational: REGRESSION — "where to buy X" is NOT informational', async () => {
  // Pinned in the source comment: removed "where to" because it catches
  // commercial-intent queries like "where to buy X". Locked here.
  const stubs = makeStubs();
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ PROTECTED_TERMS: [] })
  });
  eq(mod._isInformational('where to buy industrial racking'), false);
  eq(mod._isInformational('where can I buy widgets'), false);
});

await t('_isInformational: regular commercial query → false', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ PROTECTED_TERMS: [] })
  });
  eq(mod._isInformational('best industrial racking jhb'), false);
  eq(mod._isInformational('industrial shelving for sale'), false);
});

// ============================================================================
// _isEcommerceMode / _isLeadGenMode — both true when HYBRID
// ============================================================================
await t('_isEcommerceMode: true for ECOMMERCE', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ ACCOUNT_MODE: 'ECOMMERCE', PROTECTED_TERMS: [] })
  });
  eq(mod._isEcommerceMode(), true);
  eq(mod._isLeadGenMode(), false);
});

await t('_isLeadGenMode: true for LEAD_GEN', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ ACCOUNT_MODE: 'LEAD_GEN', PROTECTED_TERMS: [] })
  });
  eq(mod._isLeadGenMode(), true);
  eq(mod._isEcommerceMode(), false);
});

await t('HYBRID mode: BOTH _isEcommerceMode and _isLeadGenMode return true', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ ACCOUNT_MODE: 'HYBRID', PROTECTED_TERMS: [] })
  });
  eq(mod._isEcommerceMode(), true);
  eq(mod._isLeadGenMode(), true);
});

// ============================================================================
// _formatDate / _formatDatetime — uses AdsApp + Utilities
// ============================================================================
await t('_formatDate: returns yyyy-MM-dd via Utilities.formatDate', async () => {
  const stubs = makeStubs();
  // Override AdsApp.currentAccount so the helper has a timezone.
  stubs.AdsApp.currentAccount = () => ({
    getName: () => 'Test', getCustomerId: () => '1',
    getTimeZone: () => 'Africa/Johannesburg'
  });
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({ PROTECTED_TERMS: [] })
  });
  const out = mod._formatDate(new Date(2026, 4, 15));
  eq(out, '2026-05-15');
});

// ============================================================================
// _getDateRange — startDate is endDate - LOOKBACK_DAYS
// ============================================================================
await t('_getDateRange: endDate = today - CONVERSION_LAG_DAYS, startDate = endDate - LOOKBACK_DAYS', async () => {
  const stubs = makeStubs();
  stubs.AdsApp.currentAccount = () => ({
    getTimeZone: () => 'Africa/Johannesburg',
    getName: () => 'X', getCustomerId: () => '1'
  });
  const mod = await loadGasScript('syte_optimization_core.js', HELPERS, stubs, {
    inject: injectConfig({
      ACCOUNT_MODE: 'LEAD_GEN', PROTECTED_TERMS: [],
      LOOKBACK_DAYS: 30, CONVERSION_LAG_DAYS: 3
    })
  });
  const r = mod._getDateRange();
  // Both are yyyy-MM-dd strings; just verify shape + ordering.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.startDate)) throw new Error('startDate format wrong: ' + r.startDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.endDate)) throw new Error('endDate format wrong: ' + r.endDate);
  if (r.startDate >= r.endDate) throw new Error('startDate should precede endDate: ' + JSON.stringify(r));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
