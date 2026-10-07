// A generated monthly report, viewable without a suite login (for review).
// GET ?r=<clientId>-<YYYY-MM>&sig=…  the SEO report
// GET ?e=<clientId>-<YYYY-MM>&sig=…  the AEO report
// sig = HMAC of "<r|e>:<id>" with WP_PROXY_AUTH. Renders the saved report the
// same way the Monthly Report page does (buildMicrositeHtml, or the
// operator's saved edits).

import crypto from 'node:crypto';
import { getServerSupabase } from './lib/serverSupabase.js';
import { previewSig } from './lib/previewSig.js';
import { buildMicrositeHtml } from '../../src/modules/reports/microsite.js';
import { monthKeyLabel } from '../../src/modules/reports/reportMonths.js';
import { compareSnapshots, rankBrandWithCompetitors, normalizeSnapshot } from '../../src/modules/reports/aeoCompare.js';
import { stripBrandedPrompts } from '../../src/modules/reports/brandedQuery.js';

const reply = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' },
  body
});
const msg = (status, text) => reply(status, '<!doctype html><body style="font:15px Arial;padding:40px">' + String(text).replace(/</g, '&lt;') + '</body>');

export async function handler(event) {
  const key = process.env.WP_PROXY_AUTH;
  const qs = event.queryStringParameters || {};
  const kind = qs.e ? 'e' : 'r';
  const aeo = kind === 'e';
  const id = String(qs[kind] || '').replace(/[^a-zA-Z0-9-]/g, '');
  if (!key || !/-\d{4}-\d{2}$/.test(id)) return msg(400, 'Missing or invalid link.');
  const want = previewSig(kind, id, key);
  const got = String(qs.sig || '');
  if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return msg(403, 'This report link is not valid.');

  const clientId = id.slice(0, -8), month = id.slice(-7);
  const supabase = getServerSupabase();
  const [{ data: client }, { data: rows }] = await Promise.all([
    supabase.from('syte_suite_clients').select('*').eq('id', clientId).maybeSingle(),
    supabase.from('syte_suite_report_generated_log').select('*').eq('client_id', clientId).eq('month', month).eq('report_type', aeo ? 'aeo' : 'seo').limit(1)
  ]);
  const row = rows?.[0];
  if (!client || !row?.microsite_json) return msg(404, 'No report found for this month.');
  let html = row.microsite_html_override;
  if (!html && aeo) {
    // Same inputs as the page: this month's measured results, compared with
    // the latest earlier AEO report's.
    const { data: earlier } = await supabase.from('syte_suite_report_generated_log')
      .select('month, aeo_probe').eq('client_id', clientId).eq('report_type', 'aeo').lt('month', month)
      .order('month', { ascending: false }).limit(3);
    const prev = (earlier || []).find(r => r.aeo_probe);
    const aeoProbe = stripBrandedPrompts(normalizeSnapshot(row.aeo_probe || null), client);
    const previous = prev ? stripBrandedPrompts(normalizeSnapshot({ ...prev.aeo_probe, month: prev.month }), client) : null;
    html = buildMicrositeHtml({
      micro: row.microsite_json, client, monthLabel: monthKeyLabel(month), previousMonthLabel: prev ? monthKeyLabel(prev.month) : null,
      rankscale: client.rankscale_url, reportData: null, aeoProbe,
      aeoCompare: aeoProbe ? compareSnapshots(aeoProbe, previous) : null,
      aeoRanking: aeoProbe ? rankBrandWithCompetitors(aeoProbe, client.name) : null,
      aeoOnly: true, seoOnly: false
    });
  }
  if (!html) html = buildMicrositeHtml({
    micro: row.microsite_json, client, monthLabel: monthKeyLabel(month), previousMonthLabel: null,
    rankscale: client.rankscale_url, reportData: row.report_data, aeoProbe: null, aeoCompare: null, aeoRanking: null,
    aeoOnly: false, seoOnly: true
  });
  return reply(200, html.replace(/<head([^>]*)>/i, '<head$1><meta name="robots" content="noindex,nofollow">'));
}
