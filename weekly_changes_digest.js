/**
 * SYTE WEEKLY CHANGES DIGEST — MCC-level
 * ======================================
 * Once-a-week email that answers ONE question per account:
 *   "Were any changes made in the last 7 days — yes or no?"
 *
 * Iterates every MCC sub-account with spend in the last 7 days, queries the
 * change_event GAQL resource for that window, and renders a single email with
 * a per-account row:
 *   Account | Changed? | Total | Human | Script | Google Auto | Last change
 *
 * Standalone — does NOT depend on daily_digest.js. Install at the MCC level
 * and schedule weekly (e.g. Monday 8am).
 *
 * Setup:
 *   1. Paste into Google Ads Scripts at the Syte MCC level
 *   2. Set EMAIL_TO below
 *   3. Schedule weekly
 *   4. Authorize when prompted (AdsManager + Mail)
 */

var EMAIL_TO = 'michaelh@syte.co.za';
var TIMEZONE = 'Africa/Johannesburg';

// 7 to match "last week". change_event supports up to 30 days back.
var LOOKBACK_DAYS = 7;

// If true, accounts with zero changes are shown in a collapsed "no changes" list
// at the bottom instead of in the main table. If false, every spending account
// gets a row whether it changed or not.
var COLLAPSE_UNCHANGED = true;


function main() {
  if (typeof AdsManagerApp === 'undefined') {
    Logger.log('Not running in MCC mode — this script must be installed at the manager account level.');
    return;
  }

  var accounts = _listSpendingAccounts();
  Logger.log('Found ' + accounts.length + ' spending account(s) in last ' + LOOKBACK_DAYS + ' days.');

  var rows = [];
  for (var i = 0; i < accounts.length; i++) {
    var a = accounts[i];
    AdsManagerApp.select(a.account);
    var summary = _queryChangesForCurrentAccount();
    rows.push({
      name: a.name,
      cid: a.cid,
      cost7: a.cost7,
      changed: summary.total > 0,
      total: summary.total,
      human: summary.human,
      script: summary.script,
      googleAuto: summary.googleAuto,
      other: summary.other,
      lastChange: summary.lastChange,
      error: summary.error
    });
  }

  // Most changes first, then by spend
  rows.sort(function(x, y) {
    if (y.total !== x.total) return y.total - x.total;
    return y.cost7 - x.cost7;
  });

  var html = _renderEmail(rows);
  var changedCount = 0;
  for (var k = 0; k < rows.length; k++) if (rows[k].changed) changedCount++;

  var today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  var subject = 'Syte Weekly Changes — ' + changedCount + '/' + rows.length + ' accounts changed (' + today + ')';

  MailApp.sendEmail({ to: EMAIL_TO, subject: subject, htmlBody: html });
  Logger.log('Sent weekly changes digest to ' + EMAIL_TO);
}


function _listSpendingAccounts() {
  var iter = AdsManagerApp.accounts()
    .withCondition("metrics.cost_micros > 0")
    .forDateRange("LAST_" + LOOKBACK_DAYS + "_DAYS")
    .get();

  var list = [];
  while (iter.hasNext()) {
    var account = iter.next();
    var name = account.getName();
    if (!name) continue;
    var stats = account.getStatsFor("LAST_" + LOOKBACK_DAYS + "_DAYS");
    list.push({
      account: account,
      name: name,
      cid: account.getCustomerId(),
      cost7: stats.getCost()
    });
  }
  return list;
}


function _queryChangesForCurrentAccount() {
  var out = {
    human: 0, script: 0, googleAuto: 0, other: 0, total: 0,
    lastChange: null,   // { user, time, source }
    error: null
  };

  try {
    var q = "SELECT change_event.change_date_time, change_event.user_email, " +
            "change_event.client_type " +
            "FROM change_event " +
            "WHERE change_event.change_date_time DURING LAST_" + LOOKBACK_DAYS + "_DAYS " +
            "ORDER BY change_event.change_date_time DESC LIMIT 10000";

    var rows = AdsApp.search(q);
    while (rows.hasNext()) {
      var row = rows.next();
      var ev = row.changeEvent || {};
      var clientType = String(ev.clientType || 'UNKNOWN').toUpperCase();
      var when = ev.changeDateTime || '';
      var user = ev.userEmail || '';

      var source = 'other';
      if (clientType === 'GOOGLE_ADS_WEB_CLIENT' ||
          clientType === 'GOOGLE_ADS_EDITOR' ||
          clientType === 'GOOGLE_ADS_MOBILE_APP') {
        out.human++;
        source = 'human';
      } else if (clientType === 'GOOGLE_ADS_SCRIPTS' ||
                 clientType === 'GOOGLE_ADS_API' ||
                 clientType === 'GOOGLE_ADS_BULK_UPLOAD') {
        out.script++;
        source = 'script';
      } else if (clientType === 'GOOGLE_ADS_AUTOMATED_RULE' ||
                 clientType === 'GOOGLE_ADS_RECOMMENDATIONS') {
        out.googleAuto++;
        source = 'googleAuto';
      } else {
        out.other++;
      }
      out.total++;

      if (!out.lastChange) {
        out.lastChange = { user: user, time: when, source: source };
      }
    }
  } catch (e) {
    out.error = e.message;
  }
  return out;
}


function _renderEmail(rows) {
  var today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  var changed = rows.filter(function(r) { return r.changed; });
  var unchanged = rows.filter(function(r) { return !r.changed; });

  var totals = { human: 0, script: 0, googleAuto: 0, other: 0, total: 0 };
  rows.forEach(function(r) {
    totals.human += r.human;
    totals.script += r.script;
    totals.googleAuto += r.googleAuto;
    totals.other += r.other;
    totals.total += r.total;
  });

  var html = '<html><body style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;color:#333;">';

  // Header
  html += '<div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:white;padding:20px;border-radius:8px 8px 0 0;">';
  html += '<h1 style="margin:0;font-size:20px;">Syte Weekly Changes Digest</h1>';
  html += '<p style="margin:5px 0 0;opacity:0.8;">' + today + ' · last ' + LOOKBACK_DAYS + ' days · ' + rows.length + ' spending account' + (rows.length === 1 ? '' : 's') + '</p>';
  html += '</div>';

  // Totals strip
  html += '<div style="padding:14px 15px;background:#f5f7fa;border-bottom:1px solid #e3e7ec;font-size:13px;">';
  html += '<strong>' + changed.length + '</strong> of ' + rows.length + ' account' + (rows.length === 1 ? '' : 's') + ' had changes · ';
  html += '<strong>' + totals.total + '</strong> total event' + (totals.total === 1 ? '' : 's') + ' ';
  html += '(<span style="color:#c62828;">' + totals.human + ' human</span> · ';
  html += '<span style="color:#2d6cdf;">' + totals.script + ' script</span> · ';
  html += '<span style="color:#e65100;">' + totals.googleAuto + ' google auto</span>';
  if (totals.other > 0) html += ' · ' + totals.other + ' other';
  html += ')</div>';

  // Main table (changed accounts)
  if (changed.length === 0) {
    html += '<div style="padding:20px 15px;background:#e8f5e9;color:#2e7d32;font-size:13px;">';
    html += '✓ No changes detected in any spending account this week.';
    html += '</div>';
  } else {
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<tr style="background:#eceff1;">';
    html += '<th style="padding:8px;text-align:left;">Account</th>';
    html += '<th style="padding:8px;text-align:center;">Changed?</th>';
    html += '<th style="padding:8px;text-align:right;">Total</th>';
    html += '<th style="padding:8px;text-align:right;color:#c62828;">Human</th>';
    html += '<th style="padding:8px;text-align:right;color:#2d6cdf;">Script</th>';
    html += '<th style="padding:8px;text-align:right;color:#e65100;">Google Auto</th>';
    html += '<th style="padding:8px;text-align:left;">Last change</th>';
    html += '</tr>';

    for (var i = 0; i < changed.length; i++) {
      var r = changed[i];
      var rowBg = i % 2 === 0 ? '#fff' : '#fafbfc';
      html += '<tr style="background:' + rowBg + ';border-bottom:1px solid #eee;">';
      html += '<td style="padding:6px 8px;font-weight:600;">' + _escape(r.name) + '<div style="font-size:10px;color:#999;font-family:monospace;">' + r.cid + '</div></td>';
      html += '<td style="padding:6px 8px;text-align:center;color:#2e7d32;font-weight:600;">YES</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-weight:600;">' + r.total + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;color:' + (r.human > 0 ? '#c62828' : '#bbb') + ';font-weight:' + (r.human > 0 ? '600' : 'normal') + ';">' + r.human + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;color:' + (r.script > 0 ? '#2d6cdf' : '#bbb') + ';">' + r.script + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;color:' + (r.googleAuto > 0 ? '#e65100' : '#bbb') + ';">' + r.googleAuto + '</td>';
      var lc = r.lastChange;
      html += '<td style="padding:6px 8px;font-size:11px;color:#666;">';
      if (lc) {
        html += String(lc.time).substring(0, 16);
        if (lc.user) html += ' · ' + _escape(lc.user);
      } else {
        html += '—';
      }
      html += '</td></tr>';

      if (r.error) {
        html += '<tr><td colspan="7" style="padding:4px 8px;font-size:10px;color:#c62828;background:#fff5f5;">⚠ ' + _escape(r.error) + '</td></tr>';
      }
    }
    html += '</table>';
  }

  // Unchanged accounts — collapsed list
  if (COLLAPSE_UNCHANGED && unchanged.length > 0) {
    html += '<div style="padding:14px 15px;background:#fafafa;border-top:1px solid #eee;font-size:12px;color:#666;">';
    html += '<strong>' + unchanged.length + ' account' + (unchanged.length === 1 ? '' : 's') + ' with no changes this week:</strong> ';
    var names = unchanged.map(function(r) { return _escape(r.name); });
    html += names.join(', ');
    html += '</div>';
  }

  html += '<div style="padding:10px 15px;background:#fafafa;color:#999;font-size:10px;border-top:1px solid #eee;border-radius:0 0 8px 8px;">';
  html += 'Source: Google Ads <code>change_event</code> resource · Human = UI / Editor / mobile · Script = Scripts / API / bulk · Google Auto = recommendations + automated rules.';
  html += '</div>';

  html += '</body></html>';
  return html;
}


function _escape(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
