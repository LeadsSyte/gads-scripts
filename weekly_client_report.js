/**
 * SYTE WEEKLY CLIENT REPORT
 * ==========================
 * Sends ONE consolidated weekly email across all clients showing:
 *  - Total conversions this week vs last week (per client + overall)
 *  - Red-flagged clients with major conversion drops
 *  - Week-long action totals (kw paused, negatives, winners, etc.)
 *  - Clients that went silent (no runs in the last 7 days)
 *  - Errors encountered across the week
 *
 * Data source: the "DailyDigest" tab in the master sheet. Every client run
 * appends one row with its per-run metrics, so we aggregate the trailing 7
 * days of rows to build the weekly picture. Approval activity is pulled from
 * the "PendingChanges" tab for a quick week-over-week view of what the team
 * has actioned.
 *
 * This is a STANDALONE Google Ads Script — not loaded via the core.
 * Runs in ONE Google Ads account (e.g. the Syte MCC or any account).
 *
 * Setup:
 * 1. Paste into Google Ads Scripts in ANY one account
 * 2. Set SHEET_ID to your master Google Sheet ID
 * 3. Set EMAIL_TO to the recipient(s)
 * 4. Schedule weekly (e.g. Mondays 9am, after the morning daily digest)
 * 5. Authorize Sheets access
 *
 * Author: Syte Digital Agency (syte.co.za)
 * Version: 1.0.0
 */

var SHEET_ID = 'PASTE_SHEET_ID_HERE';  // Master Google Sheet ID
var EMAIL_TO = 'leads@syte.co.za';
var TIMEZONE = 'Africa/Johannesburg';

// Red-flag thresholds (percentage drop in conversions week-over-week)
var FLAG_WARN_PCT = 30;     // Yellow flag: conversions dropped 30%+
var FLAG_CRITICAL_PCT = 50; // Red flag: conversions dropped 50%+

// Silent-client threshold — accounts with no runs in this many days are flagged
var SILENT_DAYS = 4;

function main() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var digestSheet = ss.getSheetByName('DailyDigest');
  if (!digestSheet) { Logger.log('No DailyDigest tab found'); return; }

  var data = digestSheet.getDataRange().getValues();
  if (data.length < 2) { Logger.log('No data in DailyDigest'); return; }

  var headers = data[0];
  var col = {};
  for (var h = 0; h < headers.length; h++) { col[headers[h]] = h; }

  // Trailing 7 days window
  var now = new Date();
  var cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  var cutoffStr = Utilities.formatDate(cutoff, TIMEZONE, 'yyyy-MM-dd');

  // Group rows by account across the window
  var accounts = {};
  for (var i = 1; i < data.length; i++) {
    var dateStr = String(data[i][col['date']] || '');
    if (!dateStr || dateStr < cutoffStr) continue;

    var accountName = String(data[i][col['account']] || '').trim();
    if (!accountName) continue;

    if (!accounts[accountName]) {
      accounts[accountName] = {
        name: accountName,
        runs: 0,
        lastRunDate: '',
        lastRunMode: '',
        mode: '',
        kwPaused: 0,
        stNegated: 0,
        aiNegated: 0,
        aiReview: 0,
        winners: 0,
        audit: 0,
        ngramNegatives: 0,
        lowQsPaused: 0,
        scheduleAdj: 0,
        deviceAdj: 0,
        geoAdj: 0,
        errors: 0,
        convThis: 0,   // latest snapshot of rolling 7-day conversions
        convLast: 0    // latest snapshot of the prior 7-day window
      };
    }

    var acct = accounts[accountName];
    acct.runs++;
    acct.kwPaused += Number(data[i][col['keywords_paused']]) || 0;
    acct.stNegated += Number(data[i][col['search_terms_negated']]) || 0;
    acct.aiNegated += Number(data[i][col['ai_negated']]) || 0;
    acct.aiReview += Number(data[i][col['ai_review']]) || 0;
    acct.winners += Number(data[i][col['winners_promoted']]) || 0;
    acct.audit += Number(data[i][col['audit_findings']]) || 0;
    acct.ngramNegatives += Number(data[i][col['ngram_negatives']]) || 0;
    acct.lowQsPaused += Number(data[i][col['low_qs_paused']]) || 0;
    acct.scheduleAdj += Number(data[i][col['schedule_adjustments']]) || 0;
    acct.deviceAdj += Number(data[i][col['device_adjustments']]) || 0;
    acct.geoAdj += Number(data[i][col['geo_adjustments']]) || 0;
    acct.errors += Number(data[i][col['errors']]) || 0;

    // Track the LATEST run's conversion snapshot (rolling 7-day values)
    if (dateStr >= acct.lastRunDate) {
      acct.lastRunDate = dateStr;
      acct.lastRunMode = String(data[i][col['run_mode']] || '');
      acct.mode = String(data[i][col['mode']] || '');
      acct.convThis = Number(data[i][col['conv_this_week']]) || 0;
      acct.convLast = Number(data[i][col['conv_last_week']]) || 0;
    }
  }

  var accountNames = Object.keys(accounts);
  if (accountNames.length === 0) {
    Logger.log('No DailyDigest rows in the last 7 days');
    return;
  }

  // Compute per-account deltas and classify
  var rows = [];
  var totalConvThis = 0, totalConvLast = 0, totalErrors = 0, totalActions = 0;
  var critical = [], warn = [], silent = [];
  var silentCutoffStr = Utilities.formatDate(
    new Date(now.getTime() - SILENT_DAYS * 24 * 60 * 60 * 1000),
    TIMEZONE, 'yyyy-MM-dd'
  );

  for (var a = 0; a < accountNames.length; a++) {
    var r = accounts[accountNames[a]];
    var drop = null;
    if (r.convLast > 0) {
      drop = (r.convLast - r.convThis) / r.convLast * 100;
    }
    r.dropPct = drop;

    r.totalActions = r.kwPaused + r.stNegated + r.aiNegated + r.winners +
                     r.ngramNegatives + r.lowQsPaused + r.scheduleAdj +
                     r.deviceAdj + r.geoAdj;

    totalConvThis += r.convThis;
    totalConvLast += r.convLast;
    totalErrors += r.errors;
    totalActions += r.totalActions;

    if (drop !== null && drop >= FLAG_CRITICAL_PCT && r.convLast >= 3) {
      critical.push(r);
    } else if (drop !== null && drop >= FLAG_WARN_PCT && r.convLast >= 3) {
      warn.push(r);
    }

    if (r.lastRunDate < silentCutoffStr) {
      silent.push(r);
    }

    rows.push(r);
  }

  // Sort accounts: biggest drops first, then alphabetical
  rows.sort(function(a, b) {
    var da = a.dropPct === null ? -999 : a.dropPct;
    var db = b.dropPct === null ? -999 : b.dropPct;
    if (db !== da) return db - da;
    return a.name.localeCompare(b.name);
  });

  // Overall week-over-week conversion change
  var overallChange = totalConvLast > 0
    ? ((totalConvThis - totalConvLast) / totalConvLast * 100)
    : null;
  var overallColor = overallChange === null ? '#666'
    : (overallChange >= 0 ? '#2e7d32' : '#c62828');
  var overallArrow = overallChange === null ? '—'
    : (overallChange >= 0 ? '↑' : '↓');

  var today = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');
  var weekStart = Utilities.formatDate(cutoff, TIMEZONE, 'yyyy-MM-dd');

  // ============================================
  // BUILD EMAIL
  // ============================================
  var email = '<html><body style="font-family:Arial,sans-serif;max-width:960px;margin:0 auto;color:#333;">';

  // Header
  email += '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;padding:20px;border-radius:8px 8px 0 0;">';
  email += '<h1 style="margin:0;font-size:22px;">Syte Weekly Client Report</h1>';
  email += '<p style="margin:5px 0 0;opacity:0.8;">' + weekStart + '  →  ' + today +
           '  |  ' + accountNames.length + ' clients</p></div>';

  // Summary bar
  email += '<div style="background:#f8f9fa;padding:18px;border-bottom:1px solid #e0e5ec;">';
  email += '<table style="border:none;border-collapse:collapse;width:100%;"><tr>';
  email += '<td style="padding:0 25px 0 0;"><strong style="font-size:28px;color:' + overallColor + ';">' +
           totalConvThis.toFixed(0) + '</strong><br>' +
           '<span style="font-size:12px;color:#666;">Conversions (last 7d)</span></td>';
  email += '<td style="padding:0 25px 0 0;"><strong style="font-size:28px;color:' + overallColor + ';">' +
           overallArrow + ' ' +
           (overallChange === null ? 'N/A' : Math.abs(overallChange).toFixed(0) + '%') +
           '</strong><br><span style="font-size:12px;color:#666;">vs prior 7d (' +
           totalConvLast.toFixed(0) + ')</span></td>';
  email += '<td style="padding:0 25px 0 0;"><strong style="font-size:28px;color:#c62828;">' +
           critical.length + '</strong><br>' +
           '<span style="font-size:12px;color:#666;">Critical drops</span></td>';
  email += '<td style="padding:0 25px 0 0;"><strong style="font-size:28px;color:#e65100;">' +
           warn.length + '</strong><br>' +
           '<span style="font-size:12px;color:#666;">Warning drops</span></td>';
  email += '<td style="padding:0 25px 0 0;"><strong style="font-size:28px;">' +
           totalActions + '</strong><br>' +
           '<span style="font-size:12px;color:#666;">Total actions</span></td>';
  if (totalErrors > 0) {
    email += '<td style="padding:0 25px 0 0;"><strong style="font-size:28px;color:#c62828;">' +
             totalErrors + '</strong><br>' +
             '<span style="font-size:12px;color:#666;">Errors</span></td>';
  }
  email += '</tr></table></div>';

  // Red flag section — critical drops first, then warning drops
  if (critical.length > 0 || warn.length > 0) {
    email += '<div style="padding:18px;background:#ffebee;border-top:1px solid #ef9a9a;">';
    email += '<h2 style="color:#c62828;margin:0 0 10px;font-size:16px;">Red Flags — Conversion Drops</h2>';
    email += '<p style="font-size:12px;color:#666;margin:0 0 12px;">' +
             'Clients where weekly conversions fell materially vs the prior week. ' +
             'Review for tracking issues, budget pacing, creative fatigue, or paused campaigns.</p>';

    email += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    email += '<tr style="background:#ffcdd2;">' +
             '<th style="padding:8px;text-align:left;">Flag</th>' +
             '<th style="padding:8px;text-align:left;">Account</th>' +
             '<th style="padding:8px;text-align:right;">This Week</th>' +
             '<th style="padding:8px;text-align:right;">Last Week</th>' +
             '<th style="padding:8px;text-align:right;">Drop</th>' +
             '<th style="padding:8px;text-align:right;">Errors</th>' +
             '</tr>';

    var flagged = critical.concat(warn);
    for (var f = 0; f < flagged.length; f++) {
      var fr = flagged[f];
      var isCritical = fr.dropPct >= FLAG_CRITICAL_PCT;
      var badge = isCritical
        ? '<span style="background:#c62828;color:white;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">CRITICAL</span>'
        : '<span style="background:#e65100;color:white;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">WARN</span>';
      email += '<tr style="background:' + (f % 2 === 0 ? '#fff' : '#fff5f5') +
               ';border-bottom:1px solid #ffcdd2;">';
      email += '<td style="padding:6px 8px;">' + badge + '</td>';
      email += '<td style="padding:6px 8px;font-weight:600;">' + fr.name + '</td>';
      email += '<td style="padding:6px 8px;text-align:right;">' + fr.convThis.toFixed(0) + '</td>';
      email += '<td style="padding:6px 8px;text-align:right;">' + fr.convLast.toFixed(0) + '</td>';
      email += '<td style="padding:6px 8px;text-align:right;color:#c62828;font-weight:600;">↓ ' +
               fr.dropPct.toFixed(0) + '%</td>';
      email += '<td style="padding:6px 8px;text-align:right;' +
               (fr.errors > 0 ? 'color:#c62828;font-weight:600;' : 'color:#999;') + '">' +
               fr.errors + '</td>';
      email += '</tr>';
    }
    email += '</table></div>';
  }

  // Silent clients
  if (silent.length > 0) {
    email += '<div style="padding:18px;background:#fff8e1;border-top:1px solid #ffe082;">';
    email += '<h3 style="color:#e65100;margin:0 0 8px;font-size:15px;">Silent Clients</h3>';
    email += '<p style="font-size:12px;color:#666;margin:0 0 10px;">No runs in the last ' +
             SILENT_DAYS + ' days — check that the script is still scheduled.</p>';
    email += '<ul style="font-size:13px;margin:0;padding:0 0 0 20px;">';
    for (var s = 0; s < silent.length; s++) {
      email += '<li><strong>' + silent[s].name + '</strong> — last run ' +
               (silent[s].lastRunDate || 'unknown') + '</li>';
    }
    email += '</ul></div>';
  }

  // Full per-client table
  email += '<div style="padding:18px;">';
  email += '<h3 style="margin:0 0 10px;font-size:15px;">All Clients (sorted by biggest drop)</h3>';
  email += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  email += '<tr style="background:#e3f2fd;">';
  email += '<th style="padding:8px;text-align:left;">Account</th>';
  email += '<th style="padding:8px;text-align:center;">Mode</th>';
  email += '<th style="padding:8px;text-align:right;">Runs</th>';
  email += '<th style="padding:8px;text-align:right;">Conv 7d</th>';
  email += '<th style="padding:8px;text-align:right;">Prev 7d</th>';
  email += '<th style="padding:8px;text-align:right;">Δ</th>';
  email += '<th style="padding:8px;text-align:right;">KW Paused</th>';
  email += '<th style="padding:8px;text-align:right;">Negated</th>';
  email += '<th style="padding:8px;text-align:right;">Winners</th>';
  email += '<th style="padding:8px;text-align:right;">Audit</th>';
  email += '<th style="padding:8px;text-align:right;">Errors</th>';
  email += '</tr>';

  for (var rr = 0; rr < rows.length; rr++) {
    var row = rows[rr];
    var hasErrors = row.errors > 0;
    var dropText, dropColor;
    if (row.dropPct === null) {
      dropText = '—';
      dropColor = '#999';
    } else if (row.dropPct >= FLAG_CRITICAL_PCT && row.convLast >= 3) {
      dropText = '↓ ' + row.dropPct.toFixed(0) + '%';
      dropColor = '#c62828';
    } else if (row.dropPct >= FLAG_WARN_PCT && row.convLast >= 3) {
      dropText = '↓ ' + row.dropPct.toFixed(0) + '%';
      dropColor = '#e65100';
    } else if (row.dropPct > 0) {
      dropText = '↓ ' + row.dropPct.toFixed(0) + '%';
      dropColor = '#666';
    } else if (row.dropPct < 0) {
      dropText = '↑ ' + Math.abs(row.dropPct).toFixed(0) + '%';
      dropColor = '#2e7d32';
    } else {
      dropText = '0%';
      dropColor = '#666';
    }

    var rowBg = hasErrors ? '#ffebee' : (rr % 2 === 0 ? '#fff' : '#fafbfc');
    var totalNegated = row.stNegated + row.aiNegated + row.ngramNegatives;
    var totalKw = row.kwPaused + row.lowQsPaused;

    email += '<tr style="background:' + rowBg + ';border-bottom:1px solid #eee;">';
    email += '<td style="padding:6px 8px;font-weight:600;">' + row.name + '</td>';
    email += '<td style="padding:6px 8px;text-align:center;font-size:11px;color:#666;">' +
             row.mode + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;">' + row.runs + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;font-weight:600;">' +
             row.convThis.toFixed(0) + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;color:#666;">' +
             row.convLast.toFixed(0) + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;font-weight:600;color:' +
             dropColor + ';">' + dropText + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;">' + totalKw + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;">' + totalNegated + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;color:#2e7d32;">' +
             row.winners + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;">' + row.audit + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;' +
             (hasErrors ? 'color:#c62828;font-weight:600;' : 'color:#999;') + '">' +
             row.errors + '</td>';
    email += '</tr>';
  }
  email += '</table></div>';

  // Approval activity (optional — only if PendingChanges tab exists)
  var approvalHtml = _buildApprovalSection(ss, cutoff);
  if (approvalHtml) email += approvalHtml;

  // Footer
  email += '<div style="padding:15px;color:#999;font-size:11px;text-align:center;">' +
           'Syte Digital Agency | Weekly Client Report | syte.co.za</div>';
  email += '</body></html>';

  // Subject line headline
  var subjectConv = totalConvThis.toFixed(0) + ' conv';
  if (overallChange !== null) {
    subjectConv += ' (' + (overallChange >= 0 ? '+' : '') + overallChange.toFixed(0) + '%)';
  }
  var flagSuffix = '';
  if (critical.length > 0) flagSuffix = ' | ' + critical.length + ' CRITICAL';
  else if (warn.length > 0) flagSuffix = ' | ' + warn.length + ' warn';

  MailApp.sendEmail({
    to: EMAIL_TO,
    subject: 'Syte Weekly Client Report | ' + today + ' | ' +
             accountNames.length + ' clients | ' + subjectConv + flagSuffix,
    htmlBody: email
  });

  Logger.log('Weekly client report sent: ' + accountNames.length + ' clients, ' +
             critical.length + ' critical, ' + warn.length + ' warn');
}


// ============================================
// HELPERS
// ============================================

/**
 * Builds a small approval activity summary from the PendingChanges tab.
 * Returns '' if the tab is missing or has no rows in the window.
 */
function _buildApprovalSection(ss, cutoff) {
  var sheet = ss.getSheetByName('PendingChanges');
  if (!sheet) return '';

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return '';

  var headers = data[0];
  var col = {};
  for (var j = 0; j < headers.length; j++) { col[headers[j]] = j; }
  if (col['timestamp'] === undefined || col['status'] === undefined) return '';

  var applied = 0, expired = 0, pending = 0;
  for (var i = 1; i < data.length; i++) {
    var ts = new Date(data[i][col['timestamp']]);
    if (isNaN(ts.getTime()) || ts < cutoff) continue;
    var status = String(data[i][col['status']] || '').trim();
    var approvedCats = String(data[i][col['approved_categories']] || '').trim();
    if (status === 'APPLIED' || (status === 'PENDING' && approvedCats)) applied++;
    else if (status === 'EXPIRED') expired++;
    else if (status === 'PENDING') pending++;
  }

  if (applied === 0 && expired === 0 && pending === 0) return '';

  var html = '<div style="padding:18px;background:#f8f9fa;border-top:1px solid #e0e5ec;">';
  html += '<h3 style="margin:0 0 10px;font-size:15px;">Approval Activity (last 7d)</h3>';
  html += '<table style="border:none;border-collapse:collapse;"><tr>';
  html += '<td style="padding:0 25px 0 0;"><strong style="font-size:22px;color:#2e7d32;">' +
          applied + '</strong><br><span style="font-size:12px;color:#666;">Approved & Applied</span></td>';
  html += '<td style="padding:0 25px 0 0;"><strong style="font-size:22px;color:#c62828;">' +
          expired + '</strong><br><span style="font-size:12px;color:#666;">Expired (Ignored)</span></td>';
  html += '<td style="padding:0 25px 0 0;"><strong style="font-size:22px;color:#e65100;">' +
          pending + '</strong><br><span style="font-size:12px;color:#666;">Still Pending</span></td>';
  html += '</tr></table></div>';
  return html;
}
