// A generated monthly report, viewable without a suite login (for review).
// GET ?r=<clientId>-<YYYY-MM>&sig=… — sig = HMAC of "r:<id>" with
// WP_PROXY_AUTH. Renders the saved report the same way the Monthly Report
// page does (buildMicrositeHtml, or the operator's saved edits).

import crypto from 'node:crypto';
import { getServerSupabase } from './lib/serverSupabase.js';
import { previewSig } from './lib/previewSig.js';
import { buildMicrositeHtml } from '../../src/modules/reports/microsite.js';
import { monthKeyLabel } from '../../src/modules/reports/reportMonths.js';

const reply = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' },
  body
});
const msg = (status, text) => reply(status, '<!doctype html><body style="font:15px Arial;padding:40px">' + String(text).replace(/</g, '&lt;') + '</body>');

export async function handler(event) {
  const key = process.env.WP_PROXY_AUTH;
  const qs = event.queryStringParameters || {};
  const id = String(qs.r || '').replace(/[^a-zA-Z0-9-]/g, '');
  if (!key || !/-\d{4}-\d{2}$/.test(id)) return msg(400, 'Missing or invalid link.');
  const want = previewSig('r', id, key);
  const got = String(qs.sig || '');
  if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return msg(403, 'This report link is not valid.');

  const clientId = id.slice(0, -8), month = id.slice(-7);
  const supabase = getServerSupabase();
  const [{ data: client }, { data: rows }] = await Promise.all([
    supabase.from('syte_suite_clients').select('*').eq('id', clientId).maybeSingle(),
    supabase.from('syte_suite_report_generated_log').select('*').eq('client_id', clientId).eq('month', month).eq('report_type', 'seo').limit(1)
  ]);
  const row = rows?.[0];
  if (!client || !row?.microsite_json) return msg(404, 'No report found for this month.');
  const html = row.microsite_html_override || buildMicrositeHtml({
    micro: row.microsite_json, client, monthLabel: monthKeyLabel(month), previousMonthLabel: null,
    rankscale: client.rankscale_url, reportData: row.report_data, aeoProbe: null, aeoCompare: null, aeoRanking: null,
    aeoOnly: false, seoOnly: true
  });
  return reply(200, html.replace(/<head([^>]*)>/i, '<head$1><meta name="robots" content="noindex,nofollow">'));
}
