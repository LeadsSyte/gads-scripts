// Starts the Autopilot on the 1st of every month (08:00 SAST) for every
// client whose publishing profile has autopilot_enabled: true. Off for every
// client by default — nothing runs until someone switches a client on.

import { getServerSupabase } from './lib/serverSupabase.js';
import { getPublishingProfile } from '../../src/modules/cms/publishingProfile.js';

export const config = { schedule: '0 6 1 * *' };

export default async function handler() {
  const auth = process.env.WP_PROXY_AUTH;
  if (!auth) return new Response('WP_PROXY_AUTH not set', { status: 500 });
  const supabase = getServerSupabase();
  const { data: clients, error } = await supabase.from('syte_suite_clients').select('id, name, publishing_profile');
  if (error) return new Response('Client query failed', { status: 500 });

  const base = process.env.URL || 'https://syte-seo-suite.netlify.app';
  const started = [];
  for (const c of clients || []) {
    if (!getPublishingProfile(c).autopilot_enabled) continue;
    await fetch(base + '/.netlify/functions/autopilot-run-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': auth },
      body: JSON.stringify({ clientId: c.id })
    });
    started.push(c.name);
  }
  console.log('[autopilot-monthly] started for:', started.join(', ') || '(none enabled)');
  return new Response('Started ' + started.length);
}
