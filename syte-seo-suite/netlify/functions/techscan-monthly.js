// Starts the Tech Autopilot on the 2nd of every month (a day after the
// content run) for every client whose publishing profile has
// techscan_enabled: true — off for every client by default. Staggered like
// autopilot-monthly: hourly on the 2nd, at most BATCH clients per pass.

import { getServerSupabase } from './lib/serverSupabase.js';
import { clientsToStart, BATCH } from './autopilot-monthly.js';
import { TECH_STATE_PREFIX } from './lib/techScan.js';

export const config = { schedule: '30 6-21 2 * *' };

export default async function handler() {
  const auth = process.env.WP_PROXY_AUTH;
  if (!auth) return new Response('WP_PROXY_AUTH not set', { status: 500 });
  const supabase = getServerSupabase();
  const { data: clients, error } = await supabase.from('syte_suite_clients').select('id, name, publishing_profile');
  if (error) return new Response('Client query failed', { status: 500 });
  const { data: rows } = await supabase.from('syte_suite_settings').select('data').like('id', TECH_STATE_PREFIX + '%');
  const month = new Date().toISOString().slice(0, 7);

  const due = clientsToStart(clients || [], (rows || []).map(r => r.data), month, BATCH, 'techscan_enabled');
  const base = process.env.URL || 'https://syte-seo-suite.netlify.app';
  for (const c of due) {
    await fetch(base + '/.netlify/functions/techscan-run-background', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': auth },
      body: JSON.stringify({ clientId: c.id })
    });
  }
  console.log('[techscan-monthly] started:', due.map(c => c.name).join(', ') || '(none due)');
  return new Response('Started ' + due.length);
}
