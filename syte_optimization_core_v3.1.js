/**
 * SYTE OPTIMIZATION CORE v3.1
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
 * Version: 3.1
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
      .withCondition('keyword.text = "' + searchTerm + '"')
      .withCondition('keyword.match_type = "EXACT"')
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
        var ki = AdsApp.keywords().withCondition('ad_group.name = "' + agn + '"').withCondition('campaign.name = "' + cn + '"').withCondition('keyword.text = "' + kw + '"').get();
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
  var query = 'SELECT search_term_view.search_term, campaign.name, ad_group.name, metrics.conversions, metrics.clicks, metrics.cost_micros FROM search_term_view WHERE metrics.conversions >= ' + CONFIG.PROMOTION_MIN_CONVERSIONS + ' AND metrics.clicks >= ' + (CONFIG.PROMOTION_MIN_CLICKS || 10) + ' AND campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
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
        var ki = AdsApp.keywords().withCondition('ad_group.name = "' + agn + '"').withCondition('campaign.name = "' + cn + '"').withCondition('keyword.text = "' + kw + '"').get();
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
  var query = 'SELECT search_term_view.search_term, campaign.name, ad_group.name, metrics.conversions, metrics.conversions_value, metrics.clicks, metrics.cost_micros FROM search_term_view WHERE metrics.conversions >= ' + (CONFIG.ECOM_PROMOTION_MIN_CONVERSIONS || 2) + ' AND campaign.status = "ENABLED" AND campaign.advertising_channel_type = "SEARCH" AND segments.date BETWEEN "' + dr.startDate + '" AND "' + dr.endDate + '"';
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
// EMAIL REPORT
// ============================================

function _sendReport(results, duration) {
  var mode = CONFIG.PREVIEW_MODE ? 'PREVIEW' : 'LIVE';
  var accountName = AdsApp.currentAccount().getName();
  var today = Utilities.formatDate(new Date(), AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd HH:mm');
  
  var email = '<html><body style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;color:#333;">';
  email += '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;padding:20px;border-radius:8px 8px 0 0;">';
  email += '<h1 style="margin:0;font-size:20px;">Syte Optimization Report v3.1</h1>';
  email += '<p style="margin:5px 0 0;opacity:0.8;">' + accountName + ' | ' + today + ' | ' + mode + ' | ' + CONFIG.ACCOUNT_MODE + '</p></div>';
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
  email += '<tr><td colspan="2" style="padding:8px;background:#fce4ec;font-weight:bold;">Cleanup</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Informational Blocked</td><td style="text-align:right;font-weight:bold;">' + results.informationalBlocked.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Irrelevant Blocked</td><td style="text-align:right;font-weight:bold;">' + results.irrelevantBlocked.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Budget Alerts</td><td style="text-align:right;font-weight:bold;">' + results.budgetAlerts.length + '</td></tr>';
  email += '<tr><td style="padding:4px 8px;">Errors</td><td style="text-align:right;font-weight:bold;">' + results.errors.length + '</td></tr>';
  email += '</table></div>';
  email += '<div style="padding:15px;color:#666;font-size:12px;"><p>Completed in ' + duration.toFixed(1) + 's | Core v3.1 | Syte Digital Agency</p></div></body></html>';
  
  var recipients = CONFIG.EMAIL_ADDRESSES || [CONFIG.EMAIL_RECIPIENT || 'michaelh@syte.co.za'];
  if (typeof recipients === 'string') recipients = [recipients];
  
  MailApp.sendEmail({ to: recipients.join(','), subject: mode + ' Syte v3.1 | ' + accountName + ' | ' + CONFIG.ACCOUNT_MODE, htmlBody: email });
}


// ============================================
// ENTRY POINT — called by each client's loader
// ============================================

function runOptimization() {
  var startTime = new Date();
  
  _log('INFO', '═══════════════════════════════════════════');
  _log('INFO', 'SYTE OPTIMIZATION CORE v3.1');
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
    errors: []
  };
  
  try {
    if (_isLeadGenMode()) {
      _log('INFO', '\n=== SEARCH (LEAD GEN) ===');
      _pauseHighSpendKeywords_LeadGen(results);
      _negativeHighSpendSearchTerms_LeadGen(results);
      if (CONFIG.PROMOTION_ENABLED !== false) _promoteWinners_LeadGen(results);
    }
    
    if (_isEcommerceMode()) {
      _log('INFO', '\n=== SEARCH (ECOMMERCE) ===');
      _pauseHighSpendKeywords_Ecommerce(results);
      _negativeHighSpendSearchTerms_Ecommerce(results);
      if (CONFIG.PROMOTION_ENABLED !== false) _promoteWinners_Ecommerce(results);
    }
    
    _log('INFO', '\n=== CLEANUP ===');
    _blockInformationalTerms(results);
    _blockIrrelevantTerms(results);
    
    if (_isEcommerceMode()) {
      _log('INFO', '\n=== SHOPPING ===');
      _analyzeShoppingProducts(results);
      _analyzeShoppingSearchTerms(results);
      _log('INFO', '\n=== PERFORMANCE MAX ===');
      _monitorPMaxCampaigns(results);
      _analyzePMaxSearchTerms(results);
      _analyzePMaxAssetGroups(results);
    }
    
    _log('INFO', '\n=== BUDGET PACING ===');
    _checkBudgetPacing(results);
    
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
  _log('INFO', 'Informational: ' + results.informationalBlocked.length + ' | Irrelevant: ' + results.irrelevantBlocked.length + ' | Budget: ' + results.budgetAlerts.length + ' | Errors: ' + results.errors.length);
}
