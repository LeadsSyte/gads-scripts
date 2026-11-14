// CMS → Connector "Website login" form (lib/siteLogin.js).
// POST { clientId, action: 'get' | 'save' | 'clear', login_url?, username?, password?, notes? }
// with suite credentials (a person in the suite; bot keys are refused).
// → { set, login_url, username, notes, has_password, updated_at } — never the password.

import { authorize, fromEvent } from './lib/requireAuth.js';
import { getServerSupabase } from './lib/serverSupabase.js';
import { publicLoginInfo, mergeLogin } from './lib/siteLogin.js';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

export async function handler(event, { supabase: injected } = {}) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  const auth = await authorize(fromEvent(event));
  if (!auth.ok) return json(auth.status, { error: auth.reason || 'Not allowed.' });
  if (auth.actor.kind === 'api_key') return json(403, { error: 'Logins are entered by a person in the suite, not by an API key.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'The body must be JSON.' }); }
  const clientId = String(body.clientId || '').replace(/[^a-zA-Z0-9-]/g, '');
  if (!clientId) return json(400, { error: 'clientId is required.' });
  const action = body.action || 'get';
  if (!['get', 'save', 'clear'].includes(action)) return json(400, { error: 'action must be get, save or clear.' });

  const supabase = injected || getServerSupabase();
  const { data: client } = await supabase.from('syte_suite_clients').select('id').eq('id', clientId).maybeSingle();
  if (!client) return json(404, { error: 'No such client.' });
  const { data: row, error } = await supabase.from('syte_suite_client_secrets').select('site_login').eq('client_id', clientId).maybeSingle();
  if (error) {
    const missing = /site_login|column/i.test(error.message || '');
    return json(missing ? 503 : 500, { error: missing ? 'Website logins are not set up yet: run supabase-schema-site-logins.sql in the Supabase SQL Editor.' : 'Could not read the stored login.' });
  }
  const prev = row?.site_login || null;
  if (action === 'get') return json(200, publicLoginInfo(prev));

  let next = null;
  if (action === 'save') {
    try { next = mergeLogin(prev, body, { by: auth.actor.email || auth.actor.name || 'the suite' }); }
    catch (e) { return json(400, { error: e.message }); }
  }
  const { error: upErr } = await supabase.from('syte_suite_client_secrets')
    .upsert({ client_id: clientId, site_login: next, updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
  if (upErr) return json(500, { error: 'Could not save the login.' });
  return json(200, publicLoginInfo(next));
}
