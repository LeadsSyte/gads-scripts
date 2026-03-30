/**
 * SYTE OPTIMIZATION LOADER — Cellini
 * ============================================================
 * Loader script — defines client config, fetches core from GitHub.
 * Secrets (API key, GitHub PAT) are read from the master Google Sheet.
 *
 * Core Version: 4.4.0
 * Generated: 2026-03-30
 * Mode: ECOMMERCE
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

  // === Client Identity ===
  CLIENT_NAME: 'Cellini',
  CLIENT_WEBSITE: 'https://www.celliniluggage.co.za/',
  CLIENT_INDUSTRY: 'Luggage',
  TARGET_LOCATIONS: ['Johannesburg', 'Cape Town', 'South Africa', 'Durban', 'Pretoria'],
  ACCOUNT_MODE: 'ECOMMERCE',

  // === Budget ===
  MONTHLY_BUDGET: 180000,
  CURRENCY_SYMBOL: 'R',

  // === Timing ===
  LOOKBACK_DAYS: 14,
  CONVERSION_LAG_DAYS: 7,

  // === Brand & Product Protection (NEVER negatived or paused) ===
  PROTECTED_TERMS: ['cellini'],

  // === Lead Gen Thresholds ===
  KEYWORD_SPEND_THRESHOLD: 625,
  SEARCH_TERM_SPEND_THRESHOLD: 625,
  MIN_CTR_TO_PROTECT: 5,

  // === Ecommerce / ROAS ===
  TARGET_ROAS: 5,
  MIN_ROAS_TO_KEEP: 4,
  ECOM_KEYWORD_SPEND_THRESHOLD: 1000,
  ECOM_SEARCH_TERM_SPEND_THRESHOLD: 1000,

  // === Shopping ===
  SHOPPING_PRODUCT_SPEND_THRESHOLD: 5000,
  SHOPPING_MIN_ROAS_THRESHOLD: 5,
  SHOPPING_HERO_PRODUCT_ROAS: 7,
  SHOPPING_HERO_MIN_CONVERSIONS: 3,

  // === PMax ===
  PMAX_ASSET_GROUP_SPEND_THRESHOLD: 3000,
  PMAX_MIN_ROAS_THRESHOLD: 5,

  // === Winner Promotion ===
  PROMOTION_ENABLED: true,
  PROMOTION_MIN_CONVERSIONS: 2,
  PROMOTION_MIN_CONVERSION_RATE: 3,
  PROMOTION_MIN_CLICKS: 10,
  ECOM_PROMOTION_MIN_REVENUE: 1000,
  ECOM_PROMOTION_MIN_ROAS: 3,
  ECOM_PROMOTION_MIN_CONVERSIONS: 3,
  EXACT_WINNERS_AD_GROUP_NAME: '[Exact Winners]',

  // === Negative Keyword Lists ===
  NEGATIVE_LIST_NAME_SPEND: 'Script - High Spend No Results',
  NEGATIVE_LIST_NAME_INFORMATIONAL: 'Script - Informational Queries',
  NEGATIVE_LIST_NAME_IRRELEVANT: 'Script - Irrelevant Industry',

  // === Irrelevant Terms (AI hints — not auto-negated) ===
  IRRELEVANT_TERMS: [
    'vacancies',
    'vacancy',
    'hiring',
    'recruit',
    'employment',
    'free download',
    'open source',
    'cracked',
    'company profile',
    'annual report',
    'share price',
    'stock price',
    'repair',
    'repairs',
    'fix',
    'second hand',
    'secondhand',
    '2nd hand',
    'used',
    'refurbished',
    'DIY',
    'instructions',
    'manual',
    'assembly instructions',
    'dimensions',
    'catalogue',
    'catalog',
    'warehouse sale',
    'clearance sale',
    'jobs',
    'careers',
    'complaints',
    'reviews reddit',
    'assembly video'
  ],

  // === Email ===
  SEND_EMAIL: true,
  EMAIL_ADDRESSES: ['michaelh@syte.co.za', 'sarahb@syte.co.za'],

  // === Safety ===
  PREVIEW_MODE: false,
  MAX_CHANGES_PER_RUN: 150,
  BUDGET_ALERT_THRESHOLD: 0.7,

  // === Smart AI Negation (v4.1+) ===
  SMART_NEGATION: true,
  SMART_NEGATION_MIN_CLICKS: 1,
  SMART_NEGATION_MAX_SPEND: 500,

  // === Active Keyword Protection (v4.2.0+) ===
  AUTO_PROTECT_ACTIVE_KEYWORDS: true,
  KEYWORD_PAUSE_MIN_IMPRESSIONS: 100,

  // === Audit (v4.2.0+) ===
  AUDIT_NEGATIVES: true,
  AUDIT_CONVERTING_LOOKBACK_DAYS: 90,

  // === Auto-Optimizations ===
  AUTO_DEVICE_BIDS: true,
  AUTO_AD_SCHEDULE: true,
  AUTO_GEO_BIDS: true,
  AUTO_NGRAM: true,
  AUTO_QS_PAUSE: true,
  NGRAM_SPEND_THRESHOLD: 1000,
  NGRAM_MIN_TERMS: 3,
  QS_PAUSE_THRESHOLD: 3,
  QS_SPEND_THRESHOLD: 300,

  // === Approval System (v4.4.0) ===
  REQUIRE_APPROVAL: true,
  // APPROVAL_WEBAPP_URL: '',         // Can also be set in master sheet Config tab
  // PENDING_EXPIRY_DAYS: 7,          // Unapproved changes expire after this many days

  // === Client Context (v4.4.0) ===
  // CLIENT_CONTEXT_DOC_ID: '',       // Google Doc ID with business context
                                      // Can also be set in master sheet Config tab

  // === Master Sheet (secrets + change logging) ===
  SHEET_URL: 'https://docs.google.com/spreadsheets/d/1TDEpz--yxg-x1lO3twfJ2Y_VJ6988Y1vaB0BKe6IfJU/edit?gid=0#gid=0',
  // ANTHROPIC_API_KEY and GITHUB_PAT are read from the sheet's Config tab

  LOG_LEVEL: 'INFO'
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
        var recipients = CONFIG.EMAIL_ADDRESSES || ['michaelh@syte.co.za'];
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
