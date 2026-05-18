/**
 * SYTE DAILY DIGEST — Consolidated Report
 * ========================================
 * Reads today's run summaries from the DailyDigest tab in the master sheet
 * and sends ONE email with all accounts' performance.
 *
 * v2.0 NEW:
 *   - Per-client anomaly detection: today's conv_this_week vs that client's
 *     trailing 14-day baseline (median). Flags both drops AND spikes.
 *   - Orphan-account section: if installed in the Syte MCC, iterates all
 *     sub-accounts, finds any with spend in the last day that DON'T have a
 *     DailyDigest row in the last 7 days = script not installed / not running.
 *
 * This is a STANDALONE Google Ads Script — not loaded via the core.
 * Install it at the MCC level (not a sub-account) so the orphan section works.
 * Without MCC access the orphan section is skipped gracefully.
 *
 * Setup:
 * 1. Paste into Google Ads Scripts in the Syte MCC (preferred) OR any account.
 *    The script auto-detects MCC mode via AdsManagerApp.
 * 2. Set SHEET_ID to your master Google Sheet ID
 * 3. Set EMAIL_TO to the recipient(s)
 * 4. Schedule daily at 9am (after all client scripts have run)
 * 5. Authorize Sheets access (and AdsManager access at MCC install time)
 */

var SHEET_ID = 'PASTE_SHEET_ID_HERE';  // Master Google Sheet ID
var EMAIL_TO = 'michaelh@syte.co.za';
var TIMEZONE = 'Africa/Johannesburg';

// Anomaly thresholds (vs trailing 14-day median of conv_this_week per account)
var ANOMALY_DROP_PCT = 30;    // Today < baseline * (1 - 0.30) -> flag as drop
var ANOMALY_SPIKE_PCT = 50;   // Today > baseline * (1 + 0.50) -> flag as spike
var BASELINE_WINDOW_DAYS = 14;
var BASELINE_MIN_SAMPLES = 3; // Need at least 3 prior data points to call anomaly

// Orphan detection: an account is an "orphan" if it spent in the last day
// but has no DailyDigest row in the last N days.
var ORPHAN_LOOKBACK_DAYS = 7;

function main() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('DailyDigest');
  if (!sheet) { Logger.log('No DailyDigest tab found'); return; }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) { Logger.log('No data in DailyDigest'); return; }

  var headers = data[0];
  var today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');

  // Filter to today's rows
  var todayRows = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === today) {
      var row = {};
      for (var j = 0; j < headers.length; j++) {
        row[headers[j]] = data[i][j];
      }
      todayRows.push(row);
    }
  }

  if (todayRows.length === 0) {
    Logger.log('No runs found for today (' + today + ')');
    return;
  }

  // === Compute anomalies per account ===
  var anomalies = _detectAnomalies(todayRows, data, headers, today);

  // === Find orphan accounts (MCC mode only) ===
  var orphans = _findOrphanAccounts(data, headers);

  // Build email
  var email = '<html><body style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;color:#333;">';
  email += '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;padding:20px;border-radius:8px 8px 0 0;">';
  email += '<h1 style="margin:0;font-size:20px;">Syte Daily Digest</h1>';
  email += '<p style="margin:5px 0 0;opacity:0.8;">' + today + ' | ' + todayRows.length + ' accounts processed</p></div>';

  // Summary totals
  var totals = { kwPaused: 0, stNegated: 0, aiNegated: 0, aiReview: 0, winners: 0,
                 audit: 0, errors: 0, convThis: 0, convLast: 0 };

  for (var i = 0; i < todayRows.length; i++) {
    var r = todayRows[i];
    totals.kwPaused += Number(r.keywords_paused) || 0;
    totals.stNegated += Number(r.search_terms_negated) || 0;
    totals.aiNegated += Number(r.ai_negated) || 0;
    totals.aiReview += Number(r.ai_review) || 0;
    totals.winners += Number(r.winners_promoted) || 0;
    totals.audit += Number(r.audit_findings) || 0;
    totals.errors += Number(r.errors) || 0;
    totals.convThis += Number(r.conv_this_week) || 0;
    totals.convLast += Number(r.conv_last_week) || 0;
  }

  var convChange = totals.convLast > 0 ? ((totals.convThis - totals.convLast) / totals.convLast * 100).toFixed(0) : 'N/A';
  var convColor = totals.convThis >= totals.convLast ? '#2e7d32' : '#c62828';

  // Totals bar
  email += '<div style="background:#f8f9fa;padding:15px;border-bottom:1px solid #e0e5ec;">';
  email += '<table style="border:none;border-collapse:collapse;"><tr>';
  email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;color:' + convColor + ';">' + totals.convThis.toFixed(0) + '</strong><br><span style="font-size:12px;color:#666;">Conv this week</span></td>';
  email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;">' + convChange + '%</strong><br><span style="font-size:12px;color:#666;">vs last week</span></td>';
  email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;color:#2d6cdf;">' + totals.aiNegated + '</strong><br><span style="font-size:12px;color:#666;">AI negated</span></td>';
  email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;color:#e65100;">' + totals.aiReview + '</strong><br><span style="font-size:12px;color:#666;">Need review</span></td>';
  email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;">' + totals.winners + '</strong><br><span style="font-size:12px;color:#666;">Winners</span></td>';
  if (totals.errors > 0) email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;color:#c62828;">' + totals.errors + '</strong><br><span style="font-size:12px;color:#666;">Errors</span></td>';
  email += '</tr></table></div>';

  // === ANOMALIES SECTION (drops + spikes vs per-account 14d baseline) ===
  if (anomalies.length > 0) {
    email += _renderAnomaliesSection(anomalies);
  }

  // Per-account table (with anomaly badges inline)
  var anomalyByAccount = {};
  for (var ai = 0; ai < anomalies.length; ai++) anomalyByAccount[anomalies[ai].account] = anomalies[ai];

  email += '<div style="padding:15px;"><table style="width:100%;border-collapse:collapse;font-size:12px;">';
  email += '<tr style="background:#e3f2fd;">';
  email += '<th style="padding:8px;text-align:left;">Account</th>';
  email += '<th style="padding:8px;text-align:center;">Mode</th>';
  email += '<th style="padding:8px;text-align:center;">Run</th>';
  email += '<th style="padding:8px;text-align:right;">Conv</th>';
  email += '<th style="padding:8px;text-align:right;">vs Baseline</th>';
  email += '<th style="padding:8px;text-align:right;">AI Neg</th>';
  email += '<th style="padding:8px;text-align:right;">Review</th>';
  email += '<th style="padding:8px;text-align:right;">KW Paused</th>';
  email += '<th style="padding:8px;text-align:right;">Winners</th>';
  email += '<th style="padding:8px;text-align:right;">Audit</th>';
  email += '<th style="padding:8px;text-align:right;">Errors</th>';
  email += '<th style="padding:8px;text-align:right;">Time</th>';
  email += '</tr>';

  for (var i = 0; i < todayRows.length; i++) {
    var r = todayRows[i];
    var isPreview = r.run_mode === 'PREVIEW';
    var hasErrors = (Number(r.errors) || 0) > 0;
    var anom = anomalyByAccount[r.account];
    var rowBg = hasErrors ? '#ffebee'
              : anom && anom.severity === 'drop' ? '#fff5f5'
              : anom && anom.severity === 'spike' ? '#f1f8e9'
              : (i % 2 === 0 ? '#fff' : '#fafbfc');
    var convW = Number(r.conv_this_week) || 0;
    var convL = Number(r.conv_last_week) || 0;
    var convTrend = convL > 0 ? (convW >= convL ? '↑' : '↓') : '—';
    var convTrendColor = convW >= convL ? '#2e7d32' : '#c62828';

    var baselineCell = '<span style="color:#bbb;">—</span>';
    if (anom) {
      var sign = anom.deltaPct >= 0 ? '+' : '';
      var color = anom.severity === 'drop' ? '#c62828' : anom.severity === 'spike' ? '#2e7d32' : '#666';
      baselineCell = '<span style="color:' + color + ';font-weight:600;">' + sign + anom.deltaPct.toFixed(0) + '%</span>'
                   + ' <span style="font-size:10px;color:#888;">(med ' + anom.baseline.toFixed(0) + ')</span>';
    }

    email += '<tr style="background:' + rowBg + ';border-bottom:1px solid #eee;">';
    email += '<td style="padding:6px 8px;font-weight:600;">' + r.account + (anom ? ' ' + _anomalyBadge(anom.severity) : '') + '</td>';
    email += '<td style="padding:6px 8px;text-align:center;font-size:11px;">' + r.mode + '</td>';
    email += '<td style="padding:6px 8px;text-align:center;"><span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;background:' + (isPreview ? '#fff3e0;color:#e65100' : '#e8f5e9;color:#2e7d32') + ';">' + r.run_mode + '</span></td>';
    email += '<td style="padding:6px 8px;text-align:right;">' + convW.toFixed(0) + ' <span style="color:' + convTrendColor + ';">' + convTrend + '</span></td>';
    email += '<td style="padding:6px 8px;text-align:right;">' + baselineCell + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;">' + (Number(r.ai_negated) || 0) + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;color:#e65100;font-weight:' + ((Number(r.ai_review) || 0) > 0 ? '600' : '400') + ';">' + (Number(r.ai_review) || 0) + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;">' + (Number(r.keywords_paused) || 0) + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;color:#2e7d32;">' + (Number(r.winners_promoted) || 0) + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;">' + (Number(r.audit_findings) || 0) + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;' + (hasErrors ? 'color:#c62828;font-weight:600;' : '') + '">' + (Number(r.errors) || 0) + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;font-size:11px;color:#888;">' + r.duration_s + 's</td>';
    email += '</tr>';
  }

  email += '</table></div>';

  // === ORPHAN ACCOUNTS SECTION (MCC mode only) ===
  if (orphans.mode === 'mcc') {
    email += _renderOrphansSection(orphans);
  } else if (orphans.mode === 'unsupported') {
    email += '<div style="padding:10px 15px;background:#f8f9fa;color:#888;font-size:11px;border-top:1px solid #eee;">'
          + 'Orphan-account detection requires running this script at the MCC level (AdsManagerApp not available in current context).'
          + '</div>';
  }

  // Accounts needing attention (kept — different signal: errors / review backlog)
  var attention = todayRows.filter(function(r) {
    return (Number(r.errors) || 0) > 0 ||
           (Number(r.ai_review) || 0) > 10;
  });

  if (attention.length > 0) {
    email += '<div style="padding:15px;background:#fff8e1;border-top:1px solid #ffe082;">';
    email += '<h3 style="color:#e65100;margin:0 0 10px;">Needs Attention (' + attention.length + ' accounts)</h3>';
    email += '<ul style="font-size:13px;margin:0;padding:0 0 0 20px;">';
    for (var a = 0; a < attention.length; a++) {
      var ra = attention[a];
      var issues = [];
      if ((Number(ra.errors) || 0) > 0) issues.push(ra.errors + ' errors');
      if ((Number(ra.ai_review) || 0) > 10) issues.push(ra.ai_review + ' terms need review');
      email += '<li><strong>' + ra.account + '</strong> — ' + issues.join(', ') + '</li>';
    }
    email += '</ul></div>';
  }

  email += '<div style="padding:15px;color:#999;font-size:11px;text-align:center;">Syte Digital Agency | Daily Digest | syte.co.za</div>';
  email += '</body></html>';

  // Subject line surfaces the most urgent signal
  var subjectBits = [today, todayRows.length + ' accts', totals.convThis.toFixed(0) + ' conv'];
  var drops = anomalies.filter(function(a) { return a.severity === 'drop'; }).length;
  if (drops > 0) subjectBits.push('⚠ ' + drops + ' drop' + (drops > 1 ? 's' : ''));
  if (orphans.mode === 'mcc' && orphans.list.length > 0) subjectBits.push(orphans.list.length + ' orphan' + (orphans.list.length > 1 ? 's' : ''));

  MailApp.sendEmail({
    to: EMAIL_TO,
    subject: 'Syte Daily Digest | ' + subjectBits.join(' | '),
    htmlBody: email
  });

  Logger.log('Daily digest sent: ' + todayRows.length + ' accounts, ' + anomalies.length + ' anomalies, ' + (orphans.list ? orphans.list.length : 0) + ' orphans');
}


// ============================================
// ANOMALY DETECTION
// ============================================

/**
 * For each account that ran today, compare today's conv_this_week to the
 * median of the prior BASELINE_WINDOW_DAYS days of conv_this_week values
 * for that same account.
 *
 * Returns an array of { account, today, baseline, deltaPct, severity }
 * where severity is 'drop' | 'spike' | 'normal'. Only drops and spikes
 * are returned — normal accounts are omitted.
 */
function _detectAnomalies(todayRows, data, headers, todayStr) {
  // Build header index
  var colIdx = {};
  for (var h = 0; h < headers.length; h++) colIdx[headers[h]] = h;
  if (colIdx['account'] === undefined || colIdx['conv_this_week'] === undefined) return [];

  // Compute cutoff date (start of baseline window)
  var todayDate = _parseSheetDate(todayStr);
  var cutoff = new Date(todayDate.getTime() - BASELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Group historical conv_this_week per account (excluding today)
  var byAcct = {};
  for (var i = 1; i < data.length; i++) {
    var dateStr = String(data[i][0]);
    if (dateStr === todayStr) continue;
    var rowDate = _parseSheetDate(dateStr);
    if (!rowDate || rowDate < cutoff) continue;
    var acct = data[i][colIdx['account']];
    if (!acct) continue;
    var conv = Number(data[i][colIdx['conv_this_week']]);
    if (isNaN(conv)) continue;
    if (!byAcct[acct]) byAcct[acct] = [];
    byAcct[acct].push(conv);
  }

  var anomalies = [];
  for (var t = 0; t < todayRows.length; t++) {
    var r = todayRows[t];
    var history = byAcct[r.account] || [];
    if (history.length < BASELINE_MIN_SAMPLES) continue;

    var baseline = _median(history);
    var todayConv = Number(r.conv_this_week) || 0;

    // Avoid divide-by-zero noise: if baseline is 0, only flag if today is > 5 leads
    if (baseline === 0) {
      if (todayConv >= 5) {
        anomalies.push({ account: r.account, today: todayConv, baseline: 0, deltaPct: 100, severity: 'spike' });
      }
      continue;
    }

    var deltaPct = ((todayConv - baseline) / baseline) * 100;
    var severity = 'normal';
    if (deltaPct <= -ANOMALY_DROP_PCT) severity = 'drop';
    else if (deltaPct >= ANOMALY_SPIKE_PCT) severity = 'spike';

    if (severity !== 'normal') {
      anomalies.push({ account: r.account, today: todayConv, baseline: baseline, deltaPct: deltaPct, severity: severity });
    }
  }

  // Drops first, biggest drop on top
  anomalies.sort(function(a, b) {
    if (a.severity !== b.severity) return a.severity === 'drop' ? -1 : 1;
    return a.deltaPct - b.deltaPct;
  });

  return anomalies;
}

function _renderAnomaliesSection(anomalies) {
  var drops = anomalies.filter(function(a) { return a.severity === 'drop'; });
  var spikes = anomalies.filter(function(a) { return a.severity === 'spike'; });

  var html = '<div style="padding:15px;background:#fafafa;border-top:1px solid #eee;border-bottom:1px solid #eee;">';
  html += '<h3 style="margin:0 0 10px;color:#1a1a2e;font-size:14px;">Lead Anomalies vs ' + BASELINE_WINDOW_DAYS + '-day baseline</h3>';

  if (drops.length > 0) {
    html += '<div style="margin-bottom:10px;">';
    html += '<strong style="color:#c62828;">Drops (' + drops.length + ')</strong>';
    html += '<ul style="margin:4px 0 0;padding:0 0 0 20px;font-size:13px;">';
    drops.forEach(function(a) {
      html += '<li><strong>' + a.account + '</strong> — ' + a.today.toFixed(0) + ' conv today vs ' + a.baseline.toFixed(0) + ' median '
           + '<span style="color:#c62828;font-weight:600;">(' + a.deltaPct.toFixed(0) + '%)</span></li>';
    });
    html += '</ul></div>';
  }

  if (spikes.length > 0) {
    html += '<div>';
    html += '<strong style="color:#2e7d32;">Spikes (' + spikes.length + ')</strong>';
    html += '<ul style="margin:4px 0 0;padding:0 0 0 20px;font-size:13px;">';
    spikes.forEach(function(a) {
      html += '<li><strong>' + a.account + '</strong> — ' + a.today.toFixed(0) + ' conv today vs ' + a.baseline.toFixed(0) + ' median '
           + '<span style="color:#2e7d32;font-weight:600;">(+' + a.deltaPct.toFixed(0) + '%)</span></li>';
    });
    html += '</ul></div>';
  }

  html += '</div>';
  return html;
}

function _anomalyBadge(severity) {
  if (severity === 'drop') return '<span style="background:#c62828;color:white;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:600;">DROP</span>';
  if (severity === 'spike') return '<span style="background:#2e7d32;color:white;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:600;">SPIKE</span>';
  return '';
}


// ============================================
// ORPHAN ACCOUNT DETECTION (MCC mode)
// ============================================

/**
 * If running at the MCC level, list every sub-account that had spend > 0
 * yesterday but has no DailyDigest row in the last ORPHAN_LOOKBACK_DAYS —
 * i.e. accounts spending money but not running the optimization script.
 *
 * Returns { mode: 'mcc' | 'unsupported', list: [...] }
 *   mode === 'unsupported' when AdsManagerApp isn't available (script
 *   was installed at sub-account level, not MCC).
 */
function _findOrphanAccounts(data, headers) {
  if (typeof AdsManagerApp === 'undefined') {
    return { mode: 'unsupported', list: [] };
  }

  // Build set of accounts that have any DailyDigest row in the last N days
  var colIdx = {};
  for (var h = 0; h < headers.length; h++) colIdx[headers[h]] = h;
  if (colIdx['account'] === undefined) return { mode: 'mcc', list: [] };

  var now = new Date();
  var cutoff = new Date(now.getTime() - ORPHAN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  var installed = {};
  for (var i = 1; i < data.length; i++) {
    var rowDate = _parseSheetDate(String(data[i][0]));
    if (!rowDate || rowDate < cutoff) continue;
    var acct = data[i][colIdx['account']];
    if (acct) installed[String(acct).toLowerCase().trim()] = true;
  }

  // Iterate all sub-accounts with spend yesterday
  var orphans = [];
  try {
    var iter = AdsManagerApp.accounts()
      .withCondition("metrics.cost_micros > 0")
      .forDateRange("YESTERDAY")
      .get();

    while (iter.hasNext()) {
      var account = iter.next();
      var name = account.getName();
      if (!name) continue;
      if (installed[name.toLowerCase().trim()]) continue;

      // Pull spend + conversions to give context
      var stats = account.getStatsFor("YESTERDAY");
      orphans.push({
        name: name,
        cid: account.getCustomerId(),
        cost: stats.getCost(),
        conv: stats.getConversions()
      });
    }
  } catch (e) {
    Logger.log('Orphan detection error: ' + e.message);
    return { mode: 'mcc', list: [], error: e.message };
  }

  // Highest spend first
  orphans.sort(function(a, b) { return b.cost - a.cost; });
  return { mode: 'mcc', list: orphans };
}

function _renderOrphansSection(orphans) {
  if (orphans.error) {
    return '<div style="padding:15px;background:#fff3e0;color:#e65100;font-size:12px;">Orphan check error: ' + orphans.error + '</div>';
  }
  if (orphans.list.length === 0) {
    return '<div style="padding:10px 15px;background:#e8f5e9;color:#2e7d32;font-size:12px;border-top:1px solid #c8e6c9;">'
         + '✓ No orphans: every MCC sub-account with spend yesterday is reporting to the dashboard.'
         + '</div>';
  }

  var totalCost = 0;
  orphans.list.forEach(function(o) { totalCost += o.cost; });

  var html = '<div style="padding:15px;background:#fff8e1;border-top:1px solid #ffe082;">';
  html += '<h3 style="color:#e65100;margin:0 0 6px;">Not in dashboard — script may not be installed (' + orphans.list.length + ' accounts)</h3>';
  html += '<p style="margin:0 0 10px;font-size:12px;color:#666;">These MCC sub-accounts spent money yesterday but have no DailyDigest entry in the last ' + ORPHAN_LOOKBACK_DAYS + ' days. Total spend yesterday: <strong>' + totalCost.toFixed(0) + '</strong>.</p>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<tr style="background:#ffecb3;">';
  html += '<th style="padding:6px 8px;text-align:left;">Account</th>';
  html += '<th style="padding:6px 8px;text-align:left;">CID</th>';
  html += '<th style="padding:6px 8px;text-align:right;">Spend (yest.)</th>';
  html += '<th style="padding:6px 8px;text-align:right;">Conv (yest.)</th>';
  html += '</tr>';
  orphans.list.forEach(function(o) {
    html += '<tr style="border-bottom:1px solid #ffe082;">';
    html += '<td style="padding:6px 8px;font-weight:600;">' + o.name + '</td>';
    html += '<td style="padding:6px 8px;font-family:monospace;color:#666;">' + o.cid + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + o.cost.toFixed(2) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + o.conv.toFixed(0) + '</td>';
    html += '</tr>';
  });
  html += '</table>';
  html += '</div>';
  return html;
}


// ============================================
// HELPERS
// ============================================

function _parseSheetDate(str) {
  if (!str) return null;
  // Expected format: yyyy-MM-dd
  var m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function _median(arr) {
  if (arr.length === 0) return 0;
  var sorted = arr.slice().sort(function(a, b) { return a - b; });
  var mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
