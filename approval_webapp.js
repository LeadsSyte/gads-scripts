/**
 * SYTE APPROVAL WEB APP v4.5.0
 * =============================
 * Standalone Google Apps Script Web App for approving proposed Google Ads changes.
 *
 * DEPLOYMENT:
 * 1. Go to script.google.com → New Project
 * 2. Paste this entire file
 * 3. Update MASTER_SHEET_ID below with your master Google Sheet ID
 * 4. Deploy → New Deployment → Web App
 *    - Execute as: Me
 *    - Who has access: Anyone with the link
 * 5. Copy the deployed URL
 * 6. Add to master sheet Config tab: APPROVAL_WEBAPP_URL = [deployed URL]
 *    OR set in each client's loader CONFIG: APPROVAL_WEBAPP_URL = '[deployed URL]'
 *
 * HOW IT WORKS:
 * - The optimization script writes proposed changes to the "PendingChanges" sheet tab
 * - The email report includes approval buttons linking to this web app
 * - Clicking a button calls doGet() with runId + category
 * - This app updates the PendingChanges row to mark categories as approved
 * - The next optimization run picks up approved changes and applies them
 *
 * Author: Syte Digital Agency (syte.co.za)
 */

// ============================================
// CONFIGURATION — UPDATE THIS
// ============================================
var MASTER_SHEET_ID = 'YOUR_MASTER_SHEET_ID_HERE';


// ============================================
// WEB APP HANDLERS
// ============================================

/**
 * Handles GET requests from email approval buttons.
 * URL format: ?runId=XXXXX&category=keyword_pauses
 *         or: ?runId=XXXXX&category=all
 */
function doGet(e) {
  var view = (e.parameter.view || '').trim();
  var action = (e.parameter.action || '').trim();
  var runId = (e.parameter.runId || '').trim();
  var category = (e.parameter.category || '').trim();
  var account = (e.parameter.account || '').trim();

  // NEW: Per-client dashboard — shows recent errors + pending approvals
  if (view === 'client') {
    if (!account) return _renderPage('Error', 'Missing account parameter.', false);
    try {
      var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
      return _renderClientDashboard(ss, account);
    } catch (e2) {
      return _renderPage('Error', 'Could not load client dashboard: ' + e2.message, false);
    }
  }

  // v4.5.0: Interactive flagged review page — negate/keep individual terms + natural language instructions
  if (view === 'flagged_review') {
    if (!runId) return _renderPage('Error', 'Missing runId parameter.', false);
    try {
      var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
      return _renderFlaggedReviewPage(ss, runId);
    } catch (e2) {
      return _renderPage('Error', 'Could not load flagged review: ' + e2.message, false);
    }
  }

  // Reject entire run
  if (action === 'reject') {
    if (!runId) return _renderPage('Error', 'Missing runId parameter.', false);
    return _rejectRun(runId);
  }

  // Per-category reject — shows reason form
  if (action === 'reject_category') {
    if (!runId || !category) return _renderPage('Error', 'Missing runId or category parameter.', false);
    return _renderRejectReasonPage(runId, category);
  }

  // Run status dashboard
  if (view === 'run_status') {
    if (!runId) return _renderPage('Error', 'Missing runId parameter.', false);
    try {
      var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
      return _renderRunStatusPage(ss, runId);
    } catch (e2) {
      return _renderPage('Error', 'Could not load run status: ' + e2.message, false);
    }
  }

  // Defensive: if an action was passed that we don't recognize, refuse instead of
  // falling through to the approve flow. Prevents silently approving when an older
  // deployment doesn't yet handle a newer action (e.g. reject_category).
  if (action) {
    return _renderPage('Error', 'Unknown action: ' + _escape(action) + '. The approval web app may need to be redeployed to a newer version.', false);
  }

  if (!runId || !category) {
    return _renderPage('Error', 'Missing runId or category parameter.', false);
  }

  var validCategories = ['keyword_pauses', 'search_term_negations', 'winner_promotions', 'auto_optimizations', 'shopping_pmax', 'flagged_review_negations', 'all'];
  if (validCategories.indexOf(category) === -1) {
    return _renderPage('Error', 'Invalid category: ' + category, false);
  }

  try {
    var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
    var sheet = ss.getSheetByName('PendingChanges');
    if (!sheet) {
      return _renderPage('Error', 'PendingChanges sheet not found in master spreadsheet.', false);
    }

    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var colIdx = {};
    headers.forEach(function(h, i) { colIdx[h] = i; });

    // Find the row matching this runId
    var targetRow = -1;
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][colIdx['run_id']]).trim() === runId) {
        targetRow = r;
        break;
      }
    }

    if (targetRow === -1) {
      return _renderPage('Not Found', 'No pending changes found for run ID: ' + runId, false);
    }

    var row = data[targetRow];
    var status = String(row[colIdx['status']]).trim();

    if (status === 'APPLIED') {
      return _renderPage('Already Applied', 'These changes have already been applied.', false);
    }
    if (status === 'EXPIRED') {
      return _renderPage('Expired', 'These pending changes have expired (older than 7 days). The script will propose fresh changes on the next run.', false);
    }
    if (status === 'REJECTED') {
      return _renderPage('Rejected', 'These changes were previously rejected.', false);
    }

    // Get current approved categories
    var existingApproved = String(row[colIdx['approved_categories']] || '').trim();
    var accountName = row[colIdx['account_name']];
    var timestamp = row[colIdx['timestamp']];

    // Update approved categories
    var newApproved;
    if (category === 'all') {
      newApproved = 'all';
    } else if (existingApproved === 'all') {
      newApproved = 'all';  // Already approved everything
    } else {
      var existingList = existingApproved ? existingApproved.split(',') : [];
      if (existingList.indexOf(category) === -1) {
        existingList.push(category);
      }
      newApproved = existingList.join(',');
    }

    // Write updates
    var rowNum = targetRow + 1;  // 1-indexed
    var userEmail = Session.getActiveUser().getEmail() || 'Unknown';
    var now = new Date().toISOString();
    sheet.getRange(rowNum, colIdx['approved_categories'] + 1).setValue(newApproved);
    sheet.getRange(rowNum, colIdx['approved_by'] + 1).setValue(userEmail);
    sheet.getRange(rowNum, colIdx['approved_at'] + 1).setValue(now);

    // Write per-category decision tracking
    var decisions = {};
    if (colIdx['category_decisions'] !== undefined) {
      try { decisions = JSON.parse(row[colIdx['category_decisions']] || '{}'); } catch (e) {}
    }
    var allCats = ['keyword_pauses', 'search_term_negations', 'winner_promotions', 'auto_optimizations', 'shopping_pmax', 'flagged_review_negations'];
    if (category === 'all') {
      for (var ci = 0; ci < allCats.length; ci++) {
        if (!decisions[allCats[ci]] || decisions[allCats[ci]].decision !== 'rejected') {
          decisions[allCats[ci]] = { decision: 'approved', reason: '', by: userEmail, at: now };
        }
      }
    } else {
      decisions[category] = { decision: 'approved', reason: '', by: userEmail, at: now };
    }
    if (colIdx['category_decisions'] !== undefined) {
      sheet.getRange(rowNum, colIdx['category_decisions'] + 1).setValue(JSON.stringify(decisions));
    }

    // Parse changes to show summary
    var changesJson = {};
    try { changesJson = JSON.parse(row[colIdx['changes_json']]); } catch (e) {}

    var approvedLabel = category === 'all' ? 'All Changes' : (_catLabel(category) || category);
    var summary = '<strong>Account:</strong> ' + accountName + '<br>';
    summary += '<strong>Run:</strong> ' + timestamp + '<br>';
    summary += '<strong>Approved:</strong> ' + approvedLabel + '<br>';
    summary += '<strong>Total approved categories:</strong> ' + newApproved + '<br><br>';
    summary += 'Changes will be applied on the next scheduled script run.';

    // Show notes form
    var webAppUrl = ScriptApp.getService().getUrl();
    summary += '<br><br><form action="' + webAppUrl + '" method="post">';
    summary += '<input type="hidden" name="runId" value="' + runId + '">';
    summary += '<label style="font-weight:bold;">Add a note (optional):</label><br>';
    summary += '<textarea name="notes" rows="3" cols="40" style="margin:8px 0;padding:8px;border:1px solid #ccc;border-radius:4px;width:100%;max-width:400px;"></textarea><br>';
    summary += '<button type="submit" style="background:#1565c0;color:white;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:14px;">Save Note</button>';
    summary += '</form>';

    summary += '<br><a href="' + webAppUrl + '?view=run_status&runId=' + runId + '" style="color:#1565c0;">View full approval status</a>';

    return _renderPage('Approved: ' + approvedLabel, summary, true);

  } catch (e) {
    return _renderPage('Error', 'Something went wrong: ' + e.message, false);
  }
}

/**
 * Handles POST requests for saving notes and flagged review submissions.
 */
function doPost(e) {
  var runId = (e.parameter.runId || '').trim();
  var postAction = (e.parameter.post_action || '').trim();

  if (!runId) {
    return _renderPage('Error', 'Missing run ID.', false);
  }

  // Per-category reject with reason
  if (postAction === 'reject_category') {
    return _handleCategoryReject(e);
  }

  // v4.5.0: Handle flagged review submission (checkboxes + optional AI instructions)
  if (postAction === 'flagged_review') {
    return _handleFlaggedReviewSubmit(e);
  }

  // v4.5.0: Handle AI instruction processing (preview step)
  if (postAction === 'ai_instructions') {
    return _handleAIInstructions(e);
  }

  // v4.5.0: Handle confirmation of AI-proposed changes (saves to sheet)
  if (postAction === 'confirm_ai') {
    return _handleConfirmAI(e);
  }

  // Original notes handler
  var notes = (e.parameter.notes || '').trim();

  try {
    var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
    var sheet = ss.getSheetByName('PendingChanges');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var colIdx = {};
    headers.forEach(function(h, i) { colIdx[h] = i; });

    for (var r = 1; r < data.length; r++) {
      if (String(data[r][colIdx['run_id']]).trim() === runId) {
        sheet.getRange(r + 1, colIdx['notes'] + 1).setValue(notes);
        return _renderPage('Note Saved', 'Your note has been saved for run ' + runId + '.<br><br><em>"' + notes + '"</em>', true);
      }
    }

    return _renderPage('Not Found', 'Run ID not found: ' + runId, false);
  } catch (e) {
    return _renderPage('Error', 'Could not save note: ' + e.message, false);
  }
}


// ============================================
// v4.5.0: FLAGGED REVIEW — INTERACTIVE PAGE
// ============================================

/**
 * Reads the ANTHROPIC_API_KEY from the master sheet Config tab.
 */
function _getApiKey() {
  try {
    var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
    var configSheet = ss.getSheetByName('Config');
    if (!configSheet) return null;
    var data = configSheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === 'ANTHROPIC_API_KEY') {
        return String(data[i][1]).trim();
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Finds a PendingChanges row by runId. Returns { row, rowNum, colIdx, sheet } or null.
 */
function _findPendingRow(runId) {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName('PendingChanges');
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var colIdx = {};
  headers.forEach(function(h, i) { colIdx[h] = i; });
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][colIdx['run_id']]).trim() === runId) {
      return { row: data[r], rowNum: r + 1, colIdx: colIdx, sheet: sheet, data: data };
    }
  }
  return null;
}

/**
 * Renders the interactive flagged review page with checkboxes and AI instruction box.
 */
function _renderFlaggedReviewPage(ss, runId) {
  var result = _findPendingRow(runId);
  if (!result) return _renderPage('Not Found', 'No pending changes found for run ID: ' + runId, false);

  var status = String(result.row[result.colIdx['status']]).trim();
  if (status === 'APPLIED') return _renderPage('Already Applied', 'These changes have already been applied.', false);
  if (status === 'EXPIRED') return _renderPage('Expired', 'These pending changes have expired.', false);
  if (status === 'REJECTED') return _renderPage('Rejected', 'These changes were previously rejected.', false);

  var changesJson = {};
  try { changesJson = JSON.parse(result.row[result.colIdx['changes_json']]); } catch (e) {}

  var flagged = changesJson.flagged_review || {};
  var terms = flagged.terms || [];
  var alreadySelected = flagged.selectedForNegation || [];
  var accountName = result.row[result.colIdx['account_name']] || '';

  if (terms.length === 0) {
    return _renderPage('No Flagged Terms', 'There are no flagged review terms for this run.', false);
  }

  var webAppUrl = ScriptApp.getService().getUrl();

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1">';
  html += '<title>Syte — Flagged Review</title>';
  html += '<style>';
  html += 'body{font-family:Arial,sans-serif;max-width:800px;margin:20px auto;padding:0 20px;color:#333;}';
  html += 'h1{font-size:22px;margin:0 0 4px;}h2{font-size:16px;margin:20px 0 8px;}';
  html += 'table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0;}';
  html += 'th{background:#e3f2fd;padding:8px;text-align:left;}';
  html += 'td{padding:6px 8px;border-bottom:1px solid #eee;}';
  html += '.btn{display:inline-block;padding:10px 18px;margin:6px 4px;border-radius:6px;color:white;border:none;font-weight:600;font-size:13px;cursor:pointer;text-decoration:none;}';
  html += '.btn-negate{background:#c62828;}.btn-keep{background:#2e7d32;}.btn-ai{background:#1565c0;}';
  html += '.muted{color:#999;font-size:12px;}';
  html += '.card{background:#f8f9fa;padding:14px;border-radius:6px;border-left:4px solid #1565c0;margin:12px 0;}';
  html += '.ai-box{background:#e3f2fd;padding:16px;border-radius:6px;border:2px solid #1565c0;margin:16px 0;}';
  html += 'textarea{width:100%;padding:10px;border:1px solid #ccc;border-radius:4px;font-size:14px;font-family:Arial,sans-serif;box-sizing:border-box;}';
  html += 'label{cursor:pointer;}';
  html += 'tr.selected{background:#ffebee;}';
  html += '.status-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;}';
  html += '.badge-pending{background:#fff3e0;color:#e65100;}.badge-negated{background:#ffebee;color:#c62828;}';
  html += '</style></head><body>';

  html += '<h1>Flagged Review — ' + _escape(String(accountName)) + '</h1>';
  html += '<p class="muted">Run: ' + _escape(runId) + ' | ' + terms.length + ' terms flagged for review</p>';

  if (alreadySelected.length > 0) {
    html += '<div class="card"><strong>Previously selected for negation:</strong> ' + alreadySelected.map(function(t) { return _escape(t.term); }).join(', ') + '</div>';
  }

  // === AI Instructions Box ===
  html += '<div class="ai-box">';
  html += '<h2 style="margin:0 0 8px;color:#1565c0;">Talk to the Optimization</h2>';
  html += '<p style="font-size:13px;margin:0 0 10px;color:#555;">Tell us what to do in plain English. Examples:</p>';
  html += '<ul style="font-size:12px;color:#666;margin:0 0 10px;padding-left:20px;">';
  html += '<li>"Negate all competitor names but keep facebook-related terms"</li>';
  html += '<li>"Keep cold calling agency — we offer that service"</li>';
  html += '<li>"Negate everything except digital marketing website and companies that advertise"</li>';
  html += '</ul>';
  html += '<form method="post" action="' + webAppUrl + '">';
  html += '<input type="hidden" name="runId" value="' + _escape(runId) + '">';
  html += '<input type="hidden" name="post_action" value="ai_instructions">';
  html += '<textarea name="instructions" rows="3" placeholder="Type your instructions here..."></textarea>';
  html += '<br><button type="submit" class="btn btn-ai" style="margin-top:8px;">Process Instructions</button>';
  html += '</form></div>';

  // === Manual Checkbox Selection ===
  html += '<h2>Or Select Manually</h2>';
  html += '<form method="post" action="' + webAppUrl + '">';
  html += '<input type="hidden" name="runId" value="' + _escape(runId) + '">';
  html += '<input type="hidden" name="post_action" value="flagged_review">';

  html += '<table><tr><th style="width:30px;">Neg?</th><th>Search Term</th><th style="text-align:right;">Cost</th><th style="text-align:right;">Clicks</th><th>Reason</th></tr>';
  for (var i = 0; i < terms.length; i++) {
    var t = terms[i];
    var alreadyNeg = false;
    for (var j = 0; j < alreadySelected.length; j++) {
      if (alreadySelected[j].term === t.term) { alreadyNeg = true; break; }
    }
    html += '<tr' + (alreadyNeg ? ' class="selected"' : '') + '>';
    html += '<td style="text-align:center;"><input type="checkbox" name="negate_term" value="' + _escape(t.term) + '"' + (alreadyNeg ? ' checked' : '') + '></td>';
    html += '<td><label for="negate_term">' + _escape(t.term) + '</label>';
    if (alreadyNeg) html += ' <span class="status-badge badge-negated">queued</span>';
    html += '</td>';
    html += '<td style="text-align:right;">' + (t.cost ? t.cost.toFixed(0) : '0') + '</td>';
    html += '<td style="text-align:right;">' + (t.clicks || 0) + '</td>';
    html += '<td style="color:#666;font-size:12px;">' + _escape(t.reason || '') + '</td>';
    html += '</tr>';
  }
  html += '</table>';

  html += '<div style="margin:12px 0;">';
  html += '<button type="submit" class="btn btn-negate">Negate Selected Terms</button>';
  html += '<a href="' + webAppUrl + '?runId=' + encodeURIComponent(runId) + '&category=flagged_review_negations" class="btn btn-keep" style="text-decoration:none;">Approve All Queued Negations</a>';
  html += '</div></form>';

  html += '<div style="margin-top:30px;color:#999;font-size:11px;text-align:center;">Syte Digital Agency | Flagged Review | syte.co.za</div>';
  html += '</body></html>';

  return HtmlService.createHtmlOutput(html).setTitle('Syte — Flagged Review');
}

/**
 * Handles manual checkbox submission — saves selected terms for negation.
 */
function _handleFlaggedReviewSubmit(e) {
  var runId = (e.parameter.runId || '').trim();
  // Google Apps Script: single value = string, multiple = array
  var negateTerms = e.parameter.negate_term || [];
  if (typeof negateTerms === 'string') negateTerms = [negateTerms];

  try {
    var result = _findPendingRow(runId);
    if (!result) return _renderPage('Not Found', 'Run ID not found: ' + runId, false);

    var changesJson = {};
    try { changesJson = JSON.parse(result.row[result.colIdx['changes_json']]); } catch (ex) {}

    var flagged = changesJson.flagged_review || { terms: [], selectedForNegation: [] };
    var terms = flagged.terms || [];

    // Build selected list from checked terms
    var selected = [];
    for (var i = 0; i < negateTerms.length; i++) {
      var termName = negateTerms[i].trim();
      for (var j = 0; j < terms.length; j++) {
        if (terms[j].term === termName) {
          selected.push(terms[j]);
          break;
        }
      }
    }

    flagged.selectedForNegation = selected;
    changesJson.flagged_review = flagged;

    // Write back to sheet
    result.sheet.getRange(result.rowNum, result.colIdx['changes_json'] + 1).setValue(JSON.stringify(changesJson));

    // Auto-add flagged_review_negations to approved categories
    var existingApproved = String(result.row[result.colIdx['approved_categories']] || '').trim();
    if (selected.length > 0 && existingApproved.indexOf('flagged_review_negations') === -1) {
      var newApproved = existingApproved ? existingApproved + ',flagged_review_negations' : 'flagged_review_negations';
      result.sheet.getRange(result.rowNum, result.colIdx['approved_categories'] + 1).setValue(newApproved);
      result.sheet.getRange(result.rowNum, result.colIdx['approved_by'] + 1).setValue(Session.getActiveUser().getEmail() || 'Unknown');
      result.sheet.getRange(result.rowNum, result.colIdx['approved_at'] + 1).setValue(new Date().toISOString());
    }

    var summary = '<strong>' + selected.length + ' term(s) queued for negation:</strong><ul>';
    for (var s = 0; s < selected.length; s++) {
      summary += '<li>' + _escape(selected[s].term) + ' (cost: ' + (selected[s].cost || 0).toFixed(0) + ')</li>';
    }
    summary += '</ul>';
    var kept = terms.length - selected.length;
    summary += '<p>' + kept + ' term(s) kept.</p>';
    summary += '<p>Negations will be applied on the next scheduled script run.</p>';

    return _renderPage('Flagged Review Saved', summary, true);
  } catch (ex) {
    return _renderPage('Error', 'Could not save flagged review: ' + ex.message, false);
  }
}

/**
 * Handles natural language instructions — calls Claude to interpret, then shows
 * a preview page for user confirmation before saving.
 */
function _handleAIInstructions(e) {
  var runId = (e.parameter.runId || '').trim();
  var instructions = (e.parameter.instructions || '').trim();

  if (!instructions) {
    return _renderPage('Error', 'Please provide instructions.', false);
  }

  try {
    var result = _findPendingRow(runId);
    if (!result) return _renderPage('Not Found', 'Run ID not found: ' + runId, false);

    var changesJson = {};
    try { changesJson = JSON.parse(result.row[result.colIdx['changes_json']]); } catch (ex) {}

    var flagged = changesJson.flagged_review || { terms: [], selectedForNegation: [] };
    var terms = flagged.terms || [];

    if (terms.length === 0) {
      return _renderPage('No Terms', 'No flagged terms to process.', false);
    }

    // Also include N-gram negatives for context (so user can say "don't negative facebook")
    var ngramNegatives = (changesJson.search_term_negations || {}).ngramNegatives || [];

    // Include smart negated terms for context too
    var smartNegated = (changesJson.search_term_negations || {}).smartNegated || [];

    var apiKey = _getApiKey();
    if (!apiKey) {
      return _renderPage('Error', 'No ANTHROPIC_API_KEY found in Config tab. AI instructions require an API key.', false);
    }

    // Build prompt for Claude
    var termsList = terms.map(function(t) {
      return '- "' + t.term + '" (cost: ' + (t.cost || 0).toFixed(0) + ', clicks: ' + (t.clicks || 0) + ', reason: ' + (t.reason || '') + ')';
    }).join('\n');

    var ngramList = '';
    if (ngramNegatives.length > 0) {
      ngramList = '\n\nN-gram negatives also proposed (already in a separate approval category):\n';
      ngramList += ngramNegatives.map(function(n) {
        return '- "' + n.word + '" (total cost: ' + (n.totalCost || 0).toFixed(0) + ', terms: ' + (n.termCount || 0) + ')';
      }).join('\n');
    }

    var smartNegList = '';
    if (smartNegated.length > 0) {
      smartNegList = '\n\nAI auto-negated terms (already in a separate approval category):\n';
      smartNegList += smartNegated.map(function(s) {
        return '- "' + s.term + '" (cost: ' + (s.cost || 0).toFixed(0) + ', reason: ' + (s.reason || '') + ')';
      }).join('\n');
    }

    var prompt = 'You are a Google Ads optimization assistant. A user is reviewing search terms that were flagged as ambiguous by the AI system.\n\n';
    prompt += 'Flagged search terms (these are ambiguous — user decides negate or keep):\n' + termsList + '\n';
    prompt += ngramList;
    prompt += smartNegList + '\n\n';
    prompt += 'User instructions: "' + instructions + '"\n\n';
    prompt += 'Based on the user\'s instructions, return a JSON object with:\n';
    prompt += '- "negate": array of search term strings to negate (from the flagged list)\n';
    prompt += '- "keep": array of search term strings to keep (from the flagged list)\n';
    prompt += '- "remove_ngram": array of N-gram words the user wants to REMOVE from the negation list (i.e., they do NOT want these negated)\n';
    prompt += '- "remove_smart_negated": array of auto-negated term strings the user wants to REMOVE from the negation list\n';
    prompt += '- "explanation": brief explanation of what you did and why\n\n';
    prompt += 'Only include terms that were explicitly mentioned or clearly covered by the user\'s instructions. If the user\'s intent is unclear for a term, put it in "keep" (err on side of caution).\n';
    prompt += 'Return ONLY valid JSON, no markdown.';

    var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      }),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      return _renderPage('AI Error', 'Claude API returned error ' + code + ': ' + response.getContentText().substring(0, 300), false);
    }

    var aiJson = JSON.parse(response.getContentText());
    var aiText = aiJson.content[0].text;

    // Parse AI response
    var aiResult;
    try {
      var cleaned = aiText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      aiResult = JSON.parse(cleaned);
    } catch (ex) {
      return _renderPage('AI Parse Error', 'Could not parse AI response:<br><pre>' + _escape(aiText) + '</pre>', false);
    }

    var negateList = aiResult.negate || [];
    var keepList = aiResult.keep || [];
    var removeNgram = aiResult.remove_ngram || [];
    var removeSmartNegated = aiResult.remove_smart_negated || [];
    var explanation = aiResult.explanation || '';

    // === RENDER PREVIEW PAGE (no changes saved yet) ===
    var webAppUrl = ScriptApp.getService().getUrl();

    var html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1">';
    html += '<title>Syte — Review AI Suggestions</title>';
    html += '<style>';
    html += 'body{font-family:Arial,sans-serif;max-width:800px;margin:20px auto;padding:0 20px;color:#333;}';
    html += 'h1{font-size:22px;margin:0 0 4px;}h2{font-size:16px;margin:18px 0 8px;}';
    html += '.btn{display:inline-block;padding:12px 24px;margin:6px 4px;border-radius:6px;color:white;border:none;font-weight:600;font-size:14px;cursor:pointer;text-decoration:none;}';
    html += '.btn-confirm{background:#2e7d32;}.btn-cancel{background:#757575;}.btn-retry{background:#1565c0;}';
    html += '.card{background:#f8f9fa;padding:14px;border-radius:6px;border-left:4px solid #1565c0;margin:12px 0;}';
    html += '.explanation{background:#e3f2fd;padding:14px;border-radius:6px;margin:12px 0;font-size:14px;}';
    html += '.negate-item{padding:6px 0;border-bottom:1px solid #ffcdd2;color:#c62828;}';
    html += '.keep-item{padding:6px 0;border-bottom:1px solid #c8e6c9;color:#2e7d32;}';
    html += '.remove-item{padding:6px 0;border-bottom:1px solid #bbdefb;color:#1565c0;}';
    html += '.muted{color:#999;font-size:12px;}';
    html += '.section{margin:12px 0;padding:12px;border-radius:6px;}';
    html += '.section-negate{background:#ffebee;}.section-keep{background:#e8f5e9;}.section-remove{background:#e3f2fd;}';
    html += '</style></head><body>';

    html += '<h1>Review Proposed Changes</h1>';
    html += '<p class="muted">These are the changes Claude suggests based on your instructions. Nothing is saved yet.</p>';

    // Show user's original instructions
    html += '<div class="card"><strong>Your instructions:</strong><br>"' + _escape(instructions) + '"</div>';

    // AI explanation
    html += '<div class="explanation"><strong>AI interpretation:</strong> ' + _escape(explanation) + '</div>';

    // Terms to negate
    if (negateList.length > 0) {
      html += '<div class="section section-negate">';
      html += '<h2 style="color:#c62828;margin-top:0;">Will Negate (' + negateList.length + ')</h2>';
      for (var i = 0; i < negateList.length; i++) {
        // Find cost info
        var costInfo = '';
        for (var j = 0; j < terms.length; j++) {
          if (terms[j].term.toLowerCase().trim() === negateList[i].toLowerCase().trim()) {
            costInfo = ' — cost: ' + (terms[j].cost || 0).toFixed(0) + ', clicks: ' + (terms[j].clicks || 0);
            break;
          }
        }
        html += '<div class="negate-item">"' + _escape(negateList[i]) + '"' + costInfo + '</div>';
      }
      html += '</div>';
    }

    // Terms to keep
    if (keepList.length > 0) {
      html += '<div class="section section-keep">';
      html += '<h2 style="color:#2e7d32;margin-top:0;">Will Keep (' + keepList.length + ')</h2>';
      for (var k = 0; k < keepList.length; k++) {
        html += '<div class="keep-item">"' + _escape(keepList[k]) + '"</div>';
      }
      html += '</div>';
    }

    // N-grams to remove
    if (removeNgram.length > 0) {
      html += '<div class="section section-remove">';
      html += '<h2 style="color:#1565c0;margin-top:0;">Remove from N-gram Negatives</h2>';
      html += '<p style="font-size:12px;color:#666;">These words were proposed as N-gram negatives but will be removed per your instructions.</p>';
      for (var rn = 0; rn < removeNgram.length; rn++) {
        html += '<div class="remove-item">"' + _escape(removeNgram[rn]) + '" — will NOT be negated</div>';
      }
      html += '</div>';
    }

    // Smart negated to remove
    if (removeSmartNegated.length > 0) {
      html += '<div class="section section-remove">';
      html += '<h2 style="color:#1565c0;margin-top:0;">Remove from AI Auto-Negated</h2>';
      html += '<p style="font-size:12px;color:#666;">These terms were auto-negated by AI but will be removed per your instructions.</p>';
      for (var rs = 0; rs < removeSmartNegated.length; rs++) {
        html += '<div class="remove-item">"' + _escape(removeSmartNegated[rs]) + '" — will NOT be negated</div>';
      }
      html += '</div>';
    }

    // No changes
    if (negateList.length === 0 && removeNgram.length === 0 && removeSmartNegated.length === 0) {
      html += '<div class="card"><strong>No changes proposed.</strong> Claude kept all terms based on your instructions.</div>';
    }

    // Confirm / Go Back / Try Again buttons
    html += '<div style="margin:24px 0;padding:16px 0;border-top:2px solid #e0e0e0;">';

    // Confirm form — passes the AI result as hidden JSON for the confirm handler
    html += '<form method="post" action="' + webAppUrl + '" style="display:inline;">';
    html += '<input type="hidden" name="runId" value="' + _escape(runId) + '">';
    html += '<input type="hidden" name="post_action" value="confirm_ai">';
    html += '<input type="hidden" name="ai_result" value="' + _escape(JSON.stringify(aiResult)) + '">';
    html += '<button type="submit" class="btn btn-confirm">Confirm & Apply</button>';
    html += '</form>';

    // Go back to review page
    html += '<a href="' + webAppUrl + '?view=flagged_review&runId=' + encodeURIComponent(runId) + '" class="btn btn-cancel">Go Back</a>';

    // Try again with new instructions
    html += '<form method="post" action="' + webAppUrl + '" style="display:inline;margin-left:8px;">';
    html += '<input type="hidden" name="runId" value="' + _escape(runId) + '">';
    html += '<input type="hidden" name="post_action" value="ai_instructions">';
    html += '<input type="hidden" name="instructions" value="' + _escape(instructions) + '">';
    html += '<button type="submit" class="btn btn-retry" onclick="var i=prompt(\'Refine your instructions:\',\'' + _escape(instructions).replace(/'/g, "\\'") + '\');if(i){this.form.instructions.value=i;}else{return false;}">Refine Instructions</button>';
    html += '</form>';

    html += '</div>';

    html += '<div style="margin-top:30px;color:#999;font-size:11px;text-align:center;">Syte Digital Agency | AI Review Preview | syte.co.za</div>';
    html += '</body></html>';

    return HtmlService.createHtmlOutput(html).setTitle('Syte — Review AI Suggestions');
  } catch (ex) {
    return _renderPage('Error', 'Could not process instructions: ' + ex.message, false);
  }
}

/**
 * Handles confirmation of AI-proposed changes — actually saves to PendingChanges sheet.
 */
function _handleConfirmAI(e) {
  var runId = (e.parameter.runId || '').trim();
  var aiResultJson = (e.parameter.ai_result || '').trim();

  if (!runId || !aiResultJson) {
    return _renderPage('Error', 'Missing data for confirmation.', false);
  }

  try {
    var aiResult = JSON.parse(aiResultJson);
    var result = _findPendingRow(runId);
    if (!result) return _renderPage('Not Found', 'Run ID not found: ' + runId, false);

    var changesJson = {};
    try { changesJson = JSON.parse(result.row[result.colIdx['changes_json']]); } catch (ex) {}

    var flagged = changesJson.flagged_review || { terms: [], selectedForNegation: [] };
    var terms = flagged.terms || [];
    var negateList = aiResult.negate || [];
    var removeNgram = aiResult.remove_ngram || [];
    var removeSmartNegated = aiResult.remove_smart_negated || [];

    // Build selectedForNegation from confirmed AI results
    var selected = [];
    for (var i = 0; i < negateList.length; i++) {
      var neg = negateList[i].toLowerCase().trim();
      for (var j = 0; j < terms.length; j++) {
        if (terms[j].term.toLowerCase().trim() === neg) {
          selected.push(terms[j]);
          break;
        }
      }
    }

    flagged.selectedForNegation = selected;
    changesJson.flagged_review = flagged;

    // Handle N-gram removals
    var ngramNegatives = (changesJson.search_term_negations || {}).ngramNegatives || [];
    if (removeNgram.length > 0 && ngramNegatives.length > 0) {
      changesJson.search_term_negations.ngramNegatives = ngramNegatives.filter(function(n) {
        var word = n.word.toLowerCase().trim();
        for (var k = 0; k < removeNgram.length; k++) {
          if (removeNgram[k].toLowerCase().trim() === word) return false;
        }
        return true;
      });
    }

    // Handle smart-negated removals
    var smartNegated = (changesJson.search_term_negations || {}).smartNegated || [];
    if (removeSmartNegated.length > 0 && smartNegated.length > 0) {
      changesJson.search_term_negations.smartNegated = smartNegated.filter(function(s) {
        var term = s.term.toLowerCase().trim();
        for (var k = 0; k < removeSmartNegated.length; k++) {
          if (removeSmartNegated[k].toLowerCase().trim() === term) return false;
        }
        return true;
      });
    }

    // Write back to sheet
    result.sheet.getRange(result.rowNum, result.colIdx['changes_json'] + 1).setValue(JSON.stringify(changesJson));

    // Add flagged_review_negations to approved categories if there are selections
    if (selected.length > 0) {
      var existingApproved = String(result.row[result.colIdx['approved_categories']] || '').trim();
      if (existingApproved.indexOf('flagged_review_negations') === -1) {
        var newApproved = existingApproved ? existingApproved + ',flagged_review_negations' : 'flagged_review_negations';
        result.sheet.getRange(result.rowNum, result.colIdx['approved_categories'] + 1).setValue(newApproved);
      }
      result.sheet.getRange(result.rowNum, result.colIdx['approved_by'] + 1).setValue(Session.getActiveUser().getEmail() || 'Unknown');
      result.sheet.getRange(result.rowNum, result.colIdx['approved_at'] + 1).setValue(new Date().toISOString());
    }

    // Build confirmation summary
    var summary = '';
    if (selected.length > 0) {
      summary += '<strong>Negating (' + selected.length + '):</strong><ul>';
      for (var s = 0; s < selected.length; s++) {
        summary += '<li style="color:#c62828;">' + _escape(selected[s].term) + '</li>';
      }
      summary += '</ul>';
    }
    if (removeNgram.length > 0) {
      summary += '<strong>Removed from N-gram negations:</strong><ul>';
      for (var rn = 0; rn < removeNgram.length; rn++) {
        summary += '<li style="color:#1565c0;">"' + _escape(removeNgram[rn]) + '"</li>';
      }
      summary += '</ul>';
    }
    if (removeSmartNegated.length > 0) {
      summary += '<strong>Removed from AI auto-negated:</strong><ul>';
      for (var rs = 0; rs < removeSmartNegated.length; rs++) {
        summary += '<li style="color:#1565c0;">"' + _escape(removeSmartNegated[rs]) + '"</li>';
      }
      summary += '</ul>';
    }

    var kept = terms.length - selected.length;
    summary += '<p>' + kept + ' flagged term(s) kept.</p>';
    summary += '<p>Changes will be applied on the next scheduled script run.</p>';

    return _renderPage('Changes Confirmed', summary, true);
  } catch (ex) {
    return _renderPage('Error', 'Could not confirm changes: ' + ex.message, false);
  }
}


// ============================================
// HTML RENDERING
// ============================================

// ============================================
// CATEGORY LABELS HELPER
// ============================================

var CATEGORY_LABELS = {
  keyword_pauses: 'Keyword Pauses',
  search_term_negations: 'Search Term Negations',
  winner_promotions: 'Winner Promotions',
  auto_optimizations: 'Auto-Optimizations',
  shopping_pmax: 'Shopping/PMax',
  flagged_review_negations: 'Flagged Review Negations'
};

function _catLabel(cat) { return CATEGORY_LABELS[cat] || cat; }

function _countCategory(changesJson, cat) {
  var d = changesJson[cat];
  if (!d) return 0;
  var n = 0;
  for (var k in d) { if (Array.isArray(d[k])) n += d[k].length; }
  return n;
}


// ============================================
// PER-CATEGORY REJECT — REASON FORM
// ============================================

function _renderRejectReasonPage(runId, category) {
  var result = _findPendingRow(runId);
  if (!result) return _renderPage('Not Found', 'Run ID not found: ' + runId, false);

  var status = String(result.row[result.colIdx['status']]).trim();
  if (status === 'APPLIED') return _renderPage('Already Applied', 'These changes have already been applied.', false);
  if (status === 'EXPIRED') return _renderPage('Expired', 'These changes have expired.', false);

  var changesJson = {};
  try { changesJson = JSON.parse(result.row[result.colIdx['changes_json']]); } catch (e) {}

  var label = _catLabel(category);
  var count = _countCategory(changesJson, category);
  var webAppUrl = ScriptApp.getService().getUrl();

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1">';
  html += '<title>Reject: ' + label + '</title>';
  html += '<style>';
  html += 'body{font-family:Arial,sans-serif;max-width:500px;margin:30px auto;padding:0 20px;color:#333;}';
  html += '.card{background:#ffebee;border-left:4px solid #c62828;padding:20px;border-radius:6px;margin:16px 0;}';
  html += 'h1{font-size:20px;margin:0 0 8px;color:#c62828;}';
  html += 'textarea{width:100%;padding:10px;border:1px solid #ccc;border-radius:4px;margin:8px 0;box-sizing:border-box;font-size:14px;}';
  html += '.btn{display:inline-block;padding:12px 24px;border:none;border-radius:6px;color:white;font-weight:bold;font-size:14px;cursor:pointer;margin:4px;}';
  html += '.btn-reject{background:#c62828;}';
  html += '.btn-cancel{background:#999;}';
  html += '</style></head><body>';

  html += '<div class="card">';
  html += '<h1>Reject: ' + _escape(label) + '</h1>';
  html += '<p>' + count + ' proposed change(s) in this category will NOT be applied.</p>';

  html += '<form action="' + webAppUrl + '" method="post">';
  html += '<input type="hidden" name="runId" value="' + _escape(runId) + '">';
  html += '<input type="hidden" name="post_action" value="reject_category">';
  html += '<input type="hidden" name="category" value="' + _escape(category) + '">';
  html += '<label style="font-weight:bold;">Reason for rejection (required):</label>';
  html += '<textarea name="reason" rows="4" required placeholder="e.g. Too aggressive during peak season, need to review competitor terms first"></textarea>';
  html += '<button type="submit" class="btn btn-reject">Confirm Reject</button>';
  html += ' <a href="' + webAppUrl + '?view=run_status&runId=' + _escape(runId) + '" class="btn btn-cancel" style="text-decoration:none;">Cancel</a>';
  html += '</form>';

  html += '</div>';
  html += '<div style="margin-top:30px;color:#999;font-size:11px;text-align:center;">Syte Digital Agency | Optimization Approval System | syte.co.za</div>';
  html += '</body></html>';

  return HtmlService.createHtmlOutput(html).setTitle('Reject: ' + label);
}

function _handleCategoryReject(e) {
  var runId = (e.parameter.runId || '').trim();
  var category = (e.parameter.category || '').trim();
  var reason = (e.parameter.reason || '').trim();

  if (!runId || !category) return _renderPage('Error', 'Missing parameters.', false);
  if (!reason) return _renderPage('Error', 'A reason is required when rejecting.', false);

  var result = _findPendingRow(runId);
  if (!result) return _renderPage('Not Found', 'Run ID not found: ' + runId, false);

  var row = result.row;
  var colIdx = result.colIdx;
  var rowNum = result.rowNum;
  var sheet = result.sheet;

  var userEmail = Session.getActiveUser().getEmail() || 'Unknown';
  var now = new Date().toISOString();

  // Update category_decisions
  var decisions = {};
  if (colIdx['category_decisions'] !== undefined) {
    try { decisions = JSON.parse(row[colIdx['category_decisions']] || '{}'); } catch (e) {}
  }
  decisions[category] = { decision: 'rejected', reason: reason, by: userEmail, at: now };
  if (colIdx['category_decisions'] !== undefined) {
    sheet.getRange(rowNum, colIdx['category_decisions'] + 1).setValue(JSON.stringify(decisions));
  }

  // If this category was previously approved, remove it from approved_categories so
  // the apply step doesn't pick it up. ("all" expands to every remaining category
  // except this one, since the apply step also honors category_decisions.)
  var existingApproved = String(row[colIdx['approved_categories']] || '').trim();
  if (existingApproved) {
    var newApproved;
    if (existingApproved === 'all') {
      var allCats = ['keyword_pauses', 'search_term_negations', 'winner_promotions', 'auto_optimizations', 'shopping_pmax', 'flagged_review_negations'];
      newApproved = allCats.filter(function(c) { return c !== category; }).join(',');
    } else {
      newApproved = existingApproved.split(',').map(function(c) { return c.trim(); })
        .filter(function(c) { return c && c !== category; }).join(',');
    }
    sheet.getRange(rowNum, colIdx['approved_categories'] + 1).setValue(newApproved);
  }

  // Append to notes for backward-compatible visibility
  var existingNotes = String(row[colIdx['notes']] || '').trim();
  var noteEntry = '[REJECTED: ' + _catLabel(category) + '] ' + reason;
  var combined = existingNotes ? existingNotes + '\n' + noteEntry : noteEntry;
  sheet.getRange(rowNum, colIdx['notes'] + 1).setValue(combined);

  sheet.getRange(rowNum, colIdx['approved_by'] + 1).setValue(userEmail);
  sheet.getRange(rowNum, colIdx['approved_at'] + 1).setValue(now);

  var webAppUrl = ScriptApp.getService().getUrl();
  var summary = '<strong>Rejected:</strong> ' + _escape(_catLabel(category)) + '<br>';
  summary += '<strong>Reason:</strong> ' + _escape(reason) + '<br><br>';
  summary += 'These changes will NOT be applied.';
  summary += '<br><br><a href="' + webAppUrl + '?view=run_status&runId=' + runId + '" style="color:#1565c0;">View full approval status</a>';

  return _renderPage('Rejected: ' + _catLabel(category), summary, false);
}


// ============================================
// RUN STATUS DASHBOARD
// ============================================

function _renderRunStatusPage(ss, runId) {
  var result = _findPendingRow(runId);
  if (!result) return _renderPage('Not Found', 'Run ID not found: ' + runId, false);

  var row = result.row;
  var colIdx = result.colIdx;
  var accountName = row[colIdx['account_name']] || '';
  var timestamp = row[colIdx['timestamp']] || '';
  var status = String(row[colIdx['status']]).trim();
  var approvedCats = String(row[colIdx['approved_categories']] || '').trim();

  var decisions = {};
  if (colIdx['category_decisions'] !== undefined) {
    try { decisions = JSON.parse(row[colIdx['category_decisions']] || '{}'); } catch (e) {}
  }

  var changesJson = {};
  try { changesJson = JSON.parse(row[colIdx['changes_json']]); } catch (e) {}

  var webAppUrl = ScriptApp.getService().getUrl();
  var allCats = ['keyword_pauses', 'search_term_negations', 'winner_promotions', 'auto_optimizations', 'shopping_pmax', 'flagged_review_negations'];

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1">';
  html += '<title>Run Status</title>';
  html += '<style>';
  html += 'body{font-family:Arial,sans-serif;max-width:700px;margin:20px auto;padding:0 16px;color:#333;}';
  html += 'h1{font-size:20px;margin:0 0 4px;}';
  html += '.muted{color:#999;font-size:12px;}';
  html += 'table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0;}';
  html += 'th{background:#e3f2fd;padding:10px 8px;text-align:left;}';
  html += 'td{padding:8px;border-bottom:1px solid #eee;vertical-align:top;}';
  html += '.badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:bold;color:white;}';
  html += '.badge-approved{background:#2e7d32;}';
  html += '.badge-rejected{background:#c62828;}';
  html += '.badge-pending{background:#9e9e9e;}';
  html += '.reason{color:#666;font-size:12px;font-style:italic;margin-top:4px;}';
  html += '.btn{display:inline-block;padding:6px 14px;margin:2px;border-radius:4px;color:white;text-decoration:none;font-weight:600;font-size:12px;}';
  html += '.btn-approve{background:#2e7d32;}';
  html += '.btn-reject{background:#c62828;}';
  html += '.status-bar{padding:14px 16px;border-radius:6px;margin:12px 0;}';
  html += '</style></head><body>';

  html += '<h1>Approval Status</h1>';
  html += '<p class="muted">' + _escape(String(accountName)) + ' | ' + String(timestamp).substring(0, 16) + ' | Run: ' + _escape(runId) + '</p>';

  // Overall status banner
  var statusBg = status === 'APPLIED' ? '#e8f5e9' : status === 'REJECTED' ? '#ffebee' : status === 'EXPIRED' ? '#f5f5f5' : '#fff3e0';
  var statusColor = status === 'APPLIED' ? '#2e7d32' : status === 'REJECTED' ? '#c62828' : status === 'EXPIRED' ? '#999' : '#e65100';
  html += '<div class="status-bar" style="background:' + statusBg + ';border-left:4px solid ' + statusColor + ';">';
  html += '<strong style="color:' + statusColor + ';">Overall: ' + _escape(status) + '</strong>';
  html += '</div>';

  // Per-category table
  html += '<table>';
  html += '<tr><th>Category</th><th>Items</th><th>Status</th><th>Reason</th><th>Decided By</th><th>Actions</th></tr>';

  for (var i = 0; i < allCats.length; i++) {
    var cat = allCats[i];
    var count = _countCategory(changesJson, cat);
    if (count === 0 && !decisions[cat]) continue;

    var d = decisions[cat] || {};
    var dec = d.decision || 'pending';
    var badgeClass = dec === 'approved' ? 'badge-approved' : dec === 'rejected' ? 'badge-rejected' : 'badge-pending';
    var badgeLabel = dec === 'approved' ? 'Approved' : dec === 'rejected' ? 'Rejected' : 'Pending';

    html += '<tr>';
    html += '<td><strong>' + _escape(_catLabel(cat)) + '</strong></td>';
    html += '<td style="text-align:center;">' + count + '</td>';
    html += '<td><span class="badge ' + badgeClass + '">' + badgeLabel + '</span></td>';
    html += '<td>';
    if (d.reason) html += '<span class="reason">' + _escape(d.reason) + '</span>';
    html += '</td>';
    html += '<td class="muted">' + (d.by ? _escape(d.by).split('@')[0] : '') + (d.at ? '<br>' + d.at.substring(0, 16) : '') + '</td>';
    html += '<td>';
    if (dec === 'pending' && status === 'PENDING') {
      html += '<a class="btn btn-approve" href="' + webAppUrl + '?runId=' + encodeURIComponent(runId) + '&category=' + cat + '">Approve</a>';
      html += '<a class="btn btn-reject" href="' + webAppUrl + '?action=reject_category&runId=' + encodeURIComponent(runId) + '&category=' + cat + '">Reject</a>';
    }
    html += '</td>';
    html += '</tr>';
  }

  html += '</table>';

  // Notes
  var notes = String(row[colIdx['notes']] || '').trim();
  if (notes) {
    html += '<h2 style="font-size:14px;margin-top:20px;">Notes</h2>';
    html += '<pre style="background:#f5f5f5;padding:12px;border-radius:4px;font-size:12px;white-space:pre-wrap;">' + _escape(notes) + '</pre>';
  }

  html += '<div style="margin-top:30px;color:#999;font-size:11px;text-align:center;">Syte Digital Agency | Optimization Approval System | syte.co.za</div>';
  html += '</body></html>';

  return HtmlService.createHtmlOutput(html).setTitle('Run Status — ' + runId);
}


/**
 * Renders a per-client dashboard: recent digest runs, errors, and pending
 * approvals with Approve/Reject buttons. Linked from the weekly client report.
 */
function _renderClientDashboard(ss, accountName) {
  var cutoff = new Date(new Date().getTime() - 7 * 24 * 60 * 60 * 1000);
  var webAppUrl = ScriptApp.getService().getUrl();

  // ---- Recent runs from DailyDigest ----
  var digest = ss.getSheetByName('DailyDigest');
  var digestRows = [];
  if (digest) {
    var d = digest.getDataRange().getValues();
    if (d.length > 1) {
      var dh = {}; for (var i = 0; i < d[0].length; i++) dh[d[0][i]] = i;
      for (var r = d.length - 1; r >= 1; r--) {
        if (String(d[r][dh['account']]).trim() !== accountName) continue;
        var dateVal = new Date(d[r][dh['date']]);
        if (isNaN(dateVal.getTime()) || dateVal < cutoff) continue;
        digestRows.push({
          date: d[r][dh['date']],
          time: d[r][dh['time']],
          mode: d[r][dh['mode']],
          runMode: d[r][dh['run_mode']],
          kwPaused: Number(d[r][dh['keywords_paused']]) || 0,
          negated: (Number(d[r][dh['search_terms_negated']]) || 0) +
                   (Number(d[r][dh['ai_negated']]) || 0) +
                   (Number(d[r][dh['ngram_negatives']]) || 0),
          winners: Number(d[r][dh['winners_promoted']]) || 0,
          audit: Number(d[r][dh['audit_findings']]) || 0,
          convThis: Number(d[r][dh['conv_this_week']]) || 0,
          convLast: Number(d[r][dh['conv_last_week']]) || 0,
          errors: Number(d[r][dh['errors']]) || 0
        });
      }
    }
  }

  // ---- Error messages from Errors tab ----
  var errorsSheet = ss.getSheetByName('Errors');
  var errorRows = [];
  if (errorsSheet) {
    var ed = errorsSheet.getDataRange().getValues();
    if (ed.length > 1) {
      var eh = {}; for (var i = 0; i < ed[0].length; i++) eh[ed[0][i]] = i;
      for (var r = ed.length - 1; r >= 1; r--) {
        if (String(ed[r][eh['account']]).trim() !== accountName) continue;
        var ts = new Date(ed[r][eh['timestamp']]);
        if (isNaN(ts.getTime()) || ts < cutoff) continue;
        errorRows.push({
          timestamp: ed[r][eh['timestamp']],
          date: ed[r][eh['date']],
          message: ed[r][eh['error_message']]
        });
      }
    }
  }

  // ---- Pending approvals from PendingChanges ----
  var pendingSheet = ss.getSheetByName('PendingChanges');
  var pending = [];
  if (pendingSheet) {
    var pd = pendingSheet.getDataRange().getValues();
    if (pd.length > 1) {
      var ph = {}; for (var i = 0; i < pd[0].length; i++) ph[pd[0][i]] = i;
      var pCutoff = new Date(new Date().getTime() - 14 * 24 * 60 * 60 * 1000);
      for (var r = pd.length - 1; r >= 1; r--) {
        if (String(pd[r][ph['account_name']]).trim() !== accountName) continue;
        var ts2 = new Date(pd[r][ph['timestamp']]);
        if (isNaN(ts2.getTime()) || ts2 < pCutoff) continue;
        var status = String(pd[r][ph['status']] || '').trim();
        if (status !== 'PENDING') continue;
        pending.push({
          runId: pd[r][ph['run_id']],
          timestamp: pd[r][ph['timestamp']],
          approvedCategories: String(pd[r][ph['approved_categories']] || '').trim(),
          changesJson: pd[r][ph['changes_json']] || '{}',
          evalSummary: pd[r][ph['eval_summary']] || '',
          categoryDecisions: ph['category_decisions'] !== undefined ? String(pd[r][ph['category_decisions']] || '{}') : '{}'
        });
      }
    }
  }

  // ---- Build HTML ----
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1">';
  html += '<title>Syte — ' + accountName + '</title>';
  html += '<style>';
  html += 'body{font-family:Arial,sans-serif;max-width:960px;margin:20px auto;padding:0 20px;color:#333;}';
  html += 'h1{font-size:22px;margin:0 0 4px;}';
  html += 'h2{font-size:16px;margin:24px 0 10px;padding-bottom:6px;border-bottom:2px solid #e3f2fd;}';
  html += 'table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;}';
  html += 'th{background:#e3f2fd;padding:8px;text-align:left;}';
  html += 'td{padding:6px 8px;border-bottom:1px solid #eee;}';
  html += '.btn{display:inline-block;padding:8px 14px;margin:4px 4px 4px 0;border-radius:4px;color:white;text-decoration:none;font-weight:600;font-size:12px;}';
  html += '.btn-approve{background:#2e7d32;}';
  html += '.btn-reject{background:#c62828;}';
  html += '.btn-cat{background:#1565c0;}';
  html += '.muted{color:#999;}';
  html += '.err{background:#ffebee;color:#c62828;padding:10px;border-radius:4px;border-left:3px solid #c62828;margin:6px 0;font-family:monospace;font-size:12px;}';
  html += '.card{background:#f8f9fa;padding:14px;border-radius:6px;border-left:4px solid #1565c0;margin:10px 0;}';
  html += '</style></head><body>';

  html += '<h1>' + _escape(accountName) + '</h1>';
  html += '<p class="muted">Last 7 days | ' + digestRows.length + ' runs | ' +
          errorRows.length + ' errors | ' + pending.length + ' pending approvals</p>';

  // Pending approvals first — action-oriented
  html += '<h2>Pending Approvals</h2>';
  if (pending.length === 0) {
    html += '<p class="muted">No pending approvals.</p>';
  } else {
    for (var p = 0; p < pending.length; p++) {
      var pr = pending[p];
      var changes = {};
      try { changes = JSON.parse(pr.changesJson); } catch (e) {}
      html += '<div class="card">';
      html += '<strong>Run:</strong> ' + String(pr.timestamp).substring(0, 16) +
              '  <span class="muted">(' + pr.runId + ')</span><br>';
      html += '<strong>Summary:</strong> ' + _summarizeChangesDashboard(changes) + '<br>';
      if (pr.evalSummary) {
        html += '<strong>AI eval:</strong> <em>' + _escape(String(pr.evalSummary)) + '</em><br>';
      }

      // Show per-category status with badges
      var decs = {};
      try { decs = JSON.parse(pr.categoryDecisions || '{}'); } catch (e) {}
      var cats = [
        { k: 'keyword_pauses', label: 'Keywords' },
        { k: 'search_term_negations', label: 'Negations' },
        { k: 'winner_promotions', label: 'Winners' },
        { k: 'auto_optimizations', label: 'Auto-Opt' },
        { k: 'shopping_pmax', label: 'Shopping/PMax' }
      ];
      var hasDecisions = Object.keys(decs).length > 0;
      if (hasDecisions) {
        html += '<div style="margin:8px 0;font-size:12px;">';
        for (var dc = 0; dc < cats.length; dc++) {
          var catDec = decs[cats[dc].k];
          if (catDec && catDec.decision === 'approved') {
            html += '<span style="background:#e8f5e9;color:#2e7d32;padding:2px 8px;border-radius:10px;margin:2px;display:inline-block;">' + cats[dc].label + ' ✓</span> ';
          } else if (catDec && catDec.decision === 'rejected') {
            html += '<span style="background:#ffebee;color:#c62828;padding:2px 8px;border-radius:10px;margin:2px;display:inline-block;" title="' + _escape(catDec.reason || '') + '">' + cats[dc].label + ' ✗</span> ';
          }
        }
        html += '</div>';
      }

      html += '<div style="margin-top:10px;">';
      html += '<a class="btn btn-approve" href="' + webAppUrl + '?runId=' +
              encodeURIComponent(pr.runId) + '&category=all">Approve All</a>';
      for (var c = 0; c < cats.length; c++) {
        var cd = decs[cats[c].k];
        if (cd && (cd.decision === 'approved' || cd.decision === 'rejected')) continue;
        html += '<a class="btn btn-cat" href="' + webAppUrl + '?runId=' +
                encodeURIComponent(pr.runId) + '&category=' + cats[c].k + '">' +
                cats[c].label + '</a>';
      }
      html += '<a class="btn btn-reject" href="' + webAppUrl + '?action=reject&runId=' +
              encodeURIComponent(pr.runId) +
              '" onclick="return confirm(\'Reject this run? All proposed changes will be discarded.\');">Reject All</a>';
      html += ' <a class="btn btn-cat" style="background:#546e7a;" href="' + webAppUrl + '?view=run_status&runId=' +
              encodeURIComponent(pr.runId) + '">Status</a>';
      html += '</div></div>';
    }
  }

  // Error messages
  html += '<h2>Recent Errors</h2>';
  if (errorRows.length === 0) {
    html += '<p class="muted">No errors in the last 7 days.</p>';
  } else {
    for (var er = 0; er < errorRows.length; er++) {
      html += '<div class="err"><strong>' +
              Utilities.formatDate(new Date(errorRows[er].timestamp), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') +
              '</strong><br>' + _escape(String(errorRows[er].message)) + '</div>';
    }
  }

  // Recent runs table
  html += '<h2>Recent Runs</h2>';
  if (digestRows.length === 0) {
    html += '<p class="muted">No runs in the last 7 days.</p>';
  } else {
    html += '<table><tr><th>Date</th><th>Mode</th><th>Run</th>' +
            '<th style="text-align:right">Conv 7d</th>' +
            '<th style="text-align:right">Prev 7d</th>' +
            '<th style="text-align:right">KW</th>' +
            '<th style="text-align:right">Neg</th>' +
            '<th style="text-align:right">Winners</th>' +
            '<th style="text-align:right">Audit</th>' +
            '<th style="text-align:right">Errors</th></tr>';
    for (var rr = 0; rr < digestRows.length; rr++) {
      var dr = digestRows[rr];
      html += '<tr' + (dr.errors > 0 ? ' style="background:#ffebee;"' : '') + '>';
      html += '<td>' + dr.date + ' ' + (dr.time || '') + '</td>';
      html += '<td>' + _escape(String(dr.mode || '')) + '</td>';
      html += '<td>' + _escape(String(dr.runMode || '')) + '</td>';
      html += '<td style="text-align:right">' + dr.convThis.toFixed(0) + '</td>';
      html += '<td style="text-align:right" class="muted">' + dr.convLast.toFixed(0) + '</td>';
      html += '<td style="text-align:right">' + dr.kwPaused + '</td>';
      html += '<td style="text-align:right">' + dr.negated + '</td>';
      html += '<td style="text-align:right">' + dr.winners + '</td>';
      html += '<td style="text-align:right">' + dr.audit + '</td>';
      html += '<td style="text-align:right' +
              (dr.errors > 0 ? ';color:#c62828;font-weight:600' : ';color:#999') +
              '">' + dr.errors + '</td>';
      html += '</tr>';
    }
    html += '</table>';
  }

  html += '<div style="margin-top:30px;color:#999;font-size:11px;text-align:center;">' +
          'Syte Digital Agency | Client Dashboard | syte.co.za</div>';
  html += '</body></html>';

  return HtmlService.createHtmlOutput(html).setTitle('Syte — ' + accountName);
}

/**
 * Marks a pending run as REJECTED. Triggered by the Reject button.
 */
function _rejectRun(runId) {
  try {
    var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
    var sheet = ss.getSheetByName('PendingChanges');
    if (!sheet) return _renderPage('Error', 'PendingChanges sheet not found.', false);

    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var colIdx = {};
    headers.forEach(function(h, i) { colIdx[h] = i; });

    for (var r = 1; r < data.length; r++) {
      if (String(data[r][colIdx['run_id']]).trim() === runId) {
        var status = String(data[r][colIdx['status']]).trim();
        if (status === 'APPLIED') {
          return _renderPage('Already Applied', 'Cannot reject — changes have already been applied.', false);
        }
        var userEmail = Session.getActiveUser().getEmail() || 'Unknown';
        var now = new Date().toISOString();
        sheet.getRange(r + 1, colIdx['status'] + 1).setValue('REJECTED');
        sheet.getRange(r + 1, colIdx['approved_by'] + 1).setValue(userEmail);
        sheet.getRange(r + 1, colIdx['approved_at'] + 1).setValue(now);

        // Populate category_decisions for all categories
        if (colIdx['category_decisions'] !== undefined) {
          var allCats = ['keyword_pauses', 'search_term_negations', 'winner_promotions', 'auto_optimizations', 'shopping_pmax', 'flagged_review_negations'];
          var decisions = {};
          for (var ci = 0; ci < allCats.length; ci++) {
            decisions[allCats[ci]] = { decision: 'rejected', reason: 'Entire run rejected', by: userEmail, at: now };
          }
          sheet.getRange(r + 1, colIdx['category_decisions'] + 1).setValue(JSON.stringify(decisions));
        }

        return _renderPage('Rejected', 'Run ' + runId + ' has been marked as rejected. The proposed changes will not be applied.', true);
      }
    }
    return _renderPage('Not Found', 'Run ID not found: ' + runId, false);
  } catch (e) {
    return _renderPage('Error', 'Could not reject: ' + e.message, false);
  }
}

/**
 * Small helper to escape HTML in user-provided values.
 */
function _escape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Mirrors weekly_approval_report.js#_summarizeChanges but takes a parsed obj.
 */
function _summarizeChangesDashboard(changes) {
  var parts = [];
  var kw = (changes.keyword_pauses ? (changes.keyword_pauses.keywordsPaused || []).length +
                                     (changes.keyword_pauses.ecomKeywordsPaused || []).length +
                                     (changes.keyword_pauses.lowQsPaused || []).length : 0);
  var neg = (changes.search_term_negations ? (changes.search_term_negations.smartNegated || []).length +
                                             (changes.search_term_negations.ngramNegatives || []).length : 0);
  var win = (changes.winner_promotions ? (changes.winner_promotions.winnersPromoted || []).length +
                                         (changes.winner_promotions.ecomWinnersPromoted || []).length : 0);
  var auto = (changes.auto_optimizations ? (changes.auto_optimizations.deviceAdjustments || []).length +
                                           (changes.auto_optimizations.scheduleAdjustments || []).length +
                                           (changes.auto_optimizations.geoAdjustments || []).length : 0);
  var shop = (changes.shopping_pmax ? (changes.shopping_pmax.shoppingProductsPaused || []).length +
                                      (changes.shopping_pmax.pmaxSearchTermsNegated || []).length : 0);
  if (kw > 0) parts.push(kw + ' kw pauses');
  if (neg > 0) parts.push(neg + ' negations');
  if (win > 0) parts.push(win + ' winners');
  if (auto > 0) parts.push(auto + ' bid adj');
  if (shop > 0) parts.push(shop + ' shopping');
  return parts.length > 0 ? parts.join(', ') : 'No changes';
}


function _renderPage(title, body, success) {
  var bgColor = success ? '#e8f5e9' : '#ffebee';
  var borderColor = success ? '#2e7d32' : '#c62828';
  var icon = success ? '✅' : '❌';

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1">';
  html += '<title>Syte Approval — ' + title + '</title>';
  html += '<style>';
  html += 'body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; color: #333; }';
  html += '.card { background: ' + bgColor + '; border-left: 4px solid ' + borderColor + '; padding: 20px; border-radius: 6px; }';
  html += 'h1 { font-size: 22px; margin: 0 0 12px; }';
  html += '.footer { margin-top: 30px; color: #999; font-size: 12px; text-align: center; }';
  html += '</style></head><body>';
  html += '<div class="card">';
  html += '<h1>' + icon + ' ' + title + '</h1>';
  html += '<div>' + body + '</div>';
  html += '</div>';
  html += '<div class="footer">Syte Digital Agency | Optimization Approval System | syte.co.za</div>';
  html += '</body></html>';

  return HtmlService.createHtmlOutput(html).setTitle('Syte Approval — ' + title);
}
