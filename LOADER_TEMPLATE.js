/**
 * SYTE OPTIMIZATION LOADER — [CLIENT NAME]
 * ==========================================
 * This is the CLIENT-SIDE loader script. Paste this into Google Ads Scripts.
 * It defines your client-specific CONFIG, then fetches and runs the shared core.
 *
 * The core script is hosted at GitHub and updated centrally.
 * All clients automatically get updates on their next scheduled run.
 *
 * Setup:
 * 1. Copy this template
 * 2. Replace all [PLACEHOLDER] values with client-specific settings
 * 3. Paste into Google Ads Scripts > Scripts > New Script
 * 4. Authorize and schedule (recommended: every 3 days)
 *
 * Version: Loader v4.2.0
 */

// ============================================
// CORE SCRIPT URL — DO NOT CHANGE
// ============================================
var CORE_URL = 'https://raw.githubusercontent.com/LeadsSyte/gads-scripts/main/syte_optimization_core.js';


// ============================================
// CLIENT CONFIG — CUSTOMIZE PER CLIENT
// ============================================
var CONFIG = {

  // --- REQUIRED ---
  CLIENT_NAME: '[Client Name]',
  CLIENT_WEBSITE: '[https://clientwebsite.com]',
  ACCOUNT_MODE: 'LEAD_GEN',  // 'LEAD_GEN', 'ECOMMERCE', or 'HYBRID'
  PREVIEW_MODE: false,        // true = dry run (no changes), false = live

  // --- GOOGLE SHEET (change logging + outcome tracking) ---
  // Option A: Full Google Sheets URL (the script extracts the ID automatically)
  SHEET_URL: '[https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit]',
  // Option B: Just the sheet ID (from the URL between /d/ and /edit)
  // MASTER_SHEET_ID: 'YOUR_SHEET_ID',

  // --- AI FEATURES ---
  ANTHROPIC_API_KEY: '',  // sk-ant-... (required for AI smart negation + weekly review)

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
  // Add your client's core brand terms and money keywords here
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

  // --- AUDIT & REPAIR (v4.2.0) ---
  AUDIT_NEGATIVES: true,                 // Enable negative keyword audit each run
  AUDIT_REPAIR_MODE: 'LIVE',             // 'LIVE' = auto-fix, 'REPORT_ONLY' = just flag in email
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

  // --- LOGGING ---
  LOG_LEVEL: 'INFO'  // 'DEBUG', 'INFO', 'WARN', 'ERROR'
};


// ============================================
// MAIN — FETCHES AND RUNS THE CORE SCRIPT
// ============================================

function main() {
  // Cache-bust to ensure we always get the latest version from GitHub
  var cacheBuster = '?cb=' + new Date().getTime();
  var response = UrlFetchApp.fetch(CORE_URL + cacheBuster, { muteHttpExceptions: true });

  if (response.getResponseCode() !== 200) {
    Logger.log('ERROR: Could not fetch core script. HTTP ' + response.getResponseCode());
    Logger.log(response.getContentText().substring(0, 500));
    return;
  }

  var scriptContent = response.getContentText();
  Logger.log('Fetched core script: ' + scriptContent.length + ' chars');

  // Verify we got a real script (not a GitHub error page)
  if (scriptContent.indexOf('runOptimization') === -1) {
    Logger.log('ERROR: Fetched content does not contain runOptimization — possible GitHub error');
    return;
  }

  // Execute the core script
  eval(scriptContent);

  // Run optimization
  runOptimization();
}
