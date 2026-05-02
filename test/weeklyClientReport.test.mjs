// weekly_client_report.js — Phase F. Pins the helpers used to build
// the weekly client-facing report:
//   • _loadWebAppUrl — reads APPROVAL_WEBAPP_URL from the Config sheet
//   • _linkAccount — wraps account name in a link to the dashboard,
//     HTML-escapes specials, falls back to plain text when no URL
//   • _extractSheetId — normalizes ID-or-URL into the bare ID, throws
//     when input is empty

import { loadGasScript, makeStubs } from './gas-harness.mjs';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

// _buildMonthOnMonthTable references TIMEZONE — inject a value.
const INJECT = 'var TIMEZONE = "Africa/Johannesburg"; var SHEET_ID = "abc"; var EMAIL_TO = "x@y.com";';
const HELPERS = ['_loadWebAppUrl', '_linkAccount', '_extractSheetId'];

function makeConfigSheet(rows) {
  return {
    getSheetByName: (name) => name === 'Config' ? {
      getDataRange: () => ({ getValues: () => rows })
    } : null
  };
}

// ============================================================================
// _extractSheetId
// ============================================================================
await t('_extractSheetId: throws when input is empty/null', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_client_report.js', HELPERS, stubs, { inject: INJECT });
  let threw = false;
  try { mod._extractSheetId(''); } catch (e) {
    threw = /SHEET_ID is not set/.test(e.message);
  }
  if (!threw) throw new Error('expected throw for empty input');
});

await t('_extractSheetId: bare ID returned as-is', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_client_report.js', HELPERS, stubs, { inject: INJECT });
  eq(mod._extractSheetId('1abc-DEF_xyz'), '1abc-DEF_xyz');
});

await t('_extractSheetId: extracts ID from full /d/<id>/edit URL', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_client_report.js', HELPERS, stubs, { inject: INJECT });
  eq(
    mod._extractSheetId('https://docs.google.com/spreadsheets/d/1AbCdEf-Hij_Klm/edit#gid=0'),
    '1AbCdEf-Hij_Klm'
  );
});

await t('_extractSheetId: trims whitespace', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_client_report.js', HELPERS, stubs, { inject: INJECT });
  eq(mod._extractSheetId('  abc-id-123  '), 'abc-id-123');
});

// ============================================================================
// _loadWebAppUrl
// ============================================================================
await t('_loadWebAppUrl: returns "" when Config tab is missing', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_client_report.js', HELPERS, stubs, { inject: INJECT });
  const ss = { getSheetByName: () => null };
  eq(mod._loadWebAppUrl(ss), '');
});

await t('_loadWebAppUrl: returns "" when APPROVAL_WEBAPP_URL row absent', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_client_report.js', HELPERS, stubs, { inject: INJECT });
  const ss = makeConfigSheet([
    ['SOMETHING_ELSE', 'value'],
    ['ANOTHER_KEY', 'value']
  ]);
  eq(mod._loadWebAppUrl(ss), '');
});

await t('_loadWebAppUrl: returns the configured URL when present', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_client_report.js', HELPERS, stubs, { inject: INJECT });
  const ss = makeConfigSheet([
    ['ANTHROPIC_API_KEY', 'sk-x'],
    ['APPROVAL_WEBAPP_URL', 'https://script.google.com/macros/s/abc/exec'],
    ['GITHUB_PAT', 'ghp_x']
  ]);
  eq(mod._loadWebAppUrl(ss), 'https://script.google.com/macros/s/abc/exec');
});

await t('_loadWebAppUrl: returns "" when value cell is empty (key present but blank)', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_client_report.js', HELPERS, stubs, { inject: INJECT });
  const ss = makeConfigSheet([['APPROVAL_WEBAPP_URL', '']]);
  eq(mod._loadWebAppUrl(ss), '');
});

await t('_loadWebAppUrl: thrown errors swallowed (returns "")', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_client_report.js', HELPERS, stubs, { inject: INJECT });
  const ss = { getSheetByName: () => { throw new Error('access denied'); } };
  eq(mod._loadWebAppUrl(ss), '');
});

// ============================================================================
// _linkAccount
// ============================================================================
await t('_linkAccount: no URL → returns escaped plain text', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_client_report.js', HELPERS, stubs, { inject: INJECT });
  eq(mod._linkAccount('Acme & Co', ''), 'Acme &amp; Co');
});

await t('_linkAccount: HTML-escapes <, >, & in account names (no XSS in email)', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_client_report.js', HELPERS, stubs, { inject: INJECT });
  const out = mod._linkAccount('<script>x</script>', 'https://app.test/');
  if (/<script>/.test(out)) throw new Error('script tag not escaped: ' + out);
  if (!/&lt;script&gt;/.test(out)) throw new Error('expected &lt;script&gt; escape');
});

await t('_linkAccount: with URL returns an <a> with view=client&account=<encoded>', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_client_report.js', HELPERS, stubs, { inject: INJECT });
  const out = mod._linkAccount('Acme Co', 'https://app.test/');
  if (!/<a href="https:\/\/app\.test\/\?view=client&account=Acme%20Co"/.test(out)) {
    throw new Error('link malformed: ' + out);
  }
  if (!/>Acme Co<\/a>$/.test(out)) throw new Error('expected anchor text + closing tag');
});

await t('_linkAccount: existing query string uses & not ? for the params', async () => {
  const stubs = makeStubs();
  const mod = await loadGasScript('weekly_client_report.js', HELPERS, stubs, { inject: INJECT });
  const out = mod._linkAccount('X', 'https://app.test/?token=abc');
  // Should produce ...?token=abc&view=client&account=X
  if (!/\?token=abc&view=client&account=X/.test(out)) {
    throw new Error('expected & for additional params: ' + out);
  }
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
