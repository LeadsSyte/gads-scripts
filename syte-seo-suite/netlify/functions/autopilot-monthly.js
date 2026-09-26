// Starts the Autopilot on the 1st of every month for every client whose
// publishing profile has autopilot_enabled: true. Off for every client by
// default — nothing runs until someone switches a client on.
//
// Staggered: this runs every hour on the 1st (08:00–23:00 SAST) and starts
// at most BATCH clients per pass that have no run for this month yet.
// Starting 20+ clients at once would hit the AI providers' rate limits.

import { getServerSupabase } from './lib/serverSupabase.js';
import { getPublishingProfile } from '../../src/modules/cms/publishingProfile.js';
import { STATE_PREFIX, monthKey } from './lib/autopilot.js';

export const config = { schedule: '0 6-21 1 * *' };
export const BATCH = 4;

// Pure: which enabled clients still need starting this month.
export function clientsToStart(clients, states, month, batch = BATCH) {
  const startedThisMonth = new Set(states.filter(s => s?.month === month).map(s => s.client_id));
  return clients
    .filter(c => getPublishingProfile(c).autopilot_enabled && !startedThisMonth.has(c.id))
    .slice(0, batch);
}

export default async function handler() {
  const auth = process.env.WP_PROXY_AUTH;
  if (!auth) return new Response('WP_PROXY_AUTH not set', { status: 500 });
  const supabase = getServerSupabase();
  const { data: clients, error } = await supabase.from('syte_suite_clients').select('id, name, publishing_profile');
  if (error) return new Response('Client query failed', { status: 500 });
  const { data: rows } = await supabase.from('syte_suite_settings').select('data').like('id', STATE_PREFIX + '%');

  const due = clientsToStart(clients || [], (rows || []).map(r => r.data), monthKey());
  const base = process.env.URL || 'https://syte-seo-suite.netlify.app';
  for (const c of due) {
    await fetch(base + '/.netlify/functions/autopilot-run-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': auth },
      body: JSON.stringify({ clientId: c.id })
    });
  }
  console.log('[autopilot-monthly] started:', due.map(c => c.name).join(', ') || '(none due)');
  return new Response('Started ' + due.length);
}
