/**
 * SYTE WEEKLY CLIENT REPORT v2.0
 * ================================
 * Drop-in replacement for weekly_client_report.js v1.0.
 * Now includes operational dashboard view of all automation activity.
 *
 * NEW IN v2.0:
 *  - Optimization Activity table (what changed, by client, by category)
 *  - Outcome Tracking section (decision accuracy from ChangeLog backfill)
 *  - Approval Queue Status (pending changes, days waiting)
 *  - Autopilot vs Approval breakdown (% silent vs approved vs expired)
 *  - Tier 1 auto-applied counter
 *
 * Reads from master sheet:
 *  - DailyDigest tab (per-run metrics, including new tier1_applied column)
 *  - ChangeLog tab (every change with outcome scoring)
 *  - PendingChanges tab (approval queue state)
 *  - ClientConfig tab (automation tier per client — NEW)
 *
 * Setup unchanged from v1.0:
 * 1. Paste into Google Ads Scripts in any one account
 * 2. Set SHEET_ID
 * 3. Schedule Sundays at 9am
 * 4. Authorize Sheets access
 *
 * Author: Syte Digital Agency
 * Version: 2.0.0
 */

var SHEET_ID = 'https://docs.google.com/spreadsheets/d/1TDEpz--yxg-x1lO3twfJ2Y_VJ6988Y1vaB0BKe6IfJU/edit?gid=0#gid=0';
var EMAIL_TO = 'michaelh@syte.co.za';
var TIMEZONE = 'Africa/Johannesburg';

var FLAG_WARN_PCT = 30;
var FLAG_CRITICAL_PCT = 50;
var SILENT_DAYS = 4;


function main() {
  var ss = SpreadsheetApp.openById(_extractSheetId(SHEET_ID));
  var digestSheet = ss.getSheetByName('DailyDigest');
  if (!digestSheet) { Logger.log('No DailyDigest tab found'); return; }

  var webAppUrl = _loadWebAppUrl(ss);
  var clientTiers = _loadClientTiers(ss);

  var data = digestSheet.getDataRange().getValues();
  if (data.length < 2) { Logger.log('No data in DailyDigest'); return; }

  var headers = data[0];
  var col = {};
  for (var h = 0; h < headers.length; h++) { col[headers[h]] = h; }

  var now = new Date();
  var cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  var cutoffStr = Utilities.formatDate(cutoff, TIMEZONE, 'yyyy-MM-dd');

  // === Aggregate per-client data over the 7d window ===
  var accounts = _aggregateAccounts(data, col, cutoffStr);
  var accountNames = Object.keys(accounts);
  if (accountNames.length === 0) {
    Logger.log('No DailyDigest rows in the last 7 days');
    return;
  }

  // === Calculate flags and totals ===
  var rows = [];
  var totalConvThis = 0, totalConvLast = 0, totalErrors = 0, totalActions = 0, totalTier1 = 0;
  var critical = [], warn = [], silent = [];
  var silentCutoffStr = Utilities.formatDate(
    new Date(now.getTime() - SILENT_DAYS * 24 * 60 * 60 * 1000),
    TIMEZONE, 'yyyy-MM-dd'
  );

  for (var a = 0; a < accountNames.length; a++) {
    var r = accounts[accountNames[a]];
    var drop = r.convLast > 0 ? (r.convLast - r.convThis) / r.convLast * 100 : null;
    r.dropPct = drop;
    r.totalActions = r.kwPaused + r.stNegated + r.aiNegated + r.winners +
                     r.ngramNegatives + r.lowQsPaused + r.scheduleAdj +
                     r.deviceAdj + r.geoAdj;
    r.tier = clientTiers[accountNames[a].toLowerCase()] || 'tier_1_only';

    totalConvThis += r.convThis;
    totalConvLast += r.convLast;
    totalErrors += r.errors;
    totalActions += r.totalActions;
    totalTier1 += r.tier1Applied;

    if (drop !== null && drop >= FLAG_CRITICAL_PCT && r.convLast >= 3) critical.push(r);
    else if (drop !== null && drop >= FLAG_WARN_PCT && r.convLast >= 3) warn.push(r);
    if (r.lastRunDate < silentCutoffStr) silent.push(r);
    rows.push(r);
  }

  rows.sort(function(a, b) {
    var da = a.dropPct === null ? -999 : a.dropPct;
    var db = b.dropPct === null ? -999 : b.dropPct;
    if (db !== da) return db - da;
    return a.name.localeCompare(b.name);
  });

  var overallChange = totalConvLast > 0 ? ((totalConvThis - totalConvLast) / totalConvLast * 100) : null;
  var overallColor = overallChange === null ? '#666' : (overallChange >= 0 ? '#2e7d32' : '#c62828');
  var overallArrow = overallChange === null ? '—' : (overallChange >= 0 ? '↑' : '↓');

  var today = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');
  var weekStart = Utilities.formatDate(cutoff, TIMEZONE, 'yyyy-MM-dd');

  // === Build email ===
  var email = '<html><body style="font-family:Arial,sans-serif;max-width:1100px;margin:0 auto;color:#333;">';

  // Header
  email += '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;padding:20px;border-radius:8px 8px 0 0;">';
  email += '<h1 style="margin:0;font-size:22px;">Syte Weekly Client Report</h1>';
  email += '<p style="margin:5px 0 0;opacity:0.8;">' + weekStart + '  →  ' + today +
           '  |  ' + accountNames.length + ' clients</p></div>';

  // Summary bar (now includes Tier 1 auto count)
  email += '<div style="background:#f8f9fa;padding:18px;border-bottom:1px solid #e0e5ec;">';
  email += '<table style="border:none;border-collapse:collapse;width:100%;"><tr>';
  email += _summaryCell(totalConvThis.toFixed(0), 'Conversions (7d)', overallColor);
  email += _summaryCell(overallArrow + ' ' + (overallChange === null ? 'N/A' : Math.abs(overallChange).toFixed(0) + '%'),
           'vs prior 7d (' + totalConvLast.toFixed(0) + ')', overallColor);
  email += _summaryCell(critical.length, 'Critical drops', '#c62828');
  email += _summaryCell(warn.length, 'Warning drops', '#e65100');
  email += _summaryCell(totalActions, 'Total actions', '#333');
  email += _summaryCell(totalTier1, 'Auto-applied (silent)', '#1565c0');
  if (totalErrors > 0) email += _summaryCell(totalErrors, 'Errors', '#c62828');
  email += '</tr></table></div>';

  // === Red Flags section (unchanged from v1) ===
  if (critical.length > 0 || warn.length > 0) {
    email += _renderRedFlags(critical, warn, webAppUrl);
  }

  // === NEW: Optimization Activity section ===
  email += _renderOptimizationActivity(rows, webAppUrl);

  // === NEW: Outcome Tracking section ===
  var outcomeData = _buildOutcomeTracking(ss);
  if (outcomeData) email += outcomeData;

  // === NEW: Approval Queue Status ===
  var approvalQueue = _buildApprovalQueue(ss, webAppUrl);
  if (approvalQueue) email += approvalQueue;

  // === NEW: Autopilot Breakdown ===
  email += _renderAutopilotBreakdown(rows, totalTier1, totalActions);

  // Silent clients
  if (silent.length > 0) {
    email += '<div style="padding:18px;background:#fff8e1;border-top:1px solid #ffe082;">';
    email += '<h3 style="color:#e65100;margin:0 0 8px;font-size:15px;">Silent Clients</h3>';
    email += '<p style="font-size:12px;color:#666;margin:0 0 10px;">No runs in the last ' +
             SILENT_DAYS + ' days — check that the script is still scheduled.</p>';
    email += '<ul style="font-size:13px;margin:0;padding:0 0 0 20px;">';
    for (var s = 0; s < silent.length; s++) {
      email += '<li><strong>' + _linkAccount(silent[s].name, webAppUrl) + '</strong> — last run ' +
               (silent[s].lastRunDate || 'unknown') + '</li>';
    }
    email += '</ul></div>';
  }

  // Full per-client table (kept from v1)
  email += _renderFullClientTable(rows, webAppUrl);

  // Month-on-Month
  var momHtml = _buildMonthOnMonthTable(data, col, accountNames);
  if (momHtml) email += momHtml;

  // Existing approval activity rollup (kept from v1)
  var approvalHtml = _buildApprovalSection(ss, cutoff);
  if (approvalHtml) email += approvalHtml;

  // Footer
  email += '<div style="padding:15px;color:#999;font-size:11px;text-align:center;">' +
           'Syte Digital Agency | Weekly Client Report v2.0 | syte.co.za</div>';
  email += '</body></html>';

  // Subject line
  var subjectConv = totalConvThis.toFixed(0) + ' conv';
  if (overallChange !== null) {
    subjectConv += ' (' + (overallChange >= 0 ? '+' : '') + overallChange.toFixed(0) + '%)';
  }
  var flagSuffix = '';
  if (critical.length > 0) flagSuffix = ' | ' + critical.length + ' CRITICAL';
  else if (warn.length > 0) flagSuffix = ' | ' + warn.length + ' warn';
  if (totalTier1 > 0) flagSuffix += ' | ' + totalTier1 + ' auto';

  MailApp.sendEmail({
    to: EMAIL_TO,
    subject: 'Syte Weekly Client Report | ' + today + ' | ' +
             accountNames.length + ' clients | ' + subjectConv + flagSuffix,
    htmlBody: email
  });

  Logger.log('Weekly client report v2.0 sent: ' + accountNames.length + ' clients, ' +
             critical.length + ' critical, ' + warn.length + ' warn, ' + totalTier1 + ' auto-applied');
}


// ============================================
// AGGREGATION
// ============================================

function _aggregateAccounts(data, col, cutoffStr) {
  var accounts = {};
  for (var i = 1; i < data.length; i++) {
    var dateStr = String(data[i][col['date']] || '');
    if (!dateStr || dateStr < cutoffStr) continue;
    var accountName = String(data[i][col['account']] || '').trim();
    if (!accountName) continue;

    if (!accounts[accountName]) {
      accounts[accountName] = {
        name: accountName, runs: 0, lastRunDate: '', lastRunMode: '', mode: '',
        kwPaused: 0, stNegated: 0, aiNegated: 0, aiReview: 0, winners: 0,
        audit: 0, ngramNegatives: 0, lowQsPaused: 0,
        scheduleAdj: 0, deviceAdj: 0, geoAdj: 0,
        errors: 0, convThis: 0, convLast: 0,
        tier1Applied: 0
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

    // NEW: tier1_applied (safe if column doesn't exist yet)
    if (col['tier1_applied'] !== undefined) {
      acct.tier1Applied += Number(data[i][col['tier1_applied']]) || 0;
    }

    if (dateStr >= acct.lastRunDate) {
      acct.lastRunDate = dateStr;
      acct.lastRunMode = String(data[i][col['run_mode']] || '');
      acct.mode = String(data[i][col['mode']] || '');
      acct.convThis = Number(data[i][col['conv_this_week']]) || 0;
      acct.convLast = Number(data[i][col['conv_last_week']]) || 0;
    }
  }
  return accounts;
}


// ============================================
// NEW: OPTIMIZATION ACTIVITY SECTION
// ============================================

function _renderOptimizationActivity(rows, webAppUrl) {
  // Filter to only clients with activity
  var active = rows.filter(function(r) { return r.totalActions > 0 || r.tier1Applied > 0; });
  if (active.length === 0) return '';

  // Sort by total activity (most active first)
  active.sort(function(a, b) {
    return (b.totalActions + b.tier1Applied) - (a.totalActions + a.tier1Applied);
  });

  var html = '<div style="padding:18px;border-top:1px solid #e0e5ec;">';
  html += '<h2 style="color:#1565c0;margin:0 0 10px;font-size:16px;">Optimization Activity (7d)</h2>';
  html += '<p style="font-size:12px;color:#666;margin:0 0 12px;">' +
          'Every change that ran across all clients this week. ' +
          '<strong>Auto</strong> = applied silently (Tier 1 / autopilot). ' +
          '<strong>Approved</strong> = applied after email approval. ' +
          '<strong>Pending</strong> = sitting in approval queue.</p>';

  html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<tr style="background:#bbdefb;">';
  html += '<th style="padding:8px;text-align:left;">Account</th>';
  html += '<th style="padding:8px;text-align:center;">Tier</th>';
  html += '<th style="padding:8px;text-align:right;">Auto</th>';
  html += '<th style="padding:8px;text-align:right;">KW Paused</th>';
  html += '<th style="padding:8px;text-align:right;">Negations</th>';
  html += '<th style="padding:8px;text-align:right;">Winners</th>';
  html += '<th style="padding:8px;text-align:right;">Bid Adj</th>';
  html += '<th style="padding:8px;text-align:right;">Top Action</th>';
  html += '<th style="padding:8px;text-align:right;">Total</th>';
  html += '</tr>';

  for (var i = 0; i < active.length; i++) {
    var r = active[i];
    var totalKw = r.kwPaused + r.lowQsPaused;
    var totalNeg = r.stNegated + r.aiNegated + r.ngramNegatives;
    var totalWin = r.winners;
    var totalBid = r.deviceAdj + r.scheduleAdj + r.geoAdj;
    var topAction = _getTopAction(r);
    var tierBadge = _renderTierBadge(r.tier);

    var bg = i % 2 === 0 ? '#fff' : '#f8f9fa';
    html += '<tr style="background:' + bg + ';border-bottom:1px solid #eee;">';
    html += '<td style="padding:6px 8px;font-weight:600;">' + _linkAccount(r.name, webAppUrl) + '</td>';
    html += '<td style="padding:6px 8px;text-align:center;">' + tierBadge + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:' + (r.tier1Applied > 0 ? '#1565c0' : '#999') +
            ';font-weight:' + (r.tier1Applied > 0 ? '600' : 'normal') + ';">' +
            (r.tier1Applied > 0 ? '⚡ ' + r.tier1Applied : '0') + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + totalKw + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + totalNeg + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:' + (totalWin > 0 ? '#2e7d32' : '#999') + ';">' +
            totalWin + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + totalBid + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:#666;">' + topAction + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;font-weight:600;">' +
            (r.totalActions + r.tier1Applied) + '</td>';
    html += '</tr>';
  }

  html += '</table></div>';
  return html;
}

function _getTopAction(r) {
  var counts = [
    { label: 'pauses', n: r.kwPaused + r.lowQsPaused },
    { label: 'negations', n: r.stNegated + r.aiNegated + r.ngramNegatives },
    { label: 'winners', n: r.winners },
    { label: 'bid adj', n: r.deviceAdj + r.scheduleAdj + r.geoAdj }
  ];
  counts.sort(function(a, b) { return b.n - a.n; });
  return counts[0].n > 0 ? counts[0].n + ' ' + counts[0].label : '—';
}

function _renderTierBadge(tier) {
  if (tier === 'full_autopilot') {
    return '<span style="background:#1565c0;color:white;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:600;">FULL AUTO</span>';
  } else if (tier === 'approval_required') {
    return '<span style="background:#e65100;color:white;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:600;">APPROVAL</span>';
  } else {
    return '<span style="background:#666;color:white;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:600;">TIER 1</span>';
  }
}


// ============================================
// NEW: OUTCOME TRACKING SECTION
// ============================================

/**
 * Reads ChangeLog tab and computes decision accuracy for changes
 * that have been outcome-scored (between 7 and 21 days old).
 */
function _buildOutcomeTracking(ss) {
  var sheet = ss.getSheetByName('ChangeLog');
  if (!sheet) return '';

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return '';

  var headers = data[0];
  var col = {};
  for (var h = 0; h < headers.length; h++) col[headers[h]] = h;
  if (col['outcome'] === undefined) return '';

  var now = new Date();
  var olderCutoff = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);
  var newerCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Aggregate by account: { account: { correct, incorrect, neutral, lastIncorrect } }
  var byAccount = {};
  for (var r = 1; r < data.length; r++) {
    var ts = new Date(data[r][col['timestamp']]);
    if (isNaN(ts.getTime())) continue;
    if (ts < olderCutoff || ts > newerCutoff) continue;
    var account = String(data[r][col['account_name']] || '').trim();
    if (!account) continue;
    var outcome = String(data[r][col['outcome']] || '').toUpperCase();

    if (!byAccount[account]) {
      byAccount[account] = { correct: 0, incorrect: 0, neutral: 0, lastIncorrect: null };
    }
    if (outcome === 'CORRECT') byAccount[account].correct++;
    else if (outcome === 'INCORRECT') {
      byAccount[account].incorrect++;
      byAccount[account].lastIncorrect = {
        entity: data[r][col['entity']],
        reason: data[r][col['reason']],
        notes: data[r][col['outcome_notes']]
      };
    }
    else if (outcome === 'NEUTRAL') byAccount[account].neutral++;
  }

  var accounts = Object.keys(byAccount);
  if (accounts.length === 0) return '';

  // Compute accuracy and sort (worst first to surface issues)
  var rows = accounts.map(function(a) {
    var d = byAccount[a];
    var scored = d.correct + d.incorrect;
    var accuracy = scored > 0 ? (d.correct / scored * 100) : null;
    return {
      account: a,
      correct: d.correct,
      incorrect: d.incorrect,
      neutral: d.neutral,
      total: scored + d.neutral,
      accuracy: accuracy,
      lastIncorrect: d.lastIncorrect
    };
  });
  rows.sort(function(a, b) {
    var aa = a.accuracy === null ? 100 : a.accuracy;
    var bb = b.accuracy === null ? 100 : b.accuracy;
    return aa - bb;
  });

  var totalCorrect = 0, totalIncorrect = 0, totalNeutral = 0;
  rows.forEach(function(r) { totalCorrect += r.correct; totalIncorrect += r.incorrect; totalNeutral += r.neutral; });
  var overallAccuracy = (totalCorrect + totalIncorrect) > 0
    ? (totalCorrect / (totalCorrect + totalIncorrect) * 100).toFixed(0)
    : 'N/A';

  var html = '<div style="padding:18px;border-top:1px solid #e0e5ec;background:#fafbfc;">';
  html += '<h2 style="color:#1565c0;margin:0 0 10px;font-size:16px;">Outcome Tracking — Was the script right?</h2>';
  html += '<p style="font-size:12px;color:#666;margin:0 0 12px;">' +
          'Decision accuracy for changes made 7-21 days ago. ' +
          '<strong>Correct</strong> = the pause/negate held up (no missed conversions). ' +
          '<strong>Incorrect</strong> = the change blocked something it shouldn\'t have. ' +
          'Overall accuracy this period: <strong>' + overallAccuracy + '%</strong></p>';

  html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<tr style="background:#bbdefb;">';
  html += '<th style="padding:8px;text-align:left;">Account</th>';
  html += '<th style="padding:8px;text-align:right;">Correct</th>';
  html += '<th style="padding:8px;text-align:right;">Incorrect</th>';
  html += '<th style="padding:8px;text-align:right;">Neutral</th>';
  html += '<th style="padding:8px;text-align:right;">Accuracy</th>';
  html += '<th style="padding:8px;text-align:left;">Last Mistake</th>';
  html += '</tr>';

  for (var i = 0; i < rows.length; i++) {
    var rr = rows[i];
    var accColor = rr.accuracy === null ? '#999' :
                   rr.accuracy >= 80 ? '#2e7d32' :
                   rr.accuracy >= 60 ? '#e65100' : '#c62828';
    var accText = rr.accuracy === null ? '—' : rr.accuracy.toFixed(0) + '%';
    var lastMistake = rr.lastIncorrect ?
      '<span style="color:#666;">' + String(rr.lastIncorrect.entity || '').substring(0, 40) + '</span>' :
      '<span style="color:#999;">none</span>';

    var bg = i % 2 === 0 ? '#fff' : '#f8f9fa';
    html += '<tr style="background:' + bg + ';border-bottom:1px solid #eee;">';
    html += '<td style="padding:6px 8px;font-weight:600;">' + rr.account + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:#2e7d32;">' + rr.correct + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:' + (rr.incorrect > 0 ? '#c62828' : '#999') + ';">' + rr.incorrect + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:#999;">' + rr.neutral + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;font-weight:600;color:' + accColor + ';">' + accText + '</td>';
    html += '<td style="padding:6px 8px;font-size:11px;">' + lastMistake + '</td>';
    html += '</tr>';
  }
  html += '</table></div>';
  return html;
}


// ============================================
// NEW: APPROVAL QUEUE STATUS
// ============================================

function _buildApprovalQueue(ss, webAppUrl) {
  var sheet = ss.getSheetByName('PendingChanges');
  if (!sheet) return '';

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return '';

  var headers = data[0];
  var col = {};
  for (var h = 0; h < headers.length; h++) col[headers[h]] = h;

  var now = new Date();
  var pending = [];

  for (var r = 1; r < data.length; r++) {
    var status = String(data[r][col['status']] || '').trim();
    if (status !== 'PENDING') continue;
    var approvedCats = String(data[r][col['approved_categories']] || '').trim();
    if (approvedCats) continue; // already approved, just not yet applied

    var ts = new Date(data[r][col['timestamp']]);
    if (isNaN(ts.getTime())) continue;
    var daysWaiting = Math.floor((now - ts) / (24 * 60 * 60 * 1000));

    var changesJson = String(data[r][col['changes_json']] || '');
    var changeCount = 0;
    try {
      var parsed = JSON.parse(changesJson);
      Object.keys(parsed).forEach(function(cat) {
        Object.keys(parsed[cat] || {}).forEach(function(arr) {
          if (Array.isArray(parsed[cat][arr])) changeCount += parsed[cat][arr].length;
        });
      });
    } catch (e) { /* ignore */ }

    pending.push({
      runId: data[r][col['run_id']],
      account: data[r][col['account_name']],
      daysWaiting: daysWaiting,
      changeCount: changeCount,
      timestamp: data[r][col['timestamp']]
    });
  }

  if (pending.length === 0) return '';

  // Sort by oldest first
  pending.sort(function(a, b) { return b.daysWaiting - a.daysWaiting; });

  var html = '<div style="padding:18px;background:#fff3e0;border-top:1px solid #ffcc80;">';
  html += '<h2 style="color:#e65100;margin:0 0 10px;font-size:16px;">Approval Queue — ' + pending.length + ' pending</h2>';
  html += '<p style="font-size:12px;color:#666;margin:0 0 12px;">' +
          'These changes are sitting in the approval queue. They expire after 7 days if not actioned.</p>';

  html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<tr style="background:#ffe0b2;">';
  html += '<th style="padding:8px;text-align:left;">Account</th>';
  html += '<th style="padding:8px;text-align:right;">Changes</th>';
  html += '<th style="padding:8px;text-align:right;">Days Waiting</th>';
  html += '<th style="padding:8px;text-align:left;">Run ID</th>';
  html += '</tr>';

  for (var p = 0; p < pending.length; p++) {
    var pp = pending[p];
    var dayColor = pp.daysWaiting >= 5 ? '#c62828' :
                   pp.daysWaiting >= 3 ? '#e65100' : '#666';
    var bg = p % 2 === 0 ? '#fff' : '#fffaf0';

    html += '<tr style="background:' + bg + ';border-bottom:1px solid #ffe0b2;">';
    html += '<td style="padding:6px 8px;font-weight:600;">' + _linkAccount(pp.account, webAppUrl) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;font-weight:600;">' + pp.changeCount + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:' + dayColor + ';font-weight:600;">' + pp.daysWaiting + 'd</td>';
    html += '<td style="padding:6px 8px;font-family:monospace;font-size:10px;color:#999;">' + pp.runId + '</td>';
    html += '</tr>';
  }
  html += '</table></div>';
  return html;
}


// ============================================
// NEW: AUTOPILOT BREAKDOWN
// ============================================

function _renderAutopilotBreakdown(rows, totalTier1, totalActions) {
  var totalAll = totalTier1 + totalActions;
  if (totalAll === 0) return '';

  var pctAuto = totalTier1 > 0 ? (totalTier1 / totalAll * 100).toFixed(0) : 0;
  var pctApproved = totalActions > 0 ? (totalActions / totalAll * 100).toFixed(0) : 0;

  // Count clients by tier
  var tierCounts = { full_autopilot: 0, tier_1_only: 0, approval_required: 0 };
  rows.forEach(function(r) {
    var t = r.tier || 'tier_1_only';
    if (tierCounts[t] !== undefined) tierCounts[t]++;
  });

  var html = '<div style="padding:18px;background:#f3f8ff;border-top:1px solid #bbdefb;">';
  html += '<h2 style="color:#1565c0;margin:0 0 10px;font-size:16px;">⚡ Autopilot Breakdown</h2>';
  html += '<table style="border:none;border-collapse:collapse;width:100%;"><tr>';
  html += _summaryCell(totalTier1, 'Auto-applied (silent)', '#1565c0');
  html += _summaryCell(pctAuto + '%', 'of all changes', '#1565c0');
  html += _summaryCell(tierCounts.full_autopilot, 'Full autopilot clients', '#1565c0');
  html += _summaryCell(tierCounts.tier_1_only, 'Tier 1 only clients', '#666');
  html += _summaryCell(tierCounts.approval_required, 'Approval required clients', '#e65100');
  html += '</tr></table>';
  html += '<p style="font-size:12px;color:#666;margin:12px 0 0;">' +
          'To promote a client to full autopilot, edit the <strong>ClientConfig</strong> tab in the master sheet ' +
          'and set their <code>automation_tier</code> to <code>full_autopilot</code>.</p>';
  html += '</div>';
  return html;
}


// ============================================
// CLIENT TIER LOADING
// ============================================

function _loadClientTiers(ss) {
  var tiers = {};
  var sheet = ss.getSheetByName('ClientConfig');
  if (!sheet) return tiers;
  try {
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return tiers;
    var headers = data[0];
    var col = {};
    for (var h = 0; h < headers.length; h++) col[String(headers[h]).trim()] = h;
    if (col['client_name'] === undefined || col['automation_tier'] === undefined) return tiers;

    for (var r = 1; r < data.length; r++) {
      var name = String(data[r][col['client_name']] || '').trim().toLowerCase();
      var tier = String(data[r][col['automation_tier']] || '').trim().toLowerCase();
      if (name && tier) tiers[name] = tier;
    }
  } catch (e) {
    Logger.log('Could not load ClientConfig: ' + e.message);
  }
  return tiers;
}


// ============================================
// HELPERS (kept from v1 + small additions)
// ============================================

function _summaryCell(value, label, color) {
  return '<td style="padding:0 25px 0 0;"><strong style="font-size:26px;color:' + color + ';">' +
         value + '</strong><br><span style="font-size:12px;color:#666;">' + label + '</span></td>';
}

function _renderRedFlags(critical, warn, webAppUrl) {
  var html = '<div style="padding:18px;background:#ffebee;border-top:1px solid #ef9a9a;">';
  html += '<h2 style="color:#c62828;margin:0 0 10px;font-size:16px;">Red Flags — Conversion Drops</h2>';
  html += '<p style="font-size:12px;color:#666;margin:0 0 12px;">' +
          'Clients where weekly conversions fell materially vs the prior week. ' +
          'Review for tracking issues, budget pacing, creative fatigue, or paused campaigns.</p>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
  html += '<tr style="background:#ffcdd2;"><th style="padding:8px;text-align:left;">Flag</th>' +
          '<th style="padding:8px;text-align:left;">Account</th>' +
          '<th style="padding:8px;text-align:right;">This Week</th>' +
          '<th style="padding:8px;text-align:right;">Last Week</th>' +
          '<th style="padding:8px;text-align:right;">Drop</th>' +
          '<th style="padding:8px;text-align:right;">Errors</th></tr>';

  var flagged = critical.concat(warn);
  for (var f = 0; f < flagged.length; f++) {
    var fr = flagged[f];
    var isCritical = fr.dropPct >= FLAG_CRITICAL_PCT;
    var badge = isCritical
      ? '<span style="background:#c62828;color:white;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">CRITICAL</span>'
      : '<span style="background:#e65100;color:white;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">WARN</span>';
    html += '<tr style="background:' + (f % 2 === 0 ? '#fff' : '#fff5f5') + ';border-bottom:1px solid #ffcdd2;">';
    html += '<td style="padding:6px 8px;">' + badge + '</td>';
    html += '<td style="padding:6px 8px;font-weight:600;">' + _linkAccount(fr.name, webAppUrl) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + fr.convThis.toFixed(0) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + fr.convLast.toFixed(0) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:#c62828;font-weight:600;">↓ ' + fr.dropPct.toFixed(0) + '%</td>';
    html += '<td style="padding:6px 8px;text-align:right;' +
            (fr.errors > 0 ? 'color:#c62828;font-weight:600;' : 'color:#999;') + '">' + fr.errors + '</td>';
    html += '</tr>';
  }
  html += '</table></div>';
  return html;
}

function _renderFullClientTable(rows, webAppUrl) {
  var html = '<div style="padding:18px;">';
  html += '<h3 style="margin:0 0 10px;font-size:15px;">All Clients (sorted by biggest drop)</h3>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<tr style="background:#e3f2fd;">';
  html += '<th style="padding:8px;text-align:left;">Account</th>';
  html += '<th style="padding:8px;text-align:center;">Mode</th>';
  html += '<th style="padding:8px;text-align:right;">Runs</th>';
  html += '<th style="padding:8px;text-align:right;">Conv 7d</th>';
  html += '<th style="padding:8px;text-align:right;">Prev 7d</th>';
  html += '<th style="padding:8px;text-align:right;">Δ</th>';
  html += '<th style="padding:8px;text-align:right;">KW Paused</th>';
  html += '<th style="padding:8px;text-align:right;">Negated</th>';
  html += '<th style="padding:8px;text-align:right;">Winners</th>';
  html += '<th style="padding:8px;text-align:right;">Auto</th>';
  html += '<th style="padding:8px;text-align:right;">Errors</th>';
  html += '</tr>';

  for (var rr = 0; rr < rows.length; rr++) {
    var row = rows[rr];
    var hasErrors = row.errors > 0;
    var dropText, dropColor;
    if (row.dropPct === null) { dropText = '—'; dropColor = '#999'; }
    else if (row.dropPct >= FLAG_CRITICAL_PCT && row.convLast >= 3) { dropText = '↓ ' + row.dropPct.toFixed(0) + '%'; dropColor = '#c62828'; }
    else if (row.dropPct >= FLAG_WARN_PCT && row.convLast >= 3) { dropText = '↓ ' + row.dropPct.toFixed(0) + '%'; dropColor = '#e65100'; }
    else if (row.dropPct > 0) { dropText = '↓ ' + row.dropPct.toFixed(0) + '%'; dropColor = '#666'; }
    else if (row.dropPct < 0) { dropText = '↑ ' + Math.abs(row.dropPct).toFixed(0) + '%'; dropColor = '#2e7d32'; }
    else { dropText = '0%'; dropColor = '#666'; }

    var rowBg = hasErrors ? '#ffebee' : (rr % 2 === 0 ? '#fff' : '#fafbfc');
    var totalNegated = row.stNegated + row.aiNegated + row.ngramNegatives;
    var totalKw = row.kwPaused + row.lowQsPaused;

    html += '<tr style="background:' + rowBg + ';border-bottom:1px solid #eee;">';
    html += '<td style="padding:6px 8px;font-weight:600;">' + _linkAccount(row.name, webAppUrl) + '</td>';
    html += '<td style="padding:6px 8px;text-align:center;font-size:11px;color:#666;">' + row.mode + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + row.runs + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;font-weight:600;">' + row.convThis.toFixed(0) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:#666;">' + row.convLast.toFixed(0) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;font-weight:600;color:' + dropColor + ';">' + dropText + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + totalKw + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + totalNegated + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:#2e7d32;">' + row.winners + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:' + (row.tier1Applied > 0 ? '#1565c0' : '#999') + ';">⚡ ' + row.tier1Applied + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;' +
            (hasErrors ? 'color:#c62828;font-weight:600;' : 'color:#999;') + '">' + row.errors + '</td>';
    html += '</tr>';
  }
  html += '</table></div>';
  return html;
}

function _loadWebAppUrl(ss) {
  try {
    var configSheet = ss.getSheetByName('Config');
    if (!configSheet) return '';
    var data = configSheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      var key = String(data[i][0] || '').trim();
      var val = String(data[i][1] || '').trim();
      if (key === 'APPROVAL_WEBAPP_URL' && val) return val;
    }
  } catch (e) {
    Logger.log('Could not read Config tab: ' + e.message);
  }
  return '';
}

function _linkAccount(name, webAppUrl) {
  var safe = String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!webAppUrl) return safe;
  var url = webAppUrl + (webAppUrl.indexOf('?') >= 0 ? '&' : '?') +
            'view=client&account=' + encodeURIComponent(name);
  return '<a href="' + url + '" style="color:#1565c0;text-decoration:none;">' + safe + '</a>';
}

function _extractSheetId(idOrUrl) {
  if (!idOrUrl) throw new Error('SHEET_ID is not set');
  var s = String(idOrUrl).trim();
  var m = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : s;
}

function _buildMonthOnMonthTable(data, col, activeAccounts) {
  if (col['cost_30d'] === undefined) return '';
  var byAccountMonth = {};
  for (var i = 1; i < data.length; i++) {
    var dateStr = String(data[i][col['date']] || '');
    if (!dateStr || dateStr.length < 7) continue;
    var account = String(data[i][col['account']] || '').trim();
    if (!account) continue;
    var monthKey = dateStr.substring(0, 7);
    var cost = Number(data[i][col['cost_30d']]) || 0;
    var conv = Number(data[i][col['conversions_30d']]) || 0;
    var rev = Number(data[i][col['revenue_30d']]) || 0;
    var clicks = Number(data[i][col['clicks_30d']]) || 0;
    if (cost === 0 && conv === 0 && clicks === 0) continue;
    if (!byAccountMonth[account]) byAccountMonth[account] = {};
    if (!byAccountMonth[account][monthKey] || dateStr > byAccountMonth[account][monthKey].date) {
      byAccountMonth[account][monthKey] = { date: dateStr, cost: cost, conv: conv, rev: rev, clicks: clicks };
    }
  }
  var accountList = Object.keys(byAccountMonth);
  if (accountList.length === 0) return '';
  var now = new Date();
  var curYear = now.getFullYear(), curMonth = now.getMonth() + 1;
  var prevMonth = curMonth === 1 ? 12 : curMonth - 1;
  var prevYear = curMonth === 1 ? curYear - 1 : curYear;
  var curKey = curYear + '-' + (curMonth < 10 ? '0' : '') + curMonth;
  var prevKey = prevYear + '-' + (prevMonth < 10 ? '0' : '') + prevMonth;
  var curMonthLabel = Utilities.formatDate(now, TIMEZONE, 'MMM yyyy');
  var prevDate = new Date(prevYear, prevMonth - 1, 1);
  var prevMonthLabel = Utilities.formatDate(prevDate, TIMEZONE, 'MMM yyyy');

  var html = '<div style="padding:15px;">';
  html += '<h3 style="margin:0 0 10px;color:#1565c0;">Month-on-Month Performance</h3>';
  html += '<p style="font-size:12px;color:#666;margin:0 0 8px;">Comparing latest 30-day snapshot per month. ' + prevMonthLabel + ' vs ' + curMonthLabel + '.</p>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<tr style="background:#e3f2fd;"><th style="padding:8px;text-align:left;">Client</th>';
  html += '<th style="padding:8px;text-align:right;">Cost (' + prevMonthLabel + ')</th>';
  html += '<th style="padding:8px;text-align:right;">Cost (' + curMonthLabel + ')</th>';
  html += '<th style="padding:8px;text-align:right;">Δ</th>';
  html += '<th style="padding:8px;text-align:right;">Conv (' + prevMonthLabel + ')</th>';
  html += '<th style="padding:8px;text-align:right;">Conv (' + curMonthLabel + ')</th>';
  html += '<th style="padding:8px;text-align:right;">Δ</th>';
  html += '<th style="padding:8px;text-align:right;">Revenue (' + prevMonthLabel + ')</th>';
  html += '<th style="padding:8px;text-align:right;">Revenue (' + curMonthLabel + ')</th>';
  html += '<th style="padding:8px;text-align:right;">Δ</th></tr>';

  accountList.sort();
  var hasData = false;
  for (var a = 0; a < accountList.length; a++) {
    var acct = accountList[a];
    var months = byAccountMonth[acct];
    var cur = months[curKey] || null, prev = months[prevKey] || null;
    if (!cur && !prev) continue;
    hasData = true;
    var curCost = cur ? cur.cost : 0, prevCost = prev ? prev.cost : 0;
    var curConv = cur ? cur.conv : 0, prevConv = prev ? prev.conv : 0;
    var curRev = cur ? cur.rev : 0, prevRev = prev ? prev.rev : 0;
    var costDelta = prevCost > 0 ? ((curCost - prevCost) / prevCost * 100) : (curCost > 0 ? 100 : 0);
    var convDelta = prevConv > 0 ? ((curConv - prevConv) / prevConv * 100) : (curConv > 0 ? 100 : 0);
    var revDelta = prevRev > 0 ? ((curRev - prevRev) / prevRev * 100) : (curRev > 0 ? 100 : 0);
    var cs = 'R';
    html += '<tr style="border-bottom:1px solid #eee;">';
    html += '<td style="padding:6px 8px;font-weight:600;">' + acct + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + cs + prevCost.toFixed(0) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + cs + curCost.toFixed(0) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:' + (costDelta > 5 ? '#c62828' : costDelta < -5 ? '#2e7d32' : '#999') + ';">' +
            (costDelta >= 0 ? '+' : '') + costDelta.toFixed(0) + '%</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + prevConv.toFixed(1) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + curConv.toFixed(1) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:' + (convDelta >= 5 ? '#2e7d32' : convDelta <= -5 ? '#c62828' : '#999') + ';">' +
            (convDelta >= 0 ? '+' : '') + convDelta.toFixed(0) + '%</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + cs + prevRev.toFixed(0) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + cs + curRev.toFixed(0) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:' + (revDelta >= 5 ? '#2e7d32' : revDelta <= -5 ? '#c62828' : '#999') + ';">' +
            (revDelta >= 0 ? '+' : '') + revDelta.toFixed(0) + '%</td>';
    html += '</tr>';
  }
  html += '</table>';
  if (!hasData) html += '<p style="font-size:12px;color:#999;">No performance data available yet.</p>';
  html += '</div>';
  return html;
}

function _buildApprovalSection(ss, cutoff) {
  var sheet = ss.getSheetByName('PendingChanges');
  if (!sheet) return '';
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return '';
  var headers = data[0];
  var col = {};
  for (var j = 0; j < headers.length; j++) col[headers[j]] = j;
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
  html += _summaryCell(applied, 'Approved & Applied', '#2e7d32');
  html += _summaryCell(expired, 'Expired (Ignored)', '#c62828');
  html += _summaryCell(pending, 'Still Pending', '#e65100');
  html += '</tr></table></div>';
  return html;
}
