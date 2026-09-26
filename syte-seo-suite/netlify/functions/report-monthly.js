// Starts the Report Autopilot on the 5th of every month — Search Console
// data for the previous month has settled by then — for every client whose
// publishing profile has reports_enabled: true (off by default). Staggered:
// hourly on the 5th, at most BATCH clients per pass.

import { getServerSupabase } from './lib/serverSupabase.js';
import { clientsToStart, BATCH } from './autopilot-monthly.js';
import { REPORT_STATE_PREFIX, reportMonthFor } from './lib/reportScan.js';

export const config = { schedule: '45 6-21 5 * *' };

export default async function handler() {
  const auth = process.env.WP_PROXY_AUTH;
  if (!auth) return new Response('WP_PROXY_AUTH not set', { status: 500 });
  const supabase = getServerSupabase();
  const { data: clients, error } = await supabase.from('syte_suite_clients').select('id, name, publishing_profile');
  if (error) return new Response('Client query failed', { status: 500 });
  const { data: rows } = await supabase.from('syte_suite_settings').select('data').like('id', REPORT_STATE_PREFIX + '%');
  const month = reportMonthFor();

  // A run's state carries the REPORT month, so "already started" means a run
  // for last month exists.
  const due = clientsToStart(clients || [], (rows || []).map(r => r.data), month, BATCH, 'reports_enabled');
  const base = process.env.URL || 'https://syte-seo-suite.netlify.app';
  for (const c of due) {
    await fetch(base + '/.netlify/functions/report-run-background', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': auth },
      body: JSON.stringify({ clientId: c.id, month })
    });
  }
  console.log('[report-monthly] started:', due.map(c => c.name).join(', ') || '(none due)');
  return new Response('Started ' + due.length);
}
