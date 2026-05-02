// Test harness for Google Apps Script files.
// GAS files use a global pseudo-CommonJS environment with built-ins like
// SpreadsheetApp, UrlFetchApp, MailApp, Logger, Utilities, etc. None of
// those exist in Node, so we stub them and load the script source as a
// regular module that exposes its top-level function declarations.
//
// Usage in a test:
//   import { loadGasScript, makeStubs } from './gas-harness.mjs';
//   const stubs = makeStubs();
//   const mod = loadGasScript('daily_digest.js', ['main'], stubs);
//   stubs.SpreadsheetApp.openById = (id) => ({ getSheetByName: () => ... });
//   mod.main();
//
// All stubs are vi.fn-style trackable: stubs.MailApp.sendEmail.calls
// is the array of every call made.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Lightweight call-tracking shim — easier than dragging vi in.
function tracked(returnValue) {
  const fn = (...args) => {
    fn.calls.push(args);
    if (typeof fn._impl === 'function') return fn._impl(...args);
    return typeof returnValue === 'function' ? returnValue(...args) : returnValue;
  };
  fn.calls = [];
  fn.mock = { calls: fn.calls };
  fn.mockReturnValue = (v) => { returnValue = v; fn._impl = null; return fn; };
  fn.mockImplementation = (impl) => { fn._impl = impl; return fn; };
  fn.mockClear = () => { fn.calls.length = 0; };
  return fn;
}

// Build a fresh set of GAS stubs. Tests can override individual methods
// before calling the script function.
export function makeStubs() {
  const Logger = {
    log: tracked(),
    getLog: () => Logger.log.calls.map(a => a.join(' ')).join('\n')
  };

  const MailApp = {
    sendEmail: tracked()
  };

  const GmailApp = {
    sendEmail: tracked(),
    createDraft: tracked({ getId: () => 'draft-1' })
  };

  // Sheets stub — produces a chainable openById/getSheetByName/getRange/etc.
  // Tests typically override openById to return a custom sheet.
  const SpreadsheetApp = {
    openById: tracked(() => makeSheet([])),
    openByUrl: tracked(() => makeSheet([])),
    getActiveSpreadsheet: tracked(() => makeSheet([])),
    create: tracked(() => makeSheet([]))
  };

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: tracked(null),
      setProperty: tracked(),
      deleteProperty: tracked(),
      getProperties: tracked({})
    }),
    getUserProperties: () => ({
      getProperty: tracked(null),
      setProperty: tracked()
    })
  };

  const UrlFetchApp = {
    fetch: tracked(() => ({
      getResponseCode: () => 200,
      getContentText: () => '{}',
      getHeaders: () => ({})
    })),
    fetchAll: tracked(() => [])
  };

  const Utilities = {
    formatDate: (d, tz, fmt) => {
      // Minimal formatDate covering the formats the scripts actually use.
      const yr = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      if (fmt === 'yyyy-MM-dd')   return `${yr}-${mo}-${da}`;
      if (fmt === 'yyyyMMdd')     return `${yr}${mo}${da}`;
      if (fmt === 'yyyy/MM/dd')   return `${yr}/${mo}/${da}`;
      if (fmt === 'yyyy-MM')      return `${yr}-${mo}`;
      if (fmt === 'MMMM yyyy')    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      return d.toISOString();
    },
    sleep: tracked(),
    base64Encode: (s) => Buffer.from(s).toString('base64'),
    base64Decode: (s) => Array.from(Buffer.from(s, 'base64')),
    newBlob: (data, mime, name) => ({ data, mime, name, getDataAsString: () => data })
  };

  const CacheService = {
    getScriptCache: () => ({
      get: tracked(null),
      put: tracked(),
      remove: tracked()
    })
  };

  const HtmlService = {
    createHtmlOutput: (html) => ({
      _html: html,
      setTitle: function (t) { this._title = t; return this; },
      setXFrameOptionsMode: function () { return this; },
      setSandboxMode: function () { return this; },
      getContent: function () { return this._html; },
      append: function (more) { this._html += more; return this; }
    })
  };

  const ContentService = {
    createTextOutput: (text) => ({
      _text: text,
      setMimeType: function () { return this; },
      getContent: function () { return this._text; }
    }),
    MimeType: { JSON: 'application/json', TEXT: 'text/plain' }
  };

  const Session = {
    getActiveUser: () => ({ getEmail: () => 'tester@example.com' }),
    getScriptTimeZone: () => 'Africa/Johannesburg'
  };

  // Google Ads Script (only present in those scripts).
  const AdsApp = {
    accounts: tracked({ get: () => ({ hasNext: () => false }) }),
    keywords: tracked({}),
    search: tracked([]),
    currentAccount: () => ({
      getName: () => 'Test Account',
      getCustomerId: () => '111-222-3333'
    }),
    log: tracked()
  };

  return {
    Logger, MailApp, GmailApp, SpreadsheetApp, PropertiesService,
    UrlFetchApp, Utilities, CacheService, HtmlService, ContentService,
    Session, AdsApp
  };
}

// Helper for tests that need a Sheet stub. `data` is an array-of-arrays
// where the first row is headers.
export function makeSheet(data) {
  let _data = data || [];
  const sheet = {
    getName: () => 'Sheet1',
    getDataRange: () => ({
      getValues: () => _data,
      getNumRows: () => _data.length,
      getNumColumns: () => (_data[0] || []).length
    }),
    getRange: (r, c, nr, nc) => ({
      getValues: () => _data.slice((r || 1) - 1, (r || 1) - 1 + (nr || 1))
        .map(row => row.slice((c || 1) - 1, (c || 1) - 1 + (nc || 1))),
      setValues: (vals) => { /* mutation tracked via parent _data */ },
      setValue: () => {},
      getValue: () => _data[(r || 1) - 1]?.[(c || 1) - 1]
    }),
    getLastRow: () => _data.length,
    getLastColumn: () => (_data[0] || []).length,
    appendRow: (row) => { _data.push(row); },
    clear: () => { _data = []; }
  };
  return {
    getSheetByName: () => sheet,
    getSheets: () => [sheet],
    getId: () => 'fake-sheet-id',
    insertSheet: (name) => sheet
  };
}

// Load a Google Apps Script file as if it were a Node module.
//
// scriptPath: relative to the repo root (e.g. 'daily_digest.js')
// exports: an array of top-level function names you want to call from the test
// stubs: the makeStubs() result (or your own custom set)
// options.inject: raw JS to prepend before the script (e.g. CONFIG, constants
//                 that are normally defined in the loader template).
//
// Returns an object containing each named function bound to the stubbed globals.
export async function loadGasScript(scriptPath, exports, stubs, options = {}) {
  const src = fs.readFileSync(path.join(REPO_ROOT, scriptPath), 'utf8');
  const inject = options.inject || '';

  // Build the wrapper. The script's references to SpreadsheetApp / Logger
  // / etc. resolve to the destructured stubs in this scope. The wrapper
  // returns an object containing each exported function so tests can
  // call them.
  const exportList = exports.map(name => `${name}: typeof ${name} === 'function' ? ${name} : undefined`).join(', ');
  const wrapped = `
    export default function load(__stubs) {
      const { Logger, MailApp, GmailApp, SpreadsheetApp, PropertiesService,
              UrlFetchApp, Utilities, CacheService, HtmlService, ContentService,
              Session, AdsApp } = __stubs;
      ${inject}
      ${src}
      return { ${exportList} };
    }
  `;
  const tmp = path.join(os.tmpdir(), 'gas-' + path.basename(scriptPath) + '-' + Date.now() + '.mjs');
  fs.writeFileSync(tmp, wrapped);
  const { default: load } = await import(tmp);
  fs.unlinkSync(tmp);
  return load(stubs);
}
