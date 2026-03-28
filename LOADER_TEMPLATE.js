/**
 * SYTE OPTIMIZATION LOADER — [CLIENT NAME]
 * ==========================================
 * This is the CLIENT-SIDE loader script. Paste this into Google Ads Scripts.
 * It defines your client-specific CONFIG, then fetches and runs the shared core.
 *
 * The core script is hosted in a PRIVATE GitHub repo.
 * Authentication uses a GitHub PAT stored in the master Google Sheet "Config" tab.
 * The Anthropic API key is also read from the sheet — no secrets in this file.
 *
 * Setup:
 * 1. Copy this template
 * 2. Replace all [PLACEHOLDER] values with client-specific settings
 * 3. Set SHEET_URL to the master Google Sheet (must have a "Config" tab with GITHUB_PAT and ANTHROPIC_API_KEY)
 * 4. Paste into Google Ads Scripts > Scripts > New Script
 * 5. Authorize and schedule (recommended: every 3 days)
 *
 * Version: Loader v4.4.0
 */

// ============================================
// CORE SCRIPT URL — DO NOT CHANGE
// ============================================
var CORE_URL = 'https://raw.githubusercontent.com/LeadsSyte/gads-scripts/main/syte_optimization_core.js';

// Optional: hardcoded GitHub PAT fallback (if sheet read fails)
// Prefer storing this in the master sheet "Config" tab instead.
// var GITHUB_PAT = '';


// ============================================
// CLIENT CONFIG — CUSTOMIZE PER CLIENT
// ============================================
var CONFIG = {

  // --- REQUIRED ---
  CLIENT_NAME: '[Client Name]',
  CLIENT_WEBSITE: '[https://clientwebsite.com]',
  ACCOUNT_MODE: 'LEAD_GEN',  // 'LEAD_GEN', 'ECOMMERCE', or 'HYBRID'
  PREVIEW_MODE: false,        // true = dry run (no changes), false = live

  // --- GOOGLE SHEET (change logging + shared secrets) ---
  // The master sheet's "Config" tab holds ANTHROPIC_API_KEY and GITHUB_PAT.
  // Use the full URL — the core script extracts the sheet ID automatically.
  SHEET_URL: '[https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit]',

  // --- AI FEATURES ---
  // ANTHROPIC_API_KEY is loaded from the master sheet "Config" tab.
  // Only set here if you need a client-specific key (overrides the sheet value).
  // ANTHROPIC_API_KEY: '',

  // --- EMAIL ---
  EMAIL_ADDRESSES: ['[you@agency.com]'],  // Array of recipient emails
  SEND_EMAIL: true,

  // --- THRESHOLDS (Lead Gen) ---
  KEYWORD_SPEND_THRESHOLD: 500,       // Pause keywords spending more than this with 0 conversions
  SEARCH_TERM_SPEND_THRESHOLD: 200,   // Negative search terms spending more than this with 0 conversions
  MIN_CTR_TO_PROTECT: 3.0,            // Don't pause keywords with CTR above this (they're relevant)
  LOOKBACK_DAYS: 30,
  CONVERSION_LAG_DAYS: 3,
  MONTHLY_BUDGET: 10000,

  // --- THRESHOLDS (Ecommerce — only needed for ECOMMERCE/HYBRID mode) ---
  // ECOM_KEYWORD_SPEND_THRESHOLD: 1000,
  // ECOM_SEARCH_TERM_SPEND_THRESHOLD: 500,
  // MIN_ROAS_TO_KEEP: 2.0,

  // --- WINNER PROMOTION ---
  PROMOTION_ENABLED: true,
  PROMOTION_MIN_CONVERSIONS: 3,
  PROMOTION_MIN_CLICKS: 10,
  PROMOTION_MIN_CONVERSION_RATE: 3.0,
  EXACT_WINNERS_AD_GROUP_NAME: '[Exact Winners]',

  // --- PROTECTED TERMS (never paused/negatived regardless of performance) ---
  PROTECTED_TERMS: [
    // '[brand name]',
    // '[core service keyword]',
  ],

  // --- IRRELEVANT TERMS (always negatived as phrase match) ---
  IRRELEVANT_TERMS: [
    // 'competitor name',
    // 'wrong industry term',
  ],

  // --- NEGATIVE LIST NAMES ---
  NEGATIVE_LIST_NAME_SPEND: 'Script - High Spend No Results',
  NEGATIVE_LIST_NAME_INFORMATIONAL: 'Script - Informational Queries',
  NEGATIVE_LIST_NAME_IRRELEVANT: 'Script - Irrelevant Industry',

  // --- SMART AI NEGATION (v4.1) ---
  SMART_NEGATION: true,
  SMART_NEGATION_MIN_CLICKS: 1,
  SMART_NEGATION_MAX_SPEND: 500,

  // --- ACTIVE KEYWORD PROTECTION (v4.2.0) ---
  AUTO_PROTECT_ACTIVE_KEYWORDS: true,    // Master toggle — active keywords never auto-negatived
  KEYWORD_PAUSE_MIN_IMPRESSIONS: 100,    // Min impressions before a keyword can be paused

  // --- AUDIT (v4.2.0) ---
  AUDIT_NEGATIVES: true,                 // Enable negative keyword audit scan each run
  AUDIT_CONVERTING_LOOKBACK_DAYS: 90,    // How far back to check for conversions

  // --- AUTO-OPTIMIZATIONS ---
  AUTO_DEVICE_BIDS: true,
  AUTO_AD_SCHEDULE: true,
  AUTO_GEO_BIDS: true,
  AUTO_NGRAM: true,
  AUTO_QS_PAUSE: true,
  MAX_CHANGES_PER_RUN: 50,

  // --- CURRENCY ---
  CURRENCY_SYMBOL: 'R',  // 'R' for ZAR, '$' for USD, etc.

  // --- APPROVAL SYSTEM (v4.4.0) ---
  REQUIRE_APPROVAL: true,            // true = collect changes → eval → email approval, false = auto-apply (legacy)
  // APPROVAL_WEBAPP_URL: '',         // Deployed Google Apps Script Web App URL for approval buttons
                                      // Can also be set in master sheet Config tab
  // PENDING_EXPIRY_DAYS: 7,          // Unapproved changes expire after this many days

  // --- CLIENT CONTEXT (v4.4.0) ---
  // CLIENT_CONTEXT_DOC_ID: '',       // Google Doc ID with business context per client
                                      // Doc format: ## Client Name heading per section
                                      // Can also be set in master sheet Config tab

  // --- LOGGING ---
  LOG_LEVEL: 'INFO'  // 'DEBUG', 'INFO', 'WARN', 'ERROR'
};


// ============================================
// MAIN — FETCHES AND RUNS THE CORE SCRIPT
// ============================================

// Force Google Ads Scripts to request Sheets permission at authorization.
// Without this, the core script cannot read the API key from the master sheet.
var _SHEET_REF = SpreadsheetApp;

function main() {
  var githubPat = '';

  // Try to read GitHub PAT from master sheet Config tab
  if (CONFIG.SHEET_URL || CONFIG.MASTER_SHEET_ID) {
    try {
      var sheetId = CONFIG.MASTER_SHEET_ID;
      if (!sheetId && CONFIG.SHEET_URL) {
        var match = CONFIG.SHEET_URL.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (match) sheetId = match[1];
      }
      if (sheetId) {
        var ss = SpreadsheetApp.openById(sheetId);
        var configSheet = ss.getSheetByName('Config');
        if (configSheet) {
          var data = configSheet.getDataRange().getValues();
          for (var i = 0; i < data.length; i++) {
            if (String(data[i][0]).trim() === 'GITHUB_PAT') {
              githubPat = String(data[i][1]).trim();
              break;
            }
          }
        }
      }
    } catch (e) {
      Logger.log('WARN: Could not read GitHub PAT from sheet: ' + e.message);
    }
  }

  // Fall back to hardcoded PAT if sheet read failed
  if (!githubPat && typeof GITHUB_PAT !== 'undefined' && GITHUB_PAT) {
    githubPat = GITHUB_PAT;
  }

  var fetchOptions = { muteHttpExceptions: true };
  if (githubPat) {
    fetchOptions.headers = { 'Authorization': 'token ' + githubPat };
  }

  var cacheBuster = '?cb=' + new Date().getTime();
  var response = UrlFetchApp.fetch(CORE_URL + cacheBuster, fetchOptions);

  if (response.getResponseCode() !== 200) {
    Logger.log('ERROR: Could not fetch core script. HTTP ' + response.getResponseCode());
    Logger.log(response.getContentText().substring(0, 500));
    if (CONFIG.SEND_EMAIL) {
      try {
        var recipients = CONFIG.EMAIL_ADDRESSES || ['[you@agency.com]'];
        MailApp.sendEmail({
          to: recipients.join(','),
          subject: 'ERROR: Syte Script Core Fetch Failed | ' + CONFIG.CLIENT_NAME,
          body: 'Could not fetch core script from: ' + CORE_URL +
            '\nHTTP Status: ' + response.getResponseCode() +
            '\nCheck: Is the GitHub PAT valid? Is the repo accessible?' +
            '\nPAT source: ' + (githubPat ? 'loaded' : 'MISSING — add GITHUB_PAT to master sheet Config tab')
        });
      } catch (mailErr) { Logger.log('Could not send error email: ' + mailErr.message); }
    }
    return;
  }

  var scriptContent = response.getContentText();
  Logger.log('Fetched core script: ' + scriptContent.length + ' chars');

  // Verify we got a real script (not a GitHub error page)
  if (scriptContent.indexOf('runOptimization') === -1) {
    Logger.log('ERROR: Fetched content does not contain runOptimization — possible GitHub error or auth failure');
    return;
  }

  // Execute the core script
  eval(scriptContent);

  // Run optimization
  runOptimization();
}
