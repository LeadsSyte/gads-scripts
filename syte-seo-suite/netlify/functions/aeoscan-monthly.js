// Starts the AEO Autopilot on the 3rd of every month for every client whose
// publishing profile has aeoscan_enabled: true — off by default. Staggered
// like autopilot-monthly: hourly on the 3rd, at most BATCH clients per pass.

import { getServerSupabase } from './lib/serverSupabase.js';
import { clientsToStart, BATCH } from './autopilot-monthly.js';
import { AEO_STATE_PREFIX } from './lib/aeoScan.js';

export const config = { schedule: '15 6-21 3 * *' };

export default async function handler() {
  const auth = process.env.WP_PROXY_AUTH;
  if (!auth) return new Response('WP_PROXY_AUTH not set', { status: 500 });
  const supabase = getServerSupabase();
  const { data: clients, error } = await supabase.from('syte_suite_clients').select('id, name, publishing_profile');
  if (error) return new Response('Client query failed', { status: 500 });
  const { data: rows } = await supabase.from('syte_suite_settings').select('data').like('id', AEO_STATE_PREFIX + '%');
  const month = new Date().toISOString().slice(0, 7);

  const due = clientsToStart(clients || [], (rows || []).map(r => r.data), month, BATCH, 'aeoscan_enabled');
  const base = process.env.URL || 'https://syte-seo-suite.netlify.app';
  for (const c of due) {
    await fetch(base + '/.netlify/functions/aeoscan-run-background', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': auth },
      body: JSON.stringify({ clientId: c.id })
    });
  }
  console.log('[aeoscan-monthly] started:', due.map(c => c.name).join(', ') || '(none due)');
  return new Response('Started ' + due.length);
}
