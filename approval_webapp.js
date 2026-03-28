/**
 * SYTE APPROVAL WEB APP v4.4.0
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
  var runId = (e.parameter.runId || '').trim();
  var category = (e.parameter.category || '').trim();

  if (!runId || !category) {
    return _renderPage('Error', 'Missing runId or category parameter.', false);
  }

  var validCategories = ['keyword_pauses', 'search_term_negations', 'winner_promotions', 'auto_optimizations', 'shopping_pmax', 'all'];
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
    sheet.getRange(rowNum, colIdx['approved_categories'] + 1).setValue(newApproved);
    sheet.getRange(rowNum, colIdx['approved_by'] + 1).setValue(Session.getActiveUser().getEmail() || 'Unknown');
    sheet.getRange(rowNum, colIdx['approved_at'] + 1).setValue(new Date().toISOString());

    // Parse changes to show summary
    var changesJson = {};
    try { changesJson = JSON.parse(row[colIdx['changes_json']]); } catch (e) {}

    var categoryLabels = {
      keyword_pauses: 'Keyword Pauses',
      search_term_negations: 'Search Term Negations',
      winner_promotions: 'Winner Promotions',
      auto_optimizations: 'Auto-Optimizations',
      shopping_pmax: 'Shopping/PMax',
      all: 'All Changes'
    };

    var approvedLabel = category === 'all' ? 'All Changes' : categoryLabels[category] || category;
    var summary = '<strong>Account:</strong> ' + accountName + '<br>';
    summary += '<strong>Run:</strong> ' + timestamp + '<br>';
    summary += '<strong>Approved:</strong> ' + approvedLabel + '<br>';
    summary += '<strong>Total approved categories:</strong> ' + newApproved + '<br><br>';
    summary += 'Changes will be applied on the next scheduled script run.';

    // Show notes form
    summary += '<br><br><form action="' + ScriptApp.getService().getUrl() + '" method="post">';
    summary += '<input type="hidden" name="runId" value="' + runId + '">';
    summary += '<label style="font-weight:bold;">Add a note (optional):</label><br>';
    summary += '<textarea name="notes" rows="3" cols="40" style="margin:8px 0;padding:8px;border:1px solid #ccc;border-radius:4px;width:100%;max-width:400px;"></textarea><br>';
    summary += '<button type="submit" style="background:#1565c0;color:white;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:14px;">Save Note</button>';
    summary += '</form>';

    return _renderPage('Approved: ' + approvedLabel, summary, true);

  } catch (e) {
    return _renderPage('Error', 'Something went wrong: ' + e.message, false);
  }
}

/**
 * Handles POST requests for saving notes.
 */
function doPost(e) {
  var runId = (e.parameter.runId || '').trim();
  var notes = (e.parameter.notes || '').trim();

  if (!runId) {
    return _renderPage('Error', 'Missing run ID.', false);
  }

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
// HTML RENDERING
// ============================================

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
