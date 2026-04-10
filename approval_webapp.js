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
  e = e || { parameter: {} };
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

  // NEW: Reject action — marks a pending run as REJECTED
  if (action === 'reject') {
    if (!runId) return _renderPage('Error', 'Missing runId parameter.', false);
    return _rejectRun(runId);
  }

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
          evalSummary: pd[r][ph['eval_summary']] || ''
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
      if (pr.approvedCategories) {
        html += '<strong>Already approved:</strong> ' + _escape(pr.approvedCategories) + '<br>';
      }
      html += '<div style="margin-top:10px;">';
      html += '<a class="btn btn-approve" href="' + webAppUrl + '?runId=' +
              encodeURIComponent(pr.runId) + '&category=all">Approve All</a>';
      var cats = [
        { k: 'keyword_pauses', label: 'Keywords' },
        { k: 'search_term_negations', label: 'Negations' },
        { k: 'winner_promotions', label: 'Winners' },
        { k: 'auto_optimizations', label: 'Auto-Opt' },
        { k: 'shopping_pmax', label: 'Shopping/PMax' }
      ];
      for (var c = 0; c < cats.length; c++) {
        html += '<a class="btn btn-cat" href="' + webAppUrl + '?runId=' +
                encodeURIComponent(pr.runId) + '&category=' + cats[c].k + '">' +
                cats[c].label + '</a>';
      }
      html += '<a class="btn btn-reject" href="' + webAppUrl + '?action=reject&runId=' +
              encodeURIComponent(pr.runId) +
              '" onclick="return confirm(\'Reject this run? All proposed changes will be discarded.\');">Reject</a>';
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
        sheet.getRange(r + 1, colIdx['status'] + 1).setValue('REJECTED');
        sheet.getRange(r + 1, colIdx['approved_by'] + 1).setValue(Session.getActiveUser().getEmail() || 'Unknown');
        sheet.getRange(r + 1, colIdx['approved_at'] + 1).setValue(new Date().toISOString());
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
