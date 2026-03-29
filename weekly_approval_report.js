/**
 * SYTE WEEKLY APPROVAL REPORT
 * ============================
 * Sends a weekly summary of all approval activity across all clients.
 * Shows what was approved, what expired (ignored), and what's still pending.
 *
 * This is a STANDALONE Google Ads Script — not loaded via the core.
 * It runs in ONE Google Ads account (e.g. the Syte MCC or any account).
 *
 * Setup:
 * 1. Paste into Google Ads Scripts in ANY one account
 * 2. Set SHEET_ID to your master Google Sheet ID
 * 3. Set EMAIL_TO to the recipient(s)
 * 4. Schedule weekly on Sundays
 * 5. Authorize Sheets access
 *
 * Author: Syte Digital Agency (syte.co.za)
 * Version: 1.0.0
 */

var SHEET_ID = 'PASTE_SHEET_ID_HERE';  // Master Google Sheet ID
var EMAIL_TO = 'leads@syte.co.za';

function main() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('PendingChanges');
  if (!sheet) { Logger.log('No PendingChanges tab found'); return; }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) { Logger.log('No data in PendingChanges'); return; }

  var headers = data[0];
  var colIdx = {};
  for (var j = 0; j < headers.length; j++) { colIdx[headers[j]] = j; }

  // Filter to last 7 days
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var ts = new Date(data[i][colIdx['timestamp']]);
    if (ts >= cutoff) {
      rows.push({
        run_id: data[i][colIdx['run_id']],
        timestamp: data[i][colIdx['timestamp']],
        account: data[i][colIdx['account_name']],
        status: String(data[i][colIdx['status']] || '').trim(),
        approved_categories: String(data[i][colIdx['approved_categories']] || '').trim(),
        approved_by: data[i][colIdx['approved_by']] || '',
        approved_at: data[i][colIdx['approved_at']] || '',
        notes: data[i][colIdx['notes']] || '',
        changes_json: data[i][colIdx['changes_json']] || '{}',
        eval_summary: data[i][colIdx['eval_summary']] || ''
      });
    }
  }

  if (rows.length === 0) {
    Logger.log('No pending changes in the last 7 days');
    return;
  }

  // Group by account
  var accounts = {};
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!accounts[row.account]) {
      accounts[row.account] = { applied: [], expired: [], pending: [] };
    }

    if (row.status === 'APPLIED' || (row.status === 'PENDING' && row.approved_categories)) {
      accounts[row.account].applied.push(row);
    } else if (row.status === 'EXPIRED') {
      accounts[row.account].expired.push(row);
    } else if (row.status === 'PENDING') {
      accounts[row.account].pending.push(row);
    }
  }

  // Count totals
  var totals = { applied: 0, expired: 0, pending: 0 };
  for (var acct in accounts) {
    totals.applied += accounts[acct].applied.length;
    totals.expired += accounts[acct].expired.length;
    totals.pending += accounts[acct].pending.length;
  }

  var today = Utilities.formatDate(new Date(), 'Africa/Johannesburg', 'yyyy-MM-dd');
  var accountNames = Object.keys(accounts);

  // Build email
  var email = '<html><body style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;color:#333;">';

  // Header
  email += '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;padding:20px;border-radius:8px 8px 0 0;">';
  email += '<h1 style="margin:0;font-size:20px;">Syte Weekly Approval Report</h1>';
  email += '<p style="margin:5px 0 0;opacity:0.8;">Week ending ' + today + ' | ' + accountNames.length + ' accounts | ' + rows.length + ' change batches</p></div>';

  // Summary bar
  email += '<div style="background:#f8f9fa;padding:15px;border-bottom:1px solid #e0e5ec;">';
  email += '<table style="border:none;border-collapse:collapse;"><tr>';
  email += '<td style="padding:0 25px 0 0;"><strong style="font-size:28px;color:#2e7d32;">' + totals.applied + '</strong><br><span style="font-size:12px;color:#666;">Approved & Applied</span></td>';
  email += '<td style="padding:0 25px 0 0;"><strong style="font-size:28px;color:#c62828;">' + totals.expired + '</strong><br><span style="font-size:12px;color:#666;">Expired (Ignored)</span></td>';
  email += '<td style="padding:0 25px 0 0;"><strong style="font-size:28px;color:#e65100;">' + totals.pending + '</strong><br><span style="font-size:12px;color:#666;">Still Pending</span></td>';
  email += '</tr></table></div>';

  // Per-account summary table
  email += '<div style="padding:15px;"><h3 style="margin:0 0 10px;">By Account</h3>';
  email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
  email += '<tr style="background:#e3f2fd;">';
  email += '<th style="padding:8px;text-align:left;">Account</th>';
  email += '<th style="padding:8px;text-align:center;color:#2e7d32;">Approved</th>';
  email += '<th style="padding:8px;text-align:center;color:#c62828;">Expired</th>';
  email += '<th style="padding:8px;text-align:center;color:#e65100;">Pending</th>';
  email += '<th style="padding:8px;text-align:left;">Categories Approved</th>';
  email += '</tr>';

  for (var a = 0; a < accountNames.length; a++) {
    var acctName = accountNames[a];
    var acctData = accounts[acctName];
    var rowBg = a % 2 === 0 ? '#fff' : '#fafbfc';

    // Collect all approved categories across runs
    var allCategories = {};
    acctData.applied.forEach(function(r) {
      if (r.approved_categories) {
        r.approved_categories.split(',').forEach(function(c) {
          var cat = c.trim();
          if (cat) allCategories[cat] = true;
        });
      }
    });
    var categoryList = Object.keys(allCategories).join(', ') || '—';

    email += '<tr style="background:' + rowBg + ';border-bottom:1px solid #eee;">';
    email += '<td style="padding:6px 8px;font-weight:600;">' + acctName + '</td>';
    email += '<td style="padding:6px 8px;text-align:center;color:#2e7d32;font-weight:600;">' + acctData.applied.length + '</td>';
    email += '<td style="padding:6px 8px;text-align:center;color:' + (acctData.expired.length > 0 ? '#c62828;font-weight:600' : '#999') + ';">' + acctData.expired.length + '</td>';
    email += '<td style="padding:6px 8px;text-align:center;color:' + (acctData.pending.length > 0 ? '#e65100;font-weight:600' : '#999') + ';">' + acctData.pending.length + '</td>';
    email += '<td style="padding:6px 8px;font-size:12px;color:#666;">' + categoryList + '</td>';
    email += '</tr>';
  }
  email += '</table></div>';

  // Expired (ignored) detail — highlight what the team missed
  var allExpired = rows.filter(function(r) { return r.status === 'EXPIRED'; });
  if (allExpired.length > 0) {
    email += '<div style="padding:15px;background:#ffebee;border-top:1px solid #ef9a9a;">';
    email += '<h3 style="color:#c62828;margin:0 0 10px;">Expired Changes (Never Approved)</h3>';
    email += '<p style="font-size:12px;color:#666;margin:0 0 10px;">These proposed changes were never approved and have expired. Review if any should have been actioned.</p>';
    email += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    email += '<tr style="background:#ffcdd2;"><th style="padding:6px;text-align:left;">Account</th><th style="padding:6px;text-align:left;">Date</th><th style="padding:6px;text-align:left;">Proposed Changes</th><th style="padding:6px;text-align:left;">AI Eval</th></tr>';

    for (var e = 0; e < allExpired.length; e++) {
      var exp = allExpired[e];
      var changeSummary = _summarizeChanges(exp.changes_json);
      email += '<tr style="border-bottom:1px solid #ffcdd2;">';
      email += '<td style="padding:4px 6px;">' + exp.account + '</td>';
      email += '<td style="padding:4px 6px;">' + String(exp.timestamp).substring(0, 16) + '</td>';
      email += '<td style="padding:4px 6px;">' + changeSummary + '</td>';
      email += '<td style="padding:4px 6px;color:#666;">' + (exp.eval_summary || '—') + '</td>';
      email += '</tr>';
    }
    email += '</table></div>';
  }

  // Applied detail — what got approved
  var allApplied = rows.filter(function(r) { return r.status === 'APPLIED' || (r.status === 'PENDING' && r.approved_categories); });
  if (allApplied.length > 0) {
    email += '<div style="padding:15px;background:#e8f5e9;border-top:1px solid #a5d6a7;">';
    email += '<h3 style="color:#2e7d32;margin:0 0 10px;">Approved Changes</h3>';
    email += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    email += '<tr style="background:#c8e6c9;"><th style="padding:6px;text-align:left;">Account</th><th style="padding:6px;text-align:left;">Date</th><th style="padding:6px;text-align:left;">Categories</th><th style="padding:6px;text-align:left;">Approved By</th><th style="padding:6px;text-align:left;">Notes</th></tr>';

    for (var ap = 0; ap < allApplied.length; ap++) {
      var app = allApplied[ap];
      var catLabels = _formatCategories(app.approved_categories);
      email += '<tr style="border-bottom:1px solid #c8e6c9;">';
      email += '<td style="padding:4px 6px;">' + app.account + '</td>';
      email += '<td style="padding:4px 6px;">' + String(app.timestamp).substring(0, 16) + '</td>';
      email += '<td style="padding:4px 6px;">' + catLabels + '</td>';
      email += '<td style="padding:4px 6px;">' + (app.approved_by || '—') + '</td>';
      email += '<td style="padding:4px 6px;color:#666;">' + (app.notes || '—') + '</td>';
      email += '</tr>';
    }
    email += '</table></div>';
  }

  // Footer
  email += '<div style="padding:15px;color:#999;font-size:11px;text-align:center;">Syte Digital Agency | Weekly Approval Report | syte.co.za</div>';
  email += '</body></html>';

  // Send
  MailApp.sendEmail({
    to: EMAIL_TO,
    subject: 'Syte Weekly Approval Report | ' + today + ' | ' + totals.applied + ' approved, ' + totals.expired + ' expired',
    htmlBody: email
  });

  Logger.log('Weekly approval report sent: ' + rows.length + ' batches across ' + accountNames.length + ' accounts');
}


// ============================================
// HELPERS
// ============================================

/**
 * Parses the changes_json and returns a brief human-readable summary.
 */
function _summarizeChanges(changesJsonStr) {
  try {
    var changes = JSON.parse(changesJsonStr);
    var parts = [];

    var kwCount = (changes.keyword_pauses ? (changes.keyword_pauses.keywordsPaused || []).length + (changes.keyword_pauses.ecomKeywordsPaused || []).length + (changes.keyword_pauses.lowQsPaused || []).length : 0);
    var negCount = (changes.search_term_negations ? (changes.search_term_negations.smartNegated || []).length + (changes.search_term_negations.ngramNegatives || []).length : 0);
    var winCount = (changes.winner_promotions ? (changes.winner_promotions.winnersPromoted || []).length + (changes.winner_promotions.ecomWinnersPromoted || []).length : 0);
    var autoCount = (changes.auto_optimizations ? (changes.auto_optimizations.deviceAdjustments || []).length + (changes.auto_optimizations.scheduleAdjustments || []).length + (changes.auto_optimizations.geoAdjustments || []).length : 0);
    var shopCount = (changes.shopping_pmax ? (changes.shopping_pmax.shoppingProductsPaused || []).length + (changes.shopping_pmax.pmaxSearchTermsNegated || []).length : 0);

    if (kwCount > 0) parts.push(kwCount + ' kw pauses');
    if (negCount > 0) parts.push(negCount + ' negations');
    if (winCount > 0) parts.push(winCount + ' winners');
    if (autoCount > 0) parts.push(autoCount + ' bid adj');
    if (shopCount > 0) parts.push(shopCount + ' shopping');

    return parts.length > 0 ? parts.join(', ') : 'No changes';
  } catch (e) {
    return 'Unable to parse';
  }
}

/**
 * Formats category keys into human-readable labels.
 */
function _formatCategories(categoriesStr) {
  if (!categoriesStr) return '—';
  if (categoriesStr === 'all') return 'All Categories';

  var labels = {
    keyword_pauses: 'Keywords',
    search_term_negations: 'Negations',
    winner_promotions: 'Winners',
    auto_optimizations: 'Auto-Opt',
    shopping_pmax: 'Shopping/PMax'
  };

  return categoriesStr.split(',').map(function(c) {
    return labels[c.trim()] || c.trim();
  }).join(', ');
}
