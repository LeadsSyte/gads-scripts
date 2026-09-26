// A client's fix sheet (src/modules/technical/fixSheet.js): the Technical
// SEO and AEO work the suite can't apply itself, as a printable page for a
// developer or plain text for a Grok Bot.
//
// GET ?s=<clientId>&sig=…[&format=text]
// sig = HMAC of "s:<clientId>" with WP_PROXY_AUTH (minted by the suite), so
// the link can be sent to a developer without a suite login.

import crypto from 'node:crypto';
import { getServerSupabase } from './lib/serverSupabase.js';
import { previewSig } from './lib/previewSig.js';
import { buildFixSheet, renderFixSheetHtml, renderFixSheetText } from '../../src/modules/technical/fixSheet.js';

const reply = (status, body, type = 'text/html; charset=utf-8') => ({
  statusCode: status,
  headers: { 'Content-Type': type, 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' },
  body
});

export async function handler(event) {
  const key = process.env.WP_PROXY_AUTH;
  const qs = event.queryStringParameters || {};
  const clientId = String(qs.s || '').replace(/[^a-zA-Z0-9-]/g, '');
  if (!key || !clientId) return reply(400, 'Missing or invalid link.', 'text/plain');
  const want = previewSig('s', clientId, key);
  const got = String(qs.sig || '');
  if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return reply(403, 'This fix sheet link is not valid.', 'text/plain');
  }

  const supabase = getServerSupabase();
  const [client, tasks, techFixRows, aeo, aeoFixRows] = await Promise.all([
    supabase.from('syte_suite_clients').select('id, name, url, cms_type').eq('id', clientId).maybeSingle(),
    supabase.from('syte_suite_tseo_tasks').select('*').eq('client_id', clientId).eq('status', 'open'),
    supabase.from('syte_suite_settings').select('data').like('id', 'techfix:' + clientId + ':%'),
    supabase.from('syte_suite_aeo_results').select('url, optimizations').eq('client_id', clientId),
    supabase.from('syte_suite_settings').select('data').like('id', 'aeofix:' + clientId + ':%')
  ]);
  if (!client.data) return reply(404, 'Client not found.', 'text/plain');

  const sheet = buildFixSheet({
    client: client.data,
    techTasks: tasks.data || [],
    techFixes: Object.fromEntries((techFixRows.data || []).map(r => [r.data?.task_id, r.data])),
    aeoRows: aeo.data || [],
    aeoFixes: Object.fromEntries((aeoFixRows.data || []).map(r => [r.data?.url + '|' + r.data?.opt_key, r.data]))
  });
  return qs.format === 'text'
    ? reply(200, renderFixSheetText(sheet), 'text/plain; charset=utf-8')
    : reply(200, renderFixSheetHtml(sheet));
}
