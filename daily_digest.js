/**
 * SYTE DAILY DIGEST — Consolidated Report
 * ========================================
 * Reads today's run summaries from the DailyDigest tab in the master sheet
 * and sends ONE email with all accounts' performance.
 *
 * v2.0 NEW:
 *   - Per-client anomaly detection: today's conv_this_week vs that client's
 *     trailing 14-day baseline (median). Flags both drops AND spikes.
 *   - Coverage-gap section ("Install script on these N accounts"): if
 *     installed in the Syte MCC, iterates all sub-accounts with spend in the
 *     LAST 7 DAYS, lists any that DON'T have a DailyDigest row in the same
 *     window (= script not installed / not running). Pinned to the top of
 *     the email with a red border + subject-line flag so it can't be missed.
 *     Sorted by 7-day spend so highest-priority installs are at the top.
 *
 * v2.1 NEW:
 *   - Recent Activity section: queries change_event per MCC sub-account for
 *     the last 7 days, buckets changes by HUMAN / SCRIPT / GOOGLE_AUTO.
 *     Cross-references with the anomalies list — any account that is both in
 *     DROPS and had human bid/budget touches gets a high-priority correlation
 *     callout ("lead drop coincided with manual changes — start here").
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

// Recent Activity (change_event scrape): how many days to look back.
// Max 30; we use 7 to align with the "last week" framing.
var ACTIVITY_LOOKBACK_DAYS = 7;
// Skip the section entirely if every account is silent (no signal in showing zeros)
var ACTIVITY_HIDE_IF_ALL_ZERO = true;
// change_event is the slowest part of the digest (one AdsApp.search per account
// plus an account-context switch). On large MCCs it can push past Google's
// 30-min execution limit. Modes:
//   'drops-only' (default) — only query accounts flagged as lead-drop anomalies. Fast.
//   'all'                  — query every spending account. Slow.
//   'off'                  — skip the activity scrape entirely.
var ACTIVITY_SCOPE = 'drops-only';

function main() {
  Logger.log('=== DAILY DIGEST v3 (with quota logging) — code is loaded ===');
  try {
    _runDigest();
  } catch (err) {
    // Surface failure via email so the user knows the trigger fired but errored,
    // instead of failing silently into the Logger.
    Logger.log('Daily digest fatal error: ' + (err && err.stack ? err.stack : err));
    try {
      MailApp.sendEmail({
        to: EMAIL_TO,
        subject: 'Syte Daily Digest | FAILED',
        htmlBody: '<p>The daily digest script threw an error before it could send the report.</p>'
                + '<pre style="background:#f8f9fa;padding:10px;border:1px solid #eee;white-space:pre-wrap;">'
                + _escapeHtml(String(err && err.stack ? err.stack : err))
                + '</pre>'
                + '<p style="color:#666;font-size:12px;">Check the Google Ads Scripts execution log for full context.</p>'
      });
    } catch (mailErr) {
      Logger.log('Also failed to send error email: ' + mailErr.message);
    }
    throw err;
  }
}

function _runDigest() {
  // Accept either a bare ID or a full Google Sheets URL in SHEET_ID.
  var sheetId = _extractSheetId(SHEET_ID);
  if (!sheetId) {
    throw new Error('SHEET_ID is not set or unrecognised: "' + SHEET_ID + '". Paste either the sheet ID or the full URL.');
  }

  var ss;
  try {
    ss = SpreadsheetApp.openById(sheetId);
  } catch (e) {
    throw new Error('Could not open spreadsheet "' + sheetId + '": ' + e.message
                  + ' — make sure the script account has access to the sheet.');
  }

  var sheet = ss.getSheetByName('DailyDigest');
  var today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');

  // Read sheet data if the tab exists. Missing/empty tab is fine — in MCC
  // mode we can still render a digest from MCC stats alone, every account
  // just won't have optimization-script columns.
  var data = [], headers = [], digestByAccount = {};
  if (sheet) {
    data = sheet.getDataRange().getValues();
    if (data.length >= 2) {
      headers = data[0];
      for (var i = 1; i < data.length; i++) {
        if (_toDateStr(data[i][0]) === today) {
          var row = {};
          for (var j = 0; j < headers.length; j++) row[headers[j]] = data[i][j];
          if (row.account) digestByAccount[String(row.account).toLowerCase().trim()] = row;
        }
      }
    }
  }

  // Compute anomalies BEFORE the MCC pass so we can pass drop accounts as
  // the change_event filter (avoids per-account context switch + GAQL query
  // for accounts we don't need activity data on).
  var todayRowsArr = [];
  for (var k in digestByAccount) todayRowsArr.push(digestByAccount[k]);
  var anomaliesPre = (todayRowsArr.length > 0 && headers.length > 0)
    ? _detectAnomalies(todayRowsArr, data, headers, today)
    : [];

  var activityFilter = null;
  if (ACTIVITY_SCOPE === 'drops-only') {
    activityFilter = {};
    for (var afi = 0; afi < anomaliesPre.length; afi++) {
      if (anomaliesPre[afi].severity === 'drop') {
        activityFilter[String(anomaliesPre[afi].account).toLowerCase().trim()] = true;
      }
    }
  } else if (ACTIVITY_SCOPE === 'off') {
    activityFilter = {}; // empty = scrape nothing
  }
  // 'all' => activityFilter stays null = scrape every account

  // Single MCC pass: stats + (optional) change_event scrape. This used to be
  // two separate AdsManagerApp.accounts() iterations; merging them halves
  // the per-account iterator overhead.
  Logger.log('Starting MCC scan... (activity scope: ' + ACTIVITY_SCOPE + ')');
  var mccData = _collectMccData(activityFilter);
  var mccStats = { mode: mccData.mode, byAccount: mccData.byAccount, error: mccData.error };
  var activity = mccData.activity;
  Logger.log('MCC scan complete: ' + Object.keys(mccData.byAccount).length + ' accounts with stats, '
           + Object.keys(activity.byAccount).length + ' with activity data');

  // Fetch conversion value (revenue) for ecommerce accounts via MCC-level
  // AWQL report. AdsManagerApp.Stats doesn't expose getConversionValue(),
  // so we use a separate cross-account report query — one per time window.
  if (mccStats.mode === 'mcc' && Object.keys(mccData.byAccount).length > 0) {
    _mergeRevenueIntoMccStats(mccStats.byAccount);
  }

  var accountList = _buildUnifiedAccountList(mccStats, digestByAccount);

  if (accountList.length === 0) {
    var hint;
    if (mccStats.mode === 'unsupported') {
      hint = 'No client script wrote a row for today (' + today + ', timezone ' + TIMEZONE + '), '
           + 'and this script is not running at MCC level so we can\'t pull stats directly.';
    } else if (mccStats.error) {
      // MCC scan threw partway through — surface the actual error instead
      // of pretending nothing spent money. Common causes: a per-account
      // API quota hit, a malformed account in the MCC, or a timeout.
      hint = 'The MCC scan raised an error before any account stats could be collected: '
           + '<code style="background:#fdecea;padding:2px 4px;">' + _escapeHtml(mccStats.error) + '</code>. '
           + 'Check the Google Ads Scripts execution log for the full stack trace, then re-run.';
    } else {
      hint = 'No MCC sub-account spent money in the last 14 days, and no client script wrote a row for today. '
           + '<br><br>If this is unexpected, check the execution log for "MCC scan progress" lines — '
           + 'they show how many accounts were iterated vs how many had spend.';
    }
    _sendEmptyDigest(today, hint);
    return;
  }

  var anomalies = anomaliesPre;

  // === Coverage counts ===
  var withScript = 0, withoutScript = 0, ecommerceCount = 0;
  for (var ai = 0; ai < accountList.length; ai++) {
    if (accountList[ai].hasScript) withScript++; else withoutScript++;
    if (accountList[ai].isEcommerce) ecommerceCount++;
  }
  var hasEcommerce = ecommerceCount > 0;

  // === Aggregate totals ===
  var totals = { aiNegated: 0, aiReview: 0, winners: 0, errors: 0,
                 convThis: 0, convPrev: 0, costThis: 0, costMtd: 0, costPrevMtd: 0,
                 convMtd: 0, convPrevMtd: 0,
                 revThis: 0, revPrev: 0, revMtd: 0, revPrevMtd: 0 };
  for (var ti = 0; ti < accountList.length; ti++) {
    var a = accountList[ti];
    totals.convThis += a.convThis || 0;
    totals.convPrev += a.convPrev || 0;
    totals.costThis += a.costThis || 0;
    totals.costMtd += a.costMtd || 0;
    totals.costPrevMtd += a.costPrevMtd || 0;
    totals.convMtd += a.convMtd || 0;
    totals.convPrevMtd += a.convPrevMtd || 0;
    if (a.isEcommerce) {
      totals.revThis += a.revThis || 0;
      totals.revPrev += a.revPrev || 0;
      totals.revMtd += a.revMtd || 0;
      totals.revPrevMtd += a.revPrevMtd || 0;
    }
    if (a.digest) {
      totals.aiNegated += Number(a.digest.ai_negated) || 0;
      totals.aiReview += Number(a.digest.ai_review) || 0;
      totals.winners += Number(a.digest.winners_promoted) || 0;
      totals.errors += Number(a.digest.errors) || 0;
    }
  }

  var convChange = totals.convPrev > 0 ? ((totals.convThis - totals.convPrev) / totals.convPrev * 100).toFixed(0) : 'N/A';
  var convColor = totals.convThis >= totals.convPrev ? '#2e7d32' : '#c62828';
  var mtdChange = totals.convPrevMtd > 0 ? ((totals.convMtd - totals.convPrevMtd) / totals.convPrevMtd * 100).toFixed(0) : 'N/A';
  var mtdColor = totals.convMtd >= totals.convPrevMtd ? '#2e7d32' : '#c62828';
  var revChange = totals.revPrev > 0 ? ((totals.revThis - totals.revPrev) / totals.revPrev * 100).toFixed(0) : 'N/A';
  var revColor = totals.revThis >= totals.revPrev ? '#2e7d32' : '#c62828';
  var revMtdChange = totals.revPrevMtd > 0 ? ((totals.revMtd - totals.revPrevMtd) / totals.revPrevMtd * 100).toFixed(0) : 'N/A';
  var revMtdColor = totals.revMtd >= totals.revPrevMtd ? '#2e7d32' : '#c62828';
  var spendMtdChange = totals.costPrevMtd > 0 ? ((totals.costMtd - totals.costPrevMtd) / totals.costPrevMtd * 100).toFixed(0) : 'N/A';

  // === Build email ===
  var email = '<html><body style="font-family:Arial,sans-serif;max-width:1000px;margin:0 auto;color:#333;">';
  email += '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;padding:20px;border-radius:8px 8px 0 0;">';
  email += '<h1 style="margin:0;font-size:20px;">Syte Daily Digest</h1>';
  email += '<p style="margin:5px 0 0;opacity:0.8;">' + today + ' | ' + accountList.length + ' accounts ('
        + withScript + ' running optimization script, ' + withoutScript + ' without)</p></div>';

  // Totals bar
  email += '<div style="background:#f8f9fa;padding:15px;border-bottom:1px solid #e0e5ec;">';
  email += '<table style="border:none;border-collapse:collapse;"><tr>';
  email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;color:' + convColor + ';">' + totals.convThis.toFixed(0) + '</strong><br><span style="font-size:12px;color:#666;">Conv last 7d</span></td>';
  email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;">' + convChange + '%</strong><br><span style="font-size:12px;color:#666;">vs prev 7d</span></td>';
  if (mccStats.mode === 'mcc') {
    email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;color:' + mtdColor + ';">' + totals.convMtd.toFixed(0) + '</strong><br><span style="font-size:12px;color:#666;">Conv MTD</span></td>';
    email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;">' + mtdChange + '%</strong><br><span style="font-size:12px;color:#666;">vs prev MTD</span></td>';
    if (hasEcommerce) {
      email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;color:' + revColor + ';">' + _fmtMoney(totals.revThis) + '</strong><br><span style="font-size:12px;color:#666;">Revenue 7d</span></td>';
      email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;color:' + revMtdColor + ';">' + _fmtMoney(totals.revMtd) + '</strong><br><span style="font-size:12px;color:#666;">Revenue MTD (' + revMtdChange + '%)</span></td>';
    }
    email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;">' + totals.costThis.toFixed(0) + '</strong><br><span style="font-size:12px;color:#666;">Spend last 7d</span></td>';
    email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;">' + totals.costMtd.toFixed(0) + '</strong><br><span style="font-size:12px;color:#666;">Spend MTD (' + spendMtdChange + '%)</span></td>';
  }
  email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;color:#2d6cdf;">' + totals.aiNegated + '</strong><br><span style="font-size:12px;color:#666;">AI negated</span></td>';
  email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;color:#e65100;">' + totals.aiReview + '</strong><br><span style="font-size:12px;color:#666;">Need review</span></td>';
  email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;">' + totals.winners + '</strong><br><span style="font-size:12px;color:#666;">Winners</span></td>';
  if (totals.errors > 0) email += '<td style="padding:0 20px 0 0;"><strong style="font-size:24px;color:#c62828;">' + totals.errors + '</strong><br><span style="font-size:12px;color:#666;">Errors</span></td>';
  email += '</tr></table></div>';

  // === Anomalies section ===
  if (anomalies.length > 0) email += _renderAnomaliesSection(anomalies);

  // === MTD Biggest Losers / Winners summary (MCC mode only) ===
  if (mccStats.mode === 'mcc') {
    email += _renderMtdSummary(accountList);
  }

  // === Per-account table (unified MCC + sheet) ===
  var anomalyByAccount = {};
  for (var aii = 0; aii < anomalies.length; aii++) anomalyByAccount[String(anomalies[aii].account).toLowerCase().trim()] = anomalies[aii];

  // Has activity for any account? Only show the Changes column if so —
  // pointless dashes everywhere otherwise.
  var anyActivity = false;
  if (activity.mode === 'mcc') {
    for (var ack in activity.byAccount) {
      var ab = activity.byAccount[ack];
      if (ab && (ab.human + ab.script + ab.googleAuto + ab.other) > 0) { anyActivity = true; break; }
    }
  }

  email += '<div style="padding:15px;"><table style="width:100%;border-collapse:collapse;font-size:12px;">';
  email += '<tr style="background:#e3f2fd;">';
  email += '<th style="padding:8px;text-align:left;">Account</th>';
  email += '<th style="padding:8px;text-align:center;">Script</th>';
  email += '<th style="padding:8px;text-align:right;">Conv 7d</th>';
  email += '<th style="padding:8px;text-align:right;">vs Prev 7d</th>';
  if (mccStats.mode === 'mcc') {
    email += '<th style="padding:8px;text-align:right;">Conv MTD</th>';
    email += '<th style="padding:8px;text-align:right;">vs Prev MTD</th>';
    if (hasEcommerce) {
      email += '<th style="padding:8px;text-align:right;background:#e8f5e9;" title="Conversion value (revenue) for ecommerce accounts">Rev 7d</th>';
      email += '<th style="padding:8px;text-align:right;background:#e8f5e9;">vs Prev 7d</th>';
      email += '<th style="padding:8px;text-align:right;background:#e8f5e9;">Rev MTD</th>';
      email += '<th style="padding:8px;text-align:right;background:#e8f5e9;">vs Prev MTD</th>';
    }
    email += '<th style="padding:8px;text-align:right;">Spend 7d</th>';
    email += '<th style="padding:8px;text-align:right;">Spend MTD</th>';
  }
  if (anyActivity) email += '<th style="padding:8px;text-align:right;" title="Changes in the last ' + ACTIVITY_LOOKBACK_DAYS + ' days (human / script / google-auto)">Changes 7d</th>';
  email += '<th style="padding:8px;text-align:right;">vs Baseline</th>';
  email += '<th style="padding:8px;text-align:right;">AI Neg</th>';
  email += '<th style="padding:8px;text-align:right;">Review</th>';
  email += '<th style="padding:8px;text-align:right;">KW Paused</th>';
  email += '<th style="padding:8px;text-align:right;">Winners</th>';
  email += '<th style="padding:8px;text-align:right;">Errors</th>';
  email += '</tr>';

  // Helpers for column count so the group-divider colspan stays in sync
  var fixedCols = 6; // Account, Script, Conv 7d, vs Prev 7d, vs Baseline, AI Neg
  fixedCols += 4; // Review, KW Paused, Winners, Errors
  if (mccStats.mode === 'mcc') fixedCols += 4; // Conv MTD, vs Prev MTD, Spend 7d, Spend MTD
  if (mccStats.mode === 'mcc' && hasEcommerce) fixedCols += 4; // Rev 7d, vs prev 7d, Rev MTD, vs prev MTD
  if (anyActivity) fixedCols += 1;

  // Track group boundary so we can render a divider between losers and winners.
  var winnersStartIdx = -1;
  if (mccStats.mode === 'mcc') {
    for (var fi = 0; fi < accountList.length; fi++) {
      var fp = accountList[fi].mtdDeltaPct;
      if (fp !== null && fp >= 0) { winnersStartIdx = fi; break; }
    }
  }

  for (var ri = 0; ri < accountList.length; ri++) {
    var acc = accountList[ri];

    // Group divider rows
    if (mccStats.mode === 'mcc') {
      if (ri === 0 && winnersStartIdx !== 0 && acc.mtdDeltaPct !== null && acc.mtdDeltaPct < 0) {
        email += '<tr style="background:#ffe0e0;"><td colspan="' + fixedCols + '" style="padding:6px 8px;font-weight:700;color:#c62828;text-transform:uppercase;letter-spacing:0.5px;font-size:11px;">▼ Biggest Losers (MTD vs same period last month)</td></tr>';
      }
      if (ri === winnersStartIdx && winnersStartIdx !== -1) {
        email += '<tr style="background:#e0f2e0;"><td colspan="' + fixedCols + '" style="padding:6px 8px;font-weight:700;color:#2e7d32;text-transform:uppercase;letter-spacing:0.5px;font-size:11px;">▲ Biggest Winners (MTD vs same period last month)</td></tr>';
      }
      if (acc.mtdDeltaPct === null && (ri === 0 || accountList[ri - 1].mtdDeltaPct !== null)) {
        email += '<tr style="background:#f0f0f0;"><td colspan="' + fixedCols + '" style="padding:6px 8px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.5px;font-size:11px;">— No Prior MTD Baseline</td></tr>';
      }
    }

    var key = String(acc.name).toLowerCase().trim();
    var anom = anomalyByAccount[key];
    var d = acc.digest;
    var hasErrors = d && (Number(d.errors) || 0) > 0;
    var isPreview = d && d.run_mode === 'PREVIEW';

    var rowBg = !acc.hasScript ? '#fff8f0'
              : hasErrors ? '#ffebee'
              : anom && anom.severity === 'drop' ? '#fff5f5'
              : anom && anom.severity === 'spike' ? '#f1f8e9'
              : (ri % 2 === 0 ? '#fff' : '#fafbfc');

    var convTrendArrow = acc.convPrev > 0 ? (acc.convThis >= acc.convPrev ? '↑' : '↓') : '—';
    var convTrendPct = acc.convPrev > 0 ? ((acc.convThis - acc.convPrev) / acc.convPrev * 100).toFixed(0) : null;
    var convTrendColor = acc.convThis >= acc.convPrev ? '#2e7d32' : '#c62828';
    var trendCell = convTrendPct === null
      ? '<span style="color:#bbb;">—</span>'
      : '<span style="color:' + convTrendColor + ';font-weight:600;">' + (convTrendPct >= 0 ? '+' : '') + convTrendPct + '% ' + convTrendArrow + '</span>';

    var baselineCell = '<span style="color:#bbb;">—</span>';
    if (anom) {
      var sign = anom.deltaPct >= 0 ? '+' : '';
      var color = anom.severity === 'drop' ? '#c62828' : anom.severity === 'spike' ? '#2e7d32' : '#666';
      baselineCell = '<span style="color:' + color + ';font-weight:600;">' + sign + anom.deltaPct.toFixed(0) + '%</span>'
                   + ' <span style="font-size:10px;color:#888;">(med ' + anom.baseline.toFixed(0) + ')</span>';
    }

    var scriptBadge;
    if (!acc.hasScript) {
      scriptBadge = '<span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;background:#ffcdd2;color:#c62828;">NO SCRIPT</span>';
    } else if (isPreview) {
      scriptBadge = '<span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;background:#fff3e0;color:#e65100;">PREVIEW</span>';
    } else {
      scriptBadge = '<span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;background:#e8f5e9;color:#2e7d32;">LIVE</span>';
    }

    // MTD cells
    var mtdCell = '<span style="color:#bbb;">—</span>';
    var mtdTrendCell = '<span style="color:#bbb;">—</span>';
    if (mccStats.mode === 'mcc') {
      mtdCell = (acc.convMtd || 0).toFixed(0);
      if (acc.mtdDeltaPct === null) {
        mtdTrendCell = '<span style="color:#bbb;">new</span>';
      } else {
        var mtdColor = acc.mtdDeltaPct >= 0 ? '#2e7d32' : '#c62828';
        var mtdSign = acc.mtdDeltaPct >= 0 ? '+' : '';
        var mtdArrow = acc.mtdDeltaPct >= 0 ? '↑' : '↓';
        mtdTrendCell = '<span style="color:' + mtdColor + ';font-weight:600;">'
                     + mtdSign + acc.mtdDeltaPct.toFixed(0) + '% ' + mtdArrow + '</span>'
                     + ' <span style="font-size:10px;color:#888;">(prev ' + (acc.convPrevMtd || 0).toFixed(0) + ')</span>';
      }
    }

    email += '<tr style="background:' + rowBg + ';border-bottom:1px solid #eee;">';
    email += '<td style="padding:6px 8px;font-weight:600;">' + acc.name + (anom ? ' ' + _anomalyBadge(anom.severity) : '') + '</td>';
    email += '<td style="padding:6px 8px;text-align:center;">' + scriptBadge + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;">' + (acc.convThis || 0).toFixed(0) + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;">' + trendCell + '</td>';
    if (mccStats.mode === 'mcc') {
      email += '<td style="padding:6px 8px;text-align:right;font-weight:600;">' + mtdCell + '</td>';
      email += '<td style="padding:6px 8px;text-align:right;">' + mtdTrendCell + '</td>';
      if (hasEcommerce) {
        // Revenue cells — populated only for ecommerce accounts. Lead-gen
        // rows get dashes so the column reads as "not applicable" rather
        // than "zero".
        if (acc.isEcommerce) {
          email += '<td style="padding:6px 8px;text-align:right;background:#f6fbf6;font-weight:600;">' + _fmtMoney(acc.revThis) + '</td>';

          var revTrendArrow = acc.revPrev > 0 ? (acc.revThis >= acc.revPrev ? '↑' : '↓') : '—';
          var revTrendPct = acc.revPrev > 0 ? ((acc.revThis - acc.revPrev) / acc.revPrev * 100).toFixed(0) : null;
          var revTrendColor = acc.revThis >= acc.revPrev ? '#2e7d32' : '#c62828';
          var revTrendCell = revTrendPct === null
            ? '<span style="color:#bbb;">—</span>'
            : '<span style="color:' + revTrendColor + ';font-weight:600;">' + (revTrendPct >= 0 ? '+' : '') + revTrendPct + '% ' + revTrendArrow + '</span>';
          email += '<td style="padding:6px 8px;text-align:right;background:#f6fbf6;">' + revTrendCell + '</td>';

          email += '<td style="padding:6px 8px;text-align:right;background:#f6fbf6;font-weight:600;">' + _fmtMoney(acc.revMtd) + '</td>';

          var revMtdCell;
          if (acc.revMtdDeltaPct === null) {
            revMtdCell = '<span style="color:#bbb;">new</span>';
          } else {
            var revMtdColorR = acc.revMtdDeltaPct >= 0 ? '#2e7d32' : '#c62828';
            var revMtdSign = acc.revMtdDeltaPct >= 0 ? '+' : '';
            var revMtdArrow = acc.revMtdDeltaPct >= 0 ? '↑' : '↓';
            revMtdCell = '<span style="color:' + revMtdColorR + ';font-weight:600;">'
                       + revMtdSign + acc.revMtdDeltaPct.toFixed(0) + '% ' + revMtdArrow + '</span>'
                       + ' <span style="font-size:10px;color:#888;">(prev ' + _fmtMoney(acc.revPrevMtd) + ')</span>';
          }
          email += '<td style="padding:6px 8px;text-align:right;background:#f6fbf6;">' + revMtdCell + '</td>';
        } else {
          email += '<td style="padding:6px 8px;text-align:right;background:#f6fbf6;color:#ccc;">—</td>';
          email += '<td style="padding:6px 8px;text-align:right;background:#f6fbf6;color:#ccc;">—</td>';
          email += '<td style="padding:6px 8px;text-align:right;background:#f6fbf6;color:#ccc;">—</td>';
          email += '<td style="padding:6px 8px;text-align:right;background:#f6fbf6;color:#ccc;">—</td>';
        }
      }
      email += '<td style="padding:6px 8px;text-align:right;color:#666;">' + (acc.costThis || 0).toFixed(0) + '</td>';
      email += '<td style="padding:6px 8px;text-align:right;color:#666;font-weight:600;">' + (acc.costMtd || 0).toFixed(0) + '</td>';
    }
    if (anyActivity) {
      var bucket = activity.byAccount[key] || null;
      var changesCell;
      if (!bucket || (bucket.human + bucket.script + bucket.googleAuto + bucket.other) === 0) {
        changesCell = '<span style="color:#bbb;">—</span>';
      } else {
        // Compact display: H/S/A where H is bold-red if there were bid/budget touches
        var humanColor = bucket.bidBudgetTouches > 0 ? '#c62828' : '#333';
        var humanWeight = bucket.bidBudgetTouches > 0 ? '600' : 'normal';
        changesCell =
            '<span style="color:' + humanColor + ';font-weight:' + humanWeight + ';" title="human changes (UI/Editor)">' + bucket.human + 'h</span>'
          + '<span style="color:#999;">/</span>'
          + '<span style="color:#2d6cdf;" title="script + API + bulk upload">' + bucket.script + 's</span>'
          + '<span style="color:#999;">/</span>'
          + '<span style="color:#e65100;" title="Google auto-applied recs + automated rules">' + bucket.googleAuto + 'a</span>';
      }
      email += '<td style="padding:6px 8px;text-align:right;font-size:11px;">' + changesCell + '</td>';
    }
    email += '<td style="padding:6px 8px;text-align:right;">' + baselineCell + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;">' + (d ? (Number(d.ai_negated) || 0) : '<span style="color:#bbb;">—</span>') + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;color:#e65100;font-weight:' + (d && (Number(d.ai_review) || 0) > 0 ? '600' : '400') + ';">' + (d ? (Number(d.ai_review) || 0) : '<span style="color:#bbb;">—</span>') + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;">' + (d ? (Number(d.keywords_paused) || 0) : '<span style="color:#bbb;">—</span>') + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;color:#2e7d32;">' + (d ? (Number(d.winners_promoted) || 0) : '<span style="color:#bbb;">—</span>') + '</td>';
    email += '<td style="padding:6px 8px;text-align:right;' + (hasErrors ? 'color:#c62828;font-weight:600;' : '') + '">' + (d ? (Number(d.errors) || 0) : '<span style="color:#bbb;">—</span>') + '</td>';
    email += '</tr>';
  }
  email += '</table></div>';

  // === Coverage footer (replaces dedicated orphan section) ===
  if (mccStats.mode === 'mcc') {
    if (withoutScript > 0) {
      email += '<div style="padding:12px 15px;background:#fff8e1;border-top:1px solid #ffe082;color:#5d4037;font-size:12px;">'
            + '<strong style="color:#e65100;">Coverage gap:</strong> ' + withoutScript
            + ' account' + (withoutScript > 1 ? 's' : '') + ' marked <strong>NO SCRIPT</strong> above. '
            + 'Install the optimization script on those accounts to enable AI negatives, anomaly detection, and the rest of the columns.'
            + '</div>';
    } else {
      email += '<div style="padding:10px 15px;background:#e8f5e9;color:#2e7d32;font-size:12px;border-top:1px solid #c8e6c9;">'
            + 'Full coverage: optimization script is running on every active MCC sub-account.'
            + '</div>';
    }
  } else if (mccStats.mode === 'unsupported') {
    email += '<div style="padding:10px 15px;background:#f8f9fa;color:#888;font-size:11px;border-top:1px solid #eee;">'
          + 'Install this script at the MCC level to see all spending accounts, not just those reporting via DailyDigest.'
          + '</div>';
  }

  // Recent activity + drop correlation
  if (activity.mode === 'mcc') {
    email += _renderDropCorrelation(activity, anomalies);
    email += _renderActivitySection(activity);
  }

  // Attention list — only meaningful for accounts running the script
  var attention = [];
  for (var att = 0; att < accountList.length; att++) {
    var ad = accountList[att].digest;
    if (!ad) continue;
    if ((Number(ad.errors) || 0) > 0 || (Number(ad.ai_review) || 0) > 10) attention.push(ad);
  }
  if (attention.length > 0) {
    email += '<div style="padding:15px;background:#fff8e1;border-top:1px solid #ffe082;">';
    email += '<h3 style="color:#e65100;margin:0 0 10px;">Needs Attention (' + attention.length + ' accounts)</h3>';
    email += '<ul style="font-size:13px;margin:0;padding:0 0 0 20px;">';
    for (var an = 0; an < attention.length; an++) {
      var ra = attention[an];
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
  var subjectBits = [today, accountList.length + ' accts', totals.convThis.toFixed(0) + ' conv'];
  var drops = anomalies.filter(function(a) { return a.severity === 'drop'; }).length;
  if (drops > 0) subjectBits.push('⚠ ' + drops + ' drop' + (drops > 1 ? 's' : ''));
  if (withoutScript > 0) subjectBits.push('⚠ ' + withoutScript + ' uninstalled');
  var correlatedDrops = _correlatedDropAccounts(activity, anomalies).length;
  if (correlatedDrops > 0) subjectBits.push('🔥 ' + correlatedDrops + ' correlated');

  _sendMail('Syte Daily Digest | ' + subjectBits.join(' | '), email);

  Logger.log('Daily digest sent: ' + accountList.length + ' accounts ('
           + withScript + ' with script, ' + withoutScript + ' without), '
           + anomalies.length + ' anomalies');
}


// ============================================
// MCC ACCOUNT STATS (new — drives the unified table)
// ============================================

/**
 * Iterate every MCC sub-account and return last-7-day and previous-7-day
 * conv/cost stats. Used to populate the digest table for every spending
 * account, not just those reporting via DailyDigest.
 *
 * Returns { mode: 'mcc'|'unsupported', byAccount: { normName: stats } }.
 */
// Top losers + top winners by MTD vs prev-month-same-period.
function _renderMtdSummary(accountList) {
  // Require some volume in either window so a 1-conv jump doesn't dominate.
  var MIN_CONV = 3;

  var ranked = [];
  for (var i = 0; i < accountList.length; i++) {
    var a = accountList[i];
    if (a.mtdDeltaPct === null) continue;
    if ((a.convMtd || 0) < MIN_CONV && (a.convPrevMtd || 0) < MIN_CONV) continue;
    ranked.push(a);
  }
  if (ranked.length === 0) return '';

  var losers = ranked.filter(function(a) { return a.mtdDeltaPct < 0; })
                     .sort(function(a, b) { return a.mtdDeltaPct - b.mtdDeltaPct; })
                     .slice(0, 5);
  var winners = ranked.filter(function(a) { return a.mtdDeltaPct >= 0; })
                      .sort(function(a, b) { return b.mtdDeltaPct - a.mtdDeltaPct; })
                      .slice(0, 5);

  if (losers.length === 0 && winners.length === 0) return '';

  function row(a, isLoser) {
    var color = isLoser ? '#c62828' : '#2e7d32';
    var sign = a.mtdDeltaPct >= 0 ? '+' : '';
    return '<li><strong>' + a.name + '</strong> — '
         + (a.convMtd || 0).toFixed(0) + ' MTD vs ' + (a.convPrevMtd || 0).toFixed(0) + ' prior '
         + '<span style="color:' + color + ';font-weight:600;">(' + sign + a.mtdDeltaPct.toFixed(0) + '%)</span></li>';
  }

  var html = '<div style="padding:15px;background:#fafafa;border-top:1px solid #eee;border-bottom:1px solid #eee;">';
  html += '<h3 style="margin:0 0 10px;color:#1a1a2e;font-size:14px;">MTD performance vs same period last month</h3>';
  html += '<table style="width:100%;border-collapse:collapse;"><tr style="vertical-align:top;">';

  html += '<td style="width:50%;padding-right:10px;">';
  if (losers.length > 0) {
    html += '<strong style="color:#c62828;">▼ Biggest losers (' + losers.length + ')</strong>';
    html += '<ul style="margin:4px 0 0;padding:0 0 0 20px;font-size:13px;">';
    losers.forEach(function(a) { html += row(a, true); });
    html += '</ul>';
  } else {
    html += '<span style="color:#999;font-size:13px;">No accounts down vs same period last month.</span>';
  }
  html += '</td>';

  html += '<td style="width:50%;padding-left:10px;">';
  if (winners.length > 0) {
    html += '<strong style="color:#2e7d32;">▲ Biggest winners (' + winners.length + ')</strong>';
    html += '<ul style="margin:4px 0 0;padding:0 0 0 20px;font-size:13px;">';
    winners.forEach(function(a) { html += row(a, false); });
    html += '</ul>';
  } else {
    html += '<span style="color:#999;font-size:13px;">No accounts up vs same period last month.</span>';
  }
  html += '</td>';

  html += '</tr></table></div>';
  return html;
}


/**
 * Pulls conversion value (revenue) per customer via a single MCC-level AWQL
 * report per time window. Mutates the byAccount map in place, filling in
 * revThis / revPrev / revMtd / revPrevMtd by externalCustomerId match.
 *
 * Why this exists: AdsManagerApp.Stats (returned by ManagedAccount.getStatsFor)
 * does NOT expose getConversionValue — only getCost/getClicks/getImpressions/
 * getConversions. To get revenue we have to use AdsManagerApp.report() with
 * AWQL against ACCOUNT_PERFORMANCE_REPORT, which DOES expose ConversionValue.
 *
 * 4 cross-account queries total — cheap compared to selecting each account.
 */
function _mergeRevenueIntoMccStats(byAccount) {
  // Build a quick CID -> key lookup so each row from the report finds the
  // right account.
  var cidToKey = {};
  for (var k in byAccount) {
    var s = byAccount[k];
    if (s && s.cid) cidToKey[String(s.cid).replace(/[^0-9]/g, '')] = k;
  }
  if (Object.keys(cidToKey).length === 0) return;

  // Match the same date windows _collectMccData uses, so the totals line up.
  var tzToday = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd').split('-');
  var Y = Number(tzToday[0]), M = Number(tzToday[1]), D = Number(tzToday[2]);
  var pY = M === 1 ? Y - 1 : Y;
  var pM = M === 1 ? 12 : M - 1;
  var daysInPrev = new Date(pY, pM, 0).getDate();
  var pD = Math.min(D, daysInPrev);
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  // AWQL DURING accepts either presets ("LAST_7_DAYS") or yyyyMMdd,yyyyMMdd
  var ranges = {
    revThis: 'LAST_7_DAYS',
    // Days 8-14 ago — explicit yyyyMMdd range
    revPrev: _ymdNDaysAgo(14) + ',' + _ymdNDaysAgo(8),
    revMtd: '' + Y + pad(M) + '01,' + Y + pad(M) + pad(D),
    revPrevMtd: '' + pY + pad(pM) + '01,' + pY + pad(pM) + pad(pD)
  };

  Object.keys(ranges).forEach(function(field) {
    var seen = 0, matched = 0, totalRev = 0;
    try {
      var awql = "SELECT ExternalCustomerId, ConversionValue "
               + "FROM ACCOUNT_PERFORMANCE_REPORT "
               + "DURING " + ranges[field];
      var report = AdsManagerApp.report(awql);
      var rows = report.rows();
      while (rows.hasNext()) {
        var row = rows.next();
        seen++;
        var cidNum = String(row['ExternalCustomerId'] || '').replace(/[^0-9]/g, '');
        var key = cidToKey[cidNum];
        if (!key) continue;
        matched++;
        var v = Number(row['ConversionValue']) || 0;
        totalRev += v;
        byAccount[key][field] = v;
      }
      Logger.log('Revenue ' + field + ' (' + ranges[field] + '): ' + seen + ' rows from report, '
               + matched + ' matched CIDs, total=' + totalRev.toFixed(0));
    } catch (e) {
      Logger.log('Revenue report (' + field + ') FAILED: ' + e.message);
    }
  });
}

// Helper: yyyyMMdd string for the day N days ago in TIMEZONE.
function _ymdNDaysAgo(n) {
  var d = new Date(new Date().getTime() - n * 24 * 60 * 60 * 1000);
  return Utilities.formatDate(d, TIMEZONE, 'yyyyMMdd');
}

/**
 * Single-pass MCC scan: per spending account, collects stats (LAST_7_DAYS,
 * LAST_14_DAYS, MTD, prev-MTD) and — if the account matches activityFilter —
 * also scrapes change_event activity. Returns stats and activity in one
 * object so we only iterate AdsManagerApp.accounts() once.
 *
 * activityFilter:
 *   null         => scrape change_event for every spending account
 *   {} (empty)   => scrape nothing
 *   { name: 1 }  => scrape only listed accounts (lowercase, trimmed)
 *
 * Returns { mode, byAccount, activity: { mode, byAccount } } where activity
 * is shaped the same as the old _collectChangeActivity for downstream
 * compatibility.
 */
function _collectMccData(activityFilter) {
  if (typeof AdsManagerApp === 'undefined') {
    return { mode: 'unsupported', byAccount: {}, activity: { mode: 'unsupported', byAccount: {} } };
  }

  // Compute the MTD and "previous month, same period" date ranges once,
  // anchored to TIMEZONE so accounts always compare on the calendar months
  // the user reads. Format: yyyyMMdd (what getStatsFor accepts).
  var tzToday = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd').split('-');
  var Y = Number(tzToday[0]), M = Number(tzToday[1]), D = Number(tzToday[2]);
  var pY = M === 1 ? Y - 1 : Y;
  var pM = M === 1 ? 12 : M - 1;
  var daysInPrev = new Date(pY, pM, 0).getDate();
  var pD = Math.min(D, daysInPrev);
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  var mtdStart = '' + Y + pad(M) + '01';
  var mtdEnd = '' + Y + pad(M) + pad(D);
  var prevMtdStart = '' + pY + pad(pM) + '01';
  var prevMtdEnd = '' + pY + pad(pM) + pad(pD);

  var byAccount = {};
  var activityByAccount = {};
  var processed = 0, withSpend = 0, withActivity = 0;

  try {
    var iter = AdsManagerApp.accounts().get();
    while (iter.hasNext()) {
      var account = iter.next();
      processed++;
      if (processed % 25 === 0) {
        Logger.log('MCC scan progress: ' + processed + ' iterated, ' + withSpend + ' spending, ' + withActivity + ' activity scraped');
      }
      var name = account.getName();
      if (!name) continue;

      var s14 = account.getStatsFor('LAST_14_DAYS');
      if (s14.getCost() <= 0) continue;
      withSpend++;

      var s7 = account.getStatsFor('LAST_7_DAYS');
      var sMtd = account.getStatsFor(mtdStart, mtdEnd);
      var sPrevMtd = account.getStatsFor(prevMtdStart, prevMtdEnd);

      var cost7 = s7.getCost();
      var conv7 = s7.getConversions();
      var key = name.toLowerCase().trim();
      // Note: revenue (conversion value) is NOT available on
      // AdsManagerApp.Stats — only cost/clicks/impressions/conversions are.
      // We fetch revenue separately via AdsManagerApp.report() AWQL below.
      byAccount[key] = {
        name: name,
        cid: account.getCustomerId(),
        costThis: cost7,
        convThis: conv7,
        revThis: 0,
        // Previous 7 days = days 8-14 = 14d total minus last 7d
        costPrev: Math.max(0, s14.getCost() - cost7),
        convPrev: Math.max(0, s14.getConversions() - conv7),
        revPrev: 0,
        // MTD vs same period last month
        costMtd: sMtd.getCost(),
        convMtd: sMtd.getConversions(),
        revMtd: 0,
        costPrevMtd: sPrevMtd.getCost(),
        convPrevMtd: sPrevMtd.getConversions(),
        revPrevMtd: 0
      };

      // Activity scrape — only if this account is in scope. This is the
      // expensive part (account-context switch + GAQL query), so we skip
      // it aggressively.
      var scrapeActivity = (activityFilter === null) || (activityFilter[key] === true);
      if (scrapeActivity) {
        AdsManagerApp.select(account);
        activityByAccount[key] = _scrapeChangeEvents();
        withActivity++;
      }
    }
  } catch (e) {
    Logger.log('MCC scan error: ' + e.message);
    return { mode: 'mcc', byAccount: byAccount, error: e.message,
             activity: { mode: 'mcc', byAccount: activityByAccount, error: e.message } };
  }

  return {
    mode: 'mcc',
    byAccount: byAccount,
    activity: { mode: 'mcc', byAccount: activityByAccount }
  };
}

/** Scrape change_event for the currently-selected account. */
function _scrapeChangeEvents() {
  var bucket = {
    human: 0, script: 0, googleAuto: 0, other: 0,
    bidBudgetTouches: 0,
    lastHuman: null,
    lastGoogleAuto: null
  };
  try {
    var q = "SELECT change_event.change_date_time, change_event.user_email, " +
            "change_event.client_type, change_event.change_resource_type, " +
            "change_event.resource_change_operation " +
            "FROM change_event " +
            "WHERE change_event.change_date_time DURING LAST_" + ACTIVITY_LOOKBACK_DAYS + "_DAYS " +
            "ORDER BY change_event.change_date_time DESC LIMIT 10000";
    var rows = AdsApp.search(q);
    while (rows.hasNext()) {
      var row = rows.next();
      var ev = row.changeEvent || {};
      var clientType = String(ev.clientType || 'UNKNOWN').toUpperCase();
      var resType = String(ev.changeResourceType || '').toUpperCase();
      var when = ev.changeDateTime || '';
      var user = ev.userEmail || '';

      var isHuman = clientType === 'GOOGLE_ADS_WEB_CLIENT' ||
                    clientType === 'GOOGLE_ADS_EDITOR' ||
                    clientType === 'GOOGLE_ADS_MOBILE_APP';
      var isScript = clientType === 'GOOGLE_ADS_SCRIPTS' ||
                     clientType === 'GOOGLE_ADS_API' ||
                     clientType === 'GOOGLE_ADS_BULK_UPLOAD';
      var isGoogleAuto = clientType === 'GOOGLE_ADS_AUTOMATED_RULE' ||
                         clientType === 'GOOGLE_ADS_RECOMMENDATIONS';

      if (isHuman) {
        bucket.human++;
        if (!bucket.lastHuman) bucket.lastHuman = { user: user, time: when };
        if (resType === 'CAMPAIGN_BUDGET' || resType === 'BIDDING_STRATEGY' ||
            resType === 'CAMPAIGN' || resType === 'AD_GROUP_CRITERION' ||
            resType === 'AD_GROUP' || resType === 'AD_GROUP_AD') {
          bucket.bidBudgetTouches++;
        }
      } else if (isScript) {
        bucket.script++;
      } else if (isGoogleAuto) {
        bucket.googleAuto++;
        if (!bucket.lastGoogleAuto) bucket.lastGoogleAuto = { time: when };
      } else {
        bucket.other++;
      }
    }
  } catch (e) {
    bucket.error = e.message;
  }
  return bucket;
}

/**
 * Merge MCC stats with sheet rows into one ordered list. Every spending MCC
 * sub-account appears; ones running the optimization script also carry the
 * day's DailyDigest row.
 *
 * Sorted by MTD-vs-previous-MTD delta ascending: biggest losers at the top,
 * biggest winners at the bottom. The render layer inserts a group divider
 * between negative and non-negative deltas so the two groups read cleanly.
 *
 * If MCC isn't available, fall back to sheet-only (sub-account install mode).
 */
function _buildUnifiedAccountList(mccStats, digestByAccount) {
  var list = [];

  if (mccStats.mode === 'mcc') {
    for (var key in mccStats.byAccount) {
      var s = mccStats.byAccount[key];
      var d = digestByAccount[key] || null;
      var convMtd = s.convMtd || 0;
      var convPrevMtd = s.convPrevMtd || 0;
      var mtdDeltaPct = convPrevMtd > 0
        ? ((convMtd - convPrevMtd) / convPrevMtd) * 100
        : (convMtd > 0 ? null : 0); // new account / no prior baseline

      var revMtd = s.revMtd || 0;
      var revPrevMtd = s.revPrevMtd || 0;
      var revMtdDeltaPct = revPrevMtd > 0
        ? ((revMtd - revPrevMtd) / revPrevMtd) * 100
        : (revMtd > 0 ? null : 0);

      // Ecommerce detection: explicit mode from digest, or non-zero
      // conversion value in any window (means the account tracks rev).
      var isEcommerce = (d && String(d.mode || '').toUpperCase() === 'ECOMMERCE')
                     || s.revThis > 0 || s.revPrev > 0 || s.revMtd > 0;

      list.push({
        name: s.name,
        cid: s.cid,
        hasScript: !!d,
        isEcommerce: isEcommerce,
        convThis: s.convThis,
        convPrev: s.convPrev,
        costThis: s.costThis,
        convMtd: convMtd,
        convPrevMtd: convPrevMtd,
        costMtd: s.costMtd || 0,
        costPrevMtd: s.costPrevMtd || 0,
        mtdDeltaPct: mtdDeltaPct,
        revThis: s.revThis || 0,
        revPrev: s.revPrev || 0,
        revMtd: revMtd,
        revPrevMtd: revPrevMtd,
        revMtdDeltaPct: revMtdDeltaPct,
        digest: d
      });
    }
    // Losers first (most-negative MTD delta on top), winners at bottom.
    // Accounts with no prior baseline sink to the bottom.
    list.sort(function(a, b) {
      var aN = a.mtdDeltaPct === null;
      var bN = b.mtdDeltaPct === null;
      if (aN && !bN) return 1;
      if (bN && !aN) return -1;
      if (aN && bN) return (b.convMtd || 0) - (a.convMtd || 0);
      return a.mtdDeltaPct - b.mtdDeltaPct;
    });
  } else {
    // Sub-account / sheet-only mode — no MTD data available
    for (var dk in digestByAccount) {
      var dr = digestByAccount[dk];
      list.push({
        name: dr.account,
        cid: null,
        hasScript: true,
        convThis: Number(dr.conv_this_week) || 0,
        convPrev: Number(dr.conv_last_week) || 0,
        costThis: null,
        convMtd: null,
        convPrevMtd: null,
        costMtd: null,
        costPrevMtd: null,
        mtdDeltaPct: null,
        digest: dr
      });
    }
    list.sort(function(a, b) { return (b.convThis || 0) - (a.convThis || 0); });
  }

  return list;
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
    var dateStr = _toDateStr(data[i][0]);
    if (dateStr === todayStr) continue;
    var rowDate = _parseSheetDate(data[i][0]);
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
    var rowDate = _parseSheetDate(data[i][0]);
    if (!rowDate || rowDate < cutoff) continue;
    var acct = data[i][colIdx['account']];
    if (acct) installed[String(acct).toLowerCase().trim()] = true;
  }

  // Iterate all sub-accounts and filter by spend after we have the stats.
  // Filtering with .withCondition("metrics.cost_micros > 0") on
  // AdsManagerApp.accounts() now raises PROHIBITED_METRIC_IN_SELECT_OR_WHERE
  // because cost_micros is not selectable on customer_client.
  var orphans = [];
  try {
    var iter = AdsManagerApp.accounts().get();

    while (iter.hasNext()) {
      var account = iter.next();
      var name = account.getName();
      if (!name) continue;

      var stats7 = account.getStatsFor("LAST_7_DAYS");
      if (stats7.getCost() <= 0) continue; // no spend in the window — ignore
      if (installed[name.toLowerCase().trim()]) continue;

      var stats1 = account.getStatsFor("YESTERDAY");
      orphans.push({
        name: name,
        cid: account.getCustomerId(),
        cost7: stats7.getCost(),
        conv7: stats7.getConversions(),
        cost1: stats1.getCost(),
        conv1: stats1.getConversions(),
        activeYesterday: stats1.getCost() > 0
      });
    }
  } catch (e) {
    Logger.log('Orphan detection error: ' + e.message);
    return { mode: 'mcc', list: [], error: e.message };
  }

  // Highest 7-day spend first — these are the priority installs
  orphans.sort(function(a, b) { return b.cost7 - a.cost7; });
  return { mode: 'mcc', list: orphans };
}

function _renderOrphansSection(orphans) {
  if (orphans.error) {
    return '<div style="padding:15px;background:#fff3e0;color:#e65100;font-size:12px;">Orphan check error: ' + orphans.error + '</div>';
  }
  if (orphans.list.length === 0) {
    return '<div style="padding:10px 15px;background:#e8f5e9;color:#2e7d32;font-size:12px;border-top:1px solid #c8e6c9;">'
         + '✓ Full coverage: every active MCC sub-account (last 7 days) is reporting to the dashboard.'
         + '</div>';
  }

  var totalCost7 = 0, totalCost1 = 0, activeYesterday = 0;
  orphans.list.forEach(function(o) {
    totalCost7 += o.cost7;
    totalCost1 += o.cost1;
    if (o.activeYesterday) activeYesterday++;
  });

  // Prominent red border so it can't be missed — these need action
  var html = '<div style="padding:15px;background:#fff8e1;border-top:3px solid #e65100;border-bottom:1px solid #ffe082;">';
  html += '<h2 style="color:#e65100;margin:0 0 6px;font-size:16px;">⚠ Install script on these ' + orphans.list.length + ' MCC account' + (orphans.list.length > 1 ? 's' : '') + '</h2>';
  html += '<p style="margin:0 0 10px;font-size:13px;color:#5d4037;">';
  html += 'These sub-accounts have spent money in the last 7 days but have no DailyDigest entry — the optimization script is not installed (or has stopped running). ';
  html += '<strong>Total spend last 7d: ' + totalCost7.toFixed(0) + '</strong> (' + activeYesterday + ' still spending yesterday).';
  html += '</p>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<tr style="background:#ffecb3;">';
  html += '<th style="padding:6px 8px;text-align:left;">Account</th>';
  html += '<th style="padding:6px 8px;text-align:left;">CID</th>';
  html += '<th style="padding:6px 8px;text-align:right;">Spend (7d)</th>';
  html += '<th style="padding:6px 8px;text-align:right;">Conv (7d)</th>';
  html += '<th style="padding:6px 8px;text-align:right;">Spend (yest.)</th>';
  html += '<th style="padding:6px 8px;text-align:center;">Active</th>';
  html += '</tr>';
  orphans.list.forEach(function(o) {
    var rowBg = o.activeYesterday ? '#fff' : '#fafafa';
    html += '<tr style="background:' + rowBg + ';border-bottom:1px solid #ffe082;">';
    html += '<td style="padding:6px 8px;font-weight:600;">' + o.name + '</td>';
    html += '<td style="padding:6px 8px;font-family:monospace;color:#666;">' + o.cid + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;font-weight:600;">' + o.cost7.toFixed(0) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;">' + o.conv7.toFixed(0) + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:#888;">' + o.cost1.toFixed(0) + '</td>';
    html += '<td style="padding:6px 8px;text-align:center;">' + (o.activeYesterday ? '<span style="color:#c62828;font-weight:600;">●</span>' : '<span style="color:#bbb;">○</span>') + '</td>';
    html += '</tr>';
  });
  html += '</table>';
  html += '<p style="margin:10px 0 0;font-size:11px;color:#888;">Sorted by 7-day spend (highest priority first). Red dot = still spending yesterday.</p>';
  html += '</div>';
  return html;
}


// ============================================
// HELPERS
// ============================================

// Accept either a bare sheet ID or a full Google Sheets URL.
function _extractSheetId(s) {
  if (!s) return null;
  s = String(s).trim();
  if (!s || s === 'PASTE_SHEET_ID_HERE') return null;
  var m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  // Already a bare ID
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return null;
}

function _escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Compact money format for ecommerce revenue: 1,234 ; 12.5k ; 1.2M.
// No currency symbol because Google Ads sub-accounts can be in different
// currencies and the unified totals would be misleading with a single symbol.
function _fmtMoney(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(2) + 'k';
  return n.toFixed(0);
}

// Send a minimal status email when there's no data to digest, so the user
// gets confirmation that the script ran and a hint about why it's quiet.
function _sendEmptyDigest(today, reasonHtml) {
  var html = '<html><body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#333;">'
    + '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;padding:20px;border-radius:8px 8px 0 0;">'
    + '<h1 style="margin:0;font-size:20px;">Syte Daily Digest</h1>'
    + '<p style="margin:5px 0 0;opacity:0.8;">' + today + ' | no data</p></div>'
    + '<div style="padding:20px;background:#fff8e1;border-top:3px solid #e65100;">'
    + '<h3 style="margin:0 0 8px;color:#e65100;">Nothing to report</h3>'
    + '<p style="margin:0;font-size:13px;color:#5d4037;">' + reasonHtml + '</p>'
    + '</div>'
    + '<div style="padding:15px;color:#999;font-size:11px;text-align:center;">Syte Digital Agency | Daily Digest | syte.co.za</div>'
    + '</body></html>';
  _sendMail('Syte Daily Digest | ' + today + ' | no data', html);
}

// Centralised send so every code path logs quota + result and we can tell
// from the execution log whether delivery actually happened.
function _sendMail(subject, htmlBody) {
  var remaining = -1;
  try { remaining = MailApp.getRemainingDailyQuota(); } catch (qe) { Logger.log('Quota check failed: ' + qe.message); }
  Logger.log('Sending email to "' + EMAIL_TO + '" (remaining daily quota: ' + remaining + ')');
  if (remaining === 0) {
    Logger.log('ABORT: MailApp daily quota exhausted — email will not be sent.');
    return;
  }
  MailApp.sendEmail({ to: EMAIL_TO, subject: subject, htmlBody: htmlBody });
  Logger.log('Email send call returned without error. Subject: ' + subject);
}

function _parseSheetDate(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    // Use the configured TIMEZONE so a Date stored as midnight-in-some-zone
    // collapses to the same calendar day the user thinks of as "today".
    var s = Utilities.formatDate(val, TIMEZONE, 'yyyy-MM-dd');
    var p = s.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  var str = String(val);
  var m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Last resort: let JS try to parse it (handles "Mon May 18 2026 ..." form)
  var d = new Date(str);
  if (isNaN(d.getTime())) return null;
  var s2 = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd').split('-');
  return new Date(Number(s2[0]), Number(s2[1]) - 1, Number(s2[2]));
}

// Normalise a sheet cell value to a yyyy-MM-dd string in TIMEZONE.
// Handles Date objects and any string the sheet might give us.
function _toDateStr(val) {
  var d = _parseSheetDate(val);
  if (!d) return '';
  return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
}

function _median(arr) {
  if (arr.length === 0) return 0;
  var sorted = arr.slice().sort(function(a, b) { return a - b; });
  var mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}


/**
 * Cross-reference anomalies with activity. Returns the list of accounts
 * that have BOTH a DROP and human bid/budget touches in the last week —
 * i.e. the ones a human should look at first.
 */
function _correlatedDropAccounts(activity, anomalies) {
  if (!activity || activity.mode !== 'mcc') return [];
  var out = [];
  for (var i = 0; i < anomalies.length; i++) {
    var a = anomalies[i];
    if (a.severity !== 'drop') continue;
    var bucket = activity.byAccount[a.account];
    if (bucket && bucket.bidBudgetTouches > 0) {
      out.push({ anomaly: a, bucket: bucket });
    }
  }
  return out;
}


function _renderDropCorrelation(activity, anomalies) {
  var correlated = _correlatedDropAccounts(activity, anomalies);
  if (correlated.length === 0) return '';

  var html = '<div style="padding:15px;background:#fff5f5;border-top:3px solid #c62828;border-bottom:1px solid #f0c4c4;">';
  html += '<h3 style="color:#c62828;margin:0 0 6px;">🔥 Lead drop coincides with manual changes (' + correlated.length + ')</h3>';
  html += '<p style="margin:0 0 10px;font-size:12px;color:#666;">These accounts dropped vs their 14-day median AND had human bid/budget/status changes in the last ' + ACTIVITY_LOOKBACK_DAYS + ' days. Start your investigation here.</p>';
  html += '<ul style="font-size:13px;margin:0;padding:0 0 0 20px;">';
  correlated.forEach(function(c) {
    var a = c.anomaly, b = c.bucket;
    html += '<li><strong>' + a.account + '</strong> — '
         + a.today.toFixed(0) + ' conv vs ' + a.baseline.toFixed(0) + ' median '
         + '<span style="color:#c62828;font-weight:600;">(' + a.deltaPct.toFixed(0) + '%)</span>, '
         + b.bidBudgetTouches + ' manual bid/budget/status change' + (b.bidBudgetTouches > 1 ? 's' : '')
         + (b.lastHuman && b.lastHuman.user ? ' (last: ' + b.lastHuman.user + ')' : '')
         + '</li>';
  });
  html += '</ul></div>';
  return html;
}


function _renderActivitySection(activity) {
  if (activity.mode !== 'mcc') return '';

  var entries = [];
  var allZero = true;
  for (var name in activity.byAccount) {
    var b = activity.byAccount[name];
    var total = b.human + b.script + b.googleAuto + b.other;
    if (total > 0) allZero = false;
    entries.push({ name: name, b: b, total: total });
  }

  if (ACTIVITY_HIDE_IF_ALL_ZERO && allZero) return '';

  // Most active first; within that prioritise human-heavy accounts
  entries.sort(function(x, y) {
    if (y.b.human !== x.b.human) return y.b.human - x.b.human;
    return y.total - x.total;
  });

  var html = '<div style="padding:15px;background:#fafafa;border-top:1px solid #eee;">';
  html += '<h3 style="margin:0 0 6px;color:#1a1a2e;font-size:14px;">Recent Activity (last ' + ACTIVITY_LOOKBACK_DAYS + ' days, all MCC accounts with spend)</h3>';
  html += '<p style="margin:0 0 10px;font-size:11px;color:#666;">Changes per account, bucketed by source. <strong style="color:#c62828;">Human</strong> = UI/Editor/mobile app. <strong style="color:#2d6cdf;">Script</strong> = Scripts/API/bulk upload. <strong style="color:#e65100;">Google Auto</strong> = auto-applied recommendations + automated rules.</p>';

  html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<tr style="background:#eceff1;">';
  html += '<th style="padding:6px 8px;text-align:left;">Account</th>';
  html += '<th style="padding:6px 8px;text-align:right;color:#c62828;">Human</th>';
  html += '<th style="padding:6px 8px;text-align:right;">Bid/Budget</th>';
  html += '<th style="padding:6px 8px;text-align:right;color:#2d6cdf;">Script</th>';
  html += '<th style="padding:6px 8px;text-align:right;color:#e65100;">Google Auto</th>';
  html += '<th style="padding:6px 8px;text-align:left;">Last human change</th>';
  html += '</tr>';

  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.total === 0) continue;
    var rowBg = e.b.bidBudgetTouches > 0 ? '#fff5f5' : (i % 2 === 0 ? '#fff' : '#fafbfc');
    html += '<tr style="background:' + rowBg + ';border-bottom:1px solid #eee;">';
    html += '<td style="padding:6px 8px;font-weight:600;">' + e.name + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;font-weight:' + (e.b.human > 0 ? '600' : 'normal') + ';">' + e.b.human + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:' + (e.b.bidBudgetTouches > 0 ? '#c62828' : '#999') + ';font-weight:' + (e.b.bidBudgetTouches > 0 ? '600' : 'normal') + ';">' + e.b.bidBudgetTouches + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:#666;">' + e.b.script + '</td>';
    html += '<td style="padding:6px 8px;text-align:right;color:' + (e.b.googleAuto > 0 ? '#e65100' : '#999') + ';font-weight:' + (e.b.googleAuto > 0 ? '600' : 'normal') + ';">' + e.b.googleAuto + '</td>';
    var lh = e.b.lastHuman;
    html += '<td style="padding:6px 8px;font-size:11px;color:#666;">' + (lh ? (lh.user || 'unknown') + ' · ' + String(lh.time).substring(0, 16) : '—') + '</td>';
    html += '</tr>';
  }
  html += '</table>';

  if (activity.error) {
    html += '<p style="margin:10px 0 0;font-size:11px;color:#c62828;">⚠ Partial data: ' + activity.error + '</p>';
  }

  html += '</div>';
  return html;
}
