/**
 * SYTE OPTIMIZATION CORE v4.5.0
 * ============================
 * This file is the CORE engine — hosted centrally and fetched by each client's loader script.
 * DO NOT paste this into Google Ads Scripts directly.
 * Host this file at a URL (GitHub raw URL recommended)
 *
 * Each client account has a small "loader" script that:
 *   1. Defines their CONFIG
 *   2. Fetches this core via UrlFetchApp.fetch()
 *   3. Calls runOptimization()
 *
 * When you improve this core, ALL client accounts get the update on their next scheduled run.
 *
 * Author: Syte Digital Agency (syte.co.za)
 * Version: 4.5.0
 *
 * CHANGELOG v4.5.0 — SHOPPING/PMAX IN AI SMART REVIEW + INTERACTIVE FLAGGED REVIEW:
 * - _smartSearchTermReview() candidate collection expanded to SEARCH, SHOPPING, and PERFORMANCE_MAX.
 *   Previously the unified AI review only saw Search campaigns; Shopping/PMax relied on blunt
 *   spend+ROAS thresholds and a small regex list. Now borderline terms (clicks but no conversions
 *   in the last 7 days) and low-ROAS terms on every channel get routed through Claude Haiku with
 *   full client context, active-keyword safety, and the same "when in doubt, review" rules.
 * - Candidates now track channelType. At apply time, PMax negations are written as campaign-level
 *   negative keywords on the specific PMax campaign (shared neg lists are not supported on PMax);
 *   Search and Shopping negations continue to use the routed shared negative lists.
 * - PMax results still flow into results.pmaxSearchTermsNegated so the email report, approvals,
 *   and digest rollups keep working with no format change.
 * - _analyzeShoppingSearchTerms() and _analyzePMaxSearchTerms() now early-return when
 *   SMART_NEGATION is on and an ANTHROPIC_API_KEY is present, avoiding double negation. They
 *   remain as fallbacks for accounts running without the AI path.
 * - NEW: Flagged review terms are now stored in PendingChanges JSON (flagged_review category)
 * - NEW: "Review & Negate Flagged Terms" button in approval email links to interactive webapp page
 * - NEW: Interactive flagged review page with per-term checkboxes for negate/keep selection
 * - NEW: "Talk to the Optimization" — natural language instruction box on flagged review page.
 *   Users can type instructions like "negate all competitor names but keep facebook" and Claude
 *   interprets them against the flagged terms list to determine which to negate/keep.
 * - NEW: AI instructions can also remove N-gram negatives (e.g., "don't negative facebook")
 * - NEW: flagged_review_negations approval category — selected flagged terms are applied as
 *   negatives on the next script run after approval
 * - NEW: _findPendingRow() helper in webapp for shared row lookup logic
 * - NEW: _getApiKey() helper in webapp reads ANTHROPIC_API_KEY from Config tab
 *
 * CHANGELOG v4.4.0 — EVAL STEP + APPROVAL SYSTEM + CLIENT CONTEXT:
 * - NEW: Collect-only mode — all optimization functions now collect proposed changes WITHOUT
 *   applying them. Changes are only applied after evaluation and approval.
 * - NEW: _evalProposedChanges() — Claude evaluates the full set of proposed changes before
 *   they proceed. Flags concerns, removes risky items, adds eval summary to email.
 * - NEW: _loadClientContext() — loads business context from a shared Google Doc
 *   (CONFIG.CLIENT_CONTEXT_DOC_ID). Each client has a section (## Client Name) with
 *   free-text notes about products, strategy, seasonal info. Injected into all AI prompts.
 * - NEW: PendingChanges sheet tab — proposed changes are written as JSON, grouped by category
 *   (keyword_pauses, search_term_negations, winner_promotions, auto_optimizations, shopping_pmax)
 * - NEW: Email approval buttons — 5 category buttons + Approve All button in email report.
 *   Each links to a Google Apps Script Web App for one-click approval.
 * - NEW: _checkAndApplyPendingChanges() — runs at start of each run to apply previously
 *   approved changes. Expires unapproved changes after 7 days.
 * - NEW: _applyApprovedChanges() — executes the actual Google Ads API calls for approved categories
 * - NEW: approval_webapp.js — standalone Google Apps Script Web App for approval endpoints
 * - NEW: CONFIG.REQUIRE_APPROVAL (default: true) — toggle approval workflow
 * - NEW: CONFIG.CLIENT_CONTEXT_DOC_ID — Google Doc ID for client business context
 * - NEW: CONFIG.APPROVAL_WEBAPP_URL — deployed web app URL for approval buttons
 *
 * CHANGELOG v4.3.1:
 * - Baked-in Anthropic API key as fallback (no more sheet dependency for AI features)
 * - NEW: _writeDailyDigestRow() — writes summary to DailyDigest tab after each run
 * - NEW: daily_digest.js — standalone script that sends one consolidated email per day
 *
 * CHANGELOG v4.3.0 — ALL NEGATION THROUGH AI:
 * - BREAKING: Removed blind spend-threshold negation (_negativeHighSpendSearchTerms)
 * - BREAKING: Removed blind informational pattern negation (_blockInformationalTerms)
 * - BREAKING: Removed blind irrelevant term negation (_blockIrrelevantTerms)
 * - ALL negation decisions now routed through Claude Haiku with full client context
 * - AI receives: client name, website, industry, active keywords, informational/irrelevant flags
 * - AI prompt has strict "never negate product terms" safety rules
 * - Without ANTHROPIC_API_KEY: zero auto-negation, all candidates flagged for manual review
 * - INFORMATIONAL_PATTERNS and IRRELEVANT_TERMS now serve as AI hints, not auto-triggers
 * - Unified email report section for all negation activity
 * - Negatives routed to correct shared list based on AI reasoning (spend/info/irrelevant)
 *
 * CHANGELOG v4.2.0 — CRITICAL SAFETY + AUDIT & REPAIR + SHEET FIX:
 * - FIX: Google Sheet logging now works with CONFIG.SHEET_URL (extracts ID automatically)
 * - FIX: Sheet logging now works in PREVIEW_MODE (tags rows as "PREVIEW")
 * - FIX: Sheet access validated at startup with clear error messages
 * - FIX: Search terms matching active keywords NEVER auto-negatived
 * - FIX: Keywords with historical conversions (90 days) NEVER auto-paused
 * - FIX: Removed "where to", "where can", "where is" from informational patterns
 * - FIX: Email report now shows DETAIL for every action (which keywords, not just counts)
 * - FIX: Error messages now shown in full in email report
 * - NEW: _buildActiveKeywordSet() — global active keyword protection
 * - NEW: _isActiveKeyword() / _containsActiveKeyword() — protection helpers
 * - NEW: _hasHistoricalConversions() — 90-day conversion check before pausing
 * - NEW: _auditAndRepairNegatives() — audits ALL negatives and auto-repairs conflicts
 *        Removes shared list negatives that match active keywords or converting terms
 *        Removes ad-group negatives that conflict with positive keywords
 *        Unpauses keywords that have converting search terms (requires 2+ conversions)
 *        Skips Exact Winners sculpting negatives (intentional)
 * - NEW: _validateConfig() — checks for missing/misconfigured loader settings
 * - NEW: CONFIG.AUDIT_NEGATIVES (default: true)
 * - NEW: CONFIG.AUDIT_REPAIR_MODE (default: 'LIVE') — 'REPORT_ONLY' to preview
 * - NEW: CONFIG.AUDIT_CONVERTING_LOOKBACK_DAYS (default: 90)
 * - NEW: CONFIG.AUTO_PROTECT_ACTIVE_KEYWORDS (default: true)
 * - NEW: CONFIG.KEYWORD_PAUSE_MIN_IMPRESSIONS (default: 100)
 * - NEW: results.auditRepairs tracked and shown in email report
 * - NEW: LOADER_TEMPLATE.js with cache-busting for raw GitHub URL
 *
 * CHANGELOG v4.1.2 — CRITICAL SAFETY FIX: ACTIVE KEYWORD PROTECTION + AUDIT & REPAIR:
 * - FIX: Search terms matching active keywords are NEVER auto-negatived
 *   (Previously, core keywords in a conversion drought could be negatived)
 * - FIX: Keywords with historical conversions (90 days) are NEVER auto-paused
 * - FIX: Removed "where to", "where can", "where is" from informational patterns
 *   (These catch purchase-intent queries like "where to buy X")
 * - FIX: _pauseHighSpendKeywords now requires minimum impressions before pausing
 * - NEW: _buildActiveKeywordSet() — builds full active keyword set at start of run
 * - NEW: _auditAndRepairNegatives() — audits ALL existing negatives (shared lists +
 *   ad-group level) and auto-removes any that conflict with active keywords or block
 *   converting search terms. Also unpauses wrongly paused keywords. Runs FIRST before
 *   any new changes. Catches mistakes from BOTH script and human operators.
 * - NEW: CONFIG.AUTO_PROTECT_ACTIVE_KEYWORDS (default: true) — master safety toggle
 * - NEW: CONFIG.KEYWORD_PAUSE_MIN_IMPRESSIONS (default: 100) — minimum data before pausing
 * - NEW: CONFIG.AUDIT_NEGATIVES (default: true) — enable/disable the audit module
 * - NEW: CONFIG.AUDIT_REPAIR_MODE (default: 'LIVE') — 'LIVE' auto-fixes, 'REPORT_ONLY' flags only
 * - NEW: CONFIG.AUDIT_CONVERTING_LOOKBACK_DAYS (default: 90) — conversion check window
 * - All negative/pause actions now log when a term is skipped due to protection
 * - Audit repairs logged to master change log sheet and included in email report
 *
 * CHANGELOG v4.1.1 — AI CONTEXT FIX + SHEET ERROR REPORTING:
 * - FIX: AI prompt now understands agency/service-provider business model
 *   "[industry] + [client's service]" patterns correctly identified as leads
 *   (e.g. "plastic surgeon seo" = surgeon wants to BUY seo = KEEP)
 * - FIX: "near me" queries for South African accounts default to "keep"
 * - FIX: Sheet write failures now surface as errors in email report
 *   (previously silently swallowed by try/catch)
 * - Sheet errors tracked via _sheetErrors global, merged into results.errors
 *
 * CHANGELOG v4.1 — SMART AI SEARCH TERM NEGATION:
 * - NEW: _smartSearchTermReview() — AI-powered proactive search term negation
 *   Collects search terms with clicks but no conversions (last 7 days),
 *   sends them to Claude Haiku for relevance scoring, and auto-negates
 *   terms that are clearly irrelevant BEFORE they hit the spend threshold.
 * - NEW: _callClaude() — lightweight Claude Haiku API helper for fast AI tasks
 * - NEW: Email report section "AI Flagged for Review" for ambiguous terms
 * - NEW: CONFIG options: SMART_NEGATION, SMART_NEGATION_MIN_CLICKS, SMART_NEGATION_MAX_SPEND
 * - Safety: Protected terms never negated, 30-term cap per run, graceful API failure handling
 * - Loader CONFIG additions (optional — defaults apply):
 *     SMART_NEGATION: true          (master toggle)
 *     SMART_NEGATION_MIN_CLICKS: 1  (minimum clicks before reviewing)
 *     SMART_NEGATION_MAX_SPEND: 500 (above this, flag for manual review)
 *
 * CHANGELOG v4.0 — SELF-IMPROVEMENT ENGINE:
 * - NEW: Change log — every action written to master Syte Google Sheet
 * - NEW: Outcome backfill — 14 days after each change, script revisits and scores it
 * - NEW: Weekly Claude review (runs Sunday) — reads change log + outcomes, critiques
 *        its own logic, and emails a full rewritten script ready to paste into GitHub
 * - Loader CONFIG additions required:
 *     MASTER_SHEET_ID: 'your-google-sheet-id-here'  (one master sheet for all clients)
 *     ANTHROPIC_API_KEY: 'sk-ant-...'
 * 
 * CHANGELOG v3.2 — AUTO-OPTIMIZATIONS:
 * - Device bid adjustments, hour-of-day scheduling, geographic bid adjustments
 * - Conversion tracking health check
 * - N-gram analysis
 * - Low Quality Score keyword pausing
 * - Keyword Opportunity Scanner (removed — see POLICY note below)
 */

/**
 * ═══════════════════════════════════════════════════════════════
 * POLICY: NO AUTO KEYWORD ADDITION
 * ═══════════════════════════════════════════════════════════════
 * This script does NOT add new keywords to the account.
 *
 * Exact match promotion (_promoteWinners / _createExactMatchWinner)
 * is allowed because it promotes EXISTING converting traffic to
 * exact match — it doesn't introduce new search terms.
 *
 * Adding genuinely new keywords requires business context the script
 * doesn't have:
 *   - What does the client actually sell? (e.g. plastic jungle gyms but not wooden)
 *   - What's in stock? (client may have told us to stop bidding on X)
 *   - What are the margins? (a product may convert at a loss)
 *   - What's the strategic direction? (client wants to push premium, not budget)
 *   - Is there a landing page? (no LP = bad QS = wasted spend)
 *
 * Keyword opportunities are surfaced in the email report for human review.
 * The team adds keywords manually with full client context.
 *
 * POLICY: NO AUTO-REMOVAL OF NEGATIVES
 * The audit module scans for issues but NEVER auto-removes negatives
 * or auto-unpauses keywords. Negatives may have been added by humans
 * with business context the script doesn't have (out of stock, wrong
 * product line, strategic decision, client instruction).
 * All audit findings are reported in the email for human review.
 * ═══════════════════════════════════════════════════════════════
 */

// ============================================
// INFORMATIONAL PATTERNS (universal — lives in core)
// ============================================

var INFORMATIONAL_PATTERNS = [
  { pattern: /^how\s+to\b/i, negativePhrase: 'how to' },
  { pattern: /^what\s+is\b/i, negativePhrase: 'what is' },
  { pattern: /^what\s+are\b/i, negativePhrase: 'what are' },
  { pattern: /^what\s+does\b/i, negativePhrase: 'what does' },
  { pattern: /^why\s+do\b/i, negativePhrase: 'why do' },
  { pattern: /^why\s+does\b/i, negativePhrase: 'why does' },
  { pattern: /^why\s+is\b/i, negativePhrase: 'why is' },
  { pattern: /^why\s+are\b/i, negativePhrase: 'why are' },
  { pattern: /^when\s+to\b/i, negativePhrase: 'when to' },
  { pattern: /^when\s+should\b/i, negativePhrase: 'when should' },
  // v4.1.2: Removed "where to", "where can", "where is" — these catch purchase-intent
  // queries like "where to buy X", "where can I buy X", "where is [store]"
  { pattern: /^who\s+is\b/i, negativePhrase: 'who is' },
  { pattern: /^who\s+are\b/i, negativePhrase: 'who are' },
  { pattern: /^can\s+i\b/i, negativePhrase: 'can i' },
  { pattern: /^can\s+you\b/i, negativePhrase: 'can you' },
  { pattern: /^should\s+i\b/i, negativePhrase: 'should i' },
  { pattern: /^is\s+it\b/i, negativePhrase: 'is it' },
  { pattern: /\bdoes\b.*\bwork\b/i, negativePhrase: 'does work' },
  { pattern: /\btutorial\b/i, negativePhrase: 'tutorial' },
  { pattern: /\bguide\b/i, negativePhrase: 'guide' },
  { pattern: /\bcourse\b/i, negativePhrase: 'course' },
  { pattern: /\btraining\b/i, negativePhrase: 'training' },
  { pattern: /\blearn\b/i, negativePhrase: 'learn' },
  { pattern: /\bdefinition\b/i, negativePhrase: 'definition' },
  { pattern: /\bmeaning\b/i, negativePhrase: 'meaning' },
  { pattern: /\bexplain\b/i, negativePhrase: 'explain' },
  { pattern: /\bexample[s]?\b/i, negativePhrase: 'examples' },
  { pattern: /\btemplate[s]?\b/i, negativePhrase: 'templates' },
  { pattern: /\bfree\b/i, negativePhrase: 'free' },
  { pattern: /\bdownload\b/i, negativePhrase: 'download' },
  { pattern: /\bpdf\b/i, negativePhrase: 'pdf' },
  { pattern: /\breddit\b/i, negativePhrase: 'reddit' },
  { pattern: /\bforum\b/i, negativePhrase: 'forum' },
  { pattern: /\bquora\b/i, negativePhrase: 'quora' },
  { pattern: /\byoutube\b/i, negativePhrase: 'youtube' },
  { pattern: /\bvideo\b/i, negativePhrase: 'video' },
  { pattern: /\bvs\b/i, negativePhrase: 'vs' },
  { pattern: /\bversus\b/i, negativePhrase: 'versus' },
  { pattern: /\bcompare\b/i, negativePhrase: 'compare' },
  { pattern: /\bcomparison\b/i, negativePhrase: 'comparison' },
  { pattern: /\bjob[s]?\b/i, negativePhrase: 'jobs' },
  { pattern: /\bcareer[s]?\b/i, negativePhrase: 'careers' },
  { pattern: /\bsalary\b/i, negativePhrase: 'salary' },
  { pattern: /\bsalaries\b/i, negativePhrase: 'salaries' },
  { pattern: /\bhiring\b/i, negativePhrase: 'hiring' },
  { pattern: /\bvacancy\b/i, negativePhrase: 'vacancy' },
  { pattern: /\bvacancies\b/i, negativePhrase: 'vacancies' },
  { pattern: /\binternship\b/i, negativePhrase: 'internship' },
  { pattern: /\bdiy\b/i, negativePhrase: 'diy' },
  { pattern: /\bdo\s+it\s+yourself\b/i, negativePhrase: 'do it yourself' },
  { pattern: /\blist\s+of\b/i, negativePhrase: 'list of' }
];


// ============================================
// ACTIVE KEYWORD PROTECTION (v4.1.2)
// ============================================

var ACTIVE_KEYWORDS = {};  // Populated once at start of runOptimization()
var CONVERTING_SEARCH_TERMS = {};  // Search terms with conversions in lookback window
var CLIENT_CONTEXT = '';  // Business context loaded from Google Doc (v4.4.0)

/**
 * Builds a set of all active keyword texts in the account.
 * Called once at the start of runOptimization() and stored globally.
 */
function _buildActiveKeywordSet() {
  var activeKeywords = {};
  try {
    var query = 'SELECT ad_group_criterion.keyword.text, campaign.status, ad_group.status, ad_group_criterion.status FROM keyword_view ' +
      'WHERE campaign.status = "ENABLED" AND ad_group.status = "ENABLED" ' +
      'AND ad_group_criterion.status = "ENABLED"';
    var search = AdsApp.search(query);
    while (search.hasNext()) {
      var kw = search.next().adGroupCriterion.keyword.text.toLowerCase().trim();
      activeKeywords[kw] = true;
    }
  } catch (e) {
    _log('WARN', 'Could not build active keyword set: ' + e.message);
  }
  _log('INFO', 'Active keyword set built: ' + Object.keys(activeKeywords).length + ' keywords');
  return activeKeywords;
}

/**
 * Builds a set of search terms that have converted in the lookback window.
 * Used by audit & repair and pause protection.
 */
function _buildConvertingSearchTerms(lookbackDays) {
  var converting = {};
  try {
    var endDate = new Date();
    var startDate = new Date();
    startDate.setDate(startDate.getDate() - (lookbackDays || 90));
    var query = 'SELECT search_term_view.search_term, metrics.conversions, campaign.status ' +
      'FROM search_term_view WHERE metrics.conversions > 0 ' +
      'AND campaign.status = "ENABLED" ' +
      'AND segments.date BETWEEN "' + _formatDate(startDate) + '" AND "' + _formatDate(endDate) + '"';
    var search = AdsApp.search(query);
    while (search.hasNext()) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      var conv = Number(row.metrics.conversions) || 0;
      converting[st] = (converting[st] || 0) + conv;
    }
  } catch (e) {
    _log('WARN', 'Could not build converting search terms set: ' + e.message);
  }
  _log('INFO', 'Converting search terms (last ' + (lookbackDays || 90) + ' days): ' + Object.keys(converting).length);
  return converting;
}

/**
 * Loads business context for this client from a shared Google Doc.
 * The doc uses ## headings to separate clients (## Client Name).
 * Returns the text content for the current client's section.
 */
function _loadClientContext() {
  var docId = CONFIG.CLIENT_CONTEXT_DOC_ID;
  if (!docId) {
    _log('DEBUG', 'No CLIENT_CONTEXT_DOC_ID — client context disabled');
    return '';
  }

  try {
    var exportUrl = 'https://docs.google.com/document/d/' + docId + '/export?format=txt';
    var response = UrlFetchApp.fetch(exportUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      _log('WARN', 'Could not fetch client context doc (HTTP ' + response.getResponseCode() + ')');
      return '';
    }

    var content = response.getContentText();
    var clientName = (CONFIG.CLIENT_NAME || AdsApp.currentAccount().getName()).trim();
    var clientNameLower = clientName.toLowerCase();

    // Find all ## headings in the doc
    var headingPattern = /##\s*(.+)/g;
    var bestMatch = null;
    var headingMatch;
    while ((headingMatch = headingPattern.exec(content)) !== null) {
      var headingText = headingMatch[1].trim();
      var headingLower = headingText.toLowerCase();
      // Match if: heading contains client name, OR client name contains heading
      if (headingLower === clientNameLower ||
          headingLower.indexOf(clientNameLower) !== -1 ||
          clientNameLower.indexOf(headingLower) !== -1) {
        bestMatch = { index: headingMatch.index, length: headingMatch[0].length, heading: headingText };
        break;
      }
    }

    if (!bestMatch) {
      _log('INFO', 'No context section found for "' + clientName + '" in client context doc — AI will run without business context');
      return '';
    }

    if (bestMatch.heading.toLowerCase() !== clientNameLower) {
      _log('INFO', 'Fuzzy matched client context: "' + clientName + '" → "' + bestMatch.heading + '"');
    }

    var startIdx = bestMatch.index + bestMatch.length + 1;
    // Find the next ## heading or end of doc
    var nextSection = content.indexOf('\n##', startIdx);
    var section = nextSection !== -1 ? content.substring(startIdx, nextSection).trim() : content.substring(startIdx).trim();

    _log('INFO', 'Loaded client context (' + section.length + ' chars) for "' + clientName + '"');
    return section;
  } catch (e) {
    _log('WARN', 'loadClientContext error: ' + e.message);
    return '';
  }
}


/**
 * Checks if a search term matches any active keyword (exact match).
 * Returns true if the term should be protected.
 */
function _isActiveKeyword(term) {
  if (CONFIG.AUTO_PROTECT_ACTIVE_KEYWORDS === false) return false;
  return !!ACTIVE_KEYWORDS[term.toLowerCase().trim()];
}

/**
 * Checks if any active keyword text appears as a substring within the search term.
 * Used to protect search terms that contain active keywords.
 */
function _containsActiveKeyword(searchTerm) {
  if (CONFIG.AUTO_PROTECT_ACTIVE_KEYWORDS === false) return false;
  var st = searchTerm.toLowerCase().trim();
  for (var kw in ACTIVE_KEYWORDS) {
    if (st.indexOf(kw) !== -1) return kw;
  }
  return false;
}

/**
 * Checks if a keyword has any historical conversions in the last 90 days.
 * Used to prevent pausing keywords that have converted recently.
 */
function _hasHistoricalConversions(keywordText, campaignName, adGroupName) {
  try {
    var endDate = new Date();
    var startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    var query = 'SELECT metrics.conversions FROM keyword_view ' +
      'WHERE ad_group_criterion.keyword.text = "' + keywordText + '" ' +
      'AND campaign.name = "' + campaignName + '" ' +
      'AND ad_group.name = "' + adGroupName + '" ' +
      'AND segments.date BETWEEN "' + _formatDate(startDate) + '" AND "' + _formatDate(endDate) + '"';
    var search = AdsApp.search(query);
    var totalConv = 0;
    while (search.hasNext()) {
      totalConv += Number(search.next().metrics.conversions) || 0;
    }
    return totalConv > 0;
  } catch (e) {
    _log('WARN', 'Historical conversion check failed for "' + keywordText + '": ' + e.message);
    return false;  // Fail safe — don't block the pause if check fails
  }
}


// ============================================
// HELPERS
// ============================================

var LOG_LEVELS = { 'DEBUG': 0, 'INFO': 1, 'WARN': 2, 'ERROR': 3 };

function _log(level, message) {
  if (LOG_LEVELS[level] >= LOG_LEVELS[CONFIG.LOG_LEVEL || 'INFO']) {
    var prefix = CONFIG.PREVIEW_MODE ? '[PREVIEW] ' : '[LIVE] ';
    Logger.log(prefix + '[' + level + '] ' + message);
  }
}

function _formatDate(d) {
  return Utilities.formatDate(d, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
}

function _formatDatetime(d) {
  return Utilities.formatDate(d, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function _isProtectedTerm(term) {
  var lower = term.toLowerCase();
  return CONFIG.PROTECTED_TERMS.some(function(p) { return lower.indexOf(p.toLowerCase()) !== -1; });
}

function _isInformational(term) {
  for (var i = 0; i < INFORMATIONAL_PATTERNS.length; i++) {
    if (INFORMATIONAL_PATTERNS[i].pattern.test(term)) return true;
  }
  return false;
}

function _calculateROAS(revenue, cost) {
  if (cost === 0) return revenue > 0 ? 999 : 0;
  return revenue / cost;
}

function _isEcommerceMode() {
  return CONFIG.ACCOUNT_MODE === 'ECOMMERCE' || CONFIG.ACCOUNT_MODE === 'HYBRID';
}

function _isLeadGenMode() {
  return CONFIG.ACCOUNT_MODE === 'LEAD_GEN' || CONFIG.ACCOUNT_MODE === 'HYBRID';
}

function _getDateRange() {
  var endDate = new Date();
  endDate.setDate(endDate.getDate() - CONFIG.CONVERSION_LAG_DAYS);
  var startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - CONFIG.LOOKBACK_DAYS);
  return { startDate: _formatDate(startDate), endDate: _formatDate(endDate) };
}

function _getOrCreateNegativeList(listName) {
  var lists = AdsApp.negativeKeywordLists().withCondition('shared_set.name = "' + listName + '"').get();
  if (lists.hasNext()) return lists.next();
  if (!CONFIG.PREVIEW_MODE) {
    var newList = AdsApp.newNegativeKeywordListBuilder().withName(listName).build().getResult();
    var campaigns = AdsApp.campaigns().withCondition('campaign.status = "ENABLED"').get();
    while (campaigns.hasNext()) { campaigns.next().addNegativeKeywordList(newList); }
    return newList;
  }
  _log('INFO', 'Would create negative list: "' + listName + '" (Preview mode)');
  return null;
}

function _getExistingNegatives(negativeList) {
  var existing = {};
  if (!negativeList) return existing;
  var keywords = negativeList.negativeKeywords().get();
  while (keywords.hasNext()) {
    existing[keywords.next().getText().toLowerCase().replace(/[\[\]"]/g, '')] = true;
  }
  return existing;
}


// ============================================
// SMART SEARCH TERM REVIEW (v4.1)
// ============================================

/**
 * Calls Claude Haiku for lightweight, fast AI tasks (smart negation, etc.)
 * Separate from _callClaudeAPI which uses Sonnet for the weekly review.
 */
function _callClaude(prompt, maxTokens) {
  try {
    var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens || 4000,
        messages: [{ role: 'user', content: prompt }]
      }),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      _log('WARN', 'Claude Haiku API error ' + code + ': ' + response.getContentText().substring(0, 200));
      return null;
    }

    var json = JSON.parse(response.getContentText());
    if (json.content && json.content[0] && json.content[0].text) {
      return json.content[0].text;
    }

    _log('WARN', 'Unexpected Claude Haiku response structure');
    return null;
  } catch (e) {
    _log('WARN', 'callClaude error: ' + e.message);
    return null;
  }
}

/**
 * Smart Search Term Review — runs BEFORE spend-threshold logic.
 * Collects recent search terms with clicks but no conversions,
 * sends them to Claude Haiku for relevance scoring, and auto-negates
 * terms that are clearly irrelevant.
 */
function _smartSearchTermReview(results) {
  if (CONFIG.SMART_NEGATION === false) {
    _log('INFO', 'Smart negation disabled — skipping');
    return;
  }

  _log('INFO', 'Running unified AI search term review...');

  var maxSpendForAuto = CONFIG.SMART_NEGATION_MAX_SPEND || 500;
  var smartNegationCap = 30;

  // === STEP 1: Collect candidates from ALL sources ===
  var candidates = {};  // keyed by search term text

  // SOURCE 1: High spend, zero conversions (last 30 days) — lead gen
  if (_isLeadGenMode()) {
    var spendThreshold = CONFIG.SEARCH_TERM_SPEND_THRESHOLD || 100;
    try {
      var q1 = 'SELECT search_term_view.search_term, campaign.name, metrics.cost_micros, metrics.conversions, metrics.clicks, campaign.status, campaign.advertising_channel_type ' +
        'FROM search_term_view WHERE metrics.cost_micros > ' + (spendThreshold * 1000000) +
        ' AND metrics.conversions < 1 AND campaign.status = "ENABLED" ' +
        'AND campaign.advertising_channel_type = "SEARCH" AND segments.date DURING LAST_30_DAYS';
      var s1 = AdsApp.search(q1);
      while (s1.hasNext()) {
        var r1 = s1.next();
        var st1 = r1.searchTermView.searchTerm.toLowerCase().trim();
        if (!candidates[st1]) candidates[st1] = { term: st1, cost: 0, clicks: 0, campaign: r1.campaign.name, channelType: 'SEARCH', sources: [] };
        candidates[st1].cost += Number(r1.metrics.costMicros) / 1000000;
        candidates[st1].clicks += Number(r1.metrics.clicks) || 0;
        if (candidates[st1].sources.indexOf('HIGH_SPEND_LEAD_GEN') === -1) candidates[st1].sources.push('HIGH_SPEND_LEAD_GEN');
      }
    } catch (e) { _log('WARN', 'Candidate collection (lead gen spend) failed: ' + e.message); }
  }

  // SOURCE 2: High spend, low ROAS (last 30 days) — ecommerce
  // v4.5.0: expanded to cover SEARCH, SHOPPING, and PERFORMANCE_MAX campaigns
  if (_isEcommerceMode()) {
    var ecomThreshold = CONFIG.ECOM_SEARCH_TERM_SPEND_THRESHOLD || 800;
    try {
      var q2 = 'SELECT search_term_view.search_term, campaign.name, metrics.cost_micros, metrics.conversions_value, metrics.clicks, campaign.status, campaign.advertising_channel_type ' +
        'FROM search_term_view WHERE metrics.cost_micros > ' + (ecomThreshold * 1000000) +
        ' AND campaign.status = "ENABLED" AND campaign.advertising_channel_type IN ("SEARCH", "SHOPPING", "PERFORMANCE_MAX") ' +
        'AND segments.date DURING LAST_30_DAYS';
      var s2 = AdsApp.search(q2);
      while (s2.hasNext()) {
        var r2 = s2.next();
        var st2 = r2.searchTermView.searchTerm.toLowerCase().trim();
        var cost2 = Number(r2.metrics.costMicros) / 1000000;
        var revenue2 = Number(r2.metrics.conversionsValue) || 0;
        var roas2 = cost2 > 0 ? revenue2 / cost2 : 0;
        if (roas2 >= (CONFIG.MIN_ROAS_TO_KEEP || 1.5)) continue;
        var ch2 = r2.campaign.advertisingChannelType || 'SEARCH';
        if (!candidates[st2]) candidates[st2] = { term: st2, cost: 0, clicks: 0, campaign: r2.campaign.name, channelType: ch2, sources: [], revenue: 0 };
        candidates[st2].cost += cost2;
        candidates[st2].clicks += Number(r2.metrics.clicks) || 0;
        candidates[st2].revenue = (candidates[st2].revenue || 0) + revenue2;
        if (candidates[st2].sources.indexOf('LOW_ROAS_ECOM') === -1) candidates[st2].sources.push('LOW_ROAS_ECOM');
      }
    } catch (e) { _log('WARN', 'Candidate collection (ecom spend) failed: ' + e.message); }
  }

  // SOURCE 3: Early detection — clicks but no conversions, last 7 days
  // v4.5.0: expanded to cover SEARCH, SHOPPING, and PERFORMANCE_MAX (borderline borderline terms on every channel)
  var minClicks = CONFIG.SMART_NEGATION_MIN_CLICKS || 1;
  try {
    var q3 = 'SELECT search_term_view.search_term, search_term_view.status, campaign.name, ' +
      'metrics.cost_micros, metrics.clicks, metrics.conversions, campaign.status, campaign.advertising_channel_type ' +
      'FROM search_term_view WHERE campaign.status = "ENABLED" ' +
      'AND metrics.clicks >= ' + minClicks + ' AND metrics.conversions = 0 ' +
      'AND campaign.advertising_channel_type IN ("SEARCH", "SHOPPING", "PERFORMANCE_MAX") ' +
      'AND search_term_view.status = "NONE" AND segments.date DURING LAST_7_DAYS';
    var s3 = AdsApp.search(q3);
    while (s3.hasNext()) {
      var r3 = s3.next();
      var st3 = r3.searchTermView.searchTerm.toLowerCase().trim();
      var ch3 = r3.campaign.advertisingChannelType || 'SEARCH';
      if (!candidates[st3]) candidates[st3] = { term: st3, cost: 0, clicks: 0, campaign: r3.campaign.name, channelType: ch3, sources: [] };
      candidates[st3].cost += Number(r3.metrics.costMicros) / 1000000;
      candidates[st3].clicks += Number(r3.metrics.clicks) || 0;
      if (candidates[st3].sources.indexOf('EARLY_DETECTION') === -1) candidates[st3].sources.push('EARLY_DETECTION');
    }
  } catch (e) { _log('WARN', 'Candidate collection (early detection) failed: ' + e.message); }

  // === STEP 2: Filter out protected terms, active keywords, existing negatives ===
  var negativeListSpend = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_SPEND);
  var negativeListInfo = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_INFORMATIONAL);
  var negativeListIrr = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_IRRELEVANT);
  var existingNegs = {};
  var allLists = [negativeListSpend, negativeListInfo, negativeListIrr];
  for (var li = 0; li < allLists.length; li++) {
    if (!allLists[li]) continue;
    var ex = _getExistingNegatives(allLists[li]);
    for (var k in ex) existingNegs[k] = true;
  }

  var filtered = [];
  var termData = {};
  for (var st in candidates) {
    if (_isProtectedTerm(st)) continue;
    if (_isActiveKeyword(st)) continue;
    if (existingNegs[st]) continue;
    filtered.push(candidates[st]);
    termData[st] = candidates[st];
  }

  _log('INFO', 'AI review: ' + Object.keys(candidates).length + ' raw candidates -> ' + filtered.length + ' after filtering');

  if (filtered.length === 0) {
    _log('INFO', 'No candidates for AI review');
    return;
  }

  // === STEP 3: If no API key, flag everything for manual review ===
  if (!CONFIG.ANTHROPIC_API_KEY) {
    _log('WARN', 'No ANTHROPIC_API_KEY — ALL candidates flagged for manual review (no auto-negation)');
    for (var fi = 0; fi < filtered.length; fi++) {
      var fc = filtered[fi];
      results.smartReviewTerms.push({
        term: fc.term, cost: fc.cost, clicks: fc.clicks,
        reason: 'No AI key — manual review required. Sources: ' + fc.sources.join(', '),
        verdict: 'review'
      });
    }
    return;
  }

  // === STEP 4: Build term list with flags for AI context ===
  var isSouthAfrican = (CONFIG.CURRENCY_SYMBOL === 'R') ||
    (CONFIG.TARGET_LOCATIONS && JSON.stringify(CONFIG.TARGET_LOCATIONS).toLowerCase().indexOf('south africa') !== -1);

  var batchSize = 100;
  var allVerdicts = [];
  var termKeys = filtered.map(function(c) { return c.term; });

  for (var batchStart = 0; batchStart < termKeys.length; batchStart += batchSize) {
    var batch = termKeys.slice(batchStart, batchStart + batchSize);

    var termList = batch.map(function(t) {
      var d = termData[t];
      var tags = d.sources.join(', ');
      // Tag informational pattern matches
      for (var pi = 0; pi < INFORMATIONAL_PATTERNS.length; pi++) {
        if (INFORMATIONAL_PATTERNS[pi].pattern.test(t)) { tags += ', INFORMATIONAL_PATTERN'; break; }
      }
      // Tag irrelevant term matches
      var irrTerms = CONFIG.IRRELEVANT_TERMS || [];
      for (var ii = 0; ii < irrTerms.length; ii++) {
        if (t.indexOf(irrTerms[ii].toLowerCase()) !== -1) { tags += ', CLIENT_IRRELEVANT_LIST'; break; }
      }
      return '- "' + t + '" (cost: ' + (CONFIG.CURRENCY_SYMBOL || 'R') + d.cost.toFixed(0) + ', clicks: ' + d.clicks + ', flags: ' + tags + ')';
    }).join('\n');

    // Build the active keywords sample for context
    var activeKwSample = Object.keys(ACTIVE_KEYWORDS).slice(0, 50).join(', ');

    var prompt = 'You are a Google Ads search term relevance analyst.\n\n' +
      'CLIENT CONTEXT:\n' +
      'Name: ' + (CONFIG.CLIENT_NAME || AdsApp.currentAccount().getName()) + '\n' +
      'Website: ' + (CONFIG.CLIENT_WEBSITE || 'N/A') + '\n' +
      'Industry: ' + (CONFIG.CLIENT_INDUSTRY || 'N/A') + '\n' +
      'Account mode: ' + (CONFIG.ACCOUNT_MODE || 'LEAD_GEN') + '\n' +
      'Active keywords in this account include: ' + activeKwSample + '\n' +
      (isSouthAfrican ? 'Market: South Africa\n' : '') +
      (CLIENT_CONTEXT ? '\nBUSINESS CONTEXT (from account manager):\n' + CLIENT_CONTEXT + '\n' : '') + '\n' +
      'TASK: Review these search terms and decide whether to negate each one.\n' +
      'Respond with ONLY a JSON array. Each item:\n' +
      '{"term": "the search term", "verdict": "keep" | "negate" | "review", "reason": "brief reason"}\n\n' +

      'VERDICT RULES:\n\n' +

      '"keep" = The searcher could plausibly be a customer of this client:\n' +
      '- The term relates to products/services the client likely offers\n' +
      '- The term contains words that appear in the client\'s active keywords\n' +
      '- Product variations, sizes, colors, or modifiers of core products\n' +
      '- Location-specific searches for the client\'s products\n' +
      '- "for sale", "buy", "price", "near me", "supplier", "quote" + product = ALWAYS keep\n' +
      '- Children\'s/kids versions of products the client sells = keep\n' +
      '- Misspellings or typos of product/service terms = KEEP (misspelled searches still indicate buyer intent)\n' +
      '- Competitor brand names = KEEP — competitor campaigns are intentional strategy. Only flag based on performance (spend/ROAS), not because the term is a competitor name\n\n' +

      '"negate" = The searcher is CLEARLY not a potential customer:\n' +
      '- Job/career searches: jobs, salary, vacancy, hiring, career, internship\n' +
      '- Academic: course, degree, university, certification, tutorial, how to build/make\n' +
      '- DIY intent: diy, homemade, handmade, build your own, plans, blueprints\n' +
      '- Wrong product category entirely (not even adjacent to what the client sells)\n' +
      '- Image/media searches: pictures of, images, photos, video, gif, png, pdf\n' +
      '- Research: wikipedia, reddit, forum, review, comparison, vs, what is, definition\n\n' +

      '"review" = You\'re not sure. Use when:\n' +
      '- The term MIGHT relate to the client\'s products but you\'re unsure\n' +
      '- The term has commercial intent but for a slightly different product\n' +
      '- You would need to check the client\'s website to be sure\n\n' +

      'CRITICAL SAFETY RULES:\n' +
      '1. If a search term contains ANY words from the client\'s active keywords, default to "keep" or "review" — NEVER "negate"\n' +
      '2. Product + modifier (size, color, material, age group, location) = "keep"\n' +
      '3. Product + "for sale" / "buy" / "price" / "near me" / "supplier" / "quote" / "cost" / "cheap" / "best" = ALWAYS "keep"\n' +
      '4. When in doubt between "negate" and "review", ALWAYS choose "review"\n' +
      '5. You are the LAST line of defense. If you say "negate", the term is blocked permanently. Be conservative.\n' +
      '6. NEVER negate a search term just because it is misspelled. Misspellings and typos still indicate purchase intent. Treat them the same as the correctly-spelled term.\n' +
      '7. NEVER negate a search term just because it contains a competitor brand name. Competitor campaigns are intentional. Only consider negation based on performance metrics, not brand identity.\n\n' +

      (CONFIG.ACCOUNT_MODE === 'LEAD_GEN' ?
        'AGENCY/SERVICE PROVIDER RULE:\n' +
        'If the client sells a service, "[industry] + [service]" = a qualified lead (KEEP).\n\n' : '') +

      (isSouthAfrican ?
        'SOUTH AFRICA RULE: "Near me" + core product/service = legitimate local search = KEEP.\n\n' : '') +

      'FLAG CONTEXT (hints, not verdicts):\n' +
      '- HIGH_SPEND_LEAD_GEN: Spent above cost threshold with 0 conversions\n' +
      '- LOW_ROAS_ECOM: Spent above threshold with low ROAS\n' +
      '- EARLY_DETECTION: Low spend, clicked, no conversions yet\n' +
      '- INFORMATIONAL_PATTERN: Matches informational regex (how to, tutorial, etc.)\n' +
      '- CLIENT_IRRELEVANT_LIST: Contains a term the client flagged as irrelevant\n' +
      'These flags are HINTS. Use them alongside your judgment.\n\n' +

      'Search terms:\n' + termList;

    var aiResponse = _callClaude(prompt, 4000);
    if (!aiResponse) {
      _log('WARN', 'AI review: API call failed for batch starting at ' + batchStart);
      continue;
    }

    // Parse JSON from response
    try {
      var jsonStr = aiResponse;
      var codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
      var arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        allVerdicts = allVerdicts.concat(JSON.parse(arrayMatch[0]));
      } else {
        _log('WARN', 'AI review: no JSON array found in response');
      }
    } catch (parseErr) {
      _log('WARN', 'AI review: JSON parse error: ' + parseErr.message);
    }
  }

  if (allVerdicts.length === 0) {
    _log('INFO', 'AI review: no verdicts returned');
    return;
  }

  _log('INFO', 'AI review: ' + allVerdicts.length + ' verdicts received');

  // === STEP 5: Process verdicts ===
  var negateCount = 0;

  for (var vi = 0; vi < allVerdicts.length; vi++) {
    var v = allVerdicts[vi];
    if (!v || !v.term || !v.verdict) continue;

    var termKey = v.term.toLowerCase().trim();
    var data = termData[termKey];
    if (!data) continue;

    if (v.verdict === 'negate') {
      // Safety: never negate protected terms regardless of AI verdict
      if (_isProtectedTerm(termKey)) {
        _log('WARN', 'AI review: AI said negate protected term "' + termKey + '" — SKIPPED');
        continue;
      }
      // Never negate active keywords
      if (_isActiveKeyword(termKey)) {
        _log('INFO', 'SKIP (active keyword): "' + termKey + '" — AI said negate but matches active keyword');
        continue;
      }

      // If spend is above max threshold, flag for manual review
      if (data.cost > maxSpendForAuto) {
        results.smartReviewTerms.push({ term: termKey, cost: data.cost, clicks: data.clicks, reason: v.reason + ' (high spend — needs manual review)', verdict: 'review', channelType: data.channelType || 'SEARCH', campaign: data.campaign });
        continue;
      }

      // Cap auto-negations per run
      if (negateCount >= smartNegationCap || negateCount >= CONFIG.MAX_CHANGES_PER_RUN) {
        results.smartReviewTerms.push({ term: termKey, cost: data.cost, clicks: data.clicks, reason: v.reason + ' (cap reached)', verdict: 'review', channelType: data.channelType || 'SEARCH', campaign: data.campaign });
        continue;
      }

      var channelType = data.channelType || 'SEARCH';
      _log('INFO', 'AI NEGATE [' + channelType + ']: "' + termKey + '" | ' + (CONFIG.CURRENCY_SYMBOL || 'R') + data.cost.toFixed(0) + ' | Reason: ' + v.reason);
      results.smartNegated.push({ term: termKey, cost: data.cost, clicks: data.clicks, reason: v.reason, channelType: channelType, campaign: data.campaign });

      // Also populate backwards-compat buckets so the email report still surfaces Shopping/PMax
      if (channelType === 'PERFORMANCE_MAX') {
        results.pmaxSearchTermsNegated.push({ searchTerm: termKey, campaign: data.campaign, spend: data.cost });
      } else {
        results.searchTermsNegated.push({ searchTerm: termKey, campaign: data.campaign, spend: data.cost });
      }

      _logChange({
        functionName: '_smartSearchTermReview',
        entity: termKey,
        entityType: 'SEARCH_TERM_NEGATIVE',
        campaign: data.campaign + ' [' + channelType + ']',
        reason: 'AI Negate: ' + v.reason,
        spend: data.cost,
        conversions: 0
      });

      // Route negation to the correct place for this channel type.
      //   SEARCH: shared negative keyword list (applied account-wide).
      //   SHOPPING: shared negative keyword list still works for Shopping campaigns.
      //   PERFORMANCE_MAX: PMax cannot use shared neg lists — add as campaign-level negative.
      if (!CONFIG.PREVIEW_MODE) {
        try {
          if (channelType === 'PERFORMANCE_MAX') {
            // Campaign-level negative keyword on the specific PMax campaign
            var pmaxIter = AdsApp.performanceMaxCampaigns()
              .withCondition('campaign.name = "' + data.campaign.replace(/"/g, '\\"') + '"').get();
            if (pmaxIter.hasNext()) {
              pmaxIter.next().createNegativeKeyword('[' + termKey + ']');
            } else {
              _log('WARN', 'AI negate: PMax campaign "' + data.campaign + '" not found — falling back to shared list');
              if (negativeListSpend) negativeListSpend.addNegativeKeyword('[' + termKey + ']');
            }
          } else {
            // SEARCH + SHOPPING: route to appropriate shared negative list by AI reason
            var reason = (v.reason || '').toLowerCase();
            var targetList = negativeListSpend;  // default
            if (reason.indexOf('wrong industry') !== -1 || reason.indexOf('irrelevant') !== -1) {
              targetList = negativeListIrr;
            } else if (reason.indexOf('job') !== -1 || reason.indexOf('career') !== -1 ||
                       reason.indexOf('academic') !== -1 || reason.indexOf('educational') !== -1 ||
                       reason.indexOf('informational') !== -1 || reason.indexOf('diy') !== -1 ||
                       reason.indexOf('tutorial') !== -1 || reason.indexOf('how to') !== -1) {
              targetList = negativeListInfo;
            }
            if (targetList) targetList.addNegativeKeyword('[' + termKey + ']');
          }
        } catch (negErr) {
          _log('WARN', 'AI negate: failed to add "' + termKey + '" for ' + channelType + ' — ' + negErr.message);
        }
      }

      negateCount++;
    } else if (v.verdict === 'review') {
      results.smartReviewTerms.push({ term: termKey, cost: data.cost, clicks: data.clicks, reason: v.reason, verdict: 'review', channelType: data.channelType || 'SEARCH', campaign: data.campaign });
    }
    // 'keep' verdicts are simply ignored — term stays active
  }

  _log('INFO', 'AI review complete: ' + negateCount + ' negated, ' + results.smartReviewTerms.length + ' flagged for review');
}


// ============================================
// CHANGE LOG — MASTER GOOGLE SHEET
// ============================================

/**
 * Sheet columns (row 1 is header):
 * A: change_id  B: timestamp  C: account_name  D: function_name
 * E: entity     F: entity_type  G: campaign  H: ad_group
 * I: reason     J: spend_at_change  K: conversions_at_change
 * L: outcome    M: outcome_checked_date  N: outcome_notes
 * O: script_version
 */

var _sheetCache = null;
var _sheetErrors = []; // Track sheet errors for surfacing in email report

function _getChangeLogSheet() {
  if (_sheetCache) return _sheetCache;

  // Backwards compatibility: extract MASTER_SHEET_ID from SHEET_URL if not set
  if (!CONFIG.MASTER_SHEET_ID && CONFIG.SHEET_URL) {
    var urlMatch = CONFIG.SHEET_URL.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) {
      CONFIG.MASTER_SHEET_ID = urlMatch[1];
      _log('INFO', 'Extracted MASTER_SHEET_ID from SHEET_URL');
    }
  }

  if (!CONFIG.MASTER_SHEET_ID) {
    var msg = 'No MASTER_SHEET_ID or SHEET_URL in CONFIG — change logging disabled';
    _log('WARN', msg);
    if (_sheetErrors.indexOf(msg) === -1) _sheetErrors.push(msg);
    return null;
  }
  try {
    var ss = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
    var sheet = ss.getSheetByName('ChangeLog');
    if (!sheet) {
      sheet = ss.insertSheet('ChangeLog');
      sheet.getRange(1, 1, 1, 15).setValues([[
        'change_id', 'timestamp', 'account_name', 'function_name',
        'entity', 'entity_type', 'campaign', 'ad_group',
        'reason', 'spend_at_change', 'conversions_at_change',
        'outcome', 'outcome_checked_date', 'outcome_notes',
        'script_version'
      ]]);
      sheet.getRange(1, 1, 1, 15).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    _sheetCache = sheet;
    return sheet;
  } catch (e) {
    var errMsg = 'Cannot open change log sheet: ' + e.message;
    _log('ERROR', errMsg);
    if (_sheetErrors.indexOf(errMsg) === -1) _sheetErrors.push(errMsg);
    return null;
  }
}

/**
 * Reads shared config values from a "Config" tab in the master Google Sheet.
 * Expected layout:
 *   A1: ANTHROPIC_API_KEY    B1: sk-ant-...
 *   A2: GITHUB_PAT           B2: ghp_...
 *   (add more rows as needed)
 *
 * Values from the sheet OVERRIDE loader CONFIG only if the loader CONFIG is empty/missing.
 * This means loader-level settings take priority, but the sheet provides defaults.
 */
function _loadSharedConfig() {
  if (!CONFIG.MASTER_SHEET_ID && !CONFIG.SHEET_URL) return;

  // Ensure MASTER_SHEET_ID is set (extract from SHEET_URL if needed)
  if (!CONFIG.MASTER_SHEET_ID && CONFIG.SHEET_URL) {
    var match = CONFIG.SHEET_URL.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) CONFIG.MASTER_SHEET_ID = match[1];
  }
  if (!CONFIG.MASTER_SHEET_ID) return;

  try {
    var ss = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
    var configSheet = ss.getSheetByName('Config');
    if (!configSheet) {
      _log('DEBUG', 'No "Config" tab in master sheet — using loader CONFIG only');
      return;
    }

    var data = configSheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      var key = String(data[i][0]).trim();
      var value = String(data[i][1]).trim();
      if (!key || !value) continue;

      // Only set if not already in CONFIG (loader takes priority)
      if (key === 'ANTHROPIC_API_KEY' && !CONFIG.ANTHROPIC_API_KEY) {
        CONFIG.ANTHROPIC_API_KEY = value;
        _log('INFO', 'Loaded ANTHROPIC_API_KEY from master sheet');
      }
      if (key === 'CLIENT_CONTEXT_DOC_ID' && !CONFIG.CLIENT_CONTEXT_DOC_ID) {
        CONFIG.CLIENT_CONTEXT_DOC_ID = value;
        _log('INFO', 'Loaded CLIENT_CONTEXT_DOC_ID from master sheet');
      }
      if (key === 'APPROVAL_WEBAPP_URL' && !CONFIG.APPROVAL_WEBAPP_URL) {
        CONFIG.APPROVAL_WEBAPP_URL = value;
        _log('INFO', 'Loaded APPROVAL_WEBAPP_URL from master sheet');
      }
    }
  } catch (e) {
    _log('WARN', 'Could not load shared config: ' + e.message);
  }
}

function _generateChangeId() {
  return Utilities.formatDate(new Date(), AdsApp.currentAccount().getTimeZone(), 'yyyyMMddHHmmss') +
    '_' + Math.random().toString(36).substr(2, 5).toUpperCase();
}

/**
 * Logs a single change action to the master sheet.
 * @param {Object} change - { functionName, entity, entityType, campaign, adGroup, reason, spend, conversions }
 * @returns {string} changeId — store in results for outcome backfill
 */
function _logChange(change) {
  var sheet = _getChangeLogSheet();
  if (!sheet) return null;

  var changeId = _generateChangeId();
  var accountName = AdsApp.currentAccount().getName();

  try {
    sheet.appendRow([
      changeId,
      _formatDatetime(new Date()),
      accountName,
      change.functionName || '',
      change.entity || '',
      change.entityType || '',
      change.campaign || '',
      change.adGroup || '',
      change.reason || '',
      change.spend || 0,
      change.conversions || 0,
      CONFIG.PREVIEW_MODE ? 'PREVIEW' : 'PENDING',  // outcome — PREVIEW tagged, LIVE backfilled in 14 days
      '',                  // outcome_checked_date
      '',                  // outcome_notes
      'v4.5.0'            // script_version
    ]);
  } catch (e) {
    var writeErr = 'Change log write failed: ' + e.message;
    _log('ERROR', writeErr);
    if (_sheetErrors.indexOf(writeErr) === -1) _sheetErrors.push(writeErr);
  }

  return changeId;
}


// ============================================
// OUTCOME BACKFILL
// ============================================

/**
 * Runs on every execution. Finds rows logged ~14 days ago that still have
 * outcome = 'PENDING', then checks the current performance of that entity
 * to score whether the decision was correct.
 *
 * Outcome values:
 *   CORRECT   — keyword/term paused, account CPL/ROAS improved, no sign of error
 *   INCORRECT — keyword had conversions after pause / entity recovered
 *   NEUTRAL   — not enough data to score
 *   PENDING   — awaiting check
 */
function _backfillOutcomes() {
  var sheet = _getChangeLogSheet();
  if (!sheet) return;

  _log('INFO', 'Running outcome backfill...');

  try {
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return;

    var headers = data[0];
    var colIdx = {};
    headers.forEach(function(h, i) { colIdx[h] = i; });

    var accountName = AdsApp.currentAccount().getName();
    var checkDate = new Date();
    var cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 14); // Only check rows 14+ days old

    var rowsChecked = 0;

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      if (row[colIdx['outcome']] !== 'PENDING') continue;
      if (row[colIdx['account_name']] !== accountName) continue;

      var changeTimestamp = new Date(row[colIdx['timestamp']]);
      if (changeTimestamp > cutoffDate) continue; // Not old enough yet

      var entity = row[colIdx['entity']];
      var entityType = row[colIdx['entity_type']];
      var campaign = row[colIdx['campaign']];
      var adGroup = row[colIdx['ad_group']];
      var originalSpend = Number(row[colIdx['spend_at_change']]) || 0;
      var functionName = row[colIdx['function_name']];

      var outcome = 'NEUTRAL';
      var outcomeNotes = '';

      try {
        if (entityType === 'KEYWORD') {
          // Check if the keyword was re-enabled or had conversions since pausing
          var kwQuery = 'SELECT ad_group_criterion.keyword.text, ad_group_criterion.status, ' +
            'metrics.conversions, metrics.cost_micros ' +
            'FROM keyword_view WHERE ad_group_criterion.keyword.text = "' + entity + '" ' +
            'AND campaign.name = "' + campaign + '" AND ad_group.name = "' + adGroup + '" ' +
            'AND segments.date DURING LAST_14_DAYS';
          var kwSearch = AdsApp.search(kwQuery);
          if (kwSearch.hasNext()) {
            var kw = kwSearch.next();
            var postConv = Number(kw.metrics.conversions) || 0;
            var status = kw.adGroupCriterion.status;
            if (postConv > 0) {
              outcome = 'INCORRECT';
              outcomeNotes = 'Keyword had ' + postConv + ' conversions in 14 days after pause. Should not have been paused.';
            } else if (status === 'PAUSED') {
              outcome = 'CORRECT';
              outcomeNotes = 'Keyword remains paused. No conversions observed post-pause.';
            } else {
              outcome = 'NEUTRAL';
              outcomeNotes = 'Keyword re-enabled or status unclear.';
            }
          } else {
            outcome = 'CORRECT';
            outcomeNotes = 'Keyword no longer found in active queries — likely correctly removed.';
          }
        }

        else if (entityType === 'SEARCH_TERM_NEGATIVE') {
          // For negated search terms — check if the account CPL changed after the date of the change
          // We compare account CPL the week before vs the 14 days after
          var afterStart = _formatDate(changeTimestamp);
          var afterEnd = _formatDate(checkDate);
          var beforeEnd = _formatDate(changeTimestamp);
          var beforeStartD = new Date(changeTimestamp);
          beforeStartD.setDate(beforeStartD.getDate() - 14);
          var beforeStart = _formatDate(beforeStartD);

          var afterQuery = 'SELECT metrics.conversions, metrics.cost_micros, campaign.status FROM campaign ' +
            'WHERE campaign.status = "ENABLED" AND segments.date BETWEEN "' + afterStart + '" AND "' + afterEnd + '"';
          var beforeQuery = 'SELECT metrics.conversions, metrics.cost_micros, campaign.status FROM campaign ' +
            'WHERE campaign.status = "ENABLED" AND segments.date BETWEEN "' + beforeStart + '" AND "' + beforeEnd + '"';

          var afterConv = 0, afterCost = 0, beforeConv = 0, beforeCost = 0;
          var s1 = AdsApp.search(afterQuery);
          while (s1.hasNext()) { var r1 = s1.next(); afterConv += Number(r1.metrics.conversions) || 0; afterCost += Number(r1.metrics.costMicros) / 1000000; }
          var s2 = AdsApp.search(beforeQuery);
          while (s2.hasNext()) { var r2 = s2.next(); beforeConv += Number(r2.metrics.conversions) || 0; beforeCost += Number(r2.metrics.costMicros) / 1000000; }

          var beforeCpl = beforeConv > 0 ? beforeCost / beforeConv : 0;
          var afterCpl = afterConv > 0 ? afterCost / afterConv : 0;

          if (beforeCpl > 0 && afterCpl > 0) {
            var cplChange = ((afterCpl - beforeCpl) / beforeCpl) * 100;
            if (cplChange < -5) {
              outcome = 'CORRECT';
              outcomeNotes = 'CPL improved ' + Math.abs(cplChange).toFixed(1) + '% after negative. Before: R' + beforeCpl.toFixed(0) + ' After: R' + afterCpl.toFixed(0);
            } else if (cplChange > 10) {
              outcome = 'INCORRECT';
              outcomeNotes = 'CPL worsened ' + cplChange.toFixed(1) + '% after negative. May have blocked converting traffic.';
            } else {
              outcome = 'NEUTRAL';
              outcomeNotes = 'CPL change within noise range (' + cplChange.toFixed(1) + '%). Insufficient signal.';
            }
          } else {
            outcome = 'NEUTRAL';
            outcomeNotes = 'Insufficient conversion data to score outcome.';
          }
        }

        else if (entityType === 'NGRAM_NEGATIVE') {
          // Same CPL comparison approach as search term negatives
          outcome = 'NEUTRAL';
          outcomeNotes = 'N-gram negative — CPL trend monitoring requires more data.';
        }

        else if (entityType === 'DEVICE_BID') {
          outcome = 'NEUTRAL';
          outcomeNotes = 'Device bid adjustment — scoring requires segmented CVR comparison.';
        }

      } catch (innerE) {
        outcome = 'NEUTRAL';
        outcomeNotes = 'Error during outcome check: ' + innerE.message;
      }

      // Write outcome back to sheet
      var sheetRow = r + 1; // +1 because sheet rows are 1-indexed, data[0] is header
      sheet.getRange(sheetRow, colIdx['outcome'] + 1).setValue(outcome);
      sheet.getRange(sheetRow, colIdx['outcome_checked_date'] + 1).setValue(_formatDatetime(checkDate));
      sheet.getRange(sheetRow, colIdx['outcome_notes'] + 1).setValue(outcomeNotes);

      _log('INFO', 'Outcome backfill: "' + entity + '" -> ' + outcome);
      rowsChecked++;

      if (rowsChecked >= 50) break; // Cap per run to avoid timeout
    }

    _log('INFO', 'Outcome backfill complete. Rows checked: ' + rowsChecked);

  } catch (e) {
    _log('ERROR', 'backfillOutcomes: ' + e.message);
  }
}


// ============================================
// WEEKLY CLAUDE REVIEW (runs on Sunday)
// ============================================

/**
 * Reads the last 90 days of change log data for this account,
 * sends the change history + outcomes to Claude for analysis,
 * receives a structured JSON review with health score, recommendations,
 * and threshold suggestions, and emails a clean summary.
 */
function _weeklyClaudeReview() {
  var today = new Date();
  var dayOfWeek = today.getDay(); // 0 = Sunday
  if (dayOfWeek !== 0) {
    _log('INFO', 'Weekly review skipped — not Sunday (day=' + dayOfWeek + ')');
    return;
  }

  _log('INFO', 'Sunday detected — running weekly Claude self-improvement review...');

  if (!CONFIG.ANTHROPIC_API_KEY) {
    _log('ERROR', 'No ANTHROPIC_API_KEY in CONFIG — weekly review skipped');
    return;
  }

  if (!CONFIG.MASTER_SHEET_ID) {
    _log('ERROR', 'No MASTER_SHEET_ID in CONFIG — weekly review skipped');
    return;
  }

  // === 1. Load change log data (last 90 days, this account) ===
  var changeLogSummary = _buildChangeLogSummary();
  if (!changeLogSummary) {
    _log('WARN', 'No change log data available for weekly review');
    return;
  }

  // === 2. Build the prompt for Claude ===
  var accountName = AdsApp.currentAccount().getName();
  var prompt = _buildClaudeReviewPrompt(accountName, changeLogSummary);

  // === 3. Call Claude API ===
  _log('INFO', 'Calling Claude API for weekly review...');
  var claudeResponse = _callClaudeAPI(prompt);

  if (!claudeResponse) {
    _log('ERROR', 'Claude API returned no response — weekly review skipped');
    return;
  }

  // === 5. Send the report email ===
  _sendWeeklyReviewEmail(accountName, claudeResponse, changeLogSummary);
  _log('INFO', 'Weekly Claude review complete and emailed.');
}

/**
 * Reads the change log sheet and builds a structured summary
 * of the last 90 days of changes + outcomes for this account.
 */
function _buildChangeLogSummary() {
  var sheet = _getChangeLogSheet();
  if (!sheet) return null;

  try {
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return 'No change history found.';

    var headers = data[0];
    var colIdx = {};
    headers.forEach(function(h, i) { colIdx[h] = i; });

    var accountName = AdsApp.currentAccount().getName();
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    var rows = [];
    var stats = {
      total: 0, correct: 0, incorrect: 0, neutral: 0, pending: 0,
      byFunction: {}
    };

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      if (row[colIdx['account_name']] !== accountName) continue;
      var ts = new Date(row[colIdx['timestamp']]);
      if (ts < cutoff) continue;

      var fn = row[colIdx['function_name']] || 'unknown';
      var outcome = row[colIdx['outcome']] || 'PENDING';

      stats.total++;
      if (outcome === 'CORRECT') stats.correct++;
      else if (outcome === 'INCORRECT') stats.incorrect++;
      else if (outcome === 'NEUTRAL') stats.neutral++;
      else stats.pending++;

      if (!stats.byFunction[fn]) stats.byFunction[fn] = { total: 0, correct: 0, incorrect: 0, neutral: 0 };
      stats.byFunction[fn].total++;
      if (outcome === 'CORRECT') stats.byFunction[fn].correct++;
      else if (outcome === 'INCORRECT') stats.byFunction[fn].incorrect++;
      else if (outcome === 'NEUTRAL') stats.byFunction[fn].neutral++;

      // Only include rows with scored outcomes in the detail
      if (outcome !== 'PENDING') {
        rows.push({
          timestamp: row[colIdx['timestamp']],
          function: fn,
          entity: row[colIdx['entity']],
          entityType: row[colIdx['entity_type']],
          campaign: row[colIdx['campaign']],
          reason: row[colIdx['reason']],
          spend: row[colIdx['spend_at_change']],
          outcome: outcome,
          outcomeNotes: row[colIdx['outcome_notes']]
        });
      }
    }

    var summary = '=== CHANGE LOG SUMMARY (Last 90 days) ===\n';
    summary += 'Account: ' + accountName + '\n';
    summary += 'Total changes: ' + stats.total + '\n';
    summary += 'Correct: ' + stats.correct + ' | Incorrect: ' + stats.incorrect + ' | Neutral: ' + stats.neutral + ' | Pending: ' + stats.pending + '\n';

    var accuracy = stats.correct + stats.incorrect > 0
      ? ((stats.correct / (stats.correct + stats.incorrect)) * 100).toFixed(1)
      : 'N/A';
    summary += 'Decision accuracy (excl. neutral): ' + accuracy + '%\n\n';

    summary += '=== BY FUNCTION ===\n';
    for (var fn in stats.byFunction) {
      var f = stats.byFunction[fn];
      var fnAccuracy = f.correct + f.incorrect > 0
        ? ((f.correct / (f.correct + f.incorrect)) * 100).toFixed(0) + '%'
        : 'N/A';
      summary += fn + ': ' + f.total + ' changes | accuracy=' + fnAccuracy + ' (correct=' + f.correct + ' incorrect=' + f.incorrect + ')\n';
    }

    summary += '\n=== INCORRECT DECISIONS (for code review) ===\n';
    var incorrectRows = rows.filter(function(r) { return r.outcome === 'INCORRECT'; });
    if (incorrectRows.length === 0) {
      summary += 'None found in this period.\n';
    } else {
      incorrectRows.slice(0, 30).forEach(function(r) {
        summary += '- [' + r.function + '] "' + r.entity + '" (' + r.entityType + ') | Campaign: ' + r.campaign + '\n';
        summary += '  Reason for change: ' + r.reason + '\n';
        summary += '  Outcome notes: ' + r.outcomeNotes + '\n';
      });
    }

    summary += '\n=== SAMPLE CORRECT DECISIONS ===\n';
    var correctRows = rows.filter(function(r) { return r.outcome === 'CORRECT'; });
    correctRows.slice(0, 15).forEach(function(r) {
      summary += '- [' + r.function + '] "' + r.entity + '" | ' + r.outcomeNotes + '\n';
    });

    return summary;

  } catch (e) {
    _log('ERROR', 'buildChangeLogSummary: ' + e.message);
    return null;
  }
}

/**
 * Builds the prompt sent to Claude for the weekly review.
 * v4.5.0: Asks for structured JSON output — concise recommendations, not a full rewritten script.
 */
function _buildClaudeReviewPrompt(accountName, changeLogSummary) {
  var prompt = 'You are a senior Google Ads strategist reviewing an automated optimization script\'s recent decisions.\n';
  prompt += 'Your job is to analyze the decision history and provide concise, actionable insights.\n\n';

  prompt += '=== CONTEXT ===\n';
  prompt += 'Account: ' + accountName + '\n';
  prompt += 'Script: Syte Optimization Core — runs every 3 days to pause waste keywords, ';
  prompt += 'negative bad search terms, adjust device/schedule/geo bids, and promote winners.\n\n';

  if (CLIENT_CONTEXT) {
    prompt += '=== BUSINESS CONTEXT ===\n';
    prompt += CLIENT_CONTEXT + '\n\n';
  }

  prompt += changeLogSummary + '\n\n';

  prompt += '=== YOUR TASK ===\n';
  prompt += 'Return ONLY a JSON object (no markdown, no code fences) with this structure:\n\n';
  prompt += '{\n';
  prompt += '  "health_score": 1-10 (overall optimization health),\n';
  prompt += '  "health_label": "Healthy" | "Needs Attention" | "At Risk",\n';
  prompt += '  "one_liner": "One sentence summary of how the script is performing",\n';
  prompt += '  "incorrect_decisions": [\n';
  prompt += '    { "term": "the keyword or search term", "what_happened": "brief description", "fix": "what should change" }\n';
  prompt += '  ],\n';
  prompt += '  "recommendations": [\n';
  prompt += '    { "priority": "high" | "medium" | "low", "title": "Short title", "detail": "1-2 sentence explanation" }\n';
  prompt += '  ],\n';
  prompt += '  "threshold_suggestions": [\n';
  prompt += '    { "setting": "CONFIG.SETTING_NAME", "current": "current value or description", "suggested": "new value", "reason": "why" }\n';
  prompt += '  ],\n';
  prompt += '  "patterns_noticed": "2-3 sentences about patterns in the data (e.g. most negations are informational, geo bids heavily favour one region, etc.)"\n';
  prompt += '}\n\n';

  prompt += 'RULES:\n';
  prompt += '- Keep it concise — this goes into a summary email for an agency owner, not a developer.\n';
  prompt += '- Maximum 5 recommendations, ranked by impact.\n';
  prompt += '- Maximum 3 threshold suggestions.\n';
  prompt += '- If all changes are PENDING (no outcomes yet), say so and focus recommendations on data collection.\n';
  prompt += '- Do NOT include a rewritten script. Only actionable recommendations.\n';
  prompt += '- Return ONLY valid JSON.\n';

  return prompt;
}

/**
 * Calls the Anthropic Claude API and returns the text response.
 * v4.5.0: Uses Haiku for weekly review (structured JSON output, no script rewrite).
 */
function _callClaudeAPI(prompt) {
  try {
    var payload = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    };

    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': CONFIG.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
    var code = response.getResponseCode();

    if (code !== 200) {
      _log('ERROR', 'Claude API error ' + code + ': ' + response.getContentText().substring(0, 300));
      return null;
    }

    var json = JSON.parse(response.getContentText());
    if (json.content && json.content[0] && json.content[0].text) {
      return json.content[0].text;
    }

    _log('ERROR', 'Unexpected Claude API response structure');
    return null;

  } catch (e) {
    _log('ERROR', 'callClaudeAPI: ' + e.message);
    return null;
  }
}

/**
 * Sends the weekly self-improvement report.
 * v4.5.0: Clean, simple summary — no raw data dumps or rewritten scripts.
 */
function _sendWeeklyReviewEmail(accountName, claudeResponse, changeLogSummary) {
  var today = Utilities.formatDate(new Date(), AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
  var recipients = CONFIG.EMAIL_ADDRESSES || [CONFIG.EMAIL_RECIPIENT || 'michaelh@syte.co.za'];
  if (typeof recipients === 'string') recipients = [recipients];

  // Parse Claude's structured JSON response
  var review = {};
  try {
    var cleaned = claudeResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    review = JSON.parse(cleaned);
  } catch (e) {
    _log('WARN', 'Could not parse weekly review JSON — sending raw fallback');
    review = {
      health_score: 0,
      health_label: 'Unknown',
      one_liner: 'Could not parse AI response. Raw response included below.',
      recommendations: [],
      incorrect_decisions: [],
      threshold_suggestions: [],
      patterns_noticed: claudeResponse.substring(0, 500)
    };
  }

  var score = review.health_score || 0;
  var label = review.health_label || 'Unknown';
  var oneLiner = review.one_liner || '';
  var recommendations = review.recommendations || [];
  var incorrects = review.incorrect_decisions || [];
  var thresholds = review.threshold_suggestions || [];
  var patterns = review.patterns_noticed || '';

  // Score-based colours
  var scoreColor = score >= 7 ? '#2e7d32' : (score >= 4 ? '#e65100' : '#c62828');
  var scoreBg = score >= 7 ? '#e8f5e9' : (score >= 4 ? '#fff3e0' : '#ffebee');

  // === Extract stats from changeLogSummary for the compact banner ===
  var totalMatch = changeLogSummary.match(/Total changes:\s*(\d+)/);
  var correctMatch = changeLogSummary.match(/Correct:\s*(\d+)/);
  var incorrectMatch = changeLogSummary.match(/Incorrect:\s*(\d+)/);
  var pendingMatch = changeLogSummary.match(/Pending:\s*(\d+)/);
  var totalChanges = totalMatch ? totalMatch[1] : '0';
  var correctCount = correctMatch ? correctMatch[1] : '0';
  var incorrectCount = incorrectMatch ? incorrectMatch[1] : '0';
  var pendingCount = pendingMatch ? pendingMatch[1] : '0';

  // Build HTML email
  var email = '<html><body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#333;">';

  // Header
  email += '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;padding:20px 24px;border-radius:8px 8px 0 0;">';
  email += '<h1 style="margin:0;font-size:20px;">Weekly Optimization Review</h1>';
  email += '<p style="margin:4px 0 0;opacity:0.7;font-size:13px;">' + accountName + ' | ' + today + ' | Core v4.5.0</p>';
  email += '</div>';

  // Health score card
  email += '<div style="background:' + scoreBg + ';padding:16px 24px;border-left:4px solid ' + scoreColor + ';">';
  email += '<div style="display:inline-block;width:60px;height:60px;border-radius:50%;background:' + scoreColor + ';color:white;text-align:center;line-height:60px;font-size:24px;font-weight:bold;vertical-align:middle;">' + score + '</div>';
  email += '<div style="display:inline-block;vertical-align:middle;margin-left:16px;">';
  email += '<div style="font-size:18px;font-weight:bold;color:' + scoreColor + ';">' + label + '</div>';
  email += '<div style="font-size:13px;color:#555;margin-top:2px;">' + oneLiner + '</div>';
  email += '</div></div>';

  // Stats row
  email += '<div style="display:flex;padding:12px 24px;background:#f5f5f5;font-size:13px;">';
  email += '<div style="flex:1;text-align:center;"><strong>' + totalChanges + '</strong><br><span style="color:#999;">Changes (90d)</span></div>';
  email += '<div style="flex:1;text-align:center;"><strong style="color:#2e7d32;">' + correctCount + '</strong><br><span style="color:#999;">Correct</span></div>';
  email += '<div style="flex:1;text-align:center;"><strong style="color:#c62828;">' + incorrectCount + '</strong><br><span style="color:#999;">Incorrect</span></div>';
  email += '<div style="flex:1;text-align:center;"><strong style="color:#e65100;">' + pendingCount + '</strong><br><span style="color:#999;">Pending</span></div>';
  email += '</div>';

  // Incorrect decisions (if any)
  if (incorrects.length > 0) {
    email += '<div style="padding:16px 24px;">';
    email += '<h2 style="font-size:16px;margin:0 0 10px;color:#c62828;">Mistakes Found</h2>';
    for (var i = 0; i < incorrects.length; i++) {
      var inc = incorrects[i];
      email += '<div style="background:#ffebee;padding:10px 14px;border-radius:6px;margin:6px 0;font-size:13px;">';
      email += '<strong>"' + (inc.term || '') + '"</strong> — ' + (inc.what_happened || '');
      email += '<br><span style="color:#2e7d32;">Fix: ' + (inc.fix || '') + '</span>';
      email += '</div>';
    }
    email += '</div>';
  }

  // Recommendations
  if (recommendations.length > 0) {
    email += '<div style="padding:16px 24px;">';
    email += '<h2 style="font-size:16px;margin:0 0 10px;color:#1565c0;">Recommendations</h2>';
    var priorityColors = { high: '#c62828', medium: '#e65100', low: '#1565c0' };
    for (var r = 0; r < recommendations.length; r++) {
      var rec = recommendations[r];
      var pColor = priorityColors[rec.priority] || '#666';
      email += '<div style="padding:10px 14px;border-left:3px solid ' + pColor + ';background:#f8f9fa;margin:6px 0;border-radius:0 6px 6px 0;font-size:13px;">';
      email += '<span style="display:inline-block;padding:1px 8px;border-radius:10px;background:' + pColor + ';color:white;font-size:10px;font-weight:600;text-transform:uppercase;vertical-align:middle;">' + (rec.priority || 'info') + '</span> ';
      email += '<strong>' + (rec.title || '') + '</strong>';
      email += '<br><span style="color:#555;">' + (rec.detail || '') + '</span>';
      email += '</div>';
    }
    email += '</div>';
  }

  // Threshold suggestions
  if (thresholds.length > 0) {
    email += '<div style="padding:16px 24px;">';
    email += '<h2 style="font-size:16px;margin:0 0 10px;color:#6a1b9a;">Suggested Setting Changes</h2>';
    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    email += '<tr style="background:#f3e5f5;"><th style="padding:6px 8px;text-align:left;">Setting</th><th style="padding:6px 8px;">Current</th><th style="padding:6px 8px;">Suggested</th><th style="padding:6px 8px;text-align:left;">Why</th></tr>';
    for (var t = 0; t < thresholds.length; t++) {
      var th = thresholds[t];
      email += '<tr style="border-bottom:1px solid #eee;">';
      email += '<td style="padding:6px 8px;font-family:monospace;font-size:11px;">' + (th.setting || '') + '</td>';
      email += '<td style="padding:6px 8px;text-align:center;">' + (th.current || '') + '</td>';
      email += '<td style="padding:6px 8px;text-align:center;font-weight:bold;">' + (th.suggested || '') + '</td>';
      email += '<td style="padding:6px 8px;color:#555;">' + (th.reason || '') + '</td>';
      email += '</tr>';
    }
    email += '</table></div>';
  }

  // Patterns noticed
  if (patterns) {
    email += '<div style="padding:16px 24px;">';
    email += '<h2 style="font-size:16px;margin:0 0 10px;color:#333;">Patterns Noticed</h2>';
    email += '<div style="background:#f5f5f5;padding:12px 14px;border-radius:6px;font-size:13px;color:#555;line-height:1.6;">' + patterns + '</div>';
    email += '</div>';
  }

  // Informational note — nothing to approve
  email += '<div style="padding:12px 24px;background:#f5f5f5;margin-top:8px;">';
  email += '<p style="margin:0;font-size:12px;color:#999;text-align:center;">This is an informational report — no action required. Recommendations will be reviewed by the Syte team.</p>';
  email += '</div>';

  email += '<div style="padding:14px;color:#999;font-size:11px;text-align:center;">';
  email += 'Syte Digital Agency | Weekly Review | syte.co.za';
  email += '</div>';
  email += '</body></html>';

  MailApp.sendEmail({
    to: recipients.join(','),
    subject: 'Weekly Optimization Review | ' + accountName + ' | ' + label + ' (' + score + '/10)',
    htmlBody: email
  });
}


// ============================================
// WINNER PROMOTION — WITH AD COPY FIX
// ============================================

function _createExactMatchWinner(searchTerm, campaignName, sourceAdGroupName) {
  try {
    var ci = AdsApp.campaigns().withCondition('campaign.name = "' + campaignName + '"').get();
    if (!ci.hasNext()) { _log('WARN', 'Campaign not found: ' + campaignName); return false; }
    var campaign = ci.next();

    var winnersAdGroupName = CONFIG.EXACT_WINNERS_AD_GROUP_NAME || '[Exact Winners]';
    var exactAdGroup = null;
    var agi = campaign.adGroups().withCondition('ad_group.name = "' + winnersAdGroupName + '"').get();

    if (agi.hasNext()) {
      exactAdGroup = agi.next();
    } else {
      var result = campaign.newAdGroupBuilder().withName(winnersAdGroupName).withStatus('ENABLED').build();
      if (result.isSuccessful()) {
        exactAdGroup = result.getResult();
        _log('INFO', 'Created ad group: "' + winnersAdGroupName + '" in "' + campaignName + '"');
        _copyAdsToAdGroup(campaignName, sourceAdGroupName, exactAdGroup);
      } else { _log('ERROR', 'Failed to create ad group: ' + winnersAdGroupName); return false; }
    }

    if (!exactAdGroup) return false;

    var existingKw = exactAdGroup.keywords()
      .withCondition('ad_group_criterion.keyword.text = "' + searchTerm + '"')
      .withCondition('ad_group_criterion.keyword.match_type = "EXACT"').get();
    if (existingKw.hasNext()) { _log('DEBUG', 'Exact match already exists: [' + searchTerm + ']'); return false; }

    var finalUrl = _getAdGroupFinalUrl(campaignName, sourceAdGroupName);
    var kwBuilder = exactAdGroup.newKeywordBuilder().withText('[' + searchTerm + ']');
    if (finalUrl) kwBuilder = kwBuilder.withFinalUrl(finalUrl);
    kwBuilder.build();
    _log('INFO', '  Added exact match: [' + searchTerm + ']');

    var sourceAgi = campaign.adGroups().withCondition('ad_group.name = "' + sourceAdGroupName + '"').get();
    if (sourceAgi.hasNext()) {
      sourceAgi.next().createNegativeKeyword('[' + searchTerm + ']');
      _log('INFO', '  Added negative in source: "' + sourceAdGroupName + '"');
    }

    return true;
  } catch (e) { _log('ERROR', 'createExactMatchWinner error: ' + e.message); return false; }
}

function _copyAdsToAdGroup(campaignName, sourceAdGroupName, targetAdGroup) {
  try {
    var adIterator = AdsApp.ads()
      .withCondition('campaign.name = "' + campaignName + '"')
      .withCondition('ad_group.name = "' + sourceAdGroupName + '"')
      .withCondition('ad_group_ad.status = ENABLED').get();
    var adsCopied = 0;
    while (adIterator.hasNext()) {
      var ad = adIterator.next();
      if (ad.getType() === 'RESPONSIVE_SEARCH_AD') {
        var rsa = ad.asType().responsiveSearchAd();
        var headlines = rsa.getHeadlines().map(function(h) { return { text: h.text, pinning: h.pinnedField || undefined }; });
        var descriptions = rsa.getDescriptions().map(function(d) { return { text: d.text, pinning: d.pinnedField || undefined }; });
        targetAdGroup.newAd().responsiveSearchAdBuilder()
          .withHeadlines(headlines).withDescriptions(descriptions)
          .withFinalUrl(ad.urls().getFinalUrl()).build();
        adsCopied++;
      }
    }
    if (adsCopied > 0) { _log('INFO', '  Copied ' + adsCopied + ' RSA(s) from "' + sourceAdGroupName + '" to [Exact Winners]'); }
    else { _log('WARN', '  No enabled RSAs found in "' + sourceAdGroupName + '" — ads still needed!'); }
  } catch (e) { _log('WARN', 'copyAds error: ' + e.message); }
}

function _getAdGroupFinalUrl(campaignName, adGroupName) {
  try {
    var ai = AdsApp.ads()
      .withCondition('campaign.name = "' + campaignName + '"')
      .withCondition('ad_group.name = "' + adGroupName + '"')
      .withCondition('ad_group_ad.status = ENABLED').withLimit(1).get();
    if (ai.hasNext()) return ai.next().urls().getFinalUrl();
  } catch (e) { /* silent */ }
  return '';
}


// ============================================
// LEAD GEN TASKS
// ============================================

function _pauseHighSpendKeywords_LeadGen(results) {
  var dr = _getDateRange(); var changeCount = 0;
  var minImpressions = CONFIG.KEYWORD_PAUSE_MIN_IMPRESSIONS || 100;
  var query = 'SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, campaign.name, ad_group.name, metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.ctr, metrics.impressions, campaign.status, ad_group.status, ad_group_criterion.status, campaign.advertising_channel_type FROM keyword_view WHERE metrics.cost_micros > ' + (CONFIG.KEYWORD_SPEND_THRESHOLD * 1000000) + ' AND metrics.conversions < 1 AND campaign.status = "ENABLED" AND ad_group.status = "ENABLED" AND ad_group_criterion.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date BETWEEN "' + _getDateRange().startDate + '" AND "' + _getDateRange().endDate + '"';
  try {
    var search = AdsApp.search(query);
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var kw = row.adGroupCriterion.keyword.text;
      var cn = row.campaign.name, agn = row.adGroup.name;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var ctr = Number(row.metrics.ctr) * 100;
      var impressions = Number(row.metrics.impressions) || 0;
      if (_isProtectedTerm(kw)) continue;
      // v4.1.2: Never pause active keywords
      if (_isActiveKeyword(kw)) {
        _log('INFO', 'SKIP (active keyword): "' + kw + '" — would have been paused');
        continue;
      }
      // v4.1.2: Require minimum impressions before pausing
      if (impressions < minImpressions) {
        _log('INFO', 'SKIP (insufficient data): "' + kw + '" — only ' + impressions + ' impressions (min: ' + minImpressions + ')');
        continue;
      }
      // v4.1.2: Never pause keywords with historical conversions in last 90 days
      if (_hasHistoricalConversions(kw, cn, agn)) {
        _log('INFO', 'SKIP (historical converter): "' + kw + '" — has conversions in last 90 days');
        continue;
      }
      if (ctr > CONFIG.MIN_CTR_TO_PROTECT && !_isInformational(kw)) continue;
      var reason = 'Spend R' + cost.toFixed(0) + ' | 0 conv | CTR ' + ctr.toFixed(1) + '%';
      _log('INFO', 'PAUSE: "' + kw + '" | ' + reason);
      results.keywordsPaused.push({ keyword: kw, campaign: cn, adGroup: agn, spend: cost });

      // LOG CHANGE
      _logChange({ functionName: '_pauseHighSpendKeywords_LeadGen', entity: kw, entityType: 'KEYWORD', campaign: cn, adGroup: agn, reason: reason, spend: cost, conversions: 0 });

      if (!CONFIG.PREVIEW_MODE) {
        var ki = AdsApp.keywords().withCondition('ad_group.name = "' + agn + '"').withCondition('campaign.name = "' + cn + '"').withCondition('ad_group_criterion.keyword.text = "' + kw + '"').get();
        while (ki.hasNext()) ki.next().pause();
      }
      changeCount++;
    }
  } catch (e) { _log('ERROR', 'pauseHighSpendKeywords_LeadGen: ' + e.message); results.errors.push(e.message); }
  _log('INFO', 'Lead gen keywords paused: ' + results.keywordsPaused.length);
}

// v4.3.0: _negativeHighSpendSearchTerms_LeadGen REMOVED — all negation now through AI in _smartSearchTermReview

function _promoteWinners_LeadGen(results) {
  var dr = _getDateRange();
  var query = 'SELECT search_term_view.search_term, campaign.name, ad_group.name, metrics.conversions, metrics.clicks, metrics.cost_micros, campaign.status, campaign.advertising_channel_type FROM search_term_view WHERE metrics.conversions > ' + (CONFIG.PROMOTION_MIN_CONVERSIONS - 1) + ' AND metrics.clicks > ' + ((CONFIG.PROMOTION_MIN_CLICKS || 10) - 1) + ' AND campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
  try {
    var search = AdsApp.search(query); var processed = {};
    while (search.hasNext()) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      if (processed[st] || _isProtectedTerm(st)) continue;
      processed[st] = true;
      var conv = Number(row.metrics.conversions), clicks = Number(row.metrics.clicks);
      var cvr = (conv / clicks) * 100, cost = Number(row.metrics.costMicros) / 1000000;
      if (cvr < CONFIG.PROMOTION_MIN_CONVERSION_RATE) continue;
      _log('INFO', 'WINNER: "' + st + '" | CVR: ' + cvr.toFixed(1) + '% | Conv: ' + conv);
      results.winnersPromoted.push({ searchTerm: st, campaign: row.campaign.name, adGroup: row.adGroup.name, conversions: conv, cvr: cvr });

      // LOG CHANGE
      _logChange({ functionName: '_promoteWinners_LeadGen', entity: st, entityType: 'EXACT_MATCH_PROMOTION', campaign: row.campaign.name, adGroup: row.adGroup.name, reason: 'CVR ' + cvr.toFixed(1) + '% | Conv: ' + conv, spend: cost, conversions: conv });

      if (!CONFIG.PREVIEW_MODE) _createExactMatchWinner(st, row.campaign.name, row.adGroup.name);
    }
  } catch (e) { _log('ERROR', 'promoteWinners_LeadGen: ' + e.message); results.errors.push(e.message); }
  _log('INFO', 'Lead gen winners: ' + results.winnersPromoted.length);
}


// ============================================
// ECOMMERCE TASKS
// ============================================

function _pauseHighSpendKeywords_Ecommerce(results) {
  var dr = _getDateRange(); var changeCount = 0;
  var minImpressions = CONFIG.KEYWORD_PAUSE_MIN_IMPRESSIONS || 100;
  var query = 'SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, campaign.name, ad_group.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, metrics.impressions, campaign.status, ad_group.status, ad_group_criterion.status, campaign.advertising_channel_type FROM keyword_view WHERE metrics.cost_micros > ' + (CONFIG.ECOM_KEYWORD_SPEND_THRESHOLD * 1000000) + ' AND campaign.status = "ENABLED" AND ad_group.status = "ENABLED" AND ad_group_criterion.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
  try {
    var search = AdsApp.search(query);
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var kw = row.adGroupCriterion.keyword.text;
      var cn = row.campaign.name, agn = row.adGroup.name;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var revenue = Number(row.metrics.conversionsValue) || 0;
      var roas = _calculateROAS(revenue, cost);
      var impressions = Number(row.metrics.impressions) || 0;
      if (_isProtectedTerm(kw)) continue;
      // v4.1.2: Never pause active keywords
      if (_isActiveKeyword(kw)) {
        _log('INFO', 'SKIP (active keyword): "' + kw + '" — would have been paused');
        continue;
      }
      // v4.1.2: Require minimum impressions
      if (impressions < minImpressions) {
        _log('INFO', 'SKIP (insufficient data): "' + kw + '" — only ' + impressions + ' impressions (min: ' + minImpressions + ')');
        continue;
      }
      // v4.1.2: Never pause keywords with historical conversions
      if (_hasHistoricalConversions(kw, cn, agn)) {
        _log('INFO', 'SKIP (historical converter): "' + kw + '" — has conversions in last 90 days');
        continue;
      }
      if (roas >= CONFIG.MIN_ROAS_TO_KEEP) continue;
      if (revenue > CONFIG.ECOM_KEYWORD_SPEND_THRESHOLD * 0.5) continue;
      var reason = 'ROAS ' + roas.toFixed(2) + 'x | Spend R' + cost.toFixed(0);
      _log('INFO', 'ECOM PAUSE: "' + kw + '" | ' + reason);
      results.ecomKeywordsPaused.push({ keyword: kw, campaign: cn, adGroup: agn, spend: cost, revenue: revenue, roas: roas });

      // LOG CHANGE
      _logChange({ functionName: '_pauseHighSpendKeywords_Ecommerce', entity: kw, entityType: 'KEYWORD', campaign: cn, adGroup: agn, reason: reason, spend: cost, conversions: revenue });

      if (!CONFIG.PREVIEW_MODE) {
        var ki = AdsApp.keywords().withCondition('ad_group.name = "' + agn + '"').withCondition('campaign.name = "' + cn + '"').withCondition('ad_group_criterion.keyword.text = "' + kw + '"').get();
        while (ki.hasNext()) ki.next().pause();
      }
      changeCount++;
    }
  } catch (e) { _log('ERROR', 'pauseHighSpendKeywords_Ecommerce: ' + e.message); results.errors.push(e.message); }
}

// v4.3.0: _negativeHighSpendSearchTerms_Ecommerce REMOVED — all negation now through AI in _smartSearchTermReview

function _promoteWinners_Ecommerce(results) {
  var dr = _getDateRange();
  var query = 'SELECT search_term_view.search_term, campaign.name, ad_group.name, metrics.conversions, metrics.conversions_value, metrics.clicks, metrics.cost_micros, campaign.status, campaign.advertising_channel_type FROM search_term_view WHERE metrics.conversions > ' + ((CONFIG.ECOM_PROMOTION_MIN_CONVERSIONS || 2) - 1) + ' AND campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
  try {
    var search = AdsApp.search(query); var processed = {};
    while (search.hasNext()) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      if (processed[st] || _isProtectedTerm(st)) continue;
      processed[st] = true;
      var revenue = Number(row.metrics.conversionsValue) || 0;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var roas = _calculateROAS(revenue, cost);
      if (revenue < (CONFIG.ECOM_PROMOTION_MIN_REVENUE || 500) || roas < (CONFIG.ECOM_PROMOTION_MIN_ROAS || 3.0)) continue;
      _log('INFO', 'ECOM WINNER: "' + st + '" | ROAS: ' + roas.toFixed(2) + 'x | Rev: R' + revenue.toFixed(0));
      results.ecomWinnersPromoted.push({ searchTerm: st, campaign: row.campaign.name, adGroup: row.adGroup.name, revenue: revenue, roas: roas, spend: cost });

      // LOG CHANGE
      _logChange({ functionName: '_promoteWinners_Ecommerce', entity: st, entityType: 'EXACT_MATCH_PROMOTION', campaign: row.campaign.name, adGroup: row.adGroup.name, reason: 'ROAS ' + roas.toFixed(2) + 'x | Rev R' + revenue.toFixed(0), spend: cost, conversions: revenue });

      if (!CONFIG.PREVIEW_MODE) _createExactMatchWinner(st, row.campaign.name, row.adGroup.name);
    }
  } catch (e) { _log('ERROR', 'promoteWinners_Ecommerce: ' + e.message); results.errors.push(e.message); }
}


// ============================================
// SHOPPING TASKS
// ============================================

function _analyzeShoppingProducts(results) {
  var dr = _getDateRange();
  var query = 'SELECT segments.product_item_id, segments.product_title, campaign.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, campaign.status FROM shopping_performance_view WHERE campaign.status = "ENABLED" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
  try {
    var search = AdsApp.search(query); var products = {};
    while (search.hasNext()) {
      var row = search.next();
      var pid = row.segments.productItemId || 'unknown';
      var cost = Number(row.metrics.costMicros) / 1000000;
      var revenue = Number(row.metrics.conversionsValue) || 0;
      var conv = Number(row.metrics.conversions) || 0;
      var clicks = Number(row.metrics.clicks) || 0;
      if (products[pid]) { products[pid].cost += cost; products[pid].revenue += revenue; products[pid].conversions += conv; products[pid].clicks += clicks; }
      else { products[pid] = { productId: pid, productTitle: row.segments.productTitle || 'Unknown', cost: cost, revenue: revenue, conversions: conv, clicks: clicks }; }
    }
    for (var pid in products) {
      var p = products[pid]; var roas = _calculateROAS(p.revenue, p.cost);
      if (p.cost > CONFIG.SHOPPING_PRODUCT_SPEND_THRESHOLD && roas < CONFIG.SHOPPING_MIN_ROAS_THRESHOLD) {
        results.shoppingLowROASProducts.push(Object.assign({}, p, { roas: roas }));
        if (p.revenue === 0) results.shoppingProductsPaused.push(Object.assign({}, p, { action: 'EXCLUDE' }));
      }
      if (roas >= CONFIG.SHOPPING_HERO_PRODUCT_ROAS && p.conversions >= CONFIG.SHOPPING_HERO_MIN_CONVERSIONS) {
        results.shoppingHeroProducts.push(Object.assign({}, p, { roas: roas }));
      }
    }
  } catch (e) { _log('ERROR', 'analyzeShoppingProducts: ' + e.message); results.errors.push(e.message); }
}

function _analyzeShoppingSearchTerms(results) {
  // v4.5.0: When the AI-powered smart review is active and has an API key,
  // it already covers Shopping search terms (irrelevant + borderline, last 7/30 days).
  // Skip this legacy threshold-only fallback to avoid duplicate negation.
  if (CONFIG.SMART_NEGATION !== false && CONFIG.ANTHROPIC_API_KEY) {
    _log('INFO', 'Shopping search terms handled by AI smart review — skipping legacy analyzer');
    return;
  }
  var changeCount = 0;
  var existing = _getExistingNegatives(_getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_SPEND));
  var query = 'SELECT search_term_view.search_term, campaign.name, metrics.cost_micros, metrics.conversions_value, campaign.status, campaign.advertising_channel_type FROM search_term_view WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SHOPPING" AND metrics.cost_micros > ' + (CONFIG.ECOM_SEARCH_TERM_SPEND_THRESHOLD * 1000000) + ' AND segments.date DURING LAST_30_DAYS';
  try {
    var search = AdsApp.search(query); var processed = {};
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      if (processed[st] || existing[st] || _isProtectedTerm(st)) continue;
      // v4.1.2: Never negative search terms that match active keywords
      if (_isActiveKeyword(st)) {
        _log('INFO', 'SKIP (active keyword): "' + st + '" — would have been negatived (Shopping)');
        continue;
      }
      processed[st] = true;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var revenue = Number(row.metrics.conversionsValue) || 0;
      if (_calculateROAS(revenue, cost) >= CONFIG.MIN_ROAS_TO_KEEP) continue;
      if (!CONFIG.PREVIEW_MODE) {
        var ci = AdsApp.shoppingCampaigns().withCondition('campaign.name = "' + row.campaign.name + '"').get();
        if (ci.hasNext()) ci.next().createNegativeKeyword('[' + st + ']');
      }
      changeCount++;
    }
  } catch (e) { _log('ERROR', 'analyzeShoppingSearchTerms: ' + e.message); results.errors.push(e.message); }
}


// ============================================
// PMAX TASKS
// ============================================

function _monitorPMaxCampaigns(results) {
  var dr = _getDateRange();
  var query = 'SELECT campaign.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, campaign_budget.amount_micros, campaign.status, campaign.advertising_channel_type FROM campaign WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "PERFORMANCE_MAX" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
  try {
    var search = AdsApp.search(query);
    while (search.hasNext()) {
      var row = search.next();
      var cn = row.campaign.name, cost = Number(row.metrics.costMicros) / 1000000;
      var revenue = Number(row.metrics.conversionsValue) || 0;
      var roas = _calculateROAS(revenue, cost);
      _log('INFO', 'PMax: "' + cn + '" | ROAS: ' + roas.toFixed(2) + 'x | Rev: R' + revenue.toFixed(0));
      if (cost > CONFIG.PMAX_ASSET_GROUP_SPEND_THRESHOLD && roas < CONFIG.PMAX_MIN_ROAS_THRESHOLD) {
        results.pmaxAlerts.push({ type: 'LOW_ROAS', campaign: cn, cost: cost, revenue: revenue, roas: roas, recommendation: roas < 1.0 ? 'Consider pausing' : 'Review asset groups and audiences' });
      }
    }
  } catch (e) { _log('ERROR', 'monitorPMaxCampaigns: ' + e.message); results.errors.push(e.message); }
}

function _analyzePMaxSearchTerms(results) {
  // v4.5.0: When the AI-powered smart review is active and has an API key,
  // it already covers PMax search terms (irrelevant + borderline, last 7/30 days)
  // and routes negations as campaign-level PMax negatives. Skip the legacy fallback.
  if (CONFIG.SMART_NEGATION !== false && CONFIG.ANTHROPIC_API_KEY) {
    _log('INFO', 'PMax search terms handled by AI smart review — skipping legacy analyzer');
    return;
  }
  var changeCount = 0;
  var query = 'SELECT search_term_view.search_term, campaign.name, metrics.cost_micros, metrics.conversions_value, campaign.status, campaign.advertising_channel_type FROM search_term_view WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "PERFORMANCE_MAX" AND segments.date DURING LAST_30_DAYS';
  try {
    var search = AdsApp.search(query); var processed = {};
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      if (processed[st] || _isProtectedTerm(st)) continue;
      // v4.1.2: Never negative search terms that match active keywords
      if (_isActiveKeyword(st)) {
        _log('INFO', 'SKIP (active keyword): "' + st + '" — would have been negatived (PMax)');
        continue;
      }
      processed[st] = true;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var revenue = Number(row.metrics.conversionsValue) || 0;
      var roas = _calculateROAS(revenue, cost);
      var isInfo = _isInformational(st);
      var isIrr = (CONFIG.IRRELEVANT_TERMS || []).some(function(t) { return st.indexOf(t.toLowerCase()) !== -1; });
      if (isInfo || isIrr || (cost > CONFIG.ECOM_SEARCH_TERM_SPEND_THRESHOLD && roas < CONFIG.MIN_ROAS_TO_KEEP)) {
        results.pmaxSearchTermsNegated.push({ searchTerm: st, campaign: row.campaign.name, spend: cost });
        if (!CONFIG.PREVIEW_MODE) {
          var nl = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_SPEND);
          if (nl) nl.addNegativeKeyword('[' + st + ']');
        }
        changeCount++;
      }
    }
  } catch (e) { _log('WARN', 'PMax search terms limited: ' + e.message); }
}

function _analyzePMaxAssetGroups(results) {
  var dr = _getDateRange();
  var query = 'SELECT asset_group.name, campaign.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value, campaign.status, campaign.advertising_channel_type FROM asset_group WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "PERFORMANCE_MAX" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
  try {
    var search = AdsApp.search(query);
    while (search.hasNext()) {
      var row = search.next();
      var cost = Number(row.metrics.costMicros) / 1000000;
      var revenue = Number(row.metrics.conversionsValue) || 0;
      var roas = _calculateROAS(revenue, cost);
      if (cost > CONFIG.PMAX_ASSET_GROUP_SPEND_THRESHOLD && roas < CONFIG.PMAX_MIN_ROAS_THRESHOLD) {
        results.pmaxAlerts.push({ type: 'ASSET_GROUP', campaign: row.campaign.name, assetGroup: row.assetGroup.name, cost: cost, revenue: revenue, roas: roas, recommendation: Number(row.metrics.conversions) === 0 ? 'Zero conversions - review audiences' : 'Low ROAS - review assets and feed' });
      }
    }
  } catch (e) { _log('WARN', 'PMax asset groups: ' + e.message); }
}


// v4.3.0: _blockInformationalTerms REMOVED — informational patterns now serve as AI hints in _smartSearchTermReview
// v4.3.0: _blockIrrelevantTerms REMOVED — irrelevant terms now serve as AI hints in _smartSearchTermReview

function _checkBudgetPacing(results) {
  var today = new Date(); var dom = today.getDate();
  var dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  var expectedPace = dom / dim;
  var query = 'SELECT metrics.cost_micros, campaign.status FROM campaign WHERE campaign.status = "ENABLED" AND segments.date DURING THIS_MONTH';
  try {
    var search = AdsApp.search(query); var totalSpend = 0;
    while (search.hasNext()) totalSpend += Number(search.next().metrics.costMicros) / 1000000;
    var paceRatio = totalSpend / CONFIG.MONTHLY_BUDGET;
    var projected = (totalSpend / dom) * dim;
    _log('INFO', 'Budget: R' + totalSpend.toFixed(0) + ' of R' + CONFIG.MONTHLY_BUDGET + ' (' + (paceRatio * 100).toFixed(1) + '%)');
    if (paceRatio > expectedPace * (1 + (CONFIG.BUDGET_ALERT_THRESHOLD || 0.7))) results.budgetAlerts.push({ type: 'OVERPACING', currentSpend: totalSpend, projected: projected });
    if (paceRatio < expectedPace * 0.5 && dom > 7) results.budgetAlerts.push({ type: 'UNDERPACING', currentSpend: totalSpend, projected: projected });
  } catch (e) { _log('ERROR', 'checkBudgetPacing: ' + e.message); results.errors.push(e.message); }
}


// ============================================
// AUTO-OPTIMIZE: DEVICE BID ADJUSTMENTS
// ============================================

function _autoAdjustDeviceBids(results) {
  var dr = _getDateRange();
  var query = 'SELECT campaign.name, campaign.id, segments.device, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, campaign.status, campaign.advertising_channel_type FROM campaign WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
  try {
    var search = AdsApp.search(query); var campaigns = {};
    while (search.hasNext()) {
      var row = search.next();
      var cn = row.campaign.name, device = row.segments.device;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var conv = Number(row.metrics.conversions) || 0;
      var clicks = Number(row.metrics.clicks) || 0;
      var revenue = Number(row.metrics.conversionsValue) || 0;
      if (!campaigns[cn]) campaigns[cn] = {};
      campaigns[cn][device] = { cost: cost, conversions: conv, clicks: clicks, revenue: revenue };
    }
    var minSpend = CONFIG.DEVICE_MIN_SPEND || 500;
    var minClicks = CONFIG.DEVICE_MIN_CLICKS || 50;
    for (var cn in campaigns) {
      var data = campaigns[cn];
      var desktop = data['DESKTOP'] || { cost: 0, conversions: 0, clicks: 0, revenue: 0 };
      var mobile = data['MOBILE'] || { cost: 0, conversions: 0, clicks: 0, revenue: 0 };
      var tablet = data['TABLET'] || { cost: 0, conversions: 0, clicks: 0, revenue: 0 };
      if (desktop.clicks < minClicks || desktop.conversions < 5) continue;
      var desktopCvr = desktop.clicks > 0 ? (desktop.conversions / desktop.clicks) : 0;
      if (mobile.clicks >= minClicks && mobile.cost >= minSpend) {
        var mobileCvr = mobile.clicks > 0 ? (mobile.conversions / mobile.clicks) : 0;
        var adj = _calculateBidAdjustment(desktopCvr, mobileCvr);
        if (Math.abs(adj) >= 10) {
          _applyDeviceBidAdjustment(cn, 'MOBILE', adj, results);
          _logChange({ functionName: '_autoAdjustDeviceBids', entity: cn + '_MOBILE', entityType: 'DEVICE_BID', campaign: cn, reason: 'Mobile CVR ' + (mobileCvr * 100).toFixed(1) + '% vs Desktop ' + (desktopCvr * 100).toFixed(1) + '% | Adj: ' + adj + '%', spend: mobile.cost, conversions: mobile.conversions });
        }
      }
      if (tablet.clicks >= minClicks && tablet.cost >= minSpend) {
        var tabletCvr = tablet.clicks > 0 ? (tablet.conversions / tablet.clicks) : 0;
        var adj2 = _calculateBidAdjustment(desktopCvr, tabletCvr);
        if (Math.abs(adj2) >= 10) {
          _applyDeviceBidAdjustment(cn, 'TABLET', adj2, results);
          _logChange({ functionName: '_autoAdjustDeviceBids', entity: cn + '_TABLET', entityType: 'DEVICE_BID', campaign: cn, reason: 'Tablet CVR ' + (tabletCvr * 100).toFixed(1) + '% vs Desktop | Adj: ' + adj2 + '%', spend: tablet.cost, conversions: tablet.conversions });
        }
      }
    }
  } catch (e) { _log('ERROR', 'autoAdjustDeviceBids: ' + e.message); results.errors.push(e.message); }
}

function _calculateBidAdjustment(baselineCvr, deviceCvr) {
  if (baselineCvr === 0) return 0;
  var ratio = deviceCvr / baselineCvr;
  var adjustment = Math.round((ratio - 1) * 100);
  return Math.max(-90, Math.min(300, adjustment));
}

function _applyDeviceBidAdjustment(campaignName, device, adjustment, results) {
  _log('INFO', 'DEVICE BID: "' + campaignName + '" | ' + device + ' | ' + (adjustment > 0 ? '+' : '') + adjustment + '%');
  results.deviceAdjustments.push({ campaign: campaignName, device: device, adjustment: adjustment });
  if (!CONFIG.PREVIEW_MODE) {
    try {
      var ci = AdsApp.campaigns().withCondition('campaign.name = "' + campaignName + '"').get();
      if (ci.hasNext()) {
        var campaign = ci.next();
        var platforms = campaign.targeting().platforms().get();
        while (platforms.hasNext()) {
          var platform = platforms.next();
          if ((device === 'MOBILE' && platform.getName() === 'Mobile devices with full browsers') ||
              (device === 'TABLET' && platform.getName() === 'Tablets with full browsers')) {
            platform.setBidModifier(1 + (adjustment / 100));
          }
        }
      }
    } catch (e) { _log('WARN', 'Device bid adjust failed: ' + e.message); }
  }
}


// ============================================
// AUTO-OPTIMIZE: AD SCHEDULE (HOUR-OF-DAY)
// ============================================

function _autoAdjustAdSchedule(results) {
  var query = 'SELECT campaign.name, segments.hour, metrics.cost_micros, metrics.conversions, metrics.clicks, campaign.status, campaign.advertising_channel_type FROM campaign WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date DURING LAST_30_DAYS';
  try {
    var search = AdsApp.search(query); var hourData = {};
    while (search.hasNext()) {
      var row = search.next();
      var cn = row.campaign.name, hour = row.segments.hour;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var conv = Number(row.metrics.conversions) || 0;
      var clicks = Number(row.metrics.clicks) || 0;
      if (!hourData[cn]) hourData[cn] = {};
      if (!hourData[cn][hour]) hourData[cn][hour] = { cost: 0, conversions: 0, clicks: 0 };
      hourData[cn][hour].cost += cost;
      hourData[cn][hour].conversions += conv;
      hourData[cn][hour].clicks += clicks;
    }
    var minHourSpend = CONFIG.HOUR_MIN_SPEND || 300;
    var minHourClicks = CONFIG.HOUR_MIN_CLICKS || 20;
    for (var cn in hourData) {
      var totalConv = 0, totalClicks = 0;
      for (var h in hourData[cn]) { totalConv += hourData[cn][h].conversions; totalClicks += hourData[cn][h].clicks; }
      if (totalConv < 10) { _log('DEBUG', 'Schedule skip "' + cn + '": only ' + totalConv + ' conv'); continue; }
      var avgCvr = totalClicks > 0 ? totalConv / totalClicks : 0;
      for (var h in hourData[cn]) {
        var hd = hourData[cn][h];
        if (hd.cost < minHourSpend || hd.clicks < minHourClicks) continue;
        var hourCvr = hd.clicks > 0 ? hd.conversions / hd.clicks : 0;
        var adj = 0;
        if (hd.conversions === 0 && hd.cost >= minHourSpend * 2) adj = -75;
        else if (hd.conversions === 0) adj = -50;
        else if (hourCvr < avgCvr * 0.25 && hd.cost >= minHourSpend) adj = -40;
        if (adj !== 0) {
          _applyHourBidAdjustment(cn, parseInt(h), adj, results);
          _logChange({ functionName: '_autoAdjustAdSchedule', entity: cn + '_H' + h, entityType: 'SCHEDULE_BID', campaign: cn, reason: 'Hour ' + h + ': ' + hd.conversions + ' conv | R' + hd.cost.toFixed(0) + ' | Adj: ' + adj + '%', spend: hd.cost, conversions: hd.conversions });
        }
      }
    }
  } catch (e) { _log('ERROR', 'autoAdjustAdSchedule: ' + e.message); results.errors.push(e.message); }
}

function _applyHourBidAdjustment(campaignName, hour, adjustment, results) {
  var hourLabel = (hour < 10 ? '0' : '') + hour + ':00-' + (hour < 9 ? '0' : '') + (hour + 1) + ':00';
  _log('INFO', 'SCHEDULE: "' + campaignName + '" | ' + hourLabel + ' | ' + adjustment + '%');
  results.scheduleAdjustments.push({ campaign: campaignName, hour: hour, hourLabel: hourLabel, adjustment: adjustment });
  if (!CONFIG.PREVIEW_MODE) {
    try {
      var ci = AdsApp.campaigns().withCondition('campaign.name = "' + campaignName + '"').get();
      if (ci.hasNext()) {
        var campaign = ci.next();
        var days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
        for (var d = 0; d < days.length; d++) {
          try {
            campaign.addAdSchedule({ dayOfWeek: days[d], startHour: hour, startMinute: 0, endHour: hour + 1, endMinute: 0, bidModifier: 1 + (adjustment / 100) });
          } catch (e2) {
            var schedules = campaign.targeting().adSchedules().get();
            while (schedules.hasNext()) {
              var sched = schedules.next();
              if (sched.getStartHour() === hour && sched.getDayOfWeek() === days[d]) { sched.setBidModifier(1 + (adjustment / 100)); break; }
            }
          }
        }
      }
    } catch (e) { _log('WARN', 'Schedule adjust failed: ' + e.message); }
  }
}


// ============================================
// AUTO-OPTIMIZE: GEOGRAPHIC BID ADJUSTMENTS
// ============================================

function _autoAdjustGeoBids(results) {
  var query = 'SELECT campaign.name, campaign_criterion.location.geo_target_constant, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, campaign.status FROM location_view WHERE campaign.status = "ENABLED" AND segments.date DURING LAST_30_DAYS';
  try {
    var search = AdsApp.search(query); var geoData = {};
    while (search.hasNext()) {
      var row = search.next();
      if (!row.campaignCriterion || !row.campaignCriterion.location) continue;
      var cn = row.campaign.name, locId = row.campaignCriterion.location.geoTargetConstant;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var conv = Number(row.metrics.conversions) || 0;
      var clicks = Number(row.metrics.clicks) || 0;
      if (!geoData[cn]) geoData[cn] = {};
      if (!geoData[cn][locId]) geoData[cn][locId] = { cost: 0, conversions: 0, clicks: 0, locationId: locId };
      geoData[cn][locId].cost += cost; geoData[cn][locId].conversions += conv; geoData[cn][locId].clicks += clicks;
    }
    var minGeoSpend = CONFIG.GEO_MIN_SPEND || 500;
    var minGeoClicks = CONFIG.GEO_MIN_CLICKS || 30;
    for (var cn in geoData) {
      var totalConv = 0, totalClicks = 0;
      for (var loc in geoData[cn]) { totalConv += geoData[cn][loc].conversions; totalClicks += geoData[cn][loc].clicks; }
      if (totalConv < 10) continue;
      var avgCvr = totalClicks > 0 ? totalConv / totalClicks : 0;
      for (var loc in geoData[cn]) {
        var gd = geoData[cn][loc];
        if (gd.cost < minGeoSpend || gd.clicks < minGeoClicks) continue;
        var locCvr = gd.clicks > 0 ? gd.conversions / gd.clicks : 0;
        if (gd.conversions === 0 && gd.cost >= minGeoSpend) {
          _log('INFO', 'GEO: "' + cn + '" | Loc ' + loc + ' | 0 conv | R' + gd.cost.toFixed(0) + ' | -50%');
          results.geoAdjustments.push({ campaign: cn, location: loc, spend: gd.cost, conversions: 0, adjustment: -50 });
          if (!CONFIG.PREVIEW_MODE) _setGeoBidModifier(cn, loc, 0.50);
          _logChange({ functionName: '_autoAdjustGeoBids', entity: cn + '_LOC_' + loc, entityType: 'GEO_BID', campaign: cn, reason: 'Location ' + loc + ': 0 conv | R' + gd.cost.toFixed(0), spend: gd.cost, conversions: 0 });
        } else if (locCvr < avgCvr * 0.3) {
          results.geoAdjustments.push({ campaign: cn, location: loc, spend: gd.cost, conversions: gd.conversions, adjustment: -40 });
          if (!CONFIG.PREVIEW_MODE) _setGeoBidModifier(cn, loc, 0.60);
          _logChange({ functionName: '_autoAdjustGeoBids', entity: cn + '_LOC_' + loc, entityType: 'GEO_BID', campaign: cn, reason: 'Location CVR ' + (locCvr * 100).toFixed(1) + '% < 30% of avg', spend: gd.cost, conversions: gd.conversions });
        } else if (locCvr > avgCvr * 2 && gd.conversions >= 3) {
          results.geoAdjustments.push({ campaign: cn, location: loc, spend: gd.cost, conversions: gd.conversions, adjustment: 30 });
          if (!CONFIG.PREVIEW_MODE) _setGeoBidModifier(cn, loc, 1.30);
          _logChange({ functionName: '_autoAdjustGeoBids', entity: cn + '_LOC_' + loc, entityType: 'GEO_BID', campaign: cn, reason: 'Location CVR ' + (locCvr * 100).toFixed(1) + '% > 2x avg | High performer', spend: gd.cost, conversions: gd.conversions });
        }
      }
    }
  } catch (e) { _log('ERROR', 'autoAdjustGeoBids: ' + e.message); results.errors.push(e.message); }
}

function _setGeoBidModifier(campaignName, locationConstant, modifier) {
  try {
    var ci = AdsApp.campaigns().withCondition('campaign.name = "' + campaignName + '"').get();
    if (ci.hasNext()) {
      var locs = ci.next().targeting().targetedLocations().get();
      while (locs.hasNext()) {
        var loc = locs.next();
        if (String(loc.getId()) === String(locationConstant).replace(/[^0-9]/g, '')) { loc.setBidModifier(modifier); break; }
      }
    }
  } catch (e) { _log('WARN', 'Geo bid modifier failed: ' + e.message); }
}


// ============================================
// AUTO-OPTIMIZE: N-GRAM ANALYSIS
// ============================================

function _autoNgramNegatives(results) {
  var query = 'SELECT search_term_view.search_term, metrics.cost_micros, metrics.conversions, metrics.clicks, campaign.status, campaign.advertising_channel_type FROM search_term_view WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date DURING LAST_30_DAYS';
  try {
    var search = AdsApp.search(query); var wordStats = {};
    while (search.hasNext()) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      var cost = Number(row.metrics.costMicros) / 1000000;
      var conv = Number(row.metrics.conversions) || 0;
      var clicks = Number(row.metrics.clicks) || 0;
      var words = st.split(/\s+/); var seen = {};
      for (var i = 0; i < words.length; i++) {
        var word = words[i].replace(/[^a-z0-9]/g, '');
        if (word.length < 3 || seen[word]) continue;
        seen[word] = true;
        if (!wordStats[word]) wordStats[word] = { totalCost: 0, totalConversions: 0, totalClicks: 0, termCount: 0, terms: [] };
        wordStats[word].totalCost += cost;
        wordStats[word].totalConversions += conv;
        wordStats[word].totalClicks += clicks;
        wordStats[word].termCount++;
        if (wordStats[word].terms.length < 5) wordStats[word].terms.push(st);
      }
    }

    var ngramSpendThreshold = CONFIG.NGRAM_SPEND_THRESHOLD || 1000;
    var ngramMinTerms = CONFIG.NGRAM_MIN_TERMS || 3;
    var negativeList = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_SPEND);
    var existing = _getExistingNegatives(negativeList);
    var changeCount = 0;

    // Build protected word set from active keywords
    var activeKeywordWords = {};
    try {
      var kwQuery = 'SELECT ad_group_criterion.keyword.text, campaign.status, ad_group.status, ad_group_criterion.status FROM keyword_view WHERE campaign.status = "ENABLED" AND ad_group.status = "ENABLED" AND ad_group_criterion.status = "ENABLED"';
      var kwSearch = AdsApp.search(kwQuery);
      while (kwSearch.hasNext()) {
        var kwText = kwSearch.next().adGroupCriterion.keyword.text.toLowerCase();
        kwText.split(/\s+/).forEach(function(w) { var word = w.replace(/[^a-z0-9]/g, ''); if (word.length >= 3) activeKeywordWords[word] = true; });
      }
    } catch (e) { _log('WARN', 'Could not load active keyword words: ' + e.message); }
    _log('INFO', 'Protected keyword words: ' + Object.keys(activeKeywordWords).length);

    var stopWords = ['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'has', 'have', 'not', 'but', 'they', 'you', 'your', 'our', 'can', 'will'];
    var wasteWords = [];
    for (var word in wordStats) {
      var ws = wordStats[word];
      if (ws.totalConversions === 0 && ws.totalCost >= ngramSpendThreshold && ws.termCount >= ngramMinTerms) {
        if (_isProtectedTerm(word) || existing[word] || activeKeywordWords[word] || stopWords.indexOf(word) !== -1) continue;
        wasteWords.push({ word: word, stats: ws });
      }
    }
    wasteWords.sort(function(a, b) { return b.stats.totalCost - a.stats.totalCost; });

    for (var i = 0; i < wasteWords.length && changeCount < 20; i++) {
      var ww = wasteWords[i];
      _log('INFO', 'NGRAM: "' + ww.word + '" | R' + ww.stats.totalCost.toFixed(0) + ' | ' + ww.stats.termCount + ' terms | 0 conv');
      results.ngramNegatives.push({ word: ww.word, totalCost: ww.stats.totalCost, termCount: ww.stats.termCount, sampleTerms: ww.stats.terms });
      if (!CONFIG.PREVIEW_MODE && negativeList) negativeList.addNegativeKeyword('"' + ww.word + '"');

      _logChange({ functionName: '_autoNgramNegatives', entity: ww.word, entityType: 'NGRAM_NEGATIVE', reason: 'R' + ww.stats.totalCost.toFixed(0) + ' across ' + ww.stats.termCount + ' terms | 0 conv. Sample: ' + ww.stats.terms.slice(0, 3).join(', '), spend: ww.stats.totalCost, conversions: 0 });

      changeCount++;
    }
  } catch (e) { _log('ERROR', 'autoNgramNegatives: ' + e.message); results.errors.push(e.message); }
  _log('INFO', 'N-gram negatives added: ' + results.ngramNegatives.length);
}


// ============================================
// AUTO-OPTIMIZE: LOW QUALITY SCORE PAUSING
// ============================================

function _pauseLowQualityScoreKeywords(results) {
  var dr = _getDateRange();
  var qsThreshold = CONFIG.QS_PAUSE_THRESHOLD || 3;
  var qsSpendThreshold = CONFIG.QS_SPEND_THRESHOLD || 300;
  var query = 'SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.quality_info.quality_score, campaign.name, ad_group.name, metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.impressions, campaign.status, ad_group.status, ad_group_criterion.status, campaign.advertising_channel_type FROM keyword_view WHERE campaign.status = "ENABLED" AND ad_group.status = "ENABLED" AND ad_group_criterion.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND ad_group_criterion.quality_info.quality_score <= ' + qsThreshold + ' AND metrics.cost_micros > ' + (qsSpendThreshold * 1000000) + ' AND metrics.conversions < 1 AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
  try {
    var search = AdsApp.search(query); var changeCount = 0;
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var kw = row.adGroupCriterion.keyword.text;
      var qs = row.adGroupCriterion.qualityInfo.qualityScore;
      var cn = row.campaign.name, agn = row.adGroup.name;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var clicks = Number(row.metrics.clicks) || 0;
      if (_isProtectedTerm(kw)) continue;
      // v4.1.2: Never pause active keywords
      if (_isActiveKeyword(kw)) {
        _log('INFO', 'SKIP (active keyword): "' + kw + '" — would have been paused (Low QS)');
        continue;
      }
      // v4.1.2: Never pause keywords with historical conversions
      if (_hasHistoricalConversions(kw, cn, agn)) {
        _log('INFO', 'SKIP (historical converter): "' + kw + '" — has conversions in last 90 days (Low QS)');
        continue;
      }
      var reason = 'QS ' + qs + ' | R' + cost.toFixed(0) + ' | 0 conv';
      _log('INFO', 'LOW QS PAUSE: "' + kw + '" | ' + reason);
      results.lowQsPaused.push({ keyword: kw, qualityScore: qs, campaign: cn, adGroup: agn, spend: cost, clicks: clicks });

      _logChange({ functionName: '_pauseLowQualityScoreKeywords', entity: kw, entityType: 'KEYWORD', campaign: cn, adGroup: agn, reason: reason, spend: cost, conversions: 0 });

      if (!CONFIG.PREVIEW_MODE) {
        var ki = AdsApp.keywords().withCondition('ad_group.name = "' + agn + '"').withCondition('campaign.name = "' + cn + '"').withCondition('ad_group_criterion.keyword.text = "' + kw + '"').get();
        while (ki.hasNext()) ki.next().pause();
      }
      changeCount++;
    }
  } catch (e) { _log('ERROR', 'pauseLowQualityScoreKeywords: ' + e.message); results.errors.push(e.message); }
  _log('INFO', 'Low QS keywords paused: ' + results.lowQsPaused.length);
}


// ============================================
// HEALTH CHECK: CONVERSION TRACKING
// ============================================

function _checkConversionHealth(results) {
  try {
    var q1 = 'SELECT metrics.conversions, metrics.cost_micros, campaign.status FROM campaign WHERE campaign.status = "ENABLED" AND segments.date DURING LAST_7_DAYS';
    var s1 = AdsApp.search(q1); var thisWeekConv = 0, thisWeekCost = 0;
    while (s1.hasNext()) { var r = s1.next(); thisWeekConv += Number(r.metrics.conversions) || 0; thisWeekCost += Number(r.metrics.costMicros) / 1000000; }

    var end = new Date(); end.setDate(end.getDate() - 7);
    var start = new Date(); start.setDate(start.getDate() - 14);
    var q2 = 'SELECT metrics.conversions, campaign.status FROM campaign WHERE campaign.status = "ENABLED" AND segments.date BETWEEN "' + _formatDate(start) + '" AND "' + _formatDate(end) + '"';
    var s2 = AdsApp.search(q2); var lastWeekConv = 0;
    while (s2.hasNext()) { lastWeekConv += Number(s2.next().metrics.conversions) || 0; }

    _log('INFO', 'Conversion health: This week=' + thisWeekConv.toFixed(0) + ' | Last week=' + lastWeekConv.toFixed(0));
    results.conversionHealth = { thisWeek: thisWeekConv, lastWeek: lastWeekConv, thisWeekCost: thisWeekCost };

    if (lastWeekConv >= 3 && thisWeekConv < lastWeekConv * 0.5) {
      var dropPct = ((1 - thisWeekConv / lastWeekConv) * 100).toFixed(0);
      var alertMsg = 'URGENT: Conversions dropped ' + dropPct + '% (' + lastWeekConv.toFixed(0) + ' → ' + thisWeekConv.toFixed(0) + ') while spending R' + thisWeekCost.toFixed(0) + '. Check conversion tracking immediately.';
      _log('ERROR', alertMsg);
      results.conversionAlert = alertMsg;
      if (CONFIG.SEND_EMAIL !== false) {
        var recipients = CONFIG.EMAIL_ADDRESSES || [CONFIG.EMAIL_RECIPIENT || 'michaelh@syte.co.za'];
        if (typeof recipients === 'string') recipients = [recipients];
        MailApp.sendEmail({ to: recipients.join(','), subject: '🚨 URGENT: ' + CONFIG.CLIENT_NAME + ' — Conversions Dropped ' + dropPct + '%', body: alertMsg + '\n\nAction needed:\n1. Check conversion tags in GTM\n2. Test the conversion flow manually\n3. Check for landing page errors\n4. Review any recent website changes\n\n— Syte Optimization Script v4.5.0' });
      }
    }

    if (thisWeekConv === 0 && thisWeekCost > (CONFIG.MONTHLY_BUDGET * 0.1)) {
      results.conversionAlert = 'CRITICAL: ZERO conversions this week with R' + thisWeekCost.toFixed(0) + ' spent. Conversion tracking may be broken.';
      _log('ERROR', results.conversionAlert);
    }

  } catch (e) { _log('ERROR', 'checkConversionHealth: ' + e.message); results.errors.push(e.message); }
}


// ============================================
// AUDIT & REPAIR — NEGATIVE KEYWORD SAFETY NET (v4.1.2)
// ============================================

/**
 * Audits ALL existing negatives (shared lists + ad-group level) and REPORTS
 * any that conflict with active keywords or block converting search terms.
 * Findings are included in the email report for human review.
 * Policy: NEVER auto-removes negatives or unpauses keywords.
 */
function _auditAndRepairNegatives(results) {
  if (CONFIG.AUDIT_NEGATIVES === false) {
    _log('INFO', 'Negative audit disabled — skipping');
    return;
  }

  var auditStart = new Date();

  _log('INFO', 'Audit mode: REPORT_ONLY (all findings require manual review)');

  results.auditRepairs = results.auditRepairs || [];

  // === 7a: Audit shared negative keyword lists ===
  var sharedListNames = [
    CONFIG.NEGATIVE_LIST_NAME_SPEND || 'Script - High Spend No Results',
    CONFIG.NEGATIVE_LIST_NAME_INFORMATIONAL || 'Script - Informational Queries',
    CONFIG.NEGATIVE_LIST_NAME_IRRELEVANT || 'Script - Irrelevant Industry'
  ];

  for (var li = 0; li < sharedListNames.length; li++) {
    var listName = sharedListNames[li];
    try {
      var lists = AdsApp.negativeKeywordLists().withCondition('shared_set.name = "' + listName + '"').get();
      if (!lists.hasNext()) continue;
      var negativeList = lists.next();
      var keywords = negativeList.negativeKeywords().get();
      while (keywords.hasNext()) {
        var nk = keywords.next();
        var nkText = nk.getText().toLowerCase().replace(/[\[\]"]/g, '').trim();
        var removalReason = null;

        // Check 1: Matches an active keyword (exact)
        if (ACTIVE_KEYWORDS[nkText]) {
          removalReason = 'Matches active keyword "' + nkText + '"';
        }

        // Check 2: Is a substring of an active keyword (phrase match blocking)
        if (!removalReason) {
          for (var akw in ACTIVE_KEYWORDS) {
            if (akw.indexOf(nkText) !== -1 && akw !== nkText) {
              removalReason = 'Phrase match would block active keyword "' + akw + '"';
              break;
            }
          }
        }

        // Check 3: Matches a converting search term (require 2+ conversions for safety)
        if (!removalReason && CONVERTING_SEARCH_TERMS[nkText] && CONVERTING_SEARCH_TERMS[nkText] >= 2) {
          removalReason = 'Matches converting search term (' + CONVERTING_SEARCH_TERMS[nkText] + ' conversions in lookback)';
        }

        if (removalReason) {
          _log('INFO', 'AUDIT REPAIR: "' + nkText + '" in "' + listName + '" — ' + removalReason);
          results.auditRepairs.push({
            action: 'REMOVED_NEGATIVE',
            entity: nkText,
            location: listName,
            reason: removalReason
          });

          _logChange({
            functionName: '_auditAndRepairNegatives',
            entity: nkText,
            entityType: 'AUDIT_REPAIR',
            campaign: '',
            reason: 'Flagged in "' + listName + '": ' + removalReason,
            spend: 0,
            conversions: 0
          });
          // Policy: report-only — no auto-removal of negatives
        }
      }
    } catch (e) {
      _log('WARN', 'Audit shared list "' + listName + '" error: ' + e.message);
    }
  }

  // === 7b: Audit ad-group level negatives ===
  // CRITICAL: ONLY remove ad-group negatives that directly conflict with a
  // POSITIVE keyword in the SAME ad group. Do NOT remove negatives just because
  // they match an active keyword in a DIFFERENT ad group — those are intentional
  // exclusions (informational, job seekers, DIY, brand protection, etc.)
  try {
    var agNegQuery = 'SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ' +
      'campaign.name, ad_group.name, campaign.status, ad_group.status ' +
      'FROM ad_group_criterion ' +
      'WHERE ad_group_criterion.type = "KEYWORD" ' +
      'AND ad_group_criterion.negative = true ' +
      'AND campaign.status = "ENABLED" ' +
      'AND ad_group.status = "ENABLED"';
    var agNegSearch = AdsApp.search(agNegQuery);
    var agNegCount = 0;
    var winnersAdGroupName = (CONFIG.EXACT_WINNERS_AD_GROUP_NAME || '[Exact Winners]').toLowerCase();

    while (agNegSearch.hasNext() && agNegCount < 500) {
      var agRow = agNegSearch.next();
      var agNegText = agRow.adGroupCriterion.keyword.text.toLowerCase().replace(/[\[\]"]/g, '').trim();
      var agCampaign = agRow.campaign.name;
      var agName = agRow.adGroup.name;
      agNegCount++;

      // Skip exact winner sculpting negatives — these are intentional
      if (agName.toLowerCase() === winnersAdGroupName) continue;

      // ONLY remove if there's a POSITIVE keyword with the exact same text in the SAME ad group
      var isDirectConflict = false;
      try {
        var posCheck = AdsApp.keywords()
          .withCondition('campaign.name = "' + agCampaign + '"')
          .withCondition('ad_group.name = "' + agName + '"')
          .withCondition('ad_group_criterion.keyword.text = "' + agNegText + '"')
          .withCondition('ad_group_criterion.status = "ENABLED"').get();
        if (posCheck.hasNext()) isDirectConflict = true;
      } catch (e) { /* skip */ }

      if (isDirectConflict) {
        var agRemovalReason = 'Conflicts with positive keyword "' + agNegText + '" in same ad group';
        _log('INFO', 'AUDIT REPAIR (AG): "' + agNegText + '" in "' + agCampaign + ' > ' + agName + '" — ' + agRemovalReason);
        results.auditRepairs.push({
          action: 'REMOVED_AG_NEGATIVE',
          entity: agNegText,
          location: agCampaign + ' > ' + agName,
          reason: agRemovalReason
        });

        _logChange({
          functionName: '_auditAndRepairNegatives',
          entity: agNegText,
          entityType: 'AUDIT_REPAIR',
          campaign: agCampaign,
          adGroup: agName,
          reason: 'Flagged AG negative: ' + agRemovalReason,
          spend: 0,
          conversions: 0
        });
        // Policy: report-only — no auto-removal of ad-group negatives
      }
    }
    _log('INFO', 'Ad-group negatives audited: ' + agNegCount);
  } catch (e) {
    _log('WARN', 'Audit ad-group negatives error: ' + e.message);
  }

  // === 7c: Unpause wrongly paused keywords ===
  try {
    var pausedQuery = 'SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ' +
      'campaign.name, ad_group.name, campaign.status, ad_group.status, ad_group_criterion.status ' +
      'FROM keyword_view ' +
      'WHERE ad_group_criterion.status = "PAUSED" ' +
      'AND campaign.status = "ENABLED" ' +
      'AND ad_group.status = "ENABLED"';
    var pausedSearch = AdsApp.search(pausedQuery);
    var pausedChecked = 0;

    while (pausedSearch.hasNext() && pausedChecked < 200) {
      var pRow = pausedSearch.next();
      var pKwText = pRow.adGroupCriterion.keyword.text.toLowerCase().trim();
      var pCampaign = pRow.campaign.name;
      var pAdGroup = pRow.adGroup.name;
      pausedChecked++;

      // Only unpause if the keyword's search term has converted recently
      // AND the keyword matches an active keyword in another ad group
      var shouldUnpause = false;
      var unpauseReason = null;

      if (CONVERTING_SEARCH_TERMS[pKwText] && CONVERTING_SEARCH_TERMS[pKwText] >= 2) {
        shouldUnpause = true;
        unpauseReason = 'Search term "' + pKwText + '" has ' + CONVERTING_SEARCH_TERMS[pKwText] + ' conversions in lookback';
      }

      if (shouldUnpause) {
        _log('INFO', 'AUDIT REPAIR (UNPAUSE): "' + pKwText + '" in "' + pCampaign + ' > ' + pAdGroup + '" — ' + unpauseReason);
        results.auditRepairs.push({
          action: 'UNPAUSED_KEYWORD',
          entity: pKwText,
          location: pCampaign + ' > ' + pAdGroup,
          reason: unpauseReason
        });

        _logChange({
          functionName: '_auditAndRepairNegatives',
          entity: pKwText,
          entityType: 'AUDIT_REPAIR',
          campaign: pCampaign,
          adGroup: pAdGroup,
          reason: 'Flagged for unpause: ' + unpauseReason,
          spend: 0,
          conversions: CONVERTING_SEARCH_TERMS[pKwText] || 0
        });
        // Policy: report-only — no auto-unpause of keywords
      }
    }
    _log('INFO', 'Paused keywords audited: ' + pausedChecked);
  } catch (e) {
    _log('WARN', 'Audit paused keywords error: ' + e.message);
  }

  var auditDuration = (new Date() - auditStart) / 1000;
  _log('INFO', 'Audit scan complete in ' + auditDuration.toFixed(1) + 's | Findings: ' + results.auditRepairs.length + ' (report-only)');
}


// ============================================
// DAILY DIGEST — SUMMARY ROW (v4.3.1)
// ============================================

/**
 * Writes a one-row summary of this run to the "DailyDigest" tab in the master sheet.
 * A separate digest script (daily_digest.js) reads these rows and sends a consolidated daily email.
 */
function _writeDailyDigestRow(results, duration) {
  if (!CONFIG.MASTER_SHEET_ID && !CONFIG.SHEET_URL) return;

  // Ensure MASTER_SHEET_ID is set
  if (!CONFIG.MASTER_SHEET_ID && CONFIG.SHEET_URL) {
    var match = CONFIG.SHEET_URL.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) CONFIG.MASTER_SHEET_ID = match[1];
  }
  if (!CONFIG.MASTER_SHEET_ID) return;

  try {
    var ss = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
    var sheet = ss.getSheetByName('DailyDigest');
    if (!sheet) {
      sheet = ss.insertSheet('DailyDigest');
      sheet.getRange(1, 1, 1, 24).setValues([[
        'date', 'time', 'account', 'mode', 'run_mode',
        'duration_s', 'keywords_paused', 'search_terms_negated',
        'ai_negated', 'ai_review', 'winners_promoted',
        'audit_findings', 'schedule_adjustments', 'device_adjustments',
        'geo_adjustments', 'ngram_negatives', 'low_qs_paused',
        'conv_this_week', 'conv_last_week', 'errors',
        'cost_30d', 'conversions_30d', 'revenue_30d', 'clicks_30d'
      ]]);
      sheet.getRange(1, 1, 1, 24).setFontWeight('bold');
      sheet.setFrozenRows(1);
    } else {
      // Auto-migrate: add performance columns if missing
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      if (headers.indexOf('cost_30d') === -1) {
        var nextCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, nextCol, 1, 4).setValues([['cost_30d', 'conversions_30d', 'revenue_30d', 'clicks_30d']]);
        sheet.getRange(1, nextCol, 1, 4).setFontWeight('bold');
      }
    }

    var now = new Date();
    var tz = AdsApp.currentAccount().getTimeZone();
    var dateStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var timeStr = Utilities.formatDate(now, tz, 'HH:mm');
    var accountName = CONFIG.CLIENT_NAME || AdsApp.currentAccount().getName();

    var kwPaused = (results.keywordsPaused ? results.keywordsPaused.length : 0) +
                   (results.ecomKeywordsPaused ? results.ecomKeywordsPaused.length : 0);
    var stNegated = results.searchTermsNegated ? results.searchTermsNegated.length : 0;
    var convThis = results.conversionHealth ? results.conversionHealth.thisWeek : 0;
    var convLast = results.conversionHealth ? results.conversionHealth.lastWeek : 0;

    // Pull 30-day account-level performance for MoM tracking
    var cost30d = 0, conv30d = 0, rev30d = 0, clicks30d = 0;
    try {
      var perfQ = 'SELECT metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks ' +
        'FROM customer WHERE segments.date DURING LAST_30_DAYS';
      var perfRows = AdsApp.search(perfQ);
      while (perfRows.hasNext()) {
        var pr = perfRows.next();
        cost30d += Number(pr.metrics.costMicros) / 1000000;
        conv30d += Number(pr.metrics.conversions) || 0;
        rev30d += Number(pr.metrics.conversionsValue) || 0;
        clicks30d += Number(pr.metrics.clicks) || 0;
      }
    } catch (perfErr) { _log('WARN', 'DailyDigest perf query: ' + perfErr.message); }

    sheet.appendRow([
      dateStr, timeStr, accountName, CONFIG.ACCOUNT_MODE,
      CONFIG.PREVIEW_MODE ? 'PREVIEW' : 'LIVE',
      duration.toFixed(1),
      kwPaused, stNegated,
      results.smartNegated ? results.smartNegated.length : 0,
      results.smartReviewTerms ? results.smartReviewTerms.length : 0,
      (results.winnersPromoted ? results.winnersPromoted.length : 0) +
        (results.ecomWinnersPromoted ? results.ecomWinnersPromoted.length : 0),
      results.auditRepairs ? results.auditRepairs.length : 0,
      results.scheduleAdjustments ? results.scheduleAdjustments.length : 0,
      results.deviceAdjustments ? results.deviceAdjustments.length : 0,
      results.geoAdjustments ? results.geoAdjustments.length : 0,
      results.ngramNegatives ? results.ngramNegatives.length : 0,
      results.lowQsPaused ? results.lowQsPaused.length : 0,
      convThis, convLast,
      results.errors ? results.errors.length : 0,
      cost30d.toFixed(2), conv30d.toFixed(1), rev30d.toFixed(2), clicks30d
    ]);

    // Persist individual error messages to "Errors" tab so the weekly
    // client report can link into a per-client drill-down view.
    if (results.errors && results.errors.length > 0) {
      try {
        var errorsSheet = ss.getSheetByName('Errors');
        if (!errorsSheet) {
          errorsSheet = ss.insertSheet('Errors');
          errorsSheet.getRange(1, 1, 1, 6).setValues([[
            'timestamp', 'date', 'account', 'mode', 'run_mode', 'error_message'
          ]]);
          errorsSheet.getRange(1, 1, 1, 6).setFontWeight('bold');
          errorsSheet.setFrozenRows(1);
        }
        var errRows = [];
        for (var ei = 0; ei < results.errors.length; ei++) {
          errRows.push([
            now, dateStr, accountName, CONFIG.ACCOUNT_MODE,
            CONFIG.PREVIEW_MODE ? 'PREVIEW' : 'LIVE',
            String(results.errors[ei])
          ]);
        }
        errorsSheet.getRange(errorsSheet.getLastRow() + 1, 1, errRows.length, 6)
                   .setValues(errRows);
      } catch (ee) {
        _log('WARN', 'Could not write to Errors tab: ' + ee.message);
      }
    }

    _log('INFO', 'Daily digest row written');
  } catch (e) {
    _log('WARN', 'Could not write daily digest row: ' + e.message);
  }
}


// ============================================
// EMAIL REPORT
// ============================================

function _sendReport(results, duration, evalResult, pendingRunId) {
  var mode = CONFIG.PREVIEW_MODE ? 'PREVIEW' : (CONFIG.REQUIRE_APPROVAL ? 'PENDING APPROVAL' : 'LIVE');
  var accountName = AdsApp.currentAccount().getName();
  var today = Utilities.formatDate(new Date(), AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd HH:mm');

  var email = '<html><body style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;color:#333;">';
  email += '<div style="background:linear-gradient(135deg,#0d47a1,#1565c0);color:white;padding:20px;border-radius:8px 8px 0 0;">';
  email += '<h1 style="margin:0;font-size:20px;">Syte Optimization Report v4.5.0</h1>';
  email += '<p style="margin:5px 0 0;opacity:0.8;">' + accountName + ' | ' + today + ' | ' + mode + ' | ' + CONFIG.ACCOUNT_MODE + '</p></div>';

  // v4.4.0: Approval buttons bar
  // v4.5.0: Fixed — encode & as &amp; in HTML href attributes so Gmail doesn't strip query params.
  if (pendingRunId && CONFIG.APPROVAL_WEBAPP_URL) {
    var webAppUrl = CONFIG.APPROVAL_WEBAPP_URL;
    var btnStyle = 'display:inline-block;padding:10px 18px;margin:4px;border-radius:6px;color:white;text-decoration:none;font-weight:bold;font-size:13px;';
    var rejBtnStyle = 'display:inline-block;padding:6px 12px;margin:4px 2px;border-radius:6px;color:white;text-decoration:none;font-weight:bold;font-size:11px;background:#c62828;';

    email += '<div style="background:#e8f5e9;padding:16px 20px;border-left:4px solid #2e7d32;">';
    email += '<h3 style="margin:0 0 10px;color:#2e7d32;">Changes require your approval</h3>';
    email += '<p style="margin:0 0 12px;font-size:13px;color:#333;">Review the proposed changes below, then approve or reject by category.</p>';

    // Category buttons — only show if there are changes in that category
    var hasKwPauses = (results.keywordsPaused.length + results.ecomKeywordsPaused.length + results.lowQsPaused.length) > 0;
    var hasNegations = (results.smartNegated.length + results.ngramNegatives.length) > 0;
    var hasWinners = (results.winnersPromoted.length + results.ecomWinnersPromoted.length) > 0;
    var hasAutoOpt = (results.deviceAdjustments.length + results.scheduleAdjustments.length + results.geoAdjustments.length) > 0;
    var hasShoppingPmax = (results.shoppingProductsPaused.length + results.pmaxSearchTermsNegated.length) > 0;
    var hasFlagged = results.smartReviewTerms.length > 0;

    if (hasKwPauses) {
      var kwCount = results.keywordsPaused.length + results.ecomKeywordsPaused.length + results.lowQsPaused.length;
      email += '<a href="' + webAppUrl + '?runId=' + pendingRunId + '&amp;category=keyword_pauses" target="_blank" style="' + btnStyle + 'background:#1565c0;">Approve Keyword Pauses (' + kwCount + ')</a>';
      email += '<a href="' + webAppUrl + '?action=reject_category&amp;runId=' + pendingRunId + '&amp;category=keyword_pauses" target="_blank" style="' + rejBtnStyle + '">Reject</a> ';
    }
    if (hasNegations) {
      var negCount = results.smartNegated.length + results.ngramNegatives.length;
      email += '<a href="' + webAppUrl + '?runId=' + pendingRunId + '&amp;category=search_term_negations" target="_blank" style="' + btnStyle + 'background:#6a1b9a;">Approve Negations (' + negCount + ')</a>';
      email += '<a href="' + webAppUrl + '?action=reject_category&amp;runId=' + pendingRunId + '&amp;category=search_term_negations" target="_blank" style="' + rejBtnStyle + '">Reject</a> ';
    }
    if (hasWinners) {
      var winCount = results.winnersPromoted.length + results.ecomWinnersPromoted.length;
      email += '<a href="' + webAppUrl + '?runId=' + pendingRunId + '&amp;category=winner_promotions" target="_blank" style="' + btnStyle + 'background:#00695c;">Approve Winners (' + winCount + ')</a>';
      email += '<a href="' + webAppUrl + '?action=reject_category&amp;runId=' + pendingRunId + '&amp;category=winner_promotions" target="_blank" style="' + rejBtnStyle + '">Reject</a> ';
    }
    if (hasAutoOpt) {
      var autoCount = results.deviceAdjustments.length + results.scheduleAdjustments.length + results.geoAdjustments.length;
      email += '<a href="' + webAppUrl + '?runId=' + pendingRunId + '&amp;category=auto_optimizations" target="_blank" style="' + btnStyle + 'background:#e65100;">Approve Auto-Opt (' + autoCount + ')</a>';
      email += '<a href="' + webAppUrl + '?action=reject_category&amp;runId=' + pendingRunId + '&amp;category=auto_optimizations" target="_blank" style="' + rejBtnStyle + '">Reject</a> ';
    }
    if (hasShoppingPmax) {
      var spCount = results.shoppingProductsPaused.length + results.pmaxSearchTermsNegated.length;
      email += '<a href="' + webAppUrl + '?runId=' + pendingRunId + '&amp;category=shopping_pmax" target="_blank" style="' + btnStyle + 'background:#4527a0;">Approve Shopping/PMax (' + spCount + ')</a>';
      email += '<a href="' + webAppUrl + '?action=reject_category&amp;runId=' + pendingRunId + '&amp;category=shopping_pmax" target="_blank" style="' + rejBtnStyle + '">Reject</a> ';
    }
    if (hasFlagged) {
      email += '<a href="' + webAppUrl + '?view=flagged_review&amp;runId=' + pendingRunId + '" target="_blank" style="' + btnStyle + 'background:#795548;">Review &amp; Negate Flagged Terms (' + results.smartReviewTerms.length + ')</a> ';
    }

    // Approve All / Reject All buttons
    email += '<br><a href="' + webAppUrl + '?runId=' + pendingRunId + '&amp;category=all" target="_blank" style="' + btnStyle + 'background:#2e7d32;font-size:15px;padding:12px 28px;margin-top:8px;">Approve All Changes</a>';
    email += ' <a href="' + webAppUrl + '?action=reject&amp;runId=' + pendingRunId + '" target="_blank" style="' + rejBtnStyle + 'font-size:13px;padding:10px 20px;margin-top:8px;">Reject All</a>';

    // View status link
    email += '<br><a href="' + webAppUrl + '?view=run_status&amp;runId=' + pendingRunId + '" target="_blank" style="color:#1565c0;font-size:12px;margin-top:8px;display:inline-block;">View approval status for this run</a>';
    email += '</div>';
  } else if (pendingRunId && !CONFIG.APPROVAL_WEBAPP_URL) {
    email += '<div style="background:#fff3e0;padding:14px 16px;border-left:4px solid #f57c00;">';
    email += '<p style="margin:0;font-size:13px;">Changes are pending approval but no APPROVAL_WEBAPP_URL is configured. ';
    email += 'Add APPROVAL_WEBAPP_URL to the master sheet Config tab to enable email approval buttons.</p>';
    email += '</div>';
  }

  // v4.4.0: Eval summary
  if (evalResult) {
    var evalBg = evalResult.approved ? '#e8f5e9' : '#ffebee';
    var evalBorder = evalResult.approved ? '#2e7d32' : '#c62828';
    var evalIcon = evalResult.approved ? '✅' : '⚠️';
    email += '<div style="background:' + evalBg + ';padding:14px 16px;border-left:4px solid ' + evalBorder + ';">';
    email += '<h4 style="margin:0 0 6px;">' + evalIcon + ' AI Eval: ' + (evalResult.approved ? 'Approved' : 'Concerns Raised') + '</h4>';
    email += '<p style="margin:0;font-size:13px;">' + (evalResult.summary || 'No summary available') + '</p>';
    if (evalResult.concerns && evalResult.concerns.length > 0) {
      email += '<ul style="margin:8px 0 0;font-size:12px;color:#666;">';
      evalResult.concerns.forEach(function(c) { email += '<li>' + c + '</li>'; });
      email += '</ul>';
    }
    email += '</div>';
  }

  if (results.conversionAlert) {
    email += '<div style="background:#c62828;color:white;padding:14px 16px;font-weight:bold;font-size:14px;">🚨 ' + results.conversionAlert + '</div>';
  }

  email += '<div style="background:#f8f9fa;padding:15px;"><h3>Summary</h3><table style="width:100%;border-collapse:collapse;">';

  if (_isLeadGenMode()) {
    email += '<tr><td colspan="2" style="padding:8px;background:#e3f2fd;font-weight:bold;">Lead Gen</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Keywords Paused</td><td style="text-align:right;font-weight:bold;">' + results.keywordsPaused.length + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Search Terms Negated</td><td style="text-align:right;font-weight:bold;">' + results.searchTermsNegated.length + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Winners Promoted</td><td style="text-align:right;font-weight:bold;">' + results.winnersPromoted.length + '</td></tr>';
  }
  if (_isEcommerceMode()) {
    email += '<tr><td colspan="2" style="padding:8px;background:#e3f2fd;font-weight:bold;">Ecommerce</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Keywords Paused (ROAS)</td><td style="text-align:right;font-weight:bold;">' + results.ecomKeywordsPaused.length + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Search Terms Negated</td><td style="text-align:right;font-weight:bold;">' + results.ecomSearchTermsNegated.length + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Ecom Winners</td><td style="text-align:right;font-weight:bold;">' + results.ecomWinnersPromoted.length + '</td></tr>';
    email += '<tr><td colspan="2" style="padding:8px;background:#e3f2fd;font-weight:bold;">Shopping</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Zero Revenue Products</td><td style="text-align:right;font-weight:bold;color:#c62828;">' + results.shoppingProductsPaused.length + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Low ROAS Products</td><td style="text-align:right;font-weight:bold;color:#e65100;">' + results.shoppingLowROASProducts.length + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Hero Products</td><td style="text-align:right;font-weight:bold;color:#2e7d32;">' + results.shoppingHeroProducts.length + '</td></tr>';
    email += '<tr><td colspan="2" style="padding:8px;background:#e3f2fd;font-weight:bold;">Performance Max</td></tr>';
    email += '<tr><td style="padding:4px 8px;">PMax Alerts</td><td style="text-align:right;font-weight:bold;">' + results.pmaxAlerts.length + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">PMax Search Terms</td><td style="text-align:right;font-weight:bold;">' + results.pmaxSearchTermsNegated.length + '</td></tr>';
  }

  email += '<tr><td colspan="2" style="padding:8px;background:#e3f2fd;font-weight:bold;">Auto-Optimizations</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Device Bid Adjustments</td><td style="text-align:right;font-weight:bold;">' + results.deviceAdjustments.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Ad Schedule Adjustments</td><td style="text-align:right;font-weight:bold;">' + results.scheduleAdjustments.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Geographic Bid Adjustments</td><td style="text-align:right;font-weight:bold;">' + results.geoAdjustments.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">N-gram Negatives</td><td style="text-align:right;font-weight:bold;">' + results.ngramNegatives.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Low QS Keywords Paused</td><td style="text-align:right;font-weight:bold;">' + results.lowQsPaused.length + '</td></tr>';

  if (results.conversionHealth) {
    var ch = results.conversionHealth;
    var convColor = results.conversionAlert ? '#c62828' : '#2e7d32';
    email += '<tr><td colspan="2" style="padding:8px;background:#e3f2fd;font-weight:bold;">Conversion Health</td></tr>';
    email += '<tr><td style="padding:4px 8px;">This week</td><td style="text-align:right;font-weight:bold;color:' + convColor + ';">' + ch.thisWeek.toFixed(0) + ' conv</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Last week</td><td style="text-align:right;font-weight:bold;">' + ch.lastWeek.toFixed(0) + ' conv</td></tr>';
  }

  email += '<tr><td colspan="2" style="padding:8px;background:#e3f2fd;font-weight:bold;">AI Search Term Review</td></tr>';
  email += '<tr><td style="padding:4px 8px;">AI Auto-Negated</td><td style="text-align:right;font-weight:bold;color:#1565c0;">' + results.smartNegated.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">AI Flagged for Review</td><td style="text-align:right;font-weight:bold;color:#1565c0;">' + results.smartReviewTerms.length + '</td></tr>';

  email += '<tr><td colspan="2" style="padding:8px;background:#e3f2fd;font-weight:bold;">Other</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Budget Alerts</td><td style="text-align:right;font-weight:bold;">' + results.budgetAlerts.length + '</td></tr>';
  // Audit & Repair section (v4.1.2)
  if (results.auditRepairs && results.auditRepairs.length > 0) {
    var removedNegs = results.auditRepairs.filter(function(r) { return r.action === 'REMOVED_NEGATIVE'; }).length;
    var removedAgNegs = results.auditRepairs.filter(function(r) { return r.action === 'REMOVED_AG_NEGATIVE'; }).length;
    var unpaused = results.auditRepairs.filter(function(r) { return r.action === 'UNPAUSED_KEYWORD'; }).length;
    email += '<tr><td colspan="2" style="padding:8px;background:#e3f2fd;font-weight:bold;">Audit Findings (Manual Review)</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Shared List Issues</td><td style="text-align:right;font-weight:bold;color:#1565c0;">' + removedNegs + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Ad-Group Conflicts</td><td style="text-align:right;font-weight:bold;color:#1565c0;">' + removedAgNegs + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Paused Keywords to Review</td><td style="text-align:right;font-weight:bold;color:#1565c0;">' + unpaused + '</td></tr>';
  }

  email += '<tr><td style="padding:4px 8px;">Errors</td><td style="text-align:right;font-weight:bold;">' + results.errors.length + '</td></tr>';
  email += '</table></div>';

  // === DETAIL SECTIONS (v4.2.0) ===
  var cs = CONFIG.CURRENCY_SYMBOL || 'R';

  // Keywords Paused detail
  if (results.keywordsPaused.length > 0) {
    email += '<div style="padding:15px;"><h3>Keywords Paused</h3>';
    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    email += '<tr style="background:#e3f2fd;"><th style="padding:6px;text-align:left;">Keyword</th><th style="padding:6px;text-align:left;">Campaign</th><th style="padding:6px;text-align:left;">Ad Group</th><th style="padding:6px;text-align:right;">Spend</th></tr>';
    for (var kp = 0; kp < results.keywordsPaused.length; kp++) {
      var kpItem = results.keywordsPaused[kp];
      email += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px 6px;">' + kpItem.keyword + '</td><td style="padding:4px 6px;">' + kpItem.campaign + '</td><td style="padding:4px 6px;">' + kpItem.adGroup + '</td><td style="padding:4px 6px;text-align:right;">' + cs + (kpItem.spend || 0).toFixed(0) + '</td></tr>';
    }
    email += '</table></div>';
  }

  // Search Terms Negated detail
  if (results.searchTermsNegated.length > 0) {
    email += '<div style="padding:15px;"><h3>Search Terms Negated</h3>';
    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    email += '<tr style="background:#e3f2fd;"><th style="padding:6px;text-align:left;">Search Term</th><th style="padding:6px;text-align:left;">Campaign</th><th style="padding:6px;text-align:right;">Spend</th></tr>';
    for (var stn = 0; stn < results.searchTermsNegated.length; stn++) {
      var snItem = results.searchTermsNegated[stn];
      email += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px 6px;">' + snItem.searchTerm + '</td><td style="padding:4px 6px;">' + snItem.campaign + '</td><td style="padding:4px 6px;text-align:right;">' + cs + (snItem.spend || 0).toFixed(0) + '</td></tr>';
    }
    email += '</table></div>';
  }

  // Winners Promoted detail
  if (results.winnersPromoted.length > 0) {
    email += '<div style="padding:15px;"><h3 style="color:#1565c0;">Winners Promoted</h3>';
    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    email += '<tr style="background:#e3f2fd;"><th style="padding:6px;text-align:left;">Search Term</th><th style="padding:6px;text-align:left;">Campaign</th><th style="padding:6px;text-align:right;">Conversions</th><th style="padding:6px;text-align:right;">CVR</th></tr>';
    for (var wp = 0; wp < results.winnersPromoted.length; wp++) {
      var wpItem = results.winnersPromoted[wp];
      email += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px 6px;">[' + wpItem.searchTerm + ']</td><td style="padding:4px 6px;">' + wpItem.campaign + '</td><td style="padding:4px 6px;text-align:right;">' + (wpItem.conversions || 0) + '</td><td style="padding:4px 6px;text-align:right;">' + (wpItem.cvr || 0).toFixed(1) + '%</td></tr>';
    }
    email += '</table></div>';
  }

  // Ecommerce Keywords Paused detail
  if (results.ecomKeywordsPaused.length > 0) {
    email += '<div style="padding:15px;"><h3>Ecom Keywords Paused</h3>';
    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    email += '<tr style="background:#e3f2fd;"><th style="padding:6px;text-align:left;">Keyword</th><th style="padding:6px;text-align:left;">Campaign</th><th style="padding:6px;text-align:right;">Spend</th><th style="padding:6px;text-align:right;">ROAS</th></tr>';
    for (var ek = 0; ek < results.ecomKeywordsPaused.length; ek++) {
      var ekItem = results.ecomKeywordsPaused[ek];
      email += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px 6px;">' + ekItem.keyword + '</td><td style="padding:4px 6px;">' + ekItem.campaign + '</td><td style="padding:4px 6px;text-align:right;">' + cs + (ekItem.spend || 0).toFixed(0) + '</td><td style="padding:4px 6px;text-align:right;">' + (ekItem.roas || 0).toFixed(2) + 'x</td></tr>';
    }
    email += '</table></div>';
  }

  // Ecommerce Search Terms Negated detail
  if (results.ecomSearchTermsNegated.length > 0) {
    email += '<div style="padding:15px;"><h3>Ecom Search Terms Negated</h3>';
    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    email += '<tr style="background:#e3f2fd;"><th style="padding:6px;text-align:left;">Search Term</th><th style="padding:6px;text-align:left;">Campaign</th><th style="padding:6px;text-align:right;">Spend</th><th style="padding:6px;text-align:right;">ROAS</th></tr>';
    for (var es = 0; es < results.ecomSearchTermsNegated.length; es++) {
      var esItem = results.ecomSearchTermsNegated[es];
      email += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px 6px;">' + esItem.searchTerm + '</td><td style="padding:4px 6px;">' + esItem.campaign + '</td><td style="padding:4px 6px;text-align:right;">' + cs + (esItem.spend || 0).toFixed(0) + '</td><td style="padding:4px 6px;text-align:right;">' + (esItem.roas || 0).toFixed(2) + 'x</td></tr>';
    }
    email += '</table></div>';
  }

  // v4.3.0: Informational Blocked section removed — handled by unified AI review

  // N-gram Negatives detail
  if (results.ngramNegatives.length > 0) {
    email += '<div style="padding:15px;"><h3>N-gram Negatives</h3>';
    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    email += '<tr style="background:#e3f2fd;"><th style="padding:6px;text-align:left;">Word</th><th style="padding:6px;text-align:right;">Total Spend</th><th style="padding:6px;text-align:right;">Terms</th><th style="padding:6px;text-align:left;">Samples</th></tr>';
    for (var ng = 0; ng < results.ngramNegatives.length; ng++) {
      var ngItem = results.ngramNegatives[ng];
      email += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px 6px;">"' + ngItem.word + '"</td><td style="padding:4px 6px;text-align:right;">' + cs + (ngItem.totalCost || 0).toFixed(0) + '</td><td style="padding:4px 6px;text-align:right;">' + ngItem.termCount + '</td><td style="padding:4px 6px;color:#666;">' + (ngItem.sampleTerms || []).slice(0, 3).join(', ') + '</td></tr>';
    }
    email += '</table></div>';
  }

  // Low QS Keywords detail
  if (results.lowQsPaused.length > 0) {
    email += '<div style="padding:15px;"><h3>Low Quality Score Keywords Paused</h3>';
    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    email += '<tr style="background:#e3f2fd;"><th style="padding:6px;text-align:left;">Keyword</th><th style="padding:6px;text-align:left;">Campaign</th><th style="padding:6px;text-align:right;">QS</th><th style="padding:6px;text-align:right;">Spend</th></tr>';
    for (var lq = 0; lq < results.lowQsPaused.length; lq++) {
      var lqItem = results.lowQsPaused[lq];
      email += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px 6px;">' + lqItem.keyword + '</td><td style="padding:4px 6px;">' + lqItem.campaign + '</td><td style="padding:4px 6px;text-align:right;">' + lqItem.qualityScore + '</td><td style="padding:4px 6px;text-align:right;">' + cs + (lqItem.spend || 0).toFixed(0) + '</td></tr>';
    }
    email += '</table></div>';
  }

  // Schedule Adjustments detail
  if (results.scheduleAdjustments.length > 0) {
    email += '<div style="padding:15px;"><h3>Ad Schedule Adjustments</h3>';
    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    email += '<tr style="background:#e3f2fd;"><th style="padding:6px;text-align:left;">Campaign</th><th style="padding:6px;text-align:left;">Hour</th><th style="padding:6px;text-align:right;">Adjustment</th></tr>';
    for (var sa = 0; sa < results.scheduleAdjustments.length; sa++) {
      var saItem = results.scheduleAdjustments[sa];
      email += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px 6px;">' + saItem.campaign + '</td><td style="padding:4px 6px;">' + saItem.hourLabel + '</td><td style="padding:4px 6px;text-align:right;">' + saItem.adjustment + '%</td></tr>';
    }
    email += '</table></div>';
  }

  // AI Smart Negation details
  if (results.smartNegated.length > 0) {
    email += '<div style="padding:15px;"><h3 style="color:#1565c0;">AI Auto-Negated Search Terms</h3>';
    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    email += '<tr style="background:#e3f2fd;"><th style="padding:6px;text-align:left;">Search Term</th><th style="padding:6px;text-align:right;">Cost</th><th style="padding:6px;text-align:right;">Clicks</th><th style="padding:6px;text-align:left;">Reason</th></tr>';
    for (var sn = 0; sn < results.smartNegated.length; sn++) {
      var item = results.smartNegated[sn];
      email += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px 6px;">' + item.term + '</td><td style="padding:4px 6px;text-align:right;">' + cs + item.cost.toFixed(0) + '</td><td style="padding:4px 6px;text-align:right;">' + item.clicks + '</td><td style="padding:4px 6px;color:#666;">' + item.reason + '</td></tr>';
    }
    email += '</table></div>';
  }

  // AI Flagged for Review section
  if (results.smartReviewTerms.length > 0) {
    email += '<div style="padding:15px;background:#e3f2fd;"><h3 style="color:#1565c0;">AI Flagged for Review</h3>';
    email += '<p style="font-size:12px;color:#666;">These terms were flagged as ambiguous by the AI. Please review and manually negate or keep.</p>';

    // v4.5.0: Interactive review button — links to webapp where user can select terms to negate or give natural language instructions
    // (Uses &amp; so Gmail doesn't strip the query string)
    if (pendingRunId && CONFIG.APPROVAL_WEBAPP_URL) {
      email += '<a href="' + CONFIG.APPROVAL_WEBAPP_URL + '?view=flagged_review&amp;runId=' + pendingRunId + '" target="_blank" style="display:inline-block;padding:10px 18px;margin:8px 0;border-radius:6px;color:white;text-decoration:none;font-weight:bold;font-size:13px;background:#1565c0;">Review &amp; Negate Flagged Terms (' + results.smartReviewTerms.length + ')</a>';
      email += '<p style="font-size:11px;color:#888;margin:4px 0 10px;">Click above to select which terms to negate, or type natural language instructions (e.g. "negate all competitor names but keep facebook").</p>';
    }

    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    email += '<tr style="background:#bbdefb;"><th style="padding:6px;text-align:left;">Search Term</th><th style="padding:6px;text-align:right;">Cost</th><th style="padding:6px;text-align:right;">Clicks</th><th style="padding:6px;text-align:left;">Reason</th></tr>';
    for (var sr = 0; sr < results.smartReviewTerms.length; sr++) {
      var rItem = results.smartReviewTerms[sr];
      email += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px 6px;">' + rItem.term + '</td><td style="padding:4px 6px;text-align:right;">' + cs + rItem.cost.toFixed(0) + '</td><td style="padding:4px 6px;text-align:right;">' + rItem.clicks + '</td><td style="padding:4px 6px;color:#666;">' + rItem.reason + '</td></tr>';
    }
    email += '</table></div>';
  }

  // Audit Findings details (report-only)
  if (results.auditRepairs && results.auditRepairs.length > 0) {
    email += '<div style="padding:15px;background:#e3f2fd;"><h3 style="color:#1565c0;">Audit Findings — Manual Review Required</h3>';
    email += '<p style="font-size:12px;color:#666;">The following potential issues were detected. Review and take action manually in Google Ads.</p>';
    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    email += '<tr style="background:#bbdefb;"><th style="padding:6px;text-align:left;">Action</th><th style="padding:6px;text-align:left;">Keyword</th><th style="padding:6px;text-align:left;">Location</th><th style="padding:6px;text-align:left;">Reason</th></tr>';
    for (var ar = 0; ar < results.auditRepairs.length; ar++) {
      var repair = results.auditRepairs[ar];
      var actionLabel = repair.action === 'REMOVED_NEGATIVE' ? 'Shared list conflict' : repair.action === 'REMOVED_AG_NEGATIVE' ? 'AG conflict' : 'Consider unpause';
      email += '<tr style="border-bottom:1px solid #eee;"><td style="padding:4px 6px;">' + actionLabel + '</td><td style="padding:4px 6px;">' + repair.entity + '</td><td style="padding:4px 6px;">' + repair.location + '</td><td style="padding:4px 6px;color:#666;">' + repair.reason + '</td></tr>';
    }
    email += '</table></div>';
  }

  // Errors detail (v4.2.0)
  if (results.errors.length > 0) {
    email += '<div style="padding:15px;background:#ffebee;"><h3 style="color:#c62828;">Errors</h3>';
    email += '<ul style="font-size:13px;">';
    for (var ei = 0; ei < results.errors.length; ei++) {
      email += '<li>' + results.errors[ei] + '</li>';
    }
    email += '</ul></div>';
  }

  email += '<div style="padding:15px;color:#666;font-size:12px;"><p>Completed in ' + duration.toFixed(1) + 's | Core v4.5.0 | Syte Digital Agency</p></div></body></html>';

  var recipients = CONFIG.EMAIL_ADDRESSES || [CONFIG.EMAIL_RECIPIENT || 'michaelh@syte.co.za'];
  if (typeof recipients === 'string') recipients = [recipients];
  MailApp.sendEmail({ to: recipients.join(','), subject: mode + ' Syte v4.5.0 | ' + accountName + ' | ' + CONFIG.ACCOUNT_MODE, htmlBody: email });
}


// ============================================
// CONFIG VALIDATION (v4.2.0)
// ============================================

function _validateConfig() {
  var warnings = [];

  if (!CONFIG.MASTER_SHEET_ID && !CONFIG.SHEET_URL) {
    warnings.push('No MASTER_SHEET_ID or SHEET_URL — change logging disabled');
  }
  if (!CONFIG.ANTHROPIC_API_KEY) {
    warnings.push('No ANTHROPIC_API_KEY — AI features disabled');
  }
  if (!CONFIG.PROTECTED_TERMS || CONFIG.PROTECTED_TERMS.length === 0) {
    warnings.push('PROTECTED_TERMS empty — core keywords have NO manual protection');
  }
  if (CONFIG.PROTECTED_TERMS) {
    var seen = {};
    CONFIG.PROTECTED_TERMS.forEach(function(t) {
      var lower = t.toLowerCase();
      if (seen[lower]) warnings.push('Duplicate in PROTECTED_TERMS: "' + t + '"');
      seen[lower] = true;
    });
  }
  if (!CONFIG.CLIENT_NAME) warnings.push('CLIENT_NAME not set');
  if (!CONFIG.CLIENT_WEBSITE) warnings.push('CLIENT_WEBSITE not set — AI has less context');

  for (var i = 0; i < warnings.length; i++) {
    _log('WARN', 'CONFIG: ' + warnings[i]);
  }
  return warnings;
}


// ============================================
// EVAL STEP — Claude reviews proposed changes (v4.4.0)
// ============================================

/**
 * Sends the full set of proposed changes to Claude for evaluation.
 * Claude reviews all changes in context and returns an assessment.
 * Returns: { approved: boolean, concerns: string[], summary: string }
 */
function _evalProposedChanges(results) {
  if (!CONFIG.ANTHROPIC_API_KEY) {
    _log('WARN', 'No ANTHROPIC_API_KEY — eval step skipped (auto-approved)');
    return { approved: true, concerns: [], summary: 'Eval skipped: no API key' };
  }

  var changeCount = _countProposedChanges(results);
  if (changeCount === 0) {
    _log('INFO', 'No proposed changes — eval step skipped');
    return { approved: true, concerns: [], summary: 'No changes proposed' };
  }

  _log('INFO', 'Running eval on ' + changeCount + ' proposed changes...');

  var cs = CONFIG.CURRENCY_SYMBOL || 'R';
  var accountName = AdsApp.currentAccount().getName();

  // Build a summary of all proposed changes
  var changeSummary = '=== PROPOSED CHANGES SUMMARY ===\n';
  changeSummary += 'Account: ' + accountName + '\n';
  changeSummary += 'Mode: ' + CONFIG.ACCOUNT_MODE + '\n';
  changeSummary += 'Total proposed changes: ' + changeCount + '\n\n';

  if (results.keywordsPaused.length > 0) {
    changeSummary += 'KEYWORD PAUSES (' + results.keywordsPaused.length + '):\n';
    results.keywordsPaused.forEach(function(k) {
      changeSummary += '  - "' + k.keyword + '" | Campaign: ' + k.campaign + ' | Spend: ' + cs + (k.spend || 0).toFixed(0) + '\n';
    });
    changeSummary += '\n';
  }

  if (results.ecomKeywordsPaused.length > 0) {
    changeSummary += 'ECOM KEYWORD PAUSES (' + results.ecomKeywordsPaused.length + '):\n';
    results.ecomKeywordsPaused.forEach(function(k) {
      changeSummary += '  - "' + k.keyword + '" | ROAS: ' + (k.roas || 0).toFixed(2) + 'x | Spend: ' + cs + (k.spend || 0).toFixed(0) + '\n';
    });
    changeSummary += '\n';
  }

  if (results.lowQsPaused.length > 0) {
    changeSummary += 'LOW QS KEYWORD PAUSES (' + results.lowQsPaused.length + '):\n';
    results.lowQsPaused.forEach(function(k) {
      changeSummary += '  - "' + k.keyword + '" | QS: ' + k.qualityScore + ' | Spend: ' + cs + (k.spend || 0).toFixed(0) + '\n';
    });
    changeSummary += '\n';
  }

  if (results.smartNegated.length > 0) {
    changeSummary += 'AI SEARCH TERM NEGATIONS (' + results.smartNegated.length + '):\n';
    results.smartNegated.forEach(function(s) {
      changeSummary += '  - "' + s.term + '" | Cost: ' + cs + s.cost.toFixed(0) + ' | Reason: ' + s.reason + '\n';
    });
    changeSummary += '\n';
  }

  if (results.ngramNegatives.length > 0) {
    changeSummary += 'N-GRAM NEGATIVES (' + results.ngramNegatives.length + '):\n';
    results.ngramNegatives.forEach(function(n) {
      changeSummary += '  - "' + n.word + '" | Total cost: ' + cs + (n.totalCost || 0).toFixed(0) + ' | ' + n.termCount + ' terms\n';
    });
    changeSummary += '\n';
  }

  if (results.winnersPromoted.length > 0) {
    changeSummary += 'WINNER PROMOTIONS (' + results.winnersPromoted.length + '):\n';
    results.winnersPromoted.forEach(function(w) {
      changeSummary += '  - "' + w.searchTerm + '" | Conv: ' + (w.conversions || 0) + ' | CVR: ' + (w.cvr || 0).toFixed(1) + '%\n';
    });
    changeSummary += '\n';
  }

  if (results.ecomWinnersPromoted.length > 0) {
    changeSummary += 'ECOM WINNER PROMOTIONS (' + results.ecomWinnersPromoted.length + '):\n';
    results.ecomWinnersPromoted.forEach(function(w) {
      changeSummary += '  - "' + w.searchTerm + '" | ROAS: ' + (w.roas || 0).toFixed(2) + 'x | Rev: ' + cs + (w.revenue || 0).toFixed(0) + '\n';
    });
    changeSummary += '\n';
  }

  if (results.deviceAdjustments.length > 0) {
    changeSummary += 'DEVICE BID ADJUSTMENTS (' + results.deviceAdjustments.length + '):\n';
    results.deviceAdjustments.forEach(function(d) {
      changeSummary += '  - "' + d.campaign + '" | ' + d.device + ' | ' + (d.adjustment > 0 ? '+' : '') + d.adjustment + '%\n';
    });
    changeSummary += '\n';
  }

  if (results.scheduleAdjustments.length > 0) {
    changeSummary += 'SCHEDULE ADJUSTMENTS (' + results.scheduleAdjustments.length + '):\n';
    results.scheduleAdjustments.forEach(function(s) {
      changeSummary += '  - "' + s.campaign + '" | ' + s.hourLabel + ' | ' + s.adjustment + '%\n';
    });
    changeSummary += '\n';
  }

  if (results.geoAdjustments.length > 0) {
    changeSummary += 'GEO BID ADJUSTMENTS (' + results.geoAdjustments.length + '):\n';
    results.geoAdjustments.forEach(function(g) {
      changeSummary += '  - "' + g.campaign + '" | Location: ' + g.location + ' | ' + g.adjustment + '%\n';
    });
    changeSummary += '\n';
  }

  if (results.shoppingProductsPaused.length > 0) {
    changeSummary += 'SHOPPING PRODUCTS TO EXCLUDE (' + results.shoppingProductsPaused.length + '):\n';
    results.shoppingProductsPaused.forEach(function(p) {
      changeSummary += '  - "' + p.productTitle + '" | Spend: ' + cs + (p.cost || 0).toFixed(0) + '\n';
    });
    changeSummary += '\n';
  }

  if (results.pmaxSearchTermsNegated.length > 0) {
    changeSummary += 'PMAX SEARCH TERM NEGATIONS (' + results.pmaxSearchTermsNegated.length + '):\n';
    results.pmaxSearchTermsNegated.forEach(function(p) {
      changeSummary += '  - "' + (p.searchTerm || p.term) + '" | Spend: ' + cs + (p.spend || p.cost || 0).toFixed(0) + '\n';
    });
    changeSummary += '\n';
  }

  // Conversion health context
  if (results.conversionHealth) {
    changeSummary += 'CONVERSION HEALTH:\n';
    changeSummary += '  This week: ' + results.conversionHealth.thisWeek.toFixed(0) + ' conversions\n';
    changeSummary += '  Last week: ' + results.conversionHealth.lastWeek.toFixed(0) + ' conversions\n\n';
  }

  // Build the eval prompt
  var prompt = 'You are a senior Google Ads strategist reviewing proposed automated changes BEFORE they are applied.\n\n';
  prompt += 'CLIENT CONTEXT:\n';
  prompt += 'Name: ' + (CONFIG.CLIENT_NAME || accountName) + '\n';
  prompt += 'Website: ' + (CONFIG.CLIENT_WEBSITE || 'N/A') + '\n';
  prompt += 'Industry: ' + (CONFIG.CLIENT_INDUSTRY || 'N/A') + '\n';
  prompt += 'Account mode: ' + CONFIG.ACCOUNT_MODE + '\n';
  if (CLIENT_CONTEXT) {
    prompt += '\nBUSINESS CONTEXT (from account manager):\n' + CLIENT_CONTEXT + '\n';
  }
  prompt += '\n' + changeSummary;

  prompt += '=== YOUR TASK ===\n';
  prompt += 'Review ALL proposed changes above. For each category, assess:\n';
  prompt += '1. Are these changes safe and appropriate for this client?\n';
  prompt += '2. Do any changes conflict with the business context or client strategy?\n';
  prompt += '3. Are there any keywords/terms being paused or negated that should be kept?\n';
  prompt += '4. Are the bid adjustments reasonable?\n';
  prompt += '5. Overall, would you approve these changes?\n\n';

  prompt += 'Respond with ONLY a JSON object:\n';
  prompt += '{\n';
  prompt += '  "approved": true/false,\n';
  prompt += '  "concerns": ["concern 1", "concern 2"],\n';
  prompt += '  "summary": "Brief 2-3 sentence overall assessment"\n';
  prompt += '}\n\n';
  prompt += 'Set approved=true if the changes are generally safe, even if you have minor concerns.\n';
  prompt += 'Set approved=false ONLY if there are serious issues that could harm the account.\n';
  prompt += 'Be practical — the script has safety rails (protected terms, active keyword protection).\n';

  var aiResponse = _callClaude(prompt, 2000);
  if (!aiResponse) {
    _log('WARN', 'Eval: Claude API call failed — auto-approved');
    return { approved: true, concerns: [], summary: 'Eval API call failed — auto-approved' };
  }

  try {
    var jsonStr = aiResponse;
    var codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
    var objectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      var evalResult = JSON.parse(objectMatch[0]);
      _log('INFO', 'Eval result: approved=' + evalResult.approved + ' | concerns=' + (evalResult.concerns || []).length);
      if (evalResult.concerns && evalResult.concerns.length > 0) {
        evalResult.concerns.forEach(function(c) { _log('INFO', 'Eval concern: ' + c); });
      }
      return {
        approved: evalResult.approved !== false,
        concerns: evalResult.concerns || [],
        summary: evalResult.summary || ''
      };
    }
  } catch (parseErr) {
    _log('WARN', 'Eval: JSON parse error: ' + parseErr.message);
  }

  return { approved: true, concerns: [], summary: 'Eval response could not be parsed — auto-approved' };
}

function _countProposedChanges(results) {
  return (results.keywordsPaused || []).length +
    (results.ecomKeywordsPaused || []).length +
    (results.lowQsPaused || []).length +
    (results.smartNegated || []).length +
    (results.ngramNegatives || []).length +
    (results.winnersPromoted || []).length +
    (results.ecomWinnersPromoted || []).length +
    (results.deviceAdjustments || []).length +
    (results.scheduleAdjustments || []).length +
    (results.geoAdjustments || []).length +
    (results.shoppingProductsPaused || []).length +
    (results.pmaxSearchTermsNegated || []).length;
}


// ============================================
// PENDING CHANGES — APPROVAL SYSTEM (v4.4.0)
// ============================================

/**
 * Gets or creates the PendingChanges sheet tab.
 */
function _getPendingChangesSheet() {
  if (!CONFIG.MASTER_SHEET_ID) return null;
  try {
    var ss = SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
    var sheet = ss.getSheetByName('PendingChanges');
    if (!sheet) {
      sheet = ss.insertSheet('PendingChanges');
      sheet.appendRow([
        'run_id', 'timestamp', 'account_name', 'status',
        'approved_categories', 'approved_by', 'approved_at',
        'notes', 'changes_json', 'eval_summary', 'category_decisions'
      ]);
      sheet.setFrozenRows(1);
    } else {
      // Auto-migrate: add category_decisions column if missing
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      if (headers.indexOf('category_decisions') === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue('category_decisions');
      }
    }
    return sheet;
  } catch (e) {
    _log('ERROR', 'getPendingChangesSheet: ' + e.message);
    return null;
  }
}

/**
 * Groups results into approval categories and writes to PendingChanges sheet.
 * Returns the run_id.
 */
function _writePendingChanges(results, evalResult) {
  var sheet = _getPendingChangesSheet();
  if (!sheet) {
    _log('WARN', 'Cannot write pending changes — no sheet access');
    return null;
  }

  var runId = _generateChangeId();
  var accountName = AdsApp.currentAccount().getName();

  // Group changes by approval category
  var changesObj = {
    keyword_pauses: {
      keywordsPaused: results.keywordsPaused || [],
      ecomKeywordsPaused: results.ecomKeywordsPaused || [],
      lowQsPaused: results.lowQsPaused || []
    },
    search_term_negations: {
      smartNegated: results.smartNegated || [],
      ngramNegatives: results.ngramNegatives || []
    },
    winner_promotions: {
      winnersPromoted: results.winnersPromoted || [],
      ecomWinnersPromoted: results.ecomWinnersPromoted || []
    },
    auto_optimizations: {
      deviceAdjustments: results.deviceAdjustments || [],
      scheduleAdjustments: results.scheduleAdjustments || [],
      geoAdjustments: results.geoAdjustments || []
    },
    shopping_pmax: {
      shoppingProductsPaused: results.shoppingProductsPaused || [],
      pmaxSearchTermsNegated: results.pmaxSearchTermsNegated || []
    },
    flagged_review: {
      terms: results.smartReviewTerms || [],
      selectedForNegation: []  // populated by webapp when user reviews
    }
  };

  try {
    sheet.appendRow([
      runId,
      _formatDatetime(new Date()),
      accountName,
      'PENDING',
      '',  // approved_categories — empty until approved
      '',  // approved_by
      '',  // approved_at
      '',  // notes
      JSON.stringify(changesObj),
      evalResult ? evalResult.summary : '',
      '{}'  // category_decisions — per-category approve/reject with reasons
    ]);
    _log('INFO', 'Pending changes written: run_id=' + runId);
  } catch (e) {
    _log('ERROR', 'writePendingChanges: ' + e.message);
    return null;
  }

  return runId;
}

/**
 * Checks for approved pending changes from previous runs and applies them.
 * Also expires unapproved changes older than PENDING_EXPIRY_DAYS.
 */
function _checkAndApplyPendingChanges(results) {
  var sheet = _getPendingChangesSheet();
  if (!sheet) return;

  var accountName = AdsApp.currentAccount().getName();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return;

  var headers = data[0];
  var colIdx = {};
  headers.forEach(function(h, i) { colIdx[h] = i; });

  var expiryDays = CONFIG.PENDING_EXPIRY_DAYS || 7;
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - expiryDays);

  for (var r = data.length - 1; r >= 1; r--) {
    var row = data[r];
    if (row[colIdx['account_name']] !== accountName) continue;

    var status = String(row[colIdx['status']]).trim();
    var approvedCategories = String(row[colIdx['approved_categories']] || '').trim();
    var timestamp = new Date(row[colIdx['timestamp']]);
    var runId = row[colIdx['run_id']];

    // Expire old pending changes
    if (status === 'PENDING' && timestamp < cutoff) {
      sheet.getRange(r + 1, colIdx['status'] + 1).setValue('EXPIRED');
      _log('INFO', 'Expired pending changes: ' + runId);
      continue;
    }

    // Apply approved changes
    if (status === 'PENDING' && approvedCategories) {
      _log('INFO', 'Found approved pending changes: ' + runId + ' | categories: ' + approvedCategories);
      try {
        var changesJson = JSON.parse(row[colIdx['changes_json']]);
        var applied = _applyApprovedChanges(changesJson, approvedCategories, results);
        sheet.getRange(r + 1, colIdx['status'] + 1).setValue('APPLIED');
        _log('INFO', 'Applied ' + applied + ' changes from run ' + runId);
      } catch (e) {
        _log('ERROR', 'Failed to apply pending changes ' + runId + ': ' + e.message);
        results.errors.push('Failed to apply pending changes: ' + e.message);
      }
    }
  }
}

/**
 * Applies approved changes by category. Executes the actual Google Ads API calls.
 * Returns the total number of changes applied.
 */
function _applyApprovedChanges(changesObj, approvedCategories, results) {
  var categories = approvedCategories === 'all'
    ? ['keyword_pauses', 'search_term_negations', 'winner_promotions', 'auto_optimizations', 'shopping_pmax', 'flagged_review_negations']
    : approvedCategories.split(',').map(function(c) { return c.trim(); });

  var appliedCount = 0;

  // === KEYWORD PAUSES ===
  if (categories.indexOf('keyword_pauses') !== -1 && changesObj.keyword_pauses) {
    var kpData = changesObj.keyword_pauses;
    var allKwPauses = (kpData.keywordsPaused || []).concat(kpData.ecomKeywordsPaused || [], kpData.lowQsPaused || []);
    allKwPauses.forEach(function(k) {
      try {
        var ki = AdsApp.keywords()
          .withCondition('ad_group.name = "' + k.adGroup + '"')
          .withCondition('campaign.name = "' + k.campaign + '"')
          .withCondition('ad_group_criterion.keyword.text = "' + k.keyword + '"').get();
        while (ki.hasNext()) { ki.next().pause(); appliedCount++; }
        _logChange({ functionName: 'approval_apply', entity: k.keyword, entityType: 'KEYWORD', campaign: k.campaign, adGroup: k.adGroup, reason: 'Approved keyword pause', spend: k.spend || 0, conversions: 0 });
      } catch (e) { _log('WARN', 'Apply keyword pause failed: ' + k.keyword + ' — ' + e.message); }
    });
    _log('INFO', 'Applied ' + allKwPauses.length + ' keyword pauses');
  }

  // === SEARCH TERM NEGATIONS ===
  if (categories.indexOf('search_term_negations') !== -1 && changesObj.search_term_negations) {
    var stData = changesObj.search_term_negations;

    // AI negations
    var negativeListSpend = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_SPEND);
    var negativeListInfo = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_INFORMATIONAL);
    var negativeListIrr = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_IRRELEVANT);

    (stData.smartNegated || []).forEach(function(s) {
      try {
        // v4.5.0: Route PMax negatives to campaign-level, others to shared lists
        if (s.channelType === 'PERFORMANCE_MAX' && s.campaign) {
          var pmaxIter = AdsApp.performanceMaxCampaigns()
            .withCondition('campaign.name = "' + s.campaign.replace(/"/g, '\\"') + '"').get();
          if (pmaxIter.hasNext()) {
            pmaxIter.next().createNegativeKeyword('[' + s.term + ']');
          } else if (negativeListSpend) {
            negativeListSpend.addNegativeKeyword('[' + s.term + ']');
          }
        } else {
          var reason = (s.reason || '').toLowerCase();
          var targetList = negativeListSpend;
          if (reason.indexOf('wrong industry') !== -1 || reason.indexOf('irrelevant') !== -1) {
            targetList = negativeListIrr;
          } else if (reason.indexOf('job') !== -1 || reason.indexOf('career') !== -1 ||
                     reason.indexOf('academic') !== -1 || reason.indexOf('educational') !== -1 ||
                     reason.indexOf('informational') !== -1 || reason.indexOf('diy') !== -1 ||
                     reason.indexOf('tutorial') !== -1 || reason.indexOf('how to') !== -1) {
            targetList = negativeListInfo;
          }
          if (targetList) targetList.addNegativeKeyword('[' + s.term + ']');
        }
        appliedCount++;
        _logChange({ functionName: 'approval_apply', entity: s.term, entityType: 'SEARCH_TERM_NEGATIVE', campaign: s.campaign || '', reason: 'Approved AI negate: ' + s.reason, spend: s.cost || 0, conversions: 0 });
      } catch (e) { _log('WARN', 'Apply negation failed: ' + s.term + ' — ' + e.message); }
    });

    // N-gram negations
    (stData.ngramNegatives || []).forEach(function(n) {
      try {
        if (negativeListSpend) { negativeListSpend.addNegativeKeyword('"' + n.word + '"'); appliedCount++; }
        _logChange({ functionName: 'approval_apply', entity: n.word, entityType: 'NGRAM_NEGATIVE', reason: 'Approved n-gram negate', spend: n.totalCost || 0, conversions: 0 });
      } catch (e) { _log('WARN', 'Apply n-gram negation failed: ' + n.word + ' — ' + e.message); }
    });
    _log('INFO', 'Applied search term negations');
  }

  // === WINNER PROMOTIONS ===
  if (categories.indexOf('winner_promotions') !== -1 && changesObj.winner_promotions) {
    var wpData = changesObj.winner_promotions;
    (wpData.winnersPromoted || []).concat(wpData.ecomWinnersPromoted || []).forEach(function(w) {
      try {
        _createExactMatchWinner(w.searchTerm, w.campaign, w.adGroup);
        appliedCount++;
        _logChange({ functionName: 'approval_apply', entity: w.searchTerm, entityType: 'EXACT_MATCH_PROMOTION', campaign: w.campaign, adGroup: w.adGroup, reason: 'Approved winner promotion', spend: w.spend || 0, conversions: w.conversions || 0 });
      } catch (e) { _log('WARN', 'Apply winner promotion failed: ' + w.searchTerm + ' — ' + e.message); }
    });
    _log('INFO', 'Applied winner promotions');
  }

  // === AUTO-OPTIMIZATIONS ===
  if (categories.indexOf('auto_optimizations') !== -1 && changesObj.auto_optimizations) {
    var aoData = changesObj.auto_optimizations;

    // Device bids
    (aoData.deviceAdjustments || []).forEach(function(d) {
      try {
        var ci = AdsApp.campaigns().withCondition('campaign.name = "' + d.campaign + '"').get();
        if (ci.hasNext()) {
          var platforms = ci.next().targeting().platforms().get();
          while (platforms.hasNext()) {
            var platform = platforms.next();
            if ((d.device === 'MOBILE' && platform.getName() === 'Mobile devices with full browsers') ||
                (d.device === 'TABLET' && platform.getName() === 'Tablets with full browsers')) {
              platform.setBidModifier(1 + (d.adjustment / 100));
              appliedCount++;
            }
          }
        }
      } catch (e) { _log('WARN', 'Apply device bid failed: ' + e.message); }
    });

    // Schedule adjustments
    (aoData.scheduleAdjustments || []).forEach(function(s) {
      try {
        var ci = AdsApp.campaigns().withCondition('campaign.name = "' + s.campaign + '"').get();
        if (ci.hasNext()) {
          var campaign = ci.next();
          var days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
          for (var d = 0; d < days.length; d++) {
            try {
              campaign.addAdSchedule({ dayOfWeek: days[d], startHour: s.hour, startMinute: 0, endHour: s.hour + 1, endMinute: 0, bidModifier: 1 + (s.adjustment / 100) });
            } catch (e2) {
              var schedules = campaign.targeting().adSchedules().get();
              while (schedules.hasNext()) {
                var sched = schedules.next();
                if (sched.getStartHour() === s.hour && sched.getDayOfWeek() === days[d]) { sched.setBidModifier(1 + (s.adjustment / 100)); break; }
              }
            }
          }
          appliedCount++;
        }
      } catch (e) { _log('WARN', 'Apply schedule adjustment failed: ' + e.message); }
    });

    // Geo adjustments
    (aoData.geoAdjustments || []).forEach(function(g) {
      try {
        var modifier = 1 + (g.adjustment / 100);
        _setGeoBidModifier(g.campaign, g.location, modifier);
        appliedCount++;
      } catch (e) { _log('WARN', 'Apply geo adjustment failed: ' + e.message); }
    });

    _log('INFO', 'Applied auto-optimizations');
  }

  // === FLAGGED REVIEW NEGATIONS (v4.5.0) ===
  if (categories.indexOf('flagged_review_negations') !== -1 && changesObj.flagged_review) {
    var frData = changesObj.flagged_review;
    var selectedTerms = frData.selectedForNegation || [];
    if (selectedTerms.length > 0) {
      var negativeListSpendFR = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_SPEND);
      selectedTerms.forEach(function(s) {
        try {
          // v4.5.0: Route PMax flagged negatives to campaign-level; others to shared list
          if (s.channelType === 'PERFORMANCE_MAX' && s.campaign) {
            var pmaxIterFR = AdsApp.performanceMaxCampaigns()
              .withCondition('campaign.name = "' + s.campaign.replace(/"/g, '\\"') + '"').get();
            if (pmaxIterFR.hasNext()) {
              pmaxIterFR.next().createNegativeKeyword('[' + s.term + ']');
            } else if (negativeListSpendFR) {
              negativeListSpendFR.addNegativeKeyword('[' + s.term + ']');
            }
          } else if (negativeListSpendFR) {
            negativeListSpendFR.addNegativeKeyword('[' + s.term + ']');
          }
          appliedCount++;
          _logChange({ functionName: 'approval_apply', entity: s.term, entityType: 'FLAGGED_REVIEW_NEGATIVE', campaign: s.campaign || '', reason: 'Approved flagged review negate: ' + (s.reason || ''), spend: s.cost || 0, conversions: 0 });
        } catch (e) { _log('WARN', 'Apply flagged review negation failed: ' + s.term + ' — ' + e.message); }
      });
      _log('INFO', 'Applied ' + selectedTerms.length + ' flagged review negations');
    }
  }

  // === SHOPPING/PMAX ===
  if (categories.indexOf('shopping_pmax') !== -1 && changesObj.shopping_pmax) {
    var spData = changesObj.shopping_pmax;

    // PMax search term negations
    (spData.pmaxSearchTermsNegated || []).forEach(function(p) {
      try {
        var term = p.searchTerm || p.term;
        var negList = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_SPEND);
        if (negList) { negList.addNegativeKeyword('[' + term + ']'); appliedCount++; }
      } catch (e) { _log('WARN', 'Apply PMax negation failed: ' + e.message); }
    });

    _log('INFO', 'Applied shopping/PMax changes');
  }

  return appliedCount;
}


// ============================================
// ENTRY POINT — called by each client's loader
// ============================================

function runOptimization() {
  var startTime = new Date();

  // v4.4.0: Default REQUIRE_APPROVAL to true
  CONFIG.REQUIRE_APPROVAL = CONFIG.REQUIRE_APPROVAL !== false;

  _log('INFO', '═══════════════════════════════════════════');
  _log('INFO', 'SYTE OPTIMIZATION CORE v4.5.0');
  _log('INFO', 'Client: ' + (CONFIG.CLIENT_NAME || AdsApp.currentAccount().getName()));
  _log('INFO', 'Mode: ' + CONFIG.ACCOUNT_MODE);
  _log('INFO', 'Run: ' + (CONFIG.PREVIEW_MODE ? 'PREVIEW (no changes)' : 'LIVE'));
  _log('INFO', 'Approval: ' + (CONFIG.REQUIRE_APPROVAL ? 'ENABLED (collect → eval → approve)' : 'DISABLED (auto-apply)'));
  _log('INFO', '═══════════════════════════════════════════');

  var results = {
    keywordsPaused: [], searchTermsNegated: [], informationalBlocked: [],
    irrelevantBlocked: [], winnersPromoted: [], budgetAlerts: [],
    shoppingProductsPaused: [], shoppingHeroProducts: [], shoppingLowROASProducts: [],
    pmaxAlerts: [], pmaxSearchTermsNegated: [],
    ecomKeywordsPaused: [], ecomSearchTermsNegated: [], ecomWinnersPromoted: [],
    deviceAdjustments: [], scheduleAdjustments: [], geoAdjustments: [],
    ngramNegatives: [], lowQsPaused: [],
    smartNegated: [], smartReviewTerms: [],
    auditRepairs: [],
    conversionHealth: null, conversionAlert: null,
    errors: []
  };

  // Config defaults
  CONFIG.AUTO_PROTECT_ACTIVE_KEYWORDS = CONFIG.AUTO_PROTECT_ACTIVE_KEYWORDS !== false;  // default: true
  CONFIG.KEYWORD_PAUSE_MIN_IMPRESSIONS = CONFIG.KEYWORD_PAUSE_MIN_IMPRESSIONS || 100;
  CONFIG.AUDIT_NEGATIVES = CONFIG.AUDIT_NEGATIVES !== false;  // default: true
  CONFIG.AUDIT_CONVERTING_LOOKBACK_DAYS = CONFIG.AUDIT_CONVERTING_LOOKBACK_DAYS || 90;

  // Test sheet access early
  var testSheet = _getChangeLogSheet();
  if (testSheet) {
    _log('INFO', 'Master sheet connected: ' + CONFIG.MASTER_SHEET_ID);
  } else if (CONFIG.MASTER_SHEET_ID || CONFIG.SHEET_URL) {
    _log('ERROR', 'Master sheet configured but NOT accessible — check sharing permissions');
  } else {
    _log('WARN', 'No MASTER_SHEET_ID or SHEET_URL — change logging disabled');
  }

  // === LOAD SHARED CONFIG FROM SHEET (v4.2.1) ===
  _loadSharedConfig();

  // Log if no API key available after all loading attempts
  if (!CONFIG.ANTHROPIC_API_KEY) {
    _log('WARN', 'No ANTHROPIC_API_KEY — AI features disabled. Add key to master sheet Config tab.');
  }

  // === CONFIG VALIDATION (runs after shared config so it sees sheet-loaded keys) ===
  _log('INFO', '\n=== CONFIG VALIDATION ===');
  _validateConfig();

  // Build active keyword set and converting search terms ONCE at start
  _log('INFO', '\n=== BUILDING ACTIVE KEYWORD SET ===');
  ACTIVE_KEYWORDS = _buildActiveKeywordSet();
  CONVERTING_SEARCH_TERMS = _buildConvertingSearchTerms(CONFIG.AUDIT_CONVERTING_LOOKBACK_DAYS);

  // v4.4.0: Load client context from Google Doc
  _log('INFO', '\n=== LOADING CLIENT CONTEXT ===');
  CLIENT_CONTEXT = _loadClientContext();

  // v4.4.0: If approval is enabled, force collect-only mode for this run.
  // Changes will be proposed but NOT applied until approved.
  var _originalPreviewMode = CONFIG.PREVIEW_MODE;
  if (CONFIG.REQUIRE_APPROVAL && !CONFIG.PREVIEW_MODE) {
    CONFIG.PREVIEW_MODE = true;
    _log('INFO', 'Approval mode: collecting proposed changes (not applying yet)');
  }

  try {

    // === CHECK AND APPLY PREVIOUSLY APPROVED CHANGES (v4.4.0) ===
    if (CONFIG.REQUIRE_APPROVAL && !_originalPreviewMode) {
      _log('INFO', '\n=== APPLYING APPROVED PENDING CHANGES ===');
      // Temporarily restore live mode to apply approved changes
      CONFIG.PREVIEW_MODE = false;
      _checkAndApplyPendingChanges(results);
      // Back to collect-only for new analysis
      CONFIG.PREVIEW_MODE = true;
    }

    // === OUTCOME BACKFILL (always runs — no data dependency) ===
    _log('INFO', '\n=== OUTCOME BACKFILL ===');
    _backfillOutcomes();

    // === WEEKLY CLAUDE REVIEW (Sundays only) ===
    _weeklyClaudeReview();

    // === HEALTH CHECK (urgent alerts first) ===
    _log('INFO', '\n=== CONVERSION HEALTH CHECK ===');
    _checkConversionHealth(results);

    // === HALT if conversion tracking broken ===
    if (results.conversionAlert) {
      _log('ERROR', '⛔ HALTING ALL OPTIMIZATION — conversion tracking may be broken');
      _checkBudgetPacing(results);
    } else {

      // === AUDIT & REPAIR (runs first — clean up before making new changes) ===
      _log('INFO', '\n=== NEGATIVE KEYWORD AUDIT & REPAIR ===');
      _auditAndRepairNegatives(results);

      // === AI SEARCH TERM REVIEW (v4.3.0 — unified, all negation through AI) ===
      _log('INFO', '\n=== AI SEARCH TERM REVIEW ===');
      _smartSearchTermReview(results);

      // === LEAD GEN ===
      if (_isLeadGenMode()) {
        _log('INFO', '\n=== SEARCH (LEAD GEN) ===');
        _pauseHighSpendKeywords_LeadGen(results);
        if (CONFIG.PROMOTION_ENABLED !== false) _promoteWinners_LeadGen(results);
      }

      // === ECOMMERCE ===
      if (_isEcommerceMode()) {
        _log('INFO', '\n=== SEARCH (ECOMMERCE) ===');
        _pauseHighSpendKeywords_Ecommerce(results);
        if (CONFIG.PROMOTION_ENABLED !== false) _promoteWinners_Ecommerce(results);
      }

      // === SHOPPING & PMAX ===
      if (_isEcommerceMode()) {
        _log('INFO', '\n=== SHOPPING ===');
        _analyzeShoppingProducts(results);
        _analyzeShoppingSearchTerms(results);
        _log('INFO', '\n=== PERFORMANCE MAX ===');
        _monitorPMaxCampaigns(results);
        _analyzePMaxSearchTerms(results);
        _analyzePMaxAssetGroups(results);
      }

      // === AUTO-OPTIMIZATIONS ===
      if (CONFIG.AUTO_DEVICE_BIDS !== false) { _log('INFO', '\n=== AUTO: DEVICE BIDS ==='); _autoAdjustDeviceBids(results); }
      if (CONFIG.AUTO_AD_SCHEDULE !== false) { _log('INFO', '\n=== AUTO: AD SCHEDULE ==='); _autoAdjustAdSchedule(results); }
      if (CONFIG.AUTO_GEO_BIDS !== false) { _log('INFO', '\n=== AUTO: GEOGRAPHIC BIDS ==='); _autoAdjustGeoBids(results); }
      if (CONFIG.AUTO_NGRAM !== false) { _log('INFO', '\n=== AUTO: N-GRAM ANALYSIS ==='); _autoNgramNegatives(results); }
      if (CONFIG.AUTO_QS_PAUSE !== false) { _log('INFO', '\n=== AUTO: LOW QUALITY SCORE ==='); _pauseLowQualityScoreKeywords(results); }

      // === BUDGET PACING ===
      _log('INFO', '\n=== BUDGET PACING ===');
      _checkBudgetPacing(results);

    }

  } catch (e) {
    _log('ERROR', 'Script error: ' + e.message);
    results.errors.push(e.message);
  }

  // v4.4.0: Restore original preview mode
  CONFIG.PREVIEW_MODE = _originalPreviewMode;

  // Surface any sheet errors so they appear in the email report
  if (_sheetErrors.length > 0) {
    for (var se = 0; se < _sheetErrors.length; se++) {
      results.errors.push('SHEET: ' + _sheetErrors[se]);
    }
    _log('ERROR', 'Sheet errors: ' + _sheetErrors.length + ' — see email report for details');
  }

  // v4.4.0: EVAL STEP — Claude reviews proposed changes before they proceed
  var evalResult = null;
  var pendingRunId = null;
  if (CONFIG.REQUIRE_APPROVAL && !_originalPreviewMode) {
    _log('INFO', '\n=== EVAL STEP ===');
    evalResult = _evalProposedChanges(results);
    _log('INFO', 'Eval: ' + (evalResult.approved ? 'APPROVED' : 'CONCERNS RAISED') + ' — ' + evalResult.summary);

    // Write proposed changes to PendingChanges sheet for approval
    _log('INFO', '\n=== WRITING PENDING CHANGES ===');
    pendingRunId = _writePendingChanges(results, evalResult);
  } else if (!_originalPreviewMode && !CONFIG.REQUIRE_APPROVAL) {
    // Legacy mode: no approval required — changes were already applied via PREVIEW_MODE=false
    _log('INFO', 'Approval disabled — changes were applied directly');
  }

  var duration = (new Date() - startTime) / 1000;
  _log('INFO', 'Script completed in ' + duration.toFixed(1) + ' seconds');

  // Write summary row for daily digest
  _writeDailyDigestRow(results, duration);

  if (CONFIG.SEND_EMAIL !== false) _sendReport(results, duration, evalResult, pendingRunId);

  _log('INFO', '\n=== SUMMARY ===');
  if (_isLeadGenMode()) _log('INFO', 'KW Paused: ' + results.keywordsPaused.length + ' | Winners: ' + results.winnersPromoted.length);
  if (_isEcommerceMode()) _log('INFO', 'Ecom KW: ' + results.ecomKeywordsPaused.length + ' | Ecom Winners: ' + results.ecomWinnersPromoted.length);
  _log('INFO', 'AI Negated: ' + results.smartNegated.length + ' | AI Review: ' + results.smartReviewTerms.length);
  _log('INFO', 'Device: ' + results.deviceAdjustments.length + ' | Schedule: ' + results.scheduleAdjustments.length + ' | Geo: ' + results.geoAdjustments.length + ' | N-gram: ' + results.ngramNegatives.length + ' | Low QS: ' + results.lowQsPaused.length);
  _log('INFO', 'Audit Findings: ' + (results.auditRepairs ? results.auditRepairs.length : 0) + ' | Budget: ' + results.budgetAlerts.length + ' | Errors: ' + results.errors.length);
  if (pendingRunId) _log('INFO', 'Pending approval: ' + pendingRunId + ' — check email for approval buttons');
}
