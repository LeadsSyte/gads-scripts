/**
 * SYTE OPTIMIZATION CORE v3.2
 * ============================
 * This file is the CORE engine — hosted centrally and fetched by each client's loader script.
 * DO NOT paste this into Google Ads Scripts directly.
 * Host this file at a URL (GitHub, Netlify, Google Cloud Storage, etc.)
 * 
 * Each client account has a small "loader" script that:
 *   1. Defines their CONFIG
 *   2. Fetches this core via UrlFetchApp.fetch()
 *   3. Calls runOptimization()
 * 
 * When you improve this core, ALL client accounts get the update on their next scheduled run.
 * 
 * Author: Syte Digital Agency (syte.co.za)
 * Version: 3.2
 * 
 * CHANGELOG v3.2 — AUTO-OPTIMIZATIONS:
 * - NEW: Device bid adjustments — auto-adjusts mobile/tablet bids based on CVR/ROAS vs desktop
 * - NEW: Hour-of-day scheduling — auto-reduces bids in hours with high spend & zero conversions
 * - NEW: Geographic bid adjustments — auto-reduces bids in underperforming locations
 * - NEW: Conversion tracking health check — urgent alert if conversions drop 50%+ week-over-week
 * - NEW: N-gram analysis — finds recurring waste words across search terms and auto-negatives them
 * - NEW: Low Quality Score keyword pausing — pauses QS 1-3 keywords above spend threshold
 * - NEW: Keyword Opportunity Scanner — scrapes client website, finds services, generates transactional
 *        keywords, compares vs existing account keywords, and reports gaps to bid on
 * 
 * CHANGELOG v3.1:
 * - Central hosting architecture (core + loader pattern)
 * - FIXED: Winner promotion now copies RSAs from source ad group into [Exact Winners]
 * - FIXED: Adds negative in source ad group to funnel traffic to exact match
 * - Added ECOMMERCE mode (ROAS-based optimization for search, shopping, PMax)
 * - Added HYBRID mode (both lead gen + ecommerce)
 * - Shopping product analysis (hero identification, zero-revenue flagging)
 * - PMax campaign monitoring and search term cleanup
 * - Asset group level alerting
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
    // Apply to all enabled campaigns
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
// WINNER PROMOTION — WITH AD COPY FIX
// ============================================

/**
 * Creates an exact match keyword in a dedicated [Exact Winners] ad group.
 * FIXED in v3.1: Now copies RSAs from the source ad group so keywords actually serve.
 * Also adds a negative in the source ad group to funnel traffic to the exact match.
 */
function _createExactMatchWinner(searchTerm, campaignName, sourceAdGroupName) {
  try {
    // Find the campaign
    var ci = AdsApp.campaigns().withCondition('campaign.name = "' + campaignName + '"').get();
    if (!ci.hasNext()) {
      _log('WARN', 'Campaign not found: ' + campaignName);
      return false;
    }
    var campaign = ci.next();
    
    // Find or create [Exact Winners] ad group
    var winnersAdGroupName = CONFIG.EXACT_WINNERS_AD_GROUP_NAME || '[Exact Winners]';
    var exactAdGroup = null;
    var agi = campaign.adGroups().withCondition('ad_group.name = "' + winnersAdGroupName + '"').get();
    
    if (agi.hasNext()) {
      exactAdGroup = agi.next();
      _log('DEBUG', 'Found existing ad group: ' + winnersAdGroupName);
    } else {
      // Create the ad group
      var result = campaign.newAdGroupBuilder()
        .withName(winnersAdGroupName)
        .withStatus('ENABLED')
        .build();
      
      if (result.isSuccessful()) {
        exactAdGroup = result.getResult();
        _log('INFO', 'Created ad group: "' + winnersAdGroupName + '" in "' + campaignName + '"');
        
        // *** THE FIX: Copy ads from source ad group ***
        _copyAdsToAdGroup(campaignName, sourceAdGroupName, exactAdGroup);
      } else {
        _log('ERROR', 'Failed to create ad group: ' + winnersAdGroupName);
        return false;
      }
    }
    
    if (!exactAdGroup) return false;
    
    // Check if this exact keyword already exists
    var existingKw = exactAdGroup.keywords()
      .withCondition('ad_group_criterion.keyword.text = "' + searchTerm + '"')
      .withCondition('ad_group_criterion.keyword.match_type = "EXACT"')
      .get();
    
    if (existingKw.hasNext()) {
      _log('DEBUG', 'Exact match already exists: [' + searchTerm + ']');
      return false;
    }
    
    // Get the final URL from source ad group
    var finalUrl = _getAdGroupFinalUrl(campaignName, sourceAdGroupName);
    
    // Add the exact match keyword
    var kwBuilder = exactAdGroup.newKeywordBuilder().withText('[' + searchTerm + ']');
    if (finalUrl) kwBuilder = kwBuilder.withFinalUrl(finalUrl);
    kwBuilder.build();
    _log('INFO', '  Added exact match: [' + searchTerm + ']');
    
    // Add negative in source ad group to funnel traffic
    var sourceAgi = campaign.adGroups().withCondition('ad_group.name = "' + sourceAdGroupName + '"').get();
    if (sourceAgi.hasNext()) {
      sourceAgi.next().createNegativeKeyword('[' + searchTerm + ']');
      _log('INFO', '  Added negative in source: "' + sourceAdGroupName + '"');
    }
    
    return true;
  } catch (e) {
    _log('ERROR', 'createExactMatchWinner error: ' + e.message);
    return false;
  }
}

/**
 * Copies all enabled RSAs from a source ad group into a target ad group.
 * This ensures the [Exact Winners] ad group has ads and can actually serve.
 */
function _copyAdsToAdGroup(campaignName, sourceAdGroupName, targetAdGroup) {
  try {
    var adIterator = AdsApp.ads()
      .withCondition('campaign.name = "' + campaignName + '"')
      .withCondition('ad_group.name = "' + sourceAdGroupName + '"')
      .withCondition('ad_group_ad.status = ENABLED')
      .get();
    
    var adsCopied = 0;
    while (adIterator.hasNext()) {
      var ad = adIterator.next();
      if (ad.getType() === 'RESPONSIVE_SEARCH_AD') {
        var rsa = ad.asType().responsiveSearchAd();
        var headlines = rsa.getHeadlines().map(function(h) {
          return { text: h.text, pinning: h.pinnedField || undefined };
        });
        var descriptions = rsa.getDescriptions().map(function(d) {
          return { text: d.text, pinning: d.pinnedField || undefined };
        });
        
        targetAdGroup.newAd().responsiveSearchAdBuilder()
          .withHeadlines(headlines)
          .withDescriptions(descriptions)
          .withFinalUrl(ad.urls().getFinalUrl())
          .build();
        adsCopied++;
      }
    }
    
    if (adsCopied > 0) {
      _log('INFO', '  Copied ' + adsCopied + ' RSA(s) from "' + sourceAdGroupName + '" to [Exact Winners]');
    } else {
      _log('WARN', '  No enabled RSAs found in "' + sourceAdGroupName + '" to copy — ads still needed!');
    }
  } catch (e) {
    _log('WARN', 'copyAds error: ' + e.message);
  }
}

/**
 * Gets the final URL from the first enabled ad in an ad group.
 */
function _getAdGroupFinalUrl(campaignName, adGroupName) {
  try {
    var ai = AdsApp.ads()
      .withCondition('campaign.name = "' + campaignName + '"')
      .withCondition('ad_group.name = "' + adGroupName + '"')
      .withCondition('ad_group_ad.status = ENABLED')
      .withLimit(1)
      .get();
    if (ai.hasNext()) return ai.next().urls().getFinalUrl();
  } catch (e) { /* silent */ }
  return '';
}


// ============================================
// LEAD GEN TASKS
// ============================================

function _pauseHighSpendKeywords_LeadGen(results) {
  var dr = _getDateRange(); var changeCount = 0;
  var query = 'SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, campaign.name, ad_group.name, metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.ctr FROM keyword_view WHERE metrics.cost_micros > ' + (CONFIG.KEYWORD_SPEND_THRESHOLD * 1000000) + ' AND metrics.conversions < 1 AND campaign.status = "ENABLED" AND ad_group.status = "ENABLED" AND ad_group_criterion.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
  try {
    var search = AdsApp.search(query);
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var kw = row.adGroupCriterion.keyword.text;
      var cn = row.campaign.name, agn = row.adGroup.name;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var ctr = Number(row.metrics.ctr) * 100;
      if (_isProtectedTerm(kw)) continue;
      if (ctr > CONFIG.MIN_CTR_TO_PROTECT && !_isInformational(kw)) continue;
      _log('INFO', 'PAUSE: "' + kw + '" | ' + CONFIG.CURRENCY_SYMBOL + cost.toFixed(2) + ' | 0 conv');
      results.keywordsPaused.push({ keyword: kw, campaign: cn, adGroup: agn, spend: cost });
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
      _log('INFO', 'NEGATIVE: "' + st + '" | ' + CONFIG.CURRENCY_SYMBOL + cost.toFixed(2) + ' | 0 conv');
      results.searchTermsNegated.push({ searchTerm: st, campaign: row.campaign.name, spend: cost });
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
      _log('INFO', 'ECOM PAUSE: "' + kw + '" | ROAS: ' + roas.toFixed(2) + 'x | Spend: ' + CONFIG.CURRENCY_SYMBOL + cost.toFixed(2));
      results.ecomKeywordsPaused.push({ keyword: kw, campaign: cn, adGroup: agn, spend: cost, revenue: revenue, roas: roas });
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
      results.ecomSearchTermsNegated.push({ searchTerm: st, campaign: row.campaign.name, spend: cost, revenue: revenue, roas: roas });
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
      _log('INFO', 'ECOM WINNER: "' + st + '" | ROAS: ' + roas.toFixed(2) + 'x | Rev: ' + CONFIG.CURRENCY_SYMBOL + revenue.toFixed(2));
      results.ecomWinnersPromoted.push({ searchTerm: st, campaign: row.campaign.name, adGroup: row.adGroup.name, revenue: revenue, roas: roas, spend: cost });
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
      _log('INFO', 'PMax: "' + cn + '" | ROAS: ' + roas.toFixed(2) + 'x | Rev: ' + CONFIG.CURRENCY_SYMBOL + revenue.toFixed(2));
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
  var changeCount = 0;
  var negativeList = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_INFORMATIONAL);
  var existing = _getExistingNegatives(negativeList);
  var query = 'SELECT search_term_view.search_term, metrics.cost_micros FROM search_term_view WHERE campaign.status = "ENABLED" AND segments.date DURING LAST_7_DAYS';
  try {
    var search = AdsApp.search(query); var added = {};
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      if (_isProtectedTerm(st)) continue;
      for (var i = 0; i < INFORMATIONAL_PATTERNS.length; i++) {
        var p = INFORMATIONAL_PATTERNS[i];
        if (p.pattern.test(st) && !added[p.negativePhrase] && !existing[p.negativePhrase]) {
          _log('INFO', 'INFORMATIONAL: "' + st + '" -> "' + p.negativePhrase + '"');
          results.informationalBlocked.push({ phrase: p.negativePhrase, matchedTerm: st });
          if (!CONFIG.PREVIEW_MODE && negativeList) negativeList.addNegativeKeyword('"' + p.negativePhrase + '"');
          added[p.negativePhrase] = true;
          changeCount++;
          break;
        }
      }
    }
  } catch (e) { _log('ERROR', 'blockInformationalTerms: ' + e.message); results.errors.push(e.message); }
}

function _blockIrrelevantTerms(results) {
  var irrelevantTerms = CONFIG.IRRELEVANT_TERMS || [];
  if (irrelevantTerms.length === 0) return;
  
  var changeCount = 0;
  var negativeList = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_IRRELEVANT);
  var existing = _getExistingNegatives(negativeList);
  var query = 'SELECT search_term_view.search_term, metrics.cost_micros FROM search_term_view WHERE campaign.status = "ENABLED" AND segments.date DURING LAST_7_DAYS';
  try {
    var search = AdsApp.search(query); var added = {};
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      if (_isProtectedTerm(st)) continue;
      for (var i = 0; i < irrelevantTerms.length; i++) {
        var term = irrelevantTerms[i];
        if (st.indexOf(term.toLowerCase()) !== -1 && !added[term] && !existing[term]) {
          _log('INFO', 'IRRELEVANT: "' + st + '" -> "' + term + '"');
          results.irrelevantBlocked.push({ phrase: term, matchedTerm: st });
          if (!CONFIG.PREVIEW_MODE && negativeList) negativeList.addNegativeKeyword('"' + term + '"');
          added[term] = true;
          changeCount++;
          break;
        }
      }
    }
  } catch (e) { _log('ERROR', 'blockIrrelevantTerms: ' + e.message); results.errors.push(e.message); }
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
    _log('INFO', 'Budget: ' + CONFIG.CURRENCY_SYMBOL + totalSpend.toFixed(2) + ' of ' + CONFIG.CURRENCY_SYMBOL + CONFIG.MONTHLY_BUDGET + ' (' + (paceRatio * 100).toFixed(1) + '%)');
    if (paceRatio > expectedPace * (1 + (CONFIG.BUDGET_ALERT_THRESHOLD || 0.7))) results.budgetAlerts.push({ type: 'OVERPACING', currentSpend: totalSpend, projected: projected });
    if (paceRatio < expectedPace * 0.5 && dom > 7) results.budgetAlerts.push({ type: 'UNDERPACING', currentSpend: totalSpend, projected: projected });
  } catch (e) { _log('ERROR', 'checkBudgetPacing: ' + e.message); results.errors.push(e.message); }
}


// ============================================
// AUTO-OPTIMIZE: DEVICE BID ADJUSTMENTS
// ============================================

/**
 * Analyzes device performance and auto-applies bid modifiers.
 * If mobile CVR is 50%+ lower than desktop, applies negative bid adjustment.
 * If mobile CVR is 50%+ higher than desktop, applies positive bid adjustment.
 * Same for tablet. Caps adjustments at -90% / +300%.
 */
function _autoAdjustDeviceBids(results) {
  var dr = _getDateRange();
  var query = 'SELECT campaign.name, campaign.id, segments.device, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks ' +
    'FROM campaign WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" ' +
    'AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
  
  try {
    var search = AdsApp.search(query);
    var campaigns = {};
    
    while (search.hasNext()) {
      var row = search.next();
      var cn = row.campaign.name;
      var device = row.segments.device;
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
      
      // Need enough desktop data as baseline
      if (desktop.clicks < minClicks) continue;
      
      var desktopCvr = desktop.clicks > 0 ? (desktop.conversions / desktop.clicks) : 0;
      
      // Adjust mobile
      if (mobile.clicks >= minClicks && mobile.cost >= minSpend) {
        var mobileCvr = mobile.clicks > 0 ? (mobile.conversions / mobile.clicks) : 0;
        var adjustment = _calculateBidAdjustment(desktopCvr, mobileCvr);
        
        if (Math.abs(adjustment) >= 10) { // Only adjust if 10%+ difference
          _applyDeviceBidAdjustment(cn, 'MOBILE', adjustment, results);
        }
      }
      
      // Adjust tablet
      if (tablet.clicks >= minClicks && tablet.cost >= minSpend) {
        var tabletCvr = tablet.clicks > 0 ? (tablet.conversions / tablet.clicks) : 0;
        var adjustment = _calculateBidAdjustment(desktopCvr, tabletCvr);
        
        if (Math.abs(adjustment) >= 10) {
          _applyDeviceBidAdjustment(cn, 'TABLET', adjustment, results);
        }
      }
    }
  } catch (e) { _log('ERROR', 'autoAdjustDeviceBids: ' + e.message); results.errors.push(e.message); }
}

function _calculateBidAdjustment(baselineCvr, deviceCvr) {
  if (baselineCvr === 0) return 0;
  // % difference: if device CVR is 50% of desktop, adjustment = -50%
  var ratio = deviceCvr / baselineCvr;
  var adjustment = Math.round((ratio - 1) * 100);
  // Cap at -90% to +300%
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
        var targeting = campaign.targeting();
        var platforms = targeting.platforms().get();
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

/**
 * Analyzes hourly performance. If specific hours have significant spend
 * with zero conversions, creates ad schedule bid adjustments to reduce
 * bids during those hours.
 */
function _autoAdjustAdSchedule(results) {
  var query = 'SELECT campaign.name, segments.hour, metrics.cost_micros, metrics.conversions, metrics.clicks ' +
    'FROM campaign WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" ' +
    'AND segments.date DURING LAST_30_DAYS';
  
  try {
    var search = AdsApp.search(query);
    var hourData = {}; // { campaignName: { hour: { cost, conv, clicks } } }
    
    while (search.hasNext()) {
      var row = search.next();
      var cn = row.campaign.name;
      var hour = row.segments.hour;
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
      // Calculate campaign average CVR
      var totalConv = 0, totalClicks = 0;
      for (var h in hourData[cn]) { totalConv += hourData[cn][h].conversions; totalClicks += hourData[cn][h].clicks; }
      var avgCvr = totalClicks > 0 ? totalConv / totalClicks : 0;
      if (avgCvr === 0) continue; // No conversions at all, skip
      
      for (var h in hourData[cn]) {
        var hd = hourData[cn][h];
        if (hd.cost < minHourSpend || hd.clicks < minHourClicks) continue;
        
        var hourCvr = hd.clicks > 0 ? hd.conversions / hd.clicks : 0;
        
        // Zero conversions with significant spend: reduce by 50-75%
        if (hd.conversions === 0 && hd.cost >= minHourSpend * 2) {
          _applyHourBidAdjustment(cn, parseInt(h), -75, results);
        } else if (hd.conversions === 0) {
          _applyHourBidAdjustment(cn, parseInt(h), -50, results);
        }
        // CVR less than 25% of average: reduce by 40%
        else if (hourCvr < avgCvr * 0.25 && hd.cost >= minHourSpend) {
          _applyHourBidAdjustment(cn, parseInt(h), -40, results);
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
        // Create ad schedule for this hour, all days
        var days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
        for (var d = 0; d < days.length; d++) {
          try {
            campaign.addAdSchedule({
              dayOfWeek: days[d],
              startHour: hour,
              startMinute: 0,
              endHour: hour + 1,
              endMinute: 0,
              bidModifier: 1 + (adjustment / 100)
            });
          } catch (e2) {
            // May already exist — try to update existing
            var schedules = campaign.targeting().adSchedules().get();
            while (schedules.hasNext()) {
              var sched = schedules.next();
              if (sched.getStartHour() === hour && sched.getDayOfWeek() === days[d]) {
                sched.setBidModifier(1 + (adjustment / 100));
                break;
              }
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

/**
 * Analyzes location performance and auto-reduces bids for
 * underperforming regions, auto-increases for strong ones.
 */
function _autoAdjustGeoBids(results) {
  var query = 'SELECT campaign.name, campaign_criterion.location.geo_target_constant, ' +
    'metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks ' +
    'FROM location_view WHERE campaign.status = "ENABLED" AND segments.date DURING LAST_30_DAYS';
  
  try {
    var search = AdsApp.search(query);
    var geoData = {}; // { campaignName: { locationId: { cost, conv, clicks } } }
    
    while (search.hasNext()) {
      var row = search.next();
      var cn = row.campaign.name;
      var locId = row.campaignCriterion.location.geoTargetConstant;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var conv = Number(row.metrics.conversions) || 0;
      var clicks = Number(row.metrics.clicks) || 0;
      
      if (!geoData[cn]) geoData[cn] = {};
      if (!geoData[cn][locId]) geoData[cn][locId] = { cost: 0, conversions: 0, clicks: 0, locationId: locId };
      geoData[cn][locId].cost += cost;
      geoData[cn][locId].conversions += conv;
      geoData[cn][locId].clicks += clicks;
    }
    
    var minGeoSpend = CONFIG.GEO_MIN_SPEND || 500;
    var minGeoClicks = CONFIG.GEO_MIN_CLICKS || 30;
    
    for (var cn in geoData) {
      // Campaign totals for baseline
      var totalConv = 0, totalClicks = 0;
      for (var loc in geoData[cn]) { totalConv += geoData[cn][loc].conversions; totalClicks += geoData[cn][loc].clicks; }
      var avgCvr = totalClicks > 0 ? totalConv / totalClicks : 0;
      if (avgCvr === 0) continue;
      
      for (var loc in geoData[cn]) {
        var gd = geoData[cn][loc];
        if (gd.cost < minGeoSpend || gd.clicks < minGeoClicks) continue;
        
        var locCvr = gd.clicks > 0 ? gd.conversions / gd.clicks : 0;
        
        // Zero conversions: reduce 50%
        if (gd.conversions === 0 && gd.cost >= minGeoSpend) {
          _log('INFO', 'GEO: "' + cn + '" | Location ' + loc + ' | 0 conv | ' + CONFIG.CURRENCY_SYMBOL + gd.cost.toFixed(0) + ' spend | -50%');
          results.geoAdjustments.push({ campaign: cn, location: loc, spend: gd.cost, conversions: 0, adjustment: -50 });
          if (!CONFIG.PREVIEW_MODE) _setGeoBidModifier(cn, loc, 0.50);
        }
        // CVR < 30% of average: reduce 40%
        else if (locCvr < avgCvr * 0.3) {
          _log('INFO', 'GEO: "' + cn + '" | Location ' + loc + ' | Low CVR | -40%');
          results.geoAdjustments.push({ campaign: cn, location: loc, spend: gd.cost, conversions: gd.conversions, adjustment: -40 });
          if (!CONFIG.PREVIEW_MODE) _setGeoBidModifier(cn, loc, 0.60);
        }
        // CVR > 200% of average: increase 30%
        else if (locCvr > avgCvr * 2 && gd.conversions >= 3) {
          _log('INFO', 'GEO: "' + cn + '" | Location ' + loc + ' | High CVR | +30%');
          results.geoAdjustments.push({ campaign: cn, location: loc, spend: gd.cost, conversions: gd.conversions, adjustment: 30 });
          if (!CONFIG.PREVIEW_MODE) _setGeoBidModifier(cn, loc, 1.30);
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
        if (String(loc.getId()) === String(locationConstant).replace(/[^0-9]/g, '')) {
          loc.setBidModifier(modifier);
          break;
        }
      }
    }
  } catch (e) { _log('WARN', 'Geo bid modifier failed: ' + e.message); }
}


// ============================================
// AUTO-OPTIMIZE: N-GRAM ANALYSIS
// ============================================

/**
 * Finds single words that appear across multiple search terms with zero
 * conversions and high cumulative spend. If a word appears in 3+ search
 * terms with combined spend > threshold, auto-negatives it.
 */
function _autoNgramNegatives(results) {
  var query = 'SELECT search_term_view.search_term, metrics.cost_micros, metrics.conversions, metrics.clicks ' +
    'FROM search_term_view WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" ' +
    'AND segments.date DURING LAST_30_DAYS';
  
  try {
    var search = AdsApp.search(query);
    var wordStats = {}; // { word: { totalCost, totalConv, totalClicks, termCount, terms[] } }
    
    while (search.hasNext()) {
      var row = search.next();
      var st = row.searchTermView.searchTerm.toLowerCase().trim();
      var cost = Number(row.metrics.costMicros) / 1000000;
      var conv = Number(row.metrics.conversions) || 0;
      var clicks = Number(row.metrics.clicks) || 0;
      
      // Split into words (1-grams)
      var words = st.split(/\s+/);
      var seen = {}; // avoid double-counting a word in the same term
      for (var i = 0; i < words.length; i++) {
        var word = words[i].replace(/[^a-z0-9]/g, '');
        if (word.length < 3 || seen[word]) continue; // skip tiny words
        seen[word] = true;
        
        if (!wordStats[word]) wordStats[word] = { totalCost: 0, totalConversions: 0, totalClicks: 0, termCount: 0, terms: [] };
        wordStats[word].totalCost += cost;
        wordStats[word].totalConversions += conv;
        wordStats[word].totalClicks += clicks;
        wordStats[word].termCount++;
        if (wordStats[word].terms.length < 5) wordStats[word].terms.push(st); // keep sample
      }
    }
    
    // Also do 2-grams (bigrams)
    // Reset search not possible, so we process from wordStats for now
    
    var ngramSpendThreshold = CONFIG.NGRAM_SPEND_THRESHOLD || 1000;
    var ngramMinTerms = CONFIG.NGRAM_MIN_TERMS || 3;
    var negativeList = _getOrCreateNegativeList(CONFIG.NEGATIVE_LIST_NAME_SPEND);
    var existing = _getExistingNegatives(negativeList);
    var changeCount = 0;
    
    // CRITICAL: Build a set of words that appear in active bidded keywords.
    // Never negate these — they'd block your own keywords.
    var activeKeywordWords = {};
    try {
      var kwQuery = 'SELECT ad_group_criterion.keyword.text FROM keyword_view WHERE campaign.status = "ENABLED" AND ad_group.status = "ENABLED" AND ad_group_criterion.status = "ENABLED"';
      var kwSearch = AdsApp.search(kwQuery);
      while (kwSearch.hasNext()) {
        var kwText = kwSearch.next().adGroupCriterion.keyword.text.toLowerCase();
        var kwWords = kwText.split(/\s+/);
        for (var w = 0; w < kwWords.length; w++) {
          var word = kwWords[w].replace(/[^a-z0-9]/g, '');
          if (word.length >= 3) activeKeywordWords[word] = true;
        }
      }
    } catch (e) { _log('WARN', 'Could not load active keyword words: ' + e.message); }
    _log('INFO', 'Protected keyword words: ' + Object.keys(activeKeywordWords).length);
    
    // Sort by total wasted spend (zero conversion words first)
    var wasteWords = [];
    for (var word in wordStats) {
      var ws = wordStats[word];
      if (ws.totalConversions === 0 && ws.totalCost >= ngramSpendThreshold && ws.termCount >= ngramMinTerms) {
        if (_isProtectedTerm(word) || existing[word]) continue;
        // CRITICAL: Skip words that appear in active bidded keywords
        if (activeKeywordWords[word]) {
          _log('DEBUG', 'N-gram skip (in active keywords): "' + word + '" | ' + CONFIG.CURRENCY_SYMBOL + ws.totalCost.toFixed(0));
          continue;
        }
        // Skip common stop words
        if (['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'has', 'have', 'not', 'but', 'they', 'you', 'your', 'our', 'can', 'will'].indexOf(word) !== -1) continue;
        wasteWords.push({ word: word, stats: ws });
      }
    }
    
    wasteWords.sort(function(a, b) { return b.stats.totalCost - a.stats.totalCost; });
    
    for (var i = 0; i < wasteWords.length && changeCount < 20; i++) {
      var ww = wasteWords[i];
      _log('INFO', 'NGRAM: "' + ww.word + '" | ' + CONFIG.CURRENCY_SYMBOL + ww.stats.totalCost.toFixed(0) + ' waste | ' + ww.stats.termCount + ' terms | 0 conv');
      results.ngramNegatives.push({ word: ww.word, totalCost: ww.stats.totalCost, termCount: ww.stats.termCount, sampleTerms: ww.stats.terms });
      
      if (!CONFIG.PREVIEW_MODE && negativeList) {
        negativeList.addNegativeKeyword('"' + ww.word + '"');
      }
      changeCount++;
    }
  } catch (e) { _log('ERROR', 'autoNgramNegatives: ' + e.message); results.errors.push(e.message); }
  _log('INFO', 'N-gram negatives added: ' + results.ngramNegatives.length);
}


// ============================================
// AUTO-OPTIMIZE: LOW QUALITY SCORE PAUSING
// ============================================

/**
 * Pauses keywords with Quality Score 1-3 that have spent above threshold
 * with no conversions. Low QS = inflated CPCs = wasting money.
 */
function _pauseLowQualityScoreKeywords(results) {
  var dr = _getDateRange();
  var qsThreshold = CONFIG.QS_PAUSE_THRESHOLD || 3; // Pause QS 1-3
  var qsSpendThreshold = CONFIG.QS_SPEND_THRESHOLD || 300;
  
  var query = 'SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ' +
    'ad_group_criterion.quality_info.quality_score, campaign.name, ad_group.name, ' +
    'metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.impressions ' +
    'FROM keyword_view WHERE campaign.status = "ENABLED" AND ad_group.status = "ENABLED" ' +
    'AND ad_group_criterion.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" ' +
    'AND ad_group_criterion.quality_info.quality_score <= ' + qsThreshold + ' ' +
    'AND metrics.cost_micros > ' + (qsSpendThreshold * 1000000) + ' ' +
    'AND metrics.conversions < 1 ' +
    'AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
  
  try {
    var search = AdsApp.search(query);
    var changeCount = 0;
    
    while (search.hasNext() && changeCount < CONFIG.MAX_CHANGES_PER_RUN) {
      var row = search.next();
      var kw = row.adGroupCriterion.keyword.text;
      var qs = row.adGroupCriterion.qualityInfo.qualityScore;
      var cn = row.campaign.name, agn = row.adGroup.name;
      var cost = Number(row.metrics.costMicros) / 1000000;
      var clicks = Number(row.metrics.clicks) || 0;
      
      if (_isProtectedTerm(kw)) continue;
      
      _log('INFO', 'LOW QS PAUSE: "' + kw + '" | QS: ' + qs + ' | ' + CONFIG.CURRENCY_SYMBOL + cost.toFixed(0) + ' | 0 conv');
      results.lowQsPaused.push({ keyword: kw, qualityScore: qs, campaign: cn, adGroup: agn, spend: cost, clicks: clicks });
      
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

/**
 * Compares this week's conversions vs last week's. If conversions dropped
 * 50%+, sends an urgent alert. Catches broken tracking before it wastes thousands.
 */
function _checkConversionHealth(results) {
  try {
    // This week's conversions
    var q1 = 'SELECT metrics.conversions, metrics.cost_micros FROM campaign WHERE campaign.status = "ENABLED" AND segments.date DURING LAST_7_DAYS';
    var s1 = AdsApp.search(q1);
    var thisWeekConv = 0, thisWeekCost = 0;
    while (s1.hasNext()) { var r = s1.next(); thisWeekConv += Number(r.metrics.conversions) || 0; thisWeekCost += Number(r.metrics.costMicros) / 1000000; }
    
    // Last week's conversions (14 days ago to 7 days ago)
    var end = new Date(); end.setDate(end.getDate() - 7);
    var start = new Date(); start.setDate(start.getDate() - 14);
    var q2 = 'SELECT metrics.conversions FROM campaign WHERE campaign.status = "ENABLED" AND segments.date BETWEEN "' + _formatDate(start) + '" AND "' + _formatDate(end) + '"';
    var s2 = AdsApp.search(q2);
    var lastWeekConv = 0;
    while (s2.hasNext()) { lastWeekConv += Number(s2.next().metrics.conversions) || 0; }
    
    _log('INFO', 'Conversion health: This week=' + thisWeekConv.toFixed(0) + ' | Last week=' + lastWeekConv.toFixed(0));
    
    results.conversionHealth = { thisWeek: thisWeekConv, lastWeek: lastWeekConv, thisWeekCost: thisWeekCost };
    
    // Alert if conversions dropped 50%+ and there was meaningful volume last week
    if (lastWeekConv >= 3 && thisWeekConv < lastWeekConv * 0.5) {
      var dropPct = ((1 - thisWeekConv / lastWeekConv) * 100).toFixed(0);
      var alertMsg = 'URGENT: Conversions dropped ' + dropPct + '% (' + lastWeekConv.toFixed(0) + ' → ' + thisWeekConv.toFixed(0) + ') while spending ' + CONFIG.CURRENCY_SYMBOL + thisWeekCost.toFixed(0) + '. Check conversion tracking immediately.';
      _log('ERROR', alertMsg);
      results.conversionAlert = alertMsg;
      
      // Send immediate urgent email
      if (CONFIG.SEND_EMAIL !== false) {
        var recipients = CONFIG.EMAIL_ADDRESSES || [CONFIG.EMAIL_RECIPIENT || 'michaelh@syte.co.za'];
        if (typeof recipients === 'string') recipients = [recipients];
        MailApp.sendEmail({
          to: recipients.join(','),
          subject: '🚨 URGENT: ' + CONFIG.CLIENT_NAME + ' — Conversions Dropped ' + dropPct + '%',
          body: alertMsg + '\n\nThis could indicate broken conversion tracking, a landing page issue, or a significant market change.\n\nAction needed:\n1. Check conversion tags in GTM\n2. Test the conversion flow manually\n3. Check for landing page errors\n4. Review any recent website changes\n\n— Syte Optimization Script v3.2'
        });
      }
    }
    
    // Also alert on zero conversions with significant spend
    if (thisWeekConv === 0 && thisWeekCost > (CONFIG.MONTHLY_BUDGET * 0.1)) {
      var alertMsg = 'CRITICAL: ZERO conversions this week with ' + CONFIG.CURRENCY_SYMBOL + thisWeekCost.toFixed(0) + ' spent. Conversion tracking may be broken.';
      _log('ERROR', alertMsg);
      results.conversionAlert = alertMsg;
    }
    
  } catch (e) { _log('ERROR', 'checkConversionHealth: ' + e.message); results.errors.push(e.message); }
}


// ============================================
// KEYWORD OPPORTUNITY SCANNER
// ============================================

/**
 * Scrapes the client's website to find services/products, generates
 * transactional keywords, and compares against existing account keywords
 * to identify gaps — services you COULD be bidding on but aren't.
 * 
 * Requires CONFIG.CLIENT_WEBSITE to be set.
 * Only runs if CONFIG.KEYWORD_SCANNER !== false.
 */
function _scanKeywordOpportunities(results) {
  var website = CONFIG.CLIENT_WEBSITE;
  if (!website) {
    _log('WARN', 'Keyword scanner skipped: CLIENT_WEBSITE not set in config');
    return;
  }
  
  _log('INFO', 'Scanning website: ' + website);
  
  try {
    // Step 1: Extract services from website (via AI)
    var services = _extractServicesFromWebsite(website);
    _log('INFO', 'Services found: ' + services.length);
    
    if (services.length === 0) {
      _log('WARN', 'No services extracted from website');
      return;
    }
    
    // Step 2: Generate transactional keywords grouped by service
    var serviceKeywords = _generateKeywordsByService(services);
    _log('INFO', 'Service groups: ' + serviceKeywords.length);
    
    // Step 3: Get existing keywords in the account
    var existingKeywords = _getAllExistingKeywords();
    _log('INFO', 'Existing keywords in account: ' + existingKeywords.size);
    
    // Step 4: Find the best existing search campaign to add ad groups into
    var targetCampaign = _findBestSearchCampaign();
    if (!targetCampaign && !CONFIG.PREVIEW_MODE) {
      _log('WARN', 'No enabled search campaign found — cannot create test ad groups');
      return;
    }
    var targetCampaignName = targetCampaign ? targetCampaign.getName() : '(preview)';
    _log('INFO', 'Target campaign: "' + targetCampaignName + '"');
    
    // Step 5: Get existing [Test] ad groups to avoid duplicates
    var existingAdGroups = {};
    try {
      var agi = AdsApp.adGroups().withCondition('ad_group.name LIKE "[Test]%"').get();
      while (agi.hasNext()) existingAdGroups[agi.next().getName().toLowerCase()] = true;
    } catch (e) {}
    
    // Step 6: Create PAUSED ad groups for new services
    var totalOpportunities = [];
    var adGroupsCreated = 0;
    
    for (var i = 0; i < serviceKeywords.length; i++) {
      var group = serviceKeywords[i];
      var adGroupName = '[Test] ' + group.serviceName;
      
      // Skip if already exists
      if (existingAdGroups[adGroupName.toLowerCase()]) {
        _log('DEBUG', 'Already exists, skipping: ' + adGroupName);
        continue;
      }
      
      // Filter to genuinely new keywords
      var newKws = [];
      for (var k = 0; k < group.keywords.length; k++) {
        var kwLower = group.keywords[k].keyword.toLowerCase();
        if (!existingKeywords.has(kwLower) && !_isCloseVariation(kwLower, existingKeywords)) {
          newKws.push(group.keywords[k]);
        }
      }
      
      // Need at least 3 new keywords to bother
      if (newKws.length < 3) continue;
      
      // Cap at 10 per run
      if (adGroupsCreated >= 10) {
        _log('INFO', 'Max 10 ad groups per run — rest picked up next run');
        break;
      }
      
      _log('INFO', 'Building: "' + adGroupName + '" (' + newKws.length + ' keywords)');
      
      if (!CONFIG.PREVIEW_MODE && targetCampaign) {
        var agResult = targetCampaign.newAdGroupBuilder().withName(adGroupName).withStatus('PAUSED').build();
        if (agResult.isSuccessful()) {
          var adGroup = agResult.getResult();
          
          var kwCount = 0;
          for (var k = 0; k < newKws.length && kwCount < 20; k++) {
            var kw = newKws[k];
            var formatted = kw.matchType === 'Exact' ? '[' + kw.keyword + ']' : '"' + kw.keyword + '"';
            try {
              adGroup.newKeywordBuilder().withText(formatted).withFinalUrl(group.sourceUrl || website).build();
              kwCount++;
            } catch (e) { _log('DEBUG', 'KW add: ' + e.message); }
          }
          
          _createAdGroupRSA(adGroup, group.serviceName, website);
          adGroupsCreated++;
          _log('INFO', '  Created in "' + targetCampaignName + '" with ' + kwCount + ' keywords + RSA (PAUSED)');
        }
      } else if (CONFIG.PREVIEW_MODE) {
        _log('INFO', '  Would create "' + adGroupName + '" with ' + newKws.length + ' keywords (Preview)');
        adGroupsCreated++;
      }
      
      for (var k = 0; k < newKws.length; k++) {
        newKws[k].service = group.serviceName;
        totalOpportunities.push(newKws[k]);
      }
    }
    
    _log('INFO', 'Ad groups created: ' + adGroupsCreated + ' | Total new keywords: ' + totalOpportunities.length);
    results.keywordOpportunities = totalOpportunities;
    results.servicesFound = services;
    results.testAdGroupsCreated = adGroupsCreated;
    results.testCampaignUsed = targetCampaignName;
    
  } catch (e) {
    _log('ERROR', 'scanKeywordOpportunities: ' + e.message);
    results.errors.push('Keyword scanner: ' + e.message);
  }
}


/**
 * Finds the most active enabled search campaign to place test ad groups into.
 * Picks the one with the highest spend in the last 30 days.
 */
function _findBestSearchCampaign() {
  try {
    var query = 'SELECT campaign.name, campaign.id, metrics.cost_micros FROM campaign ' +
      'WHERE campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" ' +
      'AND segments.date DURING LAST_30_DAYS ORDER BY metrics.cost_micros DESC LIMIT 1';
    var search = AdsApp.search(query);
    if (search.hasNext()) {
      var topCampaignName = search.next().campaign.name;
      var ci = AdsApp.campaigns().withCondition('campaign.name = "' + topCampaignName + '"').get();
      if (ci.hasNext()) return ci.next();
    }
  } catch (e) { _log('WARN', 'findBestSearchCampaign: ' + e.message); }
  
  // Fallback: just get any enabled search campaign
  try {
    var ci = AdsApp.campaigns().withCondition('campaign.status = "ENABLED"').withCondition('campaign.advertising_channel_type = "SEARCH"').withLimit(1).get();
    if (ci.hasNext()) return ci.next();
  } catch (e) {}
  
  return null;
}


/**
 * Generates an RSA for an ad group using the Anthropic API, with template fallback.
 */
function _createAdGroupRSA(adGroup, serviceName, websiteUrl) {
  var apiKey = CONFIG.ANTHROPIC_API_KEY;
  var biz = CONFIG.CLIENT_NAME || 'Our Company';
  
  if (apiKey) {
    try {
      var prompt = 'Generate a Google Responsive Search Ad.\nBusiness: ' + biz + '\nService: ' + serviceName + '\nWebsite: ' + websiteUrl + '\n\nReturn EXACTLY this format:\nH1: [max 30 chars]\nH2: [max 30 chars]\nH3: [max 30 chars]\nH4: [max 30 chars]\nH5: [max 30 chars]\nH6: [max 30 chars]\nH7: [max 30 chars]\nH8: [max 30 chars]\nH9: [max 30 chars]\nH10: [max 30 chars]\nH11: [max 30 chars]\nH12: [max 30 chars]\nH13: [max 30 chars]\nH14: [max 30 chars]\nH15: [max 30 chars]\nD1: [max 90 chars]\nD2: [max 90 chars]\nD3: [max 90 chars]\nD4: [max 90 chars]\n\nRules: Include business name in 2+ headlines. Include CTAs. Vary lengths. STRICT char limits.';
      var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        payload: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
        muteHttpExceptions: true
      });
      if (resp.getResponseCode() === 200) {
        var text = JSON.parse(resp.getContentText()).content[0].text;
        var headlines = [], descriptions = [];
        text.split('\n').forEach(function(line) {
          var hm = line.match(/^H\d+:\s*(.+)/);
          var dm = line.match(/^D\d+:\s*(.+)/);
          if (hm && headlines.length < 15) headlines.push(hm[1].trim().substring(0, 30));
          if (dm && descriptions.length < 4) descriptions.push(dm[1].trim().substring(0, 90));
        });
        if (headlines.length >= 3 && descriptions.length >= 2) {
          adGroup.newAd().responsiveSearchAdBuilder()
            .withHeadlines(headlines.map(function(h) { return { text: h }; }))
            .withDescriptions(descriptions.map(function(d) { return { text: d }; }))
            .withFinalUrl(websiteUrl).build();
          _log('INFO', '  AI RSA created (' + headlines.length + 'h, ' + descriptions.length + 'd)');
          return;
        }
      }
    } catch (e) { _log('WARN', 'AI RSA failed: ' + e.message); }
  }
  
  // Fallback: template RSA
  var svc = serviceName.substring(0, 22);
  var bizShort = biz.substring(0, 25);
  try {
    adGroup.newAd().responsiveSearchAdBuilder()
      .withHeadlines([
        { text: (svc + ' Services').substring(0, 30) }, { text: (bizShort + ' | ' + svc).substring(0, 30) },
        { text: ('Professional ' + svc).substring(0, 30) }, { text: ('Get a ' + svc + ' Quote').substring(0, 30) },
        { text: (bizShort + ' - Experts').substring(0, 30) }, { text: ('Affordable ' + svc).substring(0, 30) },
        { text: ('Top-Rated ' + svc).substring(0, 30) }, { text: 'Get a Free Quote Today' },
        { text: 'Contact Us Today' }, { text: 'Trusted Professionals' },
        { text: ('Quality ' + svc).substring(0, 30) }, { text: 'Proven Track Record' },
        { text: ('Expert ' + svc).substring(0, 30) }, { text: ('Book ' + svc + ' Now').substring(0, 30) },
        { text: (bizShort + ' - Call Now').substring(0, 30) }
      ])
      .withDescriptions([
        { text: ('Looking for professional ' + svc.toLowerCase() + '? ' + bizShort + ' delivers results. Contact us today.').substring(0, 90) },
        { text: ('Trusted ' + svc.toLowerCase() + ' provider. Quality service, competitive rates. Request your free quote.').substring(0, 90) },
        { text: (bizShort + ' offers expert ' + svc.toLowerCase() + '. Proven results for businesses of all sizes.').substring(0, 90) },
        { text: ('Get started with ' + svc.toLowerCase() + ' today. Professional team, fast turnaround. Contact us now.').substring(0, 90) }
      ])
      .withFinalUrl(websiteUrl).build();
    _log('INFO', '  Template RSA created for "' + serviceName + '"');
  } catch (e) { _log('WARN', 'Template RSA failed: ' + e.message); }
}


/**
 * Groups keywords by service name for ad group creation.
 */
function _generateKeywordsByService(services) {
  var transactionalSuffixes = [
    'services', 'company', 'agency', 'provider', 'specialist',
    'cost', 'pricing', 'quote', 'rates', 'packages', 'near me'
  ];
  var transactionalPrefixes = [
    'hire', 'get', 'buy', 'book', 'best', 'top', 'professional', 'affordable'
  ];
  var locations = CONFIG.TARGET_LOCATIONS || [];
  var groups = [];
  for (var i = 0; i < services.length; i++) {
    var service = services[i];
    var base = service.text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    if (base.length < 3 || base.split(' ').length > 5) continue;
    var keywords = [];
    var seen = {};
    if (!seen[base]) { keywords.push({ keyword: base, matchType: 'Exact' }); seen[base] = true; }
    for (var s = 0; s < transactionalSuffixes.length; s++) {
      var kw = base + ' ' + transactionalSuffixes[s];
      if (!seen[kw] && base.indexOf(transactionalSuffixes[s]) === -1 && kw.length <= 80) {
        keywords.push({ keyword: kw, matchType: kw.split(' ').length <= 3 ? 'Exact' : 'Phrase' }); seen[kw] = true;
      }
    }
    for (var p = 0; p < transactionalPrefixes.length; p++) {
      var kw = transactionalPrefixes[p] + ' ' + base;
      if (!seen[kw] && base.indexOf(transactionalPrefixes[p]) === -1 && kw.length <= 80) {
        keywords.push({ keyword: kw, matchType: 'Phrase' }); seen[kw] = true;
      }
    }
    for (var l = 0; l < Math.min(locations.length, 3); l++) {
      var kw = base + ' ' + locations[l].toLowerCase();
      if (!seen[kw]) { keywords.push({ keyword: kw, matchType: 'Phrase' }); seen[kw] = true; }
    }
    groups.push({ serviceName: service.text, sourceUrl: service.url || '', keywords: keywords });
  }
  return groups;
}


/**
 * Fetches the website and extracts service/product names from:
 * - Page titles, H1s, H2s, H3s
 * - Navigation links
 * - Meta descriptions
 * Follows internal links to service/product pages.
 */
function _extractServicesFromWebsite(baseUrl) {
  var visitedUrls = {};
  var pagesToScan = [baseUrl];
  var maxPages = CONFIG.SCANNER_MAX_PAGES || 10;
  var pagesScanned = 0;
  var allPageText = [];
  
  // Normalize base domain
  var domain = baseUrl.replace(/https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  
  // Step 1: Crawl the site and collect page text
  while (pagesToScan.length > 0 && pagesScanned < maxPages) {
    var url = pagesToScan.shift();
    if (visitedUrls[url]) continue;
    visitedUrls[url] = true;
    pagesScanned++;
    
    try {
      var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      if (response.getResponseCode() !== 200) continue;
      var html = response.getContentText();
      
      // Strip scripts, styles, and get text content
      var textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '') // remove nav (often noisy)
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '') // remove footer
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ''); // remove header
      
      // Extract headings separately (high signal)
      var headings = [];
      var hRegex = /<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi;
      var hMatch;
      while ((hMatch = hRegex.exec(html)) !== null) {
        var h = _cleanText(hMatch[1]);
        if (h && h.length > 3 && h.length < 80) headings.push(h);
      }
      
      // Get page title
      var titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      var title = titleMatch ? _cleanText(titleMatch[1]) : '';
      
      // Get meta description
      var metaMatch = html.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i);
      if (!metaMatch) metaMatch = html.match(/<meta\s+content=["'](.*?)["']\s+name=["']description["']/i);
      var metaDesc = metaMatch ? _cleanText(metaMatch[1]) : '';
      
      // Clean body text (truncate to avoid token limits)
      var bodyText = _cleanText(textContent).substring(0, 2000);
      
      var pageSummary = 'PAGE: ' + url + '\n';
      if (title) pageSummary += 'TITLE: ' + title + '\n';
      if (metaDesc) pageSummary += 'META: ' + metaDesc + '\n';
      if (headings.length > 0) pageSummary += 'HEADINGS: ' + headings.join(' | ') + '\n';
      pageSummary += 'BODY EXCERPT: ' + bodyText.substring(0, 800) + '\n';
      
      allPageText.push(pageSummary);
      
      // Find internal links to scan (prioritize service pages)
      var linkRegex = /<a\s+[^>]*href=["'](.*?)["'][^>]*>/gi;
      var linkMatch;
      while ((linkMatch = linkRegex.exec(html)) !== null) {
        var href = linkMatch[1];
        if (href.indexOf('http') === 0 && href.toLowerCase().indexOf(domain) === -1) continue;
        if (href.indexOf('#') === 0 || href.indexOf('mailto') === 0 || href.indexOf('tel:') === 0 || href.indexOf('javascript') === 0) continue;
        
        var fullUrl = href;
        if (href.indexOf('http') !== 0) {
          fullUrl = baseUrl.replace(/\/$/, '') + (href.indexOf('/') === 0 ? '' : '/') + href;
        }
        
        // Prioritize service-looking URLs
        var serviceUrlPatterns = /\b(service|product|solution|offer|what-we-do|our-work|specialit|capabilit|feature|package|pricing|work|portfolio)\b/i;
        if (serviceUrlPatterns.test(href)) {
          if (!visitedUrls[fullUrl] && pagesToScan.indexOf(fullUrl) === -1) pagesToScan.unshift(fullUrl);
        } else {
          if (!visitedUrls[fullUrl] && pagesToScan.indexOf(fullUrl) === -1) pagesToScan.push(fullUrl);
        }
      }
      
    } catch (e) {
      _log('DEBUG', 'Failed to fetch: ' + url + ' (' + e.message + ')');
    }
  }
  
  _log('INFO', 'Scraped ' + pagesScanned + ' pages, sending to AI for service extraction');
  
  // Step 2: Send to Anthropic API to extract actual services
  return _extractServicesWithAI(allPageText, baseUrl);
}

/**
 * Uses the Anthropic API to intelligently extract actual services/products
 * from website content. Returns clean service names, not raw HTML junk.
 */
function _extractServicesWithAI(pageTexts, websiteUrl) {
  var apiKey = CONFIG.ANTHROPIC_API_KEY;
  if (!apiKey) {
    _log('WARN', 'Keyword scanner: ANTHROPIC_API_KEY not set — falling back to basic extraction');
    return _fallbackExtractServices(pageTexts);
  }
  
  // Combine page text, respecting token limits (~15k chars)
  var combinedText = pageTexts.join('\n---\n').substring(0, 15000);
  
  var prompt = 'You are analyzing a business website to identify the specific services or products they offer. ' +
    'Below is content scraped from ' + websiteUrl + '.\n\n' +
    'Extract ONLY the actual services or products this business sells/offers. ' +
    'Rules:\n' +
    '- Return ONLY service/product names, one per line\n' +
    '- Each should be 2-5 words maximum (e.g. "SEO services", "Google Ads management", "website development")\n' +
    '- Only include things a customer would search for and PAY for\n' +
    '- Do NOT include: company name, taglines, team member names, blog post titles, navigation items, generic phrases like "learn more" or "about us"\n' +
    '- Do NOT include internal business concepts that customers wouldn\'t search for\n' +
    '- Be specific: "ecommerce SEO" is better than just "SEO"\n' +
    '- If you find sub-services (e.g. "technical SEO", "local SEO"), include those too\n' +
    '- Return between 5 and 30 services maximum\n' +
    '- Return ONLY the list, no numbering, no explanations, no other text\n\n' +
    'WEBSITE CONTENT:\n' + combinedText;
  
  try {
    var apiResponse = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      }),
      muteHttpExceptions: true
    });
    
    var status = apiResponse.getResponseCode();
    if (status !== 200) {
      _log('WARN', 'Anthropic API error (HTTP ' + status + '): ' + apiResponse.getContentText().substring(0, 200));
      return _fallbackExtractServices(pageTexts);
    }
    
    var data = JSON.parse(apiResponse.getContentText());
    var text = data.content && data.content[0] && data.content[0].text ? data.content[0].text : '';
    
    // Parse response: one service per line
    var services = [];
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^[\-\*\d\.\)]+\s*/, '').trim(); // strip bullets/numbers
      if (line.length >= 3 && line.length <= 60 && line.indexOf(':') === -1) {
        services.push({ text: line, source: 'ai-extracted', url: websiteUrl });
      }
    }
    
    _log('INFO', 'AI extracted ' + services.length + ' services from website');
    return services;
    
  } catch (e) {
    _log('WARN', 'AI service extraction failed: ' + e.message + ' — falling back');
    return _fallbackExtractServices(pageTexts);
  }
}

/**
 * Basic fallback if no API key: extracts from headings only, with strict filtering.
 */
function _fallbackExtractServices(pageTexts) {
  var services = [];
  var seen = {};
  
  var stopWords = /^(home|about|contact|blog|news|privacy|terms|cookie|sitemap|login|sign|cart|faq|copyright|all rights|powered|follow|subscribe|menu|toggle|search|loading|we are|our team|our story|our mission|welcome|get in touch|let's|read more|learn more|click|view|download|play|watch|back to|thank you|oops|error|page not found|\d+)/i;
  
  for (var i = 0; i < pageTexts.length; i++) {
    var headingsMatch = pageTexts[i].match(/HEADINGS: (.+)/);
    if (!headingsMatch) continue;
    
    var headings = headingsMatch[1].split(' | ');
    for (var h = 0; h < headings.length; h++) {
      var heading = headings[h].toLowerCase().trim();
      
      if (heading.length < 4 || heading.length > 50) continue;
      if (stopWords.test(heading)) continue;
      if (heading.split(' ').length > 5) continue;
      if (heading.split(' ').length < 2) continue; // single words are too vague
      if (seen[heading]) continue;
      
      seen[heading] = true;
      services.push({ text: headings[h].trim(), source: 'heading', url: '' });
    }
  }
  
  return services;
}

/**
 * Cleans extracted text: strips HTML tags, decodes entities, trims.
 */
function _cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '').replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Gets all existing keywords from the account for comparison.
 */
function _getAllExistingKeywords() {
  var existing = new Set ? new Set() : {};
  var isSet = typeof Set !== 'undefined';
  
  var query = 'SELECT ad_group_criterion.keyword.text FROM keyword_view WHERE campaign.status = "ENABLED" AND ad_group_criterion.status != "REMOVED"';
  
  try {
    var search = AdsApp.search(query);
    while (search.hasNext()) {
      var kw = search.next().adGroupCriterion.keyword.text.toLowerCase();
      if (isSet) existing.add(kw); else existing[kw] = true;
    }
  } catch (e) {
    _log('WARN', 'getAllExistingKeywords: ' + e.message);
    // Fallback: use keyword iterator
    try {
      var kwIterator = AdsApp.keywords().withCondition('campaign.status = "ENABLED"').get();
      while (kwIterator.hasNext()) {
        var kw = kwIterator.next().getText().toLowerCase().replace(/[\[\]"+]/g, '');
        if (isSet) existing.add(kw); else existing[kw] = true;
      }
    } catch (e2) { _log('ERROR', 'keyword fallback: ' + e2.message); }
  }
  
  // Wrap in consistent interface
  if (!isSet) {
    var obj = existing;
    existing = { has: function(k) { return obj[k] === true; }, size: Object.keys(obj).length };
  }
  
  return existing;
}

/**
 * Checks if a keyword is a close variation of any existing keyword.
 * Catches plurals, slight reordering, etc.
 */
function _isCloseVariation(candidate, existingSet) {
  // Check without trailing 's' (simple plural check)
  if (candidate.endsWith('s') && existingSet.has(candidate.slice(0, -1))) return true;
  if (existingSet.has(candidate + 's')) return true;
  
  // Check with/without common suffixes
  var suffixes = [' services', ' service', ' company', ' agency'];
  for (var i = 0; i < suffixes.length; i++) {
    if (candidate.endsWith(suffixes[i])) {
      var base = candidate.slice(0, -suffixes[i].length);
      if (existingSet.has(base)) return true;
    }
  }
  
  return false;
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
  email += '<h1 style="margin:0;font-size:20px;">Syte Optimization Report v3.2</h1>';
  email += '<p style="margin:5px 0 0;opacity:0.8;">' + accountName + ' | ' + today + ' | ' + mode + ' | ' + CONFIG.ACCOUNT_MODE + '</p></div>';
  
  // Conversion health alert banner
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
  
  // Auto-optimizations section
  email += '<tr><td colspan="2" style="padding:8px;background:#e0f2f1;font-weight:bold;">Auto-Optimizations (v3.2)</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Device Bid Adjustments</td><td style="text-align:right;font-weight:bold;">' + results.deviceAdjustments.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Ad Schedule Adjustments</td><td style="text-align:right;font-weight:bold;">' + results.scheduleAdjustments.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Geographic Bid Adjustments</td><td style="text-align:right;font-weight:bold;">' + results.geoAdjustments.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">N-gram Negatives</td><td style="text-align:right;font-weight:bold;">' + results.ngramNegatives.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Low QS Keywords Paused</td><td style="text-align:right;font-weight:bold;">' + results.lowQsPaused.length + '</td></tr>';
  
  // Keyword scanner
  if (results.keywordOpportunities && results.keywordOpportunities.length > 0) {
    email += '<tr><td colspan="2" style="padding:8px;background:#bbdefb;font-weight:bold;">🔍 Keyword Scanner</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Services Found on Website</td><td style="text-align:right;font-weight:bold;">' + (results.servicesFound ? results.servicesFound.length : 0) + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Keyword Gaps (not bidding on)</td><td style="text-align:right;font-weight:bold;color:#1565c0;">' + results.keywordOpportunities.length + '</td></tr>';
    email += '<tr><td style="padding:4px 8px;">Test Ad Groups Created</td><td style="text-align:right;font-weight:bold;color:#2e7d32;">' + (results.testAdGroupsCreated || 0) + '</td></tr>';
  }
  
  // Conversion health
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
  
  // Keyword Opportunities detail section
  if (results.keywordOpportunities && results.keywordOpportunities.length > 0) {
    var accountId = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');
    var adsUrl = 'https://ads.google.com/aw/campaigns?authuser=0&ocid=' + accountId;
    var campaignUsed = results.testCampaignUsed || 'your main search campaign';
    
    email += '<div style="background:#e3f2fd;padding:20px;border-top:3px solid #1565c0;">';
    email += '<h3 style="color:#1565c0;margin:0 0 6px;">🔍 New Keyword Opportunities Found</h3>';
    email += '<p style="font-size:15px;color:#333;margin:0 0 4px;"><strong>' + results.keywordOpportunities.length + ' keywords</strong> across <strong>' + (results.testAdGroupsCreated || 0) + ' new PAUSED ad groups</strong> ready for your review.</p>';
    email += '<p style="font-size:13px;color:#666;margin:0 0 16px;">Added to campaign <strong>' + campaignUsed + '</strong> — all ad groups start PAUSED until you approve them.</p>';
    
    // Big action button
    email += '<div style="margin:0 0 16px;">';
    email += '<a href="' + adsUrl + '" style="display:inline-block;padding:14px 32px;background:#1565c0;color:white;text-decoration:none;border-radius:8px;font-size:15px;font-weight:bold;">👉 Review in Google Ads</a>';
    email += '</div>';
    
    // Step by step
    email += '<div style="background:white;border-radius:8px;padding:14px 16px;margin:0 0 16px;">';
    email += '<p style="font-size:13px;font-weight:bold;color:#333;margin:0 0 8px;">How to approve or decline:</p>';
    email += '<p style="font-size:13px;color:#555;margin:0;line-height:1.7;">';
    email += '1. Click the button above → open campaign <strong>' + campaignUsed + '</strong><br>';
    email += '2. Look for ad groups starting with <strong>[Test]</strong> — e.g. [Test] SEO Services, [Test] Google Ads Management<br>';
    email += '3. <strong style="color:#2e7d32;">✅ To approve:</strong> Enable the ad group (change from Paused to Enabled)<br>';
    email += '4. <strong style="color:#c62828;">❌ To decline:</strong> Delete it or leave paused — the script won\'t recreate it</p>';
    email += '</div>';
    email += '</div>';
    
    // Keyword table (grouped by service)
    email += '<div style="background:#fff;padding:15px;">';
    email += '<p style="font-size:13px;font-weight:bold;color:#333;margin:0 0 10px;">Keywords created (preview):</p>';
    
    // Group by service
    var currentService = '';
    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    var shown = 0;
    for (var o = 0; o < results.keywordOpportunities.length && shown < 50; o++) {
      var opp = results.keywordOpportunities[o];
      var service = opp.service || opp.sourceUrl || '-';
      if (service !== currentService) {
        currentService = service;
        email += '<tr><td colspan="2" style="padding:10px 8px 4px;font-weight:bold;color:#1565c0;border-bottom:1px solid #e0e5ec;">' + service + '</td></tr>';
      }
      var bg = shown % 2 === 0 ? '#fff' : '#f8f9fa';
      email += '<tr style="background:' + bg + ';"><td style="padding:3px 8px 3px 20px;font-family:monospace;font-size:12px;">' + opp.keyword + '</td><td style="padding:3px 8px;color:#888;font-size:12px;">' + opp.matchType + '</td></tr>';
      shown++;
    }
    if (results.keywordOpportunities.length > 50) {
      email += '<tr><td colspan="2" style="padding:8px;color:#888;font-style:italic;">... and ' + (results.keywordOpportunities.length - 50) + ' more (see full list in Google Ads)</td></tr>';
    }
    email += '</table></div>';
  }
  
  email += '<div style="padding:15px;color:#666;font-size:12px;"><p>Completed in ' + duration.toFixed(1) + 's | Core v3.2 | Syte Digital Agency</p></div></body></html>';
  
  var recipients = CONFIG.EMAIL_ADDRESSES || [CONFIG.EMAIL_RECIPIENT || 'michaelh@syte.co.za'];
  if (typeof recipients === 'string') recipients = [recipients];
  
  MailApp.sendEmail({ to: recipients.join(','), subject: mode + ' Syte v3.2 | ' + accountName + ' | ' + CONFIG.ACCOUNT_MODE, htmlBody: email });
}


// ============================================
// ENTRY POINT — called by each client's loader
// ============================================

function runOptimization() {
  var startTime = new Date();
  
  _log('INFO', '═══════════════════════════════════════════');
  _log('INFO', 'SYTE OPTIMIZATION CORE v3.2');
  _log('INFO', 'Client: ' + (CONFIG.CLIENT_NAME || AdsApp.currentAccount().getName()));
  _log('INFO', 'Mode: ' + CONFIG.ACCOUNT_MODE);
  _log('INFO', 'Run: ' + (CONFIG.PREVIEW_MODE ? 'PREVIEW (no changes)' : 'LIVE'));
  _log('INFO', '═══════════════════════════════════════════');
  
  var results = {
    keywordsPaused: [], searchTermsNegated: [], informationalBlocked: [],
    irrelevantBlocked: [], winnersPromoted: [], budgetAlerts: [],
    shoppingProductsPaused: [], shoppingHeroProducts: [], shoppingLowROASProducts: [],
    pmaxAlerts: [], pmaxSearchTermsNegated: [],
    ecomKeywordsPaused: [], ecomSearchTermsNegated: [], ecomWinnersPromoted: [],
    // v3.2 auto-optimizations
    deviceAdjustments: [], scheduleAdjustments: [], geoAdjustments: [],
    ngramNegatives: [], lowQsPaused: [],
    conversionHealth: null, conversionAlert: null,
    // Keyword opportunity scanner
    keywordOpportunities: [], servicesFound: [], testAdGroupsCreated: 0, testCampaignCreated: null,
    errors: []
  };
  
  try {
    // === HEALTH CHECK (runs first — urgent alerts) ===
    _log('INFO', '\n=== CONVERSION HEALTH CHECK ===');
    _checkConversionHealth(results);
    
    // === HALT if conversion tracking appears broken ===
    // If zero conversions or 50%+ drop, skip ALL optimization tasks.
    // Bad data = bad decisions. Only run non-conversion-dependent tasks.
    if (results.conversionAlert) {
      _log('ERROR', '⛔ HALTING ALL OPTIMIZATION — conversion tracking may be broken');
      _log('ERROR', 'No keywords will be paused, no negatives added, no bid adjustments made.');
      _log('ERROR', 'Fix conversion tracking, then the script will resume on the next run.');
      
      // Still run keyword scanner (doesn't depend on conversions)
      if (CONFIG.KEYWORD_SCANNER !== false && CONFIG.CLIENT_WEBSITE) {
        _log('INFO', '\n=== KEYWORD OPPORTUNITY SCANNER (safe to run) ===');
        _scanKeywordOpportunities(results);
      }
      
      // Still check budget pacing
      _log('INFO', '\n=== BUDGET PACING ===');
      _checkBudgetPacing(results);
      
    } else {
    
    // === NORMAL OPERATION — conversion tracking is healthy ===
    
    // === LEAD GEN TASKS ===
    if (_isLeadGenMode()) {
      _log('INFO', '\n=== SEARCH (LEAD GEN) ===');
      _pauseHighSpendKeywords_LeadGen(results);
      _negativeHighSpendSearchTerms_LeadGen(results);
      if (CONFIG.PROMOTION_ENABLED !== false) _promoteWinners_LeadGen(results);
    }
    
    // === ECOMMERCE TASKS ===
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
    
    // === AUTO-OPTIMIZATIONS (v3.2) ===
    if (CONFIG.AUTO_DEVICE_BIDS !== false) {
      _log('INFO', '\n=== AUTO: DEVICE BIDS ===');
      _autoAdjustDeviceBids(results);
    }
    
    if (CONFIG.AUTO_AD_SCHEDULE !== false) {
      _log('INFO', '\n=== AUTO: AD SCHEDULE ===');
      _autoAdjustAdSchedule(results);
    }
    
    if (CONFIG.AUTO_GEO_BIDS !== false) {
      _log('INFO', '\n=== AUTO: GEOGRAPHIC BIDS ===');
      _autoAdjustGeoBids(results);
    }
    
    if (CONFIG.AUTO_NGRAM !== false) {
      _log('INFO', '\n=== AUTO: N-GRAM ANALYSIS ===');
      _autoNgramNegatives(results);
    }
    
    if (CONFIG.AUTO_QS_PAUSE !== false) {
      _log('INFO', '\n=== AUTO: LOW QUALITY SCORE ===');
      _pauseLowQualityScoreKeywords(results);
    }
    
    // === KEYWORD OPPORTUNITY SCANNER ===
    if (CONFIG.KEYWORD_SCANNER !== false && CONFIG.CLIENT_WEBSITE) {
      _log('INFO', '\n=== KEYWORD OPPORTUNITY SCANNER ===');
      _scanKeywordOpportunities(results);
    }
    
    // === BUDGET PACING ===
    _log('INFO', '\n=== BUDGET PACING ===');
    _checkBudgetPacing(results);
    
    } // end of else (normal operation — tracking healthy)
    
  } catch (e) {
    _log('ERROR', 'Script error: ' + e.message);
    results.errors.push(e.message);
  }
  
  var duration = (new Date() - startTime) / 1000;
  _log('INFO', 'Script completed in ' + duration.toFixed(1) + ' seconds');
  
  if (CONFIG.SEND_EMAIL !== false) _sendReport(results, duration);
  
  // Log summary
  _log('INFO', '\n=== SUMMARY ===');
  if (_isLeadGenMode()) {
    _log('INFO', 'KW Paused: ' + results.keywordsPaused.length + ' | ST Negated: ' + results.searchTermsNegated.length + ' | Winners: ' + results.winnersPromoted.length);
  }
  if (_isEcommerceMode()) {
    _log('INFO', 'Ecom KW: ' + results.ecomKeywordsPaused.length + ' | Ecom ST: ' + results.ecomSearchTermsNegated.length + ' | Ecom Winners: ' + results.ecomWinnersPromoted.length);
    _log('INFO', 'Shopping Heroes: ' + results.shoppingHeroProducts.length + ' | Low ROAS: ' + results.shoppingLowROASProducts.length + ' | PMax Alerts: ' + results.pmaxAlerts.length);
  }
  _log('INFO', 'Device: ' + results.deviceAdjustments.length + ' | Schedule: ' + results.scheduleAdjustments.length + ' | Geo: ' + results.geoAdjustments.length + ' | N-gram: ' + results.ngramNegatives.length + ' | Low QS: ' + results.lowQsPaused.length);
  _log('INFO', 'Informational: ' + results.informationalBlocked.length + ' | Irrelevant: ' + results.irrelevantBlocked.length + ' | Budget: ' + results.budgetAlerts.length + ' | Errors: ' + results.errors.length);
  if (results.keywordOpportunities && results.keywordOpportunities.length > 0) {
    _log('INFO', 'Keyword Scanner: ' + results.keywordOpportunities.length + ' keywords | ' + (results.testAdGroupsCreated || 0) + ' ad groups built | ' + (results.servicesFound ? results.servicesFound.length : 0) + ' services found');
  }
}
