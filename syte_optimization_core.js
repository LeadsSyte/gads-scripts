/**
 * SYTE OPTIMIZATION CORE v4.1
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
 * Version: 4.1
 *
 * CHANGELOG v4.1 — OUTCOME SCORING + RUN DELTAS:
 * - NEW: Real outcome scoring for DEVICE_BID — compares device CVR before/after change
 * - NEW: Real outcome scoring for GEO_BID — compares location-level CVR before/after
 * - NEW: Real outcome scoring for SCHEDULE_BID — compares hour-of-day CVR before/after
 * - NEW: RunLog sheet tab — records a performance snapshot every run
 * - NEW: Run-over-run performance delta tracking (CPL, conversions, ROAS vs last run)
 * - NEW: "Since Last Run" section in email report with directional arrows
 * - NEW: Yellow warning if CPL worsened >15% after >10 changes in previous run
 * - NEW: Weekly Claude review now receives last 8 RunLog rows for trend analysis
 * - FIX: _sheetCache refactored to _sheetCacheMap (supports both ChangeLog and RunLog)
 * - FIX: MASTER_SHEET_ID default hardcoded to Syte master sheet
 * - FIX: Sunday gate uses account timezone via getDay() — correct for all timezones
 * - FIX: Sheet initialisation handles first-run gracefully (no previous rows)
 *
 * CHANGELOG v4.0 — SELF-IMPROVEMENT ENGINE:
 * - NEW: Change log — every action written to master Syte Google Sheet
 * - NEW: Outcome backfill — 7 days after each change, script revisits and scores it
 * - NEW: Weekly Claude review (runs Sunday) — reads change log + outcomes, critiques
 *        its own logic, and emails a full rewritten script ready to paste into GitHub
 * - Loader CONFIG additions required:
 *     MASTER_SHEET_ID: '1TDEpz--yxg-x1lO3twfJ2Y_VJ6988Y1vaB0BKe6IfJU'
 *     ANTHROPIC_API_KEY: 'sk-ant-...'
 *
 * CHANGELOG v3.2 — AUTO-OPTIMIZATIONS:
 * - Device bid adjustments, hour-of-day scheduling, geographic bid adjustments
 * - Conversion tracking health check
 * - N-gram analysis
 * - Low Quality Score keyword pausing
 * - Keyword Opportunity Scanner
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
  { pattern: /^where\s+to\b/i, negativePhrase: 'where to' },
  { pattern: /^where\s+can\b/i, negativePhrase: 'where can' },
  { pattern: /^where\s+is\b/i, negativePhrase: 'where is' },
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

var _sheetCacheMap = {};

function _getSheet(sheetName, headerRow) {
  if (_sheetCacheMap[sheetName]) return _sheetCacheMap[sheetName];
  var sheetId = CONFIG.MASTER_SHEET_ID || '1TDEpz--yxg-x1lO3twfJ2Y_VJ6988Y1vaB0BKe6IfJU';
  if (!sheetId) {
    _log('WARN', 'No MASTER_SHEET_ID in CONFIG — ' + sheetName + ' disabled');
    return null;
  }
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
      sheet.getRange(1, 1, 1, headerRow.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    _sheetCacheMap[sheetName] = sheet;
    return sheet;
  } catch (e) {
    _log('ERROR', 'Cannot open sheet "' + sheetName + '": ' + e.message);
    return null;
  }
}

function _getChangeLogSheet() {
  return _getSheet('ChangeLog', [
    'change_id', 'timestamp', 'account_name', 'function_name',
    'entity', 'entity_type', 'campaign', 'ad_group',
    'reason', 'spend_at_change', 'conversions_at_change',
    'outcome', 'outcome_checked_date', 'outcome_notes',
    'script_version'
  ]);
}

function _getRunLogSheet() {
  return _getSheet('RunLog', [
    'run_id', 'timestamp', 'account_name', 'script_version',
    'account_cpl', 'account_conversions', 'account_cost',
    'account_roas', 'account_clicks', 'account_impressions',
    'changes_made', 'delta_cpl_vs_last_run', 'delta_conversions_vs_last_run',
    'delta_roas_vs_last_run', 'run_notes'
  ]);
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
  if (!sheet || CONFIG.PREVIEW_MODE) return null;

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
      'PENDING',           // outcome — will be backfilled in 7 days
      '',                  // outcome_checked_date
      '',                  // outcome_notes
      'v4.1'              // script_version
    ]);
  } catch (e) {
    _log('WARN', 'Change log write failed: ' + e.message);
  }

  return changeId;
}


// ============================================
// OUTCOME BACKFILL
// ============================================

/**
 * Runs on every execution. Finds rows logged ~7 days ago that still have
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
    cutoffDate.setDate(cutoffDate.getDate() - 7); // Only check rows 7+ days old

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
            'AND segments.date DURING LAST_7_DAYS';
          var kwSearch = AdsApp.search(kwQuery);
          if (kwSearch.hasNext()) {
            var kw = kwSearch.next();
            var postConv = Number(kw.metrics.conversions) || 0;
            var status = kw.adGroupCriterion.status;
            if (postConv > 0) {
              outcome = 'INCORRECT';
              outcomeNotes = 'Keyword had ' + postConv + ' conversions in 7 days after pause. Should not have been paused.';
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
          // We compare account CPL the week before vs the 7 days after
          var afterStart = _formatDate(changeTimestamp);
          var afterEnd = _formatDate(checkDate);
          var beforeEnd = _formatDate(changeTimestamp);
          var beforeStartD = new Date(changeTimestamp);
          beforeStartD.setDate(beforeStartD.getDate() - 7);
          var beforeStart = _formatDate(beforeStartD);

          var afterQuery = 'SELECT metrics.conversions, metrics.cost_micros FROM campaign ' +
            'WHERE campaign.status = "ENABLED" AND segments.date BETWEEN "' + afterStart + '" AND "' + afterEnd + '"';
          var beforeQuery = 'SELECT metrics.conversions, metrics.cost_micros FROM campaign ' +
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
          // Compare device CVR 7 days before vs 7 days after the change
          var deviceMatch = entity.match(/_([A-Z]+)$/);
          var deviceName = deviceMatch ? deviceMatch[1] : '';
          if (deviceName) {
            var afterStartD = new Date(changeTimestamp);
            var afterEndD = new Date(changeTimestamp);
            afterEndD.setDate(afterEndD.getDate() + 7);
            var beforeStartD2 = new Date(changeTimestamp);
            beforeStartD2.setDate(beforeStartD2.getDate() - 7);

            var deviceAfterQuery = 'SELECT segments.device, metrics.conversions, metrics.clicks, metrics.cost_micros ' +
              'FROM campaign WHERE campaign.name = "' + campaign + '" AND campaign.status = "ENABLED" ' +
              'AND segments.date BETWEEN "' + _formatDate(afterStartD) + '" AND "' + _formatDate(afterEndD) + '"';
            var deviceBeforeQuery = 'SELECT segments.device, metrics.conversions, metrics.clicks, metrics.cost_micros ' +
              'FROM campaign WHERE campaign.name = "' + campaign + '" AND campaign.status = "ENABLED" ' +
              'AND segments.date BETWEEN "' + _formatDate(beforeStartD2) + '" AND "' + _formatDate(changeTimestamp) + '"';

            var devAfterConv = 0, devAfterClicks = 0, devAfterCost = 0;
            var devBeforeConv = 0, devBeforeClicks = 0, devBeforeCost = 0;
            var acctAfterConv = 0, acctAfterCost = 0, acctBeforeConv = 0, acctBeforeCost = 0;

            var ds1 = AdsApp.search(deviceAfterQuery);
            while (ds1.hasNext()) {
              var dr1 = ds1.next();
              var dev = dr1.segments.device;
              var c = Number(dr1.metrics.conversions) || 0;
              var cl = Number(dr1.metrics.clicks) || 0;
              var co = Number(dr1.metrics.costMicros) / 1000000;
              acctAfterConv += c; acctAfterCost += co;
              if (dev === deviceName) { devAfterConv += c; devAfterClicks += cl; devAfterCost += co; }
            }
            var ds2 = AdsApp.search(deviceBeforeQuery);
            while (ds2.hasNext()) {
              var dr2 = ds2.next();
              var dev2 = dr2.segments.device;
              var c2 = Number(dr2.metrics.conversions) || 0;
              var cl2 = Number(dr2.metrics.clicks) || 0;
              var co2 = Number(dr2.metrics.costMicros) / 1000000;
              acctBeforeConv += c2; acctBeforeCost += co2;
              if (dev2 === deviceName) { devBeforeConv += c2; devBeforeClicks += cl2; devBeforeCost += co2; }
            }

            var devCvrBefore = devBeforeClicks > 0 ? devBeforeConv / devBeforeClicks : 0;
            var devCvrAfter = devAfterClicks > 0 ? devAfterConv / devAfterClicks : 0;
            var acctCplBefore = acctBeforeConv > 0 ? acctBeforeCost / acctBeforeConv : 0;
            var acctCplAfter = acctAfterConv > 0 ? acctAfterCost / acctAfterConv : 0;

            if (devBeforeClicks >= 10 && devAfterClicks >= 10) {
              if (devCvrAfter > devCvrBefore || (acctCplBefore > 0 && acctCplAfter < acctCplBefore * 0.95)) {
                outcome = 'CORRECT';
                outcomeNotes = deviceName + ' CVR ' + (devCvrBefore * 100).toFixed(1) + '% -> ' + (devCvrAfter * 100).toFixed(1) + '%. Account CPL R' + acctCplBefore.toFixed(0) + ' -> R' + acctCplAfter.toFixed(0);
              } else if (devCvrAfter < devCvrBefore * 0.8) {
                outcome = 'INCORRECT';
                outcomeNotes = deviceName + ' CVR worsened ' + (devCvrBefore * 100).toFixed(1) + '% -> ' + (devCvrAfter * 100).toFixed(1) + '%. Bid adjustment may have been wrong.';
              } else {
                outcome = 'NEUTRAL';
                outcomeNotes = deviceName + ' CVR change within noise range. Before: ' + (devCvrBefore * 100).toFixed(1) + '% After: ' + (devCvrAfter * 100).toFixed(1) + '%';
              }
            } else {
              outcome = 'NEUTRAL';
              outcomeNotes = 'Insufficient click volume on ' + deviceName + ' to score (before: ' + devBeforeClicks + ', after: ' + devAfterClicks + ' clicks).';
            }
          } else {
            outcome = 'NEUTRAL';
            outcomeNotes = 'Could not parse device name from entity.';
          }
        }

        else if (entityType === 'GEO_BID') {
          // Compare location-level CVR before vs after
          var locMatch = entity.match(/_LOC_(.+)$/);
          var locConstant = locMatch ? locMatch[1] : '';
          if (locConstant) {
            var geoAfterStart = new Date(changeTimestamp);
            var geoAfterEnd = new Date(changeTimestamp);
            geoAfterEnd.setDate(geoAfterEnd.getDate() + 7);
            var geoBeforeStart = new Date(changeTimestamp);
            geoBeforeStart.setDate(geoBeforeStart.getDate() - 7);

            var geoAfterQ = 'SELECT metrics.conversions, metrics.clicks, metrics.cost_micros ' +
              'FROM location_view WHERE campaign.name = "' + campaign + '" AND campaign.status = "ENABLED" ' +
              'AND segments.date BETWEEN "' + _formatDate(geoAfterStart) + '" AND "' + _formatDate(geoAfterEnd) + '"';
            var geoBeforeQ = 'SELECT metrics.conversions, metrics.clicks, metrics.cost_micros ' +
              'FROM location_view WHERE campaign.name = "' + campaign + '" AND campaign.status = "ENABLED" ' +
              'AND segments.date BETWEEN "' + _formatDate(geoBeforeStart) + '" AND "' + _formatDate(changeTimestamp) + '"';

            var geoAfterConv = 0, geoAfterClicks = 0, geoAfterCost = 0;
            var geoBeforeConv = 0, geoBeforeClicks = 0, geoBeforeCost = 0;

            var gs1 = AdsApp.search(geoAfterQ);
            while (gs1.hasNext()) { var gr1 = gs1.next(); geoAfterConv += Number(gr1.metrics.conversions) || 0; geoAfterClicks += Number(gr1.metrics.clicks) || 0; geoAfterCost += Number(gr1.metrics.costMicros) / 1000000; }
            var gs2 = AdsApp.search(geoBeforeQ);
            while (gs2.hasNext()) { var gr2 = gs2.next(); geoBeforeConv += Number(gr2.metrics.conversions) || 0; geoBeforeClicks += Number(gr2.metrics.clicks) || 0; geoBeforeCost += Number(gr2.metrics.costMicros) / 1000000; }

            var geoCvrBefore = geoBeforeClicks > 0 ? geoBeforeConv / geoBeforeClicks : 0;
            var geoCvrAfter = geoAfterClicks > 0 ? geoAfterConv / geoAfterClicks : 0;
            var geoCplBefore = geoBeforeConv > 0 ? geoBeforeCost / geoBeforeConv : 0;
            var geoCplAfter = geoAfterConv > 0 ? geoAfterCost / geoAfterConv : 0;

            // Determine if bid was increased or reduced from the reason field
            var wasReduction = (row[colIdx['reason']] || '').indexOf('-') !== -1 || (row[colIdx['reason']] || '').indexOf('0 conv') !== -1;

            if (geoBeforeClicks >= 10 || geoAfterClicks >= 10) {
              if (wasReduction) {
                // For bid reductions: CORRECT if CPL stayed flat or improved
                if (geoCplBefore > 0 && geoCplAfter <= geoCplBefore * 1.05) {
                  outcome = 'CORRECT';
                  outcomeNotes = 'Geo bid reduction: CPL held/improved. Before R' + geoCplBefore.toFixed(0) + ' -> After R' + geoCplAfter.toFixed(0);
                } else if (geoCplAfter > geoCplBefore * 1.15) {
                  outcome = 'INCORRECT';
                  outcomeNotes = 'Geo bid reduction may have hurt: CPL R' + geoCplBefore.toFixed(0) + ' -> R' + geoCplAfter.toFixed(0);
                } else {
                  outcome = 'NEUTRAL';
                  outcomeNotes = 'Geo bid reduction: CPL change within noise. R' + geoCplBefore.toFixed(0) + ' -> R' + geoCplAfter.toFixed(0);
                }
              } else {
                // For bid increases: CORRECT if CVR lifted
                if (geoCvrAfter > geoCvrBefore) {
                  outcome = 'CORRECT';
                  outcomeNotes = 'Geo bid increase: CVR improved ' + (geoCvrBefore * 100).toFixed(1) + '% -> ' + (geoCvrAfter * 100).toFixed(1) + '%';
                } else if (geoCvrAfter < geoCvrBefore * 0.8) {
                  outcome = 'INCORRECT';
                  outcomeNotes = 'Geo bid increase: CVR dropped ' + (geoCvrBefore * 100).toFixed(1) + '% -> ' + (geoCvrAfter * 100).toFixed(1) + '%';
                } else {
                  outcome = 'NEUTRAL';
                  outcomeNotes = 'Geo bid increase: CVR flat ' + (geoCvrBefore * 100).toFixed(1) + '% -> ' + (geoCvrAfter * 100).toFixed(1) + '%';
                }
              }
            } else {
              outcome = 'NEUTRAL';
              outcomeNotes = 'Insufficient click volume for geo scoring.';
            }
          } else {
            outcome = 'NEUTRAL';
            outcomeNotes = 'Could not parse location from entity.';
          }
        }

        else if (entityType === 'SCHEDULE_BID') {
          // Compare hour-of-day CVR before vs after
          var hourMatch = entity.match(/_H(\d+)$/);
          var targetHour = hourMatch ? parseInt(hourMatch[1]) : -1;
          if (targetHour >= 0) {
            var schedAfterStart = new Date(changeTimestamp);
            var schedAfterEnd = new Date(changeTimestamp);
            schedAfterEnd.setDate(schedAfterEnd.getDate() + 7);
            var schedBeforeStart = new Date(changeTimestamp);
            schedBeforeStart.setDate(schedBeforeStart.getDate() - 7);

            var schedAfterQ = 'SELECT segments.hour, metrics.conversions, metrics.clicks, metrics.cost_micros ' +
              'FROM campaign WHERE campaign.name = "' + campaign + '" AND campaign.status = "ENABLED" ' +
              'AND segments.date BETWEEN "' + _formatDate(schedAfterStart) + '" AND "' + _formatDate(schedAfterEnd) + '"';
            var schedBeforeQ = 'SELECT segments.hour, metrics.conversions, metrics.clicks, metrics.cost_micros ' +
              'FROM campaign WHERE campaign.name = "' + campaign + '" AND campaign.status = "ENABLED" ' +
              'AND segments.date BETWEEN "' + _formatDate(schedBeforeStart) + '" AND "' + _formatDate(changeTimestamp) + '"';

            var hourAfterConv = 0, hourAfterClicks = 0, hourAfterCost = 0;
            var hourBeforeConv = 0, hourBeforeClicks = 0, hourBeforeCost = 0;
            var acctSchedAfterConv = 0, acctSchedAfterCost = 0;
            var acctSchedBeforeConv = 0, acctSchedBeforeCost = 0;

            var ss1 = AdsApp.search(schedAfterQ);
            while (ss1.hasNext()) {
              var sr1 = ss1.next();
              var h = Number(sr1.segments.hour);
              var sc = Number(sr1.metrics.conversions) || 0;
              var scl = Number(sr1.metrics.clicks) || 0;
              var sco = Number(sr1.metrics.costMicros) / 1000000;
              acctSchedAfterConv += sc; acctSchedAfterCost += sco;
              if (h === targetHour) { hourAfterConv += sc; hourAfterClicks += scl; hourAfterCost += sco; }
            }
            var ss2 = AdsApp.search(schedBeforeQ);
            while (ss2.hasNext()) {
              var sr2 = ss2.next();
              var h2 = Number(sr2.segments.hour);
              var sc2 = Number(sr2.metrics.conversions) || 0;
              var scl2 = Number(sr2.metrics.clicks) || 0;
              var sco2 = Number(sr2.metrics.costMicros) / 1000000;
              acctSchedBeforeConv += sc2; acctSchedBeforeCost += sco2;
              if (h2 === targetHour) { hourBeforeConv += sc2; hourBeforeClicks += scl2; hourBeforeCost += sco2; }
            }

            var wasSchedReduction = (row[colIdx['reason']] || '').indexOf('-') !== -1;
            var hourCvrBefore = hourBeforeClicks > 0 ? hourBeforeConv / hourBeforeClicks : 0;
            var hourCvrAfter = hourAfterClicks > 0 ? hourAfterConv / hourAfterClicks : 0;
            var acctSchedCplBefore = acctSchedBeforeConv > 0 ? acctSchedBeforeCost / acctSchedBeforeConv : 0;
            var acctSchedCplAfter = acctSchedAfterConv > 0 ? acctSchedAfterCost / acctSchedAfterConv : 0;

            if (wasSchedReduction) {
              if (acctSchedCplBefore > 0 && acctSchedCplAfter <= acctSchedCplBefore * 1.05) {
                outcome = 'CORRECT';
                outcomeNotes = 'Hour ' + targetHour + ' bid reduced: CPL improved/held. R' + acctSchedCplBefore.toFixed(0) + ' -> R' + acctSchedCplAfter.toFixed(0);
              } else if (hourAfterConv > hourBeforeConv && hourBeforeConv > 0) {
                outcome = 'INCORRECT';
                outcomeNotes = 'Hour ' + targetHour + ' bid reduced but conversions increased (' + hourBeforeConv + ' -> ' + hourAfterConv + '). May have blocked a converting hour.';
              } else {
                outcome = 'NEUTRAL';
                outcomeNotes = 'Hour ' + targetHour + ' schedule change: insufficient signal. CPL R' + acctSchedCplBefore.toFixed(0) + ' -> R' + acctSchedCplAfter.toFixed(0);
              }
            } else {
              if (hourCvrAfter > hourCvrBefore) {
                outcome = 'CORRECT';
                outcomeNotes = 'Hour ' + targetHour + ' bid increased: CVR ' + (hourCvrBefore * 100).toFixed(1) + '% -> ' + (hourCvrAfter * 100).toFixed(1) + '%';
              } else {
                outcome = 'NEUTRAL';
                outcomeNotes = 'Hour ' + targetHour + ' bid increased: CVR flat/down ' + (hourCvrBefore * 100).toFixed(1) + '% -> ' + (hourCvrAfter * 100).toFixed(1) + '%';
              }
            }
          } else {
            outcome = 'NEUTRAL';
            outcomeNotes = 'Could not parse hour from entity.';
          }
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
// RUN-OVER-RUN PERFORMANCE DELTA TRACKING
// ============================================

/**
 * Captures a 7-day trailing performance snapshot for the account.
 * Called at the start of each run before any optimizations.
 */
function _capturePerformanceSnapshot() {
  try {
    var query = 'SELECT metrics.cost_micros, metrics.conversions, metrics.conversions_value, ' +
      'metrics.clicks, metrics.impressions FROM campaign WHERE campaign.status = "ENABLED" ' +
      'AND segments.date DURING LAST_7_DAYS';
    var search = AdsApp.search(query);
    var cost = 0, conversions = 0, revenue = 0, clicks = 0, impressions = 0;
    while (search.hasNext()) {
      var row = search.next();
      cost += Number(row.metrics.costMicros) / 1000000;
      conversions += Number(row.metrics.conversions) || 0;
      revenue += Number(row.metrics.conversionsValue) || 0;
      clicks += Number(row.metrics.clicks) || 0;
      impressions += Number(row.metrics.impressions) || 0;
    }
    var cpl = conversions > 0 ? cost / conversions : 0;
    var roas = cost > 0 ? revenue / cost : 0;
    return { cost: cost, conversions: conversions, revenue: revenue, clicks: clicks, impressions: impressions, cpl: cpl, roas: roas };
  } catch (e) {
    _log('WARN', 'Performance snapshot failed: ' + e.message);
    return null;
  }
}

/**
 * Reads the last RunLog row for this account and returns it, or null if none.
 */
function _getLastRunLogRow() {
  var sheet = _getRunLogSheet();
  if (!sheet) return null;
  try {
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return null; // Only header row
    var headers = data[0];
    var colIdx = {};
    headers.forEach(function(h, i) { colIdx[h] = i; });
    var accountName = AdsApp.currentAccount().getName();
    // Search from bottom up for the most recent row for this account
    for (var r = data.length - 1; r >= 1; r--) {
      if (data[r][colIdx['account_name']] === accountName) {
        return {
          runId: data[r][colIdx['run_id']],
          cpl: Number(data[r][colIdx['account_cpl']]) || 0,
          conversions: Number(data[r][colIdx['account_conversions']]) || 0,
          cost: Number(data[r][colIdx['account_cost']]) || 0,
          roas: Number(data[r][colIdx['account_roas']]) || 0,
          clicks: Number(data[r][colIdx['account_clicks']]) || 0,
          impressions: Number(data[r][colIdx['account_impressions']]) || 0,
          changesMade: Number(data[r][colIdx['changes_made']]) || 0
        };
      }
    }
    return null;
  } catch (e) {
    _log('WARN', 'Could not read last RunLog row: ' + e.message);
    return null;
  }
}

/**
 * Writes a RunLog row with the current snapshot + deltas vs last run.
 */
function _writeRunLogRow(snapshot, totalChanges, lastRun) {
  var sheet = _getRunLogSheet();
  if (!sheet || !snapshot) return null;

  var runId = _generateChangeId();
  var accountName = AdsApp.currentAccount().getName();

  var deltaCpl = '';
  var deltaConv = '';
  var deltaRoas = '';
  var runNotes = '';

  if (lastRun && lastRun.cpl > 0) {
    var cplChange = ((snapshot.cpl - lastRun.cpl) / lastRun.cpl) * 100;
    deltaCpl = cplChange.toFixed(1) + '%';
    var convChange = snapshot.conversions - lastRun.conversions;
    deltaConv = (convChange >= 0 ? '+' : '') + convChange.toFixed(1);
    if (lastRun.roas > 0) {
      var roasChange = ((snapshot.roas - lastRun.roas) / lastRun.roas) * 100;
      deltaRoas = roasChange.toFixed(1) + '%';
    }

    // Flag if CPL worsened >15% and last run had >10 changes
    if (cplChange > 15 && lastRun.changesMade > 10) {
      runNotes = 'WARNING: CPL worsened ' + cplChange.toFixed(1) + '% since last run which made ' + lastRun.changesMade + ' changes. Review change log.';
    }
  }

  try {
    sheet.appendRow([
      runId,
      _formatDatetime(new Date()),
      accountName,
      'v4.1',
      snapshot.cpl.toFixed(2),
      snapshot.conversions.toFixed(1),
      snapshot.cost.toFixed(2),
      snapshot.roas.toFixed(2),
      snapshot.clicks,
      snapshot.impressions,
      totalChanges,
      deltaCpl,
      deltaConv,
      deltaRoas,
      runNotes
    ]);
  } catch (e) {
    _log('WARN', 'RunLog write failed: ' + e.message);
  }

  return {
    snapshot: snapshot,
    lastRun: lastRun,
    deltaCpl: deltaCpl,
    deltaConv: deltaConv,
    deltaRoas: deltaRoas,
    runNotes: runNotes,
    totalChanges: totalChanges
  };
}

/**
 * Gets the last N RunLog rows for this account.
 */
function _getRecentRunLogRows(count) {
  var sheet = _getRunLogSheet();
  if (!sheet) return [];
  try {
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    var headers = data[0];
    var colIdx = {};
    headers.forEach(function(h, i) { colIdx[h] = i; });
    var accountName = AdsApp.currentAccount().getName();
    var rows = [];
    for (var r = data.length - 1; r >= 1 && rows.length < count; r--) {
      if (data[r][colIdx['account_name']] === accountName) {
        var rowObj = {};
        headers.forEach(function(h, i) { rowObj[h] = data[r][i]; });
        rows.unshift(rowObj); // Keep chronological order
      }
    }
    return rows;
  } catch (e) {
    _log('WARN', 'Could not read RunLog rows: ' + e.message);
    return [];
  }
}


// ============================================
// WEEKLY CLAUDE REVIEW (runs on Sunday)
// ============================================

/**
 * Reads the last 90 days of change log data for this account,
 * sends the full script code + change history + outcomes to Claude,
 * receives a critique of the code logic + a full rewritten script,
 * and emails it to the Syte team.
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

  // === 2. Load the current script from GitHub ===
  var currentScript = '';
  try {
    var scriptUrl = CONFIG.CORE_SCRIPT_URL || 'https://raw.githubusercontent.com/LeadsSyte/gads-scripts/refs/heads/main/syte_optimization_core.js';
    var response = UrlFetchApp.fetch(scriptUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      currentScript = response.getContentText();
      _log('INFO', 'Loaded current script (' + currentScript.length + ' chars)');
    } else {
      _log('WARN', 'Could not fetch script from GitHub — using summary only');
    }
  } catch (e) {
    _log('WARN', 'Script fetch error: ' + e.message);
  }

  // === 3. Build the prompt for Claude ===
  var accountName = AdsApp.currentAccount().getName();
  var prompt = _buildClaudeReviewPrompt(accountName, changeLogSummary, currentScript);

  // === 4. Call Claude API ===
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
 */
function _buildClaudeReviewPrompt(accountName, changeLogSummary, currentScript) {
  var prompt = 'You are a senior Google Ads engineer reviewing an automated optimization script. ';
  prompt += 'Your job is to analyze the script\'s real-world decision history, identify flaws in its logic, ';
  prompt += 'and produce an improved version of the full script.\n\n';

  prompt += '=== CONTEXT ===\n';
  prompt += 'Account: ' + accountName + '\n';
  prompt += 'Script: Syte Optimization Core — a Google Ads Script that runs every 3 days to pause waste, ';
  prompt += 'negative bad search terms, adjust bids, promote winning search terms to exact match, and send email reports.\n\n';

  prompt += changeLogSummary + '\n\n';

  prompt += '=== YOUR TASK ===\n';
  prompt += 'Do the following in your response:\n\n';

  prompt += '1. DECISION AUDIT\n';
  prompt += 'For each INCORRECT decision found in the change log, explain:\n';
  prompt += '- What the script\'s logic was doing\n';
  prompt += '- Why that logic produced a wrong decision\n';
  prompt += '- What the code change should be to prevent it happening again\n\n';

  prompt += '2. LOGIC CRITIQUE\n';
  prompt += 'Review the overall script logic and identify:\n';
  prompt += '- Any thresholds that appear too aggressive or too conservative based on outcomes\n';
  prompt += '- Any functions with low accuracy that need redesigning\n';
  prompt += '- Any edge cases not being handled\n';
  prompt += '- Any new optimizations worth adding based on patterns in the data\n\n';

  prompt += '3. FULL REWRITTEN SCRIPT\n';
  prompt += 'Provide the complete updated syte_optimization_core.js with all your fixes applied.\n';
  prompt += 'Update the version number to v' + _getNextVersion() + '.\n';
  prompt += 'Add a CHANGELOG entry at the top listing every change you made and why.\n';
  prompt += 'Do not remove existing functionality. Only improve it.\n\n';

  // Append RunLog trend data for Claude to analyze
  var recentRuns = _getRecentRunLogRows(8);
  if (recentRuns.length > 0) {
    prompt += '4. PERFORMANCE TREND ANALYSIS\n';
    prompt += 'Review the run-over-run performance data below and:\n';
    prompt += '- Comment on whether the run-over-run performance trend is positive or negative\n';
    prompt += '- Identify if any specific function in the change log correlates with performance drops\n';
    prompt += '- Factor this into your threshold recommendations in the rewritten script\n\n';

    prompt += '=== RUN LOG (last ' + recentRuns.length + ' runs) ===\n';
    prompt += 'run_id | timestamp | cpl | conversions | cost | roas | changes_made | delta_cpl | delta_conv | delta_roas | notes\n';
    recentRuns.forEach(function(row) {
      prompt += (row['run_id'] || '') + ' | ' +
        (row['timestamp'] || '') + ' | ' +
        (row['account_cpl'] || '') + ' | ' +
        (row['account_conversions'] || '') + ' | ' +
        (row['account_cost'] || '') + ' | ' +
        (row['account_roas'] || '') + ' | ' +
        (row['changes_made'] || '0') + ' | ' +
        (row['delta_cpl_vs_last_run'] || 'N/A') + ' | ' +
        (row['delta_conversions_vs_last_run'] || 'N/A') + ' | ' +
        (row['delta_roas_vs_last_run'] || 'N/A') + ' | ' +
        (row['run_notes'] || '') + '\n';
    });
    prompt += '\n';
  }

  if (currentScript) {
    prompt += '=== CURRENT SCRIPT CODE ===\n';
    prompt += currentScript;
  }

  return prompt;
}

function _getNextVersion() {
  var match = '4.1'.match(/(\d+)\.(\d+)/);
  if (match) {
    return match[1] + '.' + (parseInt(match[2]) + 1);
  }
  return '4.2';
}

/**
 * Calls the Anthropic Claude API and returns the text response.
 */
function _callClaudeAPI(prompt) {
  try {
    var payload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
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
 * Sends the weekly self-improvement report to the Syte team.
 * Includes the full decision audit, logic critique, and rewritten script.
 */
function _sendWeeklyReviewEmail(accountName, claudeResponse, changeLogSummary) {
  var today = Utilities.formatDate(new Date(), AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
  var recipients = CONFIG.EMAIL_ADDRESSES || [CONFIG.EMAIL_RECIPIENT || 'michaelh@syte.co.za'];
  if (typeof recipients === 'string') recipients = [recipients];

  // Try to extract the rewritten script from Claude's response
  var scriptMatch = claudeResponse.match(/```javascript([\s\S]*?)```/);
  var rewrittenScript = scriptMatch ? scriptMatch[1].trim() : null;

  // Build HTML email
  var email = '<html><body style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;color:#333;">';

  // Header
  email += '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;padding:24px;border-radius:8px 8px 0 0;">';
  email += '<h1 style="margin:0;font-size:22px;">🤖 Syte Script — Weekly Self-Improvement Report</h1>';
  email += '<p style="margin:6px 0 0;opacity:0.8;">' + accountName + ' | ' + today + ' | Core v4.1</p>';
  email += '</div>';

  // Change log stats banner
  email += '<div style="background:#e8f5e9;padding:14px 20px;border-left:4px solid #2e7d32;">';
  email += '<pre style="margin:0;font-size:12px;white-space:pre-wrap;">' + changeLogSummary + '</pre>';
  email += '</div>';

  // Claude's analysis
  email += '<div style="padding:20px;">';
  email += '<h2 style="color:#1a1a2e;border-bottom:2px solid #eee;padding-bottom:8px;">Claude\'s Analysis & Recommendations</h2>';

  // If there's a rewritten script, separate the narrative from it
  var narrative = rewrittenScript
    ? claudeResponse.replace(/```javascript[\s\S]*?```/, '[Full rewritten script — see below]')
    : claudeResponse;

  email += '<div style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:#f9f9f9;padding:16px;border-radius:6px;">' +
    narrative.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
  email += '</div>';

  // Rewritten script section
  if (rewrittenScript) {
    email += '<div style="padding:20px;background:#1a1a2e;color:#e0e0e0;">';
    email += '<h2 style="color:#90caf9;margin-top:0;">📋 Rewritten Script — Ready to Paste into GitHub</h2>';
    email += '<p style="color:#aaa;font-size:13px;margin:0 0 12px;">Copy everything below and replace the contents of <code>syte_optimization_core.js</code> in GitHub.</p>';
    email += '<pre style="font-size:11px;line-height:1.5;white-space:pre-wrap;overflow-x:auto;">' +
      rewrittenScript.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>';
    email += '</div>';
  } else {
    email += '<div style="padding:16px;background:#fff3e0;border-left:4px solid #f57c00;">';
    email += '<p style="margin:0;font-size:13px;">⚠️ Claude\'s response did not contain a parseable script block. ';
    email += 'See the analysis above for manual recommendations.</p>';
    email += '</div>';
  }

  email += '<div style="padding:14px;color:#999;font-size:11px;text-align:center;">';
  email += 'Syte Digital Agency | Automated weekly review | syte.co.za';
  email += '</div>';
  email += '</body></html>';

  MailApp.sendEmail({
    to: recipients.join(','),
    subject: '🤖 Syte Script Self-Improvement | ' + accountName + ' | ' + today,
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
  var query = 'SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, campaign.name, ad_group.name, metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.ctr FROM keyword_view WHERE metrics.cost_micros > ' + (CONFIG.KEYWORD_SPEND_THRESHOLD * 1000000) + ' AND metrics.conversions < 0.1 AND campaign.status = "ENABLED" AND ad_group.status = "ENABLED" AND ad_group_criterion.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date BETWEEN "' + _getDateRange().startDate + '" AND "' + _getDateRange().endDate + '"';
  try {
    var search = AdsApp.search(query);
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var kw = row.adGroupCriterion.keyword.text;
      var cn = row.campaign.name, agn = row.adGroup.name;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var conversions = Number(row.metrics.conversions) || 0;
      var ctr = Number(row.metrics.ctr) * 100;
      if (conversions > 0) continue; // Safety: skip fractional conversions from DDA
      if (_isProtectedTerm(kw)) continue;
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

function _negativeHighSpendSearchTerms_LeadGen(results) {
  var dr = _getDateRange(); var changeCount = 0;
  var negativeList = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_SPEND);
  var existing = _getExistingNegatives(negativeList);
  var query = 'SELECT search_term_view.search_term, campaign.name, metrics.cost_micros, metrics.conversions, metrics.clicks FROM search_term_view WHERE metrics.cost_micros > ' + (CONFIG.SEARCH_TERM_SPEND_THRESHOLD * 1000000) + ' AND metrics.conversions < 1 AND campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date DURING LAST_30_DAYS';
  try {
    var search = AdsApp.search(query); var processed = {};
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      if (processed[st] || existing[st] || _isProtectedTerm(st)) continue;
      processed[st] = true;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var reason = 'Spend R' + cost.toFixed(0) + ' | 0 conv';
      _log('INFO', 'NEGATIVE: "' + st + '" | ' + reason);
      results.searchTermsNegated.push({ searchTerm: st, campaign: row.campaign.name, spend: cost });

      // LOG CHANGE
      _logChange({ functionName: '_negativeHighSpendSearchTerms_LeadGen', entity: st, entityType: 'SEARCH_TERM_NEGATIVE', campaign: row.campaign.name, reason: reason, spend: cost, conversions: 0 });

      if (!CONFIG.PREVIEW_MODE && negativeList) negativeList.addNegativeKeyword('[' + st + ']');
      changeCount++;
    }
  } catch (e) { _log('ERROR', 'negativeHighSpendSearchTerms_LeadGen: ' + e.message); results.errors.push(e.message); }
}

function _promoteWinners_LeadGen(results) {
  var dr = _getDateRange();
  var query = 'SELECT search_term_view.search_term, campaign.name, ad_group.name, metrics.conversions, metrics.clicks, metrics.cost_micros FROM search_term_view WHERE metrics.conversions > ' + (CONFIG.PROMOTION_MIN_CONVERSIONS - 1) + ' AND metrics.clicks > ' + ((CONFIG.PROMOTION_MIN_CLICKS || 10) - 1) + ' AND campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
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
  var query = 'SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, campaign.name, ad_group.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks FROM keyword_view WHERE metrics.cost_micros > ' + (CONFIG.ECOM_KEYWORD_SPEND_THRESHOLD * 1000000) + ' AND campaign.status = "ENABLED" AND ad_group.status = "ENABLED" AND ad_group_criterion.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
  try {
    var search = AdsApp.search(query);
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var kw = row.adGroupCriterion.keyword.text;
      var cn = row.campaign.name, agn = row.adGroup.name;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var revenue = Number(row.metrics.conversionsValue) || 0;
      var roas = _calculateROAS(revenue, cost);
      if (_isProtectedTerm(kw)) continue;
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

function _negativeHighSpendSearchTerms_Ecommerce(results) {
  var changeCount = 0;
  var negativeList = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_SPEND);
  var existing = _getExistingNegatives(negativeList);
  var query = 'SELECT search_term_view.search_term, campaign.name, metrics.cost_micros, metrics.conversions_value FROM search_term_view WHERE metrics.cost_micros > ' + (CONFIG.ECOM_SEARCH_TERM_SPEND_THRESHOLD * 1000000) + ' AND campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date DURING LAST_30_DAYS';
  try {
    var search = AdsApp.search(query); var processed = {};
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      if (processed[st] || existing[st] || _isProtectedTerm(st)) continue;
      processed[st] = true;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var revenue = Number(row.metrics.conversionsValue) || 0;
      var roas = _calculateROAS(revenue, cost);
      if (roas >= CONFIG.MIN_ROAS_TO_KEEP) continue;
      var reason = 'ROAS ' + roas.toFixed(2) + 'x | Spend R' + cost.toFixed(0);
      results.ecomSearchTermsNegated.push({ searchTerm: st, campaign: row.campaign.name, spend: cost, revenue: revenue, roas: roas });

      // LOG CHANGE
      _logChange({ functionName: '_negativeHighSpendSearchTerms_Ecommerce', entity: st, entityType: 'SEARCH_TERM_NEGATIVE', campaign: row.campaign.name, reason: reason, spend: cost, conversions: revenue });

      if (!CONFIG.PREVIEW_MODE && negativeList) negativeList.addNegativeKeyword('[' + st + ']');
      changeCount++;
    }
  } catch (e) { _log('ERROR', 'negativeHighSpendSearchTerms_Ecommerce: ' + e.message); results.errors.push(e.message); }
}

function _promoteWinners_Ecommerce(results) {
  var dr = _getDateRange();
  var query = 'SELECT search_term_view.search_term, campaign.name, ad_group.name, metrics.conversions, metrics.conversions_value, metrics.clicks, metrics.cost_micros FROM search_term_view WHERE metrics.conversions > ' + ((CONFIG.ECOM_PROMOTION_MIN_CONVERSIONS || 2) - 1) + ' AND campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
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
  var query = 'SELECT segments.product_item_id, segments.product_title, campaign.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks FROM shopping_performance_view WHERE campaign.status = "ENABLED" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
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
  var changeCount = 0;
  var existing = _getExistingNegatives(_getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_SPEND));
  var query = 'SELECT search_term_view.search_term, campaign.name, metrics.cost_micros, metrics.conversions_value FROM search_term_view WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SHOPPING" AND metrics.cost_micros > ' + (CONFIG.ECOM_SEARCH_TERM_SPEND_THRESHOLD * 1000000) + ' AND segments.date DURING LAST_30_DAYS';
  try {
    var search = AdsApp.search(query); var processed = {};
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      if (processed[st] || existing[st] || _isProtectedTerm(st)) continue;
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
  var query = 'SELECT campaign.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, campaign_budget.amount_micros FROM campaign WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "PERFORMANCE_MAX" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
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
  var changeCount = 0;
  var query = 'SELECT search_term_view.search_term, campaign.name, metrics.cost_micros, metrics.conversions_value FROM search_term_view WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "PERFORMANCE_MAX" AND segments.date DURING LAST_30_DAYS';
  try {
    var search = AdsApp.search(query); var processed = {};
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      if (processed[st] || _isProtectedTerm(st)) continue;
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
  var query = 'SELECT asset_group.name, campaign.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM asset_group WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "PERFORMANCE_MAX" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
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


// ============================================
// SHARED TASKS (all modes)
// ============================================

function _blockInformationalTerms(results) {
  var zeroTolerance = CONFIG.ZERO_TOLERANCE_PATTERNS !== false; // default true
  var changeCount = 0;
  var negativeList = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_INFORMATIONAL);
  var existing = _getExistingNegatives(negativeList);
  var dateRange = zeroTolerance ? 'LAST_30_DAYS' : 'LAST_7_DAYS';
  var query = 'SELECT search_term_view.search_term, metrics.cost_micros FROM search_term_view WHERE campaign.status = "ENABLED" AND segments.date DURING ' + dateRange;
  try {
    var search = AdsApp.search(query); var added = {};
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      if (_isProtectedTerm(st)) continue;
      for (var i = 0; i < INFORMATIONAL_PATTERNS.length; i++) {
        var p = INFORMATIONAL_PATTERNS[i];
        if (p.pattern.test(st) && !added[p.negativePhrase] && !existing[p.negativePhrase]) {
          var category = _classifyInformationalPattern(p.negativePhrase);
          var spend = Number(row.metrics.costMicros) / 1000000;
          _log('INFO', 'INFORMATIONAL [' + category + ']: "' + st + '" -> "' + p.negativePhrase + '" | R' + spend.toFixed(0));
          results.informationalBlocked.push({ phrase: p.negativePhrase, matchedTerm: st, category: category, spend: spend });
          if (zeroTolerance) results.zeroToleranceNegatives.push({ term: st, pattern: p.negativePhrase, category: category, type: 'informational', spend: spend });
          if (!CONFIG.PREVIEW_MODE && negativeList) negativeList.addNegativeKeyword('"' + p.negativePhrase + '"');
          added[p.negativePhrase] = true;
          changeCount++;
          break;
        }
      }
    }
  } catch (e) { _log('ERROR', 'blockInformationalTerms: ' + e.message); results.errors.push(e.message); }
}

function _classifyInformationalPattern(phrase) {
  if (/^(job|career|salary|salaries|hiring|vacancy|vacancies|internship)$/i.test(phrase)) return 'job_seeker';
  if (/^(how to|what is|what are|what does|why|when|where|who|can i|can you|should i|is it|does work|explain|definition|meaning)/.test(phrase)) return 'informational';
  if (/^(tutorial|guide|course|training|learn|examples|templates|pdf|download|free|diy|do it yourself|list of)$/i.test(phrase)) return 'informational';
  if (/^(reddit|forum|quora|youtube|video)$/i.test(phrase)) return 'navigational';
  if (/^(vs|versus|compare|comparison)$/i.test(phrase)) return 'comparison';
  return 'informational';
}

function _blockIrrelevantTerms(results) {
  var irrelevantTerms = CONFIG.IRRELEVANT_TERMS || [];
  if (irrelevantTerms.length === 0) return;
  var zeroTolerance = CONFIG.ZERO_TOLERANCE_PATTERNS !== false; // default true
  var changeCount = 0;
  var negativeList = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_IRRELEVANT);
  var existing = _getExistingNegatives(negativeList);
  var dateRange = zeroTolerance ? 'LAST_30_DAYS' : 'LAST_7_DAYS';
  var query = 'SELECT search_term_view.search_term, metrics.cost_micros FROM search_term_view WHERE campaign.status = "ENABLED" AND segments.date DURING ' + dateRange;
  try {
    var search = AdsApp.search(query); var added = {};
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      if (_isProtectedTerm(st)) continue;
      for (var i = 0; i < irrelevantTerms.length; i++) {
        var term = irrelevantTerms[i];
        if (st.indexOf(term.toLowerCase()) !== -1 && !added[term] && !existing[term]) {
          var spend = Number(row.metrics.costMicros) / 1000000;
          var category = _classifyIrrelevantTerm(term);
          _log('INFO', 'IRRELEVANT [' + category + ']: "' + st + '" -> "' + term + '" | R' + spend.toFixed(0));
          results.irrelevantBlocked.push({ phrase: term, matchedTerm: st, category: category, spend: spend });
          if (zeroTolerance) results.zeroToleranceNegatives.push({ term: st, pattern: term, category: category, type: 'irrelevant', spend: spend });
          if (!CONFIG.PREVIEW_MODE && negativeList) negativeList.addNegativeKeyword('"' + term + '"');
          added[term] = true;
          changeCount++;
          break;
        }
      }
    }
  } catch (e) { _log('ERROR', 'blockIrrelevantTerms: ' + e.message); results.errors.push(e.message); }
}

function _classifyIrrelevantTerm(term) {
  var t = term.toLowerCase();
  if (/job|career|salary|hiring|vacancy|intern|recruit/.test(t)) return 'job_seeker';
  if (/competitor|brand/.test(t)) return 'competitor';
  return 'irrelevant';
}

function _checkBudgetPacing(results) {
  var today = new Date(); var dom = today.getDate();
  var dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  var expectedPace = dom / dim;
  var query = 'SELECT metrics.cost_micros FROM campaign WHERE campaign.status = "ENABLED" AND segments.date DURING THIS_MONTH';
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
  var query = 'SELECT campaign.name, campaign.id, segments.device, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks FROM campaign WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
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
  var query = 'SELECT campaign.name, segments.hour, metrics.cost_micros, metrics.conversions, metrics.clicks FROM campaign WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date DURING LAST_30_DAYS';
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
  var query = 'SELECT campaign.name, campaign_criterion.location.geo_target_constant, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks FROM location_view WHERE campaign.status = "ENABLED" AND segments.date DURING LAST_30_DAYS';
  try {
    var search = AdsApp.search(query); var geoData = {};
    while (search.hasNext()) {
      var row = search.next();
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
  var query = 'SELECT search_term_view.search_term, metrics.cost_micros, metrics.conversions, metrics.clicks FROM search_term_view WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date DURING LAST_30_DAYS';
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
      var kwQuery = 'SELECT ad_group_criterion.keyword.text FROM keyword_view WHERE campaign.status = "ENABLED" AND ad_group.status = "ENABLED" AND ad_group_criterion.status = "ENABLED"';
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
  var query = 'SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.quality_info.quality_score, campaign.name, ad_group.name, metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.impressions FROM keyword_view WHERE campaign.status = "ENABLED" AND ad_group.status = "ENABLED" AND ad_group_criterion.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND ad_group_criterion.quality_info.quality_score <= ' + qsThreshold + ' AND metrics.cost_micros > ' + (qsSpendThreshold * 1000000) + ' AND metrics.conversions < 0.1 AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
  try {
    var search = AdsApp.search(query); var changeCount = 0;
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var kw = row.adGroupCriterion.keyword.text;
      var qs = row.adGroupCriterion.qualityInfo.qualityScore;
      var cn = row.campaign.name, agn = row.adGroup.name;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var conversions = Number(row.metrics.conversions) || 0;
      var clicks = Number(row.metrics.clicks) || 0;
      if (conversions > 0) continue; // Safety: skip fractional conversions from DDA
      if (_isProtectedTerm(kw)) continue;
      var reason = 'QS ' + qs + ' | R' + cost.toFixed(0) + ' | ' + conversions.toFixed(2) + ' conv';
      _log('INFO', 'LOW QS PAUSE: "' + kw + '" | ' + reason);
      results.lowQsPaused.push({ keyword: kw, qualityScore: qs, campaign: cn, adGroup: agn, spend: cost, clicks: clicks, conversions: conversions });

      _logChange({ functionName: '_pauseLowQualityScoreKeywords', entity: kw, entityType: 'KEYWORD', campaign: cn, adGroup: agn, reason: reason, spend: cost, conversions: conversions });

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
    var q1 = 'SELECT metrics.conversions, metrics.cost_micros FROM campaign WHERE campaign.status = "ENABLED" AND segments.date DURING LAST_7_DAYS';
    var s1 = AdsApp.search(q1); var thisWeekConv = 0, thisWeekCost = 0;
    while (s1.hasNext()) { var r = s1.next(); thisWeekConv += Number(r.metrics.conversions) || 0; thisWeekCost += Number(r.metrics.costMicros) / 1000000; }

    var end = new Date(); end.setDate(end.getDate() - 7);
    var start = new Date(); start.setDate(start.getDate() - 14);
    var q2 = 'SELECT metrics.conversions FROM campaign WHERE campaign.status = "ENABLED" AND segments.date BETWEEN "' + _formatDate(start) + '" AND "' + _formatDate(end) + '"';
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
        MailApp.sendEmail({ to: recipients.join(','), subject: '🚨 URGENT: ' + CONFIG.CLIENT_NAME + ' — Conversions Dropped ' + dropPct + '%', body: alertMsg + '\n\nAction needed:\n1. Check conversion tags in GTM\n2. Test the conversion flow manually\n3. Check for landing page errors\n4. Review any recent website changes\n\n— Syte Optimization Script v4.1' });
      }
    }

    if (thisWeekConv === 0 && thisWeekCost > (CONFIG.MONTHLY_BUDGET * 0.1)) {
      results.conversionAlert = 'CRITICAL: ZERO conversions this week with R' + thisWeekCost.toFixed(0) + ' spent. Conversion tracking may be broken.';
      _log('ERROR', results.conversionAlert);
    }

  } catch (e) { _log('ERROR', 'checkConversionHealth: ' + e.message); results.errors.push(e.message); }
}


// ============================================
// EMAIL REPORT
// ============================================

function _sendReport(results, duration) {
  var mode = CONFIG.PREVIEW_MODE ? 'PREVIEW' : 'LIVE';
  var accountName = AdsApp.currentAccount().getName();
  var today = Utilities.formatDate(new Date(), AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd HH:mm');

  var email = '<html><body style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;color:#333;">';
  email += '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;padding:20px;border-radius:8px 8px 0 0;">';
  email += '<h1 style="margin:0;font-size:20px;">Syte Optimization Report v4.1</h1>';
  email += '<p style="margin:5px 0 0;opacity:0.8;">' + accountName + ' | ' + today + ' | ' + mode + ' | ' + CONFIG.ACCOUNT_MODE + '</p></div>';

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
    email += '<tr><td colspan="2" style="padding:8px;background:#e8f5e9;font-weight:bold;">Ecommerce</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Keywords Paused (ROAS)</td><td style="text-align:right;font-weight:bold;">' + results.ecomKeywordsPaused.length + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Search Terms Negated</td><td style="text-align:right;font-weight:bold;">' + results.ecomSearchTermsNegated.length + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Ecom Winners</td><td style="text-align:right;font-weight:bold;">' + results.ecomWinnersPromoted.length + '</td></tr>';
    email += '<tr><td colspan="2" style="padding:8px;background:#fff3e0;font-weight:bold;">Shopping</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Zero Revenue Products</td><td style="text-align:right;font-weight:bold;color:#c62828;">' + results.shoppingProductsPaused.length + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Low ROAS Products</td><td style="text-align:right;font-weight:bold;color:#e65100;">' + results.shoppingLowROASProducts.length + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Hero Products</td><td style="text-align:right;font-weight:bold;color:#2e7d32;">' + results.shoppingHeroProducts.length + '</td></tr>';
    email += '<tr><td colspan="2" style="padding:8px;background:#f3e5f5;font-weight:bold;">Performance Max</td></tr>';
    email += '<tr><td style="padding:4px 8px;">PMax Alerts</td><td style="text-align:right;font-weight:bold;">' + results.pmaxAlerts.length + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">PMax Search Terms</td><td style="text-align:right;font-weight:bold;">' + results.pmaxSearchTermsNegated.length + '</td></tr>';
  }

  email += '<tr><td colspan="2" style="padding:8px;background:#e0f2f1;font-weight:bold;">Auto-Optimizations</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Device Bid Adjustments</td><td style="text-align:right;font-weight:bold;">' + results.deviceAdjustments.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Ad Schedule Adjustments</td><td style="text-align:right;font-weight:bold;">' + results.scheduleAdjustments.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Geographic Bid Adjustments</td><td style="text-align:right;font-weight:bold;">' + results.geoAdjustments.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">N-gram Negatives</td><td style="text-align:right;font-weight:bold;">' + results.ngramNegatives.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Low QS Keywords Paused</td><td style="text-align:right;font-weight:bold;">' + results.lowQsPaused.length + '</td></tr>';

  if (results.conversionHealth) {
    var ch = results.conversionHealth;
    var convColor = results.conversionAlert ? '#c62828' : '#2e7d32';
    email += '<tr><td colspan="2" style="padding:8px;background:#fff9c4;font-weight:bold;">Conversion Health</td></tr>';
    email += '<tr><td style="padding:4px 8px;">This week</td><td style="text-align:right;font-weight:bold;color:' + convColor + ';">' + ch.thisWeek.toFixed(0) + ' conv</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Last week</td><td style="text-align:right;font-weight:bold;">' + ch.lastWeek.toFixed(0) + ' conv</td></tr>';
  }

  email += '<tr><td colspan="2" style="padding:8px;background:#fce4ec;font-weight:bold;">Cleanup</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Informational Blocked</td><td style="text-align:right;font-weight:bold;">' + results.informationalBlocked.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Irrelevant Blocked</td><td style="text-align:right;font-weight:bold;">' + results.irrelevantBlocked.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Budget Alerts</td><td style="text-align:right;font-weight:bold;">' + results.budgetAlerts.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Errors</td><td style="text-align:right;font-weight:bold;">' + results.errors.length + '</td></tr>';
  email += '</table></div>';

  // === ZERO-TOLERANCE PATTERN NEGATIVES DETAIL ===
  if (results.zeroToleranceNegatives.length > 0) {
    email += '<div style="background:#fff8e1;padding:15px;border-left:4px solid #f9a825;margin-top:2px;">';
    email += '<h3 style="margin:0 0 10px;color:#f57f17;">Zero-Tolerance Pattern Negatives (' + results.zeroToleranceNegatives.length + ')</h3>';
    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    email += '<tr style="background:#f9a825;color:white;"><th style="padding:6px 8px;text-align:left;">Search Term</th><th style="padding:6px 8px;text-align:left;">Pattern</th><th style="padding:6px 8px;text-align:left;">Category</th><th style="padding:6px 8px;text-align:left;">Type</th><th style="padding:6px 8px;text-align:right;">Spend</th></tr>';
    for (var zt = 0; zt < results.zeroToleranceNegatives.length && zt < 50; zt++) {
      var zn = results.zeroToleranceNegatives[zt];
      var bgColor = zt % 2 === 0 ? '#fff' : '#fffde7';
      email += '<tr style="background:' + bgColor + ';"><td style="padding:4px 8px;">' + zn.term + '</td><td style="padding:4px 8px;">' + zn.pattern + '</td><td style="padding:4px 8px;">' + zn.category + '</td><td style="padding:4px 8px;">' + zn.type + '</td><td style="padding:4px 8px;text-align:right;">R' + zn.spend.toFixed(0) + '</td></tr>';
    }
    if (results.zeroToleranceNegatives.length > 50) {
      email += '<tr><td colspan="5" style="padding:6px 8px;color:#999;">...and ' + (results.zeroToleranceNegatives.length - 50) + ' more</td></tr>';
    }
    email += '</table></div>';
  }

  // === SINCE LAST RUN section ===
  if (results.performanceDelta && results.performanceDelta.lastRun) {
    var pd = results.performanceDelta;
    var snap = pd.snapshot;
    var lr = pd.lastRun;

    var cplPctNum = lr.cpl > 0 ? ((snap.cpl - lr.cpl) / lr.cpl) * 100 : 0;
    var cplArrow = cplPctNum <= 0 ? '↓' : '↑';
    var cplColor = cplPctNum <= 0 ? '#2e7d32' : '#c62828';
    var convDiff = snap.conversions - lr.conversions;
    var convArrow = convDiff >= 0 ? '↑' : '↓';
    var convColor = convDiff >= 0 ? '#2e7d32' : '#c62828';
    var roasPctNum = lr.roas > 0 ? ((snap.roas - lr.roas) / lr.roas) * 100 : 0;
    var roasArrow = roasPctNum >= 0 ? '↑' : '↓';
    var roasColor = roasPctNum >= 0 ? '#2e7d32' : '#c62828';

    email += '<div style="background:#e3f2fd;padding:15px;border-left:4px solid #1565c0;margin-top:2px;">';
    email += '<h3 style="margin:0 0 10px;color:#1565c0;">Since Last Run</h3>';
    email += '<table style="width:100%;border-collapse:collapse;">';
    email += '<tr><td style="padding:4px 8px;">CPL</td><td style="text-align:right;font-weight:bold;color:' + cplColor + ';">' + cplArrow + ' ' + Math.abs(cplPctNum).toFixed(1) + '% (R' + snap.cpl.toFixed(0) + ' vs R' + lr.cpl.toFixed(0) + ')</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Conversions</td><td style="text-align:right;font-weight:bold;color:' + convColor + ';">' + convArrow + ' ' + Math.abs(convDiff).toFixed(1) + ' (' + snap.conversions.toFixed(0) + ' vs ' + lr.conversions.toFixed(0) + ')</td></tr>';
    email += '<tr><td style="padding:4px 8px;">ROAS</td><td style="text-align:right;font-weight:bold;color:' + roasColor + ';">' + roasArrow + ' ' + Math.abs(roasPctNum).toFixed(1) + '% (' + snap.roas.toFixed(2) + 'x vs ' + lr.roas.toFixed(2) + 'x)</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Changes this run</td><td style="text-align:right;font-weight:bold;">' + pd.totalChanges + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Changes last run</td><td style="text-align:right;">' + lr.changesMade + '</td></tr>';
    email += '</table>';

    if (pd.runNotes) {
      email += '<div style="margin-top:10px;padding:10px 14px;background:#fff3e0;border-left:4px solid #f57c00;color:#e65100;font-size:13px;font-weight:bold;">';
      email += '⚠️ ' + pd.runNotes;
      email += '</div>';
    }

    email += '</div>';
  }

  email += '<div style="padding:15px;color:#666;font-size:12px;"><p>Completed in ' + duration.toFixed(1) + 's | Core v4.1 | Syte Digital Agency</p></div></body></html>';

  var recipients = CONFIG.EMAIL_ADDRESSES || [CONFIG.EMAIL_RECIPIENT || 'michaelh@syte.co.za'];
  if (typeof recipients === 'string') recipients = [recipients];
  MailApp.sendEmail({ to: recipients.join(','), subject: mode + ' Syte v4.1 | ' + accountName + ' | ' + CONFIG.ACCOUNT_MODE, htmlBody: email });
}


// ============================================
// ENTRY POINT — called by each client's loader
// ============================================

function runOptimization() {
  var startTime = new Date();

  _log('INFO', '═══════════════════════════════════════════');
  _log('INFO', 'SYTE OPTIMIZATION CORE v4.1');
  _log('INFO', 'Client: ' + (CONFIG.CLIENT_NAME || AdsApp.currentAccount().getName()));
  _log('INFO', 'Mode: ' + CONFIG.ACCOUNT_MODE);
  _log('INFO', 'Run: ' + (CONFIG.PREVIEW_MODE ? 'PREVIEW (no changes)' : 'LIVE'));
  _log('INFO', '═══════════════════════════════════════════');

  // === PERFORMANCE SNAPSHOT (before any optimizations) ===
  _log('INFO', '\n=== PERFORMANCE SNAPSHOT ===');
  var performanceSnapshot = _capturePerformanceSnapshot();
  var lastRun = _getLastRunLogRow();
  if (performanceSnapshot) {
    _log('INFO', 'Snapshot: CPL R' + performanceSnapshot.cpl.toFixed(0) + ' | Conv ' + performanceSnapshot.conversions.toFixed(0) + ' | ROAS ' + performanceSnapshot.roas.toFixed(2) + 'x');
    if (lastRun) {
      _log('INFO', 'Last run: CPL R' + lastRun.cpl.toFixed(0) + ' | Conv ' + lastRun.conversions.toFixed(0) + ' | Changes: ' + lastRun.changesMade);
    } else {
      _log('INFO', 'No previous run found — first run for this account.');
    }
  }

  var results = {
    keywordsPaused: [], searchTermsNegated: [], informationalBlocked: [],
    irrelevantBlocked: [], winnersPromoted: [], budgetAlerts: [],
    shoppingProductsPaused: [], shoppingHeroProducts: [], shoppingLowROASProducts: [],
    pmaxAlerts: [], pmaxSearchTermsNegated: [],
    ecomKeywordsPaused: [], ecomSearchTermsNegated: [], ecomWinnersPromoted: [],
    deviceAdjustments: [], scheduleAdjustments: [], geoAdjustments: [],
    ngramNegatives: [], lowQsPaused: [],
    zeroToleranceNegatives: [],
    conversionHealth: null, conversionAlert: null,
    performanceDelta: null,
    errors: []
  };

  try {

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

      // === LEAD GEN ===
      if (_isLeadGenMode()) {
        _log('INFO', '\n=== SEARCH (LEAD GEN) ===');
        _pauseHighSpendKeywords_LeadGen(results);
        _negativeHighSpendSearchTerms_LeadGen(results);
        if (CONFIG.PROMOTION_ENABLED !== false) _promoteWinners_LeadGen(results);
      }

      // === ECOMMERCE ===
      if (_isEcommerceMode()) {
        _log('INFO', '\n=== SEARCH (ECOMMERCE) ===');
        _pauseHighSpendKeywords_Ecommerce(results);
        _negativeHighSpendSearchTerms_Ecommerce(results);
        if (CONFIG.PROMOTION_ENABLED !== false) _promoteWinners_Ecommerce(results);
      }

      // === CLEANUP ===
      _log('INFO', '\n=== CLEANUP ===');
      _blockInformationalTerms(results);
      _blockIrrelevantTerms(results);

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

  var duration = (new Date() - startTime) / 1000;
  _log('INFO', 'Script completed in ' + duration.toFixed(1) + ' seconds');

  // === WRITE RUNLOG ROW ===
  var totalChanges = results.keywordsPaused.length + results.searchTermsNegated.length +
    results.winnersPromoted.length + results.ecomKeywordsPaused.length +
    results.ecomSearchTermsNegated.length + results.ecomWinnersPromoted.length +
    results.deviceAdjustments.length + results.scheduleAdjustments.length +
    results.geoAdjustments.length + results.ngramNegatives.length +
    results.lowQsPaused.length + results.informationalBlocked.length +
    results.irrelevantBlocked.length;

  if (performanceSnapshot) {
    results.performanceDelta = _writeRunLogRow(performanceSnapshot, totalChanges, lastRun);
    if (results.performanceDelta) {
      _log('INFO', 'RunLog written. Delta CPL: ' + (results.performanceDelta.deltaCpl || 'N/A') +
        ' | Delta Conv: ' + (results.performanceDelta.deltaConv || 'N/A'));
    }
  }

  if (CONFIG.SEND_EMAIL !== false) _sendReport(results, duration);

  _log('INFO', '\n=== SUMMARY ===');
  if (_isLeadGenMode()) _log('INFO', 'KW Paused: ' + results.keywordsPaused.length + ' | ST Negated: ' + results.searchTermsNegated.length + ' | Winners: ' + results.winnersPromoted.length);
  if (_isEcommerceMode()) _log('INFO', 'Ecom KW: ' + results.ecomKeywordsPaused.length + ' | Ecom ST: ' + results.ecomSearchTermsNegated.length + ' | Ecom Winners: ' + results.ecomWinnersPromoted.length);
  _log('INFO', 'Device: ' + results.deviceAdjustments.length + ' | Schedule: ' + results.scheduleAdjustments.length + ' | Geo: ' + results.geoAdjustments.length + ' | N-gram: ' + results.ngramNegatives.length + ' | Low QS: ' + results.lowQsPaused.length);
  _log('INFO', 'Informational: ' + results.informationalBlocked.length + ' | Irrelevant: ' + results.irrelevantBlocked.length + ' | Budget: ' + results.budgetAlerts.length + ' | Errors: ' + results.errors.length);
}
