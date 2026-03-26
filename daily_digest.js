/**
 * SYTE DAILY DIGEST — Consolidated Report
 * ========================================
 * Reads today's run summaries from the DailyDigest tab in the master sheet
 * and sends ONE email with all accounts' performance.
 *
 * This is a STANDALONE Google Ads Script — not loaded via the core.
 * It runs in ONE Google Ads account (e.g. the Syte MCC or any account).
 *
 * Setup:
 * 1. Paste into Google Ads Scripts in ANY one account
 * 2. Set SHEET_ID to your master Google Sheet ID
 * 3. Set EMAIL_TO to the recipient(s)
 * 4. Schedule daily at 9am (after all client scripts have run)
 * 5. Authorize Sheets access
 */

var SHEET_ID = 'PASTE_SHEET_ID_HERE';  // Master Google Sheet ID
var EMAIL_TO = 'michaelh@syte.co.za';

function main() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('DailyDigest');
  if (!sheet) { Logger.log('No DailyDigest tab found'); return; }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) { Logger.log('No data in DailyDigest'); return; }

  var headers = data[0];
  var today = Utilities.formatDate(new Date(), 'Africa/Johannesburg', 'yyyy-MM-dd');

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

  // Per-account table
  email += '<div style="padding:15px;"><table style="width:100%;border-collapse:collapse;font-size:12px;">';
  email += '<tr style="background:#e3f2fd;">';
  email += '<th style="padding:8px;text-align:left;">Account</th>';
  email += '<th style="padding:8px;text-align:center;">Mode</th>';
  email += '<th style="padding:8px;text-align:center;">Run</th>';
  email += '<th style="padding:8px;text-align:right;">Conv</th>';
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
    var rowBg = hasErrors ? '#ffebee' : (i % 2 === 0 ? '#fff' : '#fafbfc');
    var convW = Number(r.conv_this_week) || 0;
    var convL = Number(r.conv_last_week) || 0;
    var convTrend = convL > 0 ? (convW >= convL ? '↑' : '↓') : '—';
    var convTrendColor = convW >= convL ? '#2e7d32' : '#c62828';

    email += '<tr style="background:' + rowBg + ';border-bottom:1px solid #eee;">';
    email += '<td style="padding:6px 8px;font-weight:600;">' + r.account + '</td>';
    email += '<td style="padding:6px 8px;text-align:center;font-size:11px;">' + r.mode + '</td>';
    email += '<td style="padding:6px 8px;text-align:center;"><span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;background:' + (isPreview ? '#fff3e0;color:#e65100' : '#e8f5e9;color:#2e7d32') + ';">' + r.run_mode + '</span></td>';
    email += '<td style="padding:6px 8px;text-align:right;">' + convW.toFixed(0) + ' <span style="color:' + convTrendColor + ';">' + convTrend + '</span></td>';
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

  // Accounts needing attention
  var attention = todayRows.filter(function(r) {
    return (Number(r.errors) || 0) > 0 ||
           (Number(r.ai_review) || 0) > 10 ||
           (Number(r.conv_this_week) || 0) < (Number(r.conv_last_week) || 0) * 0.5;
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
      var cw = Number(ra.conv_this_week) || 0, cl = Number(ra.conv_last_week) || 0;
      if (cl > 0 && cw < cl * 0.5) issues.push('Conversions dropped ' + ((1 - cw / cl) * 100).toFixed(0) + '%');
      email += '<li><strong>' + ra.account + '</strong> — ' + issues.join(', ') + '</li>';
    }
    email += '</ul></div>';
  }

  email += '<div style="padding:15px;color:#999;font-size:11px;text-align:center;">Syte Digital Agency | Daily Digest | syte.co.za</div>';
  email += '</body></html>';

  // Send
  MailApp.sendEmail({
    to: EMAIL_TO,
    subject: 'Syte Daily Digest | ' + today + ' | ' + todayRows.length + ' accounts | ' + totals.convThis.toFixed(0) + ' conv',
    htmlBody: email
  });

  Logger.log('Daily digest sent: ' + todayRows.length + ' accounts');
}
