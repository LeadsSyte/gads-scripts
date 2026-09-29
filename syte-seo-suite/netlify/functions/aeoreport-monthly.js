// Starts the AEO Report Autopilot on the 6th of every month, for every client
// whose publishing profile has aeo_reports_enabled: true (off by default).
// Each report asks three AI engines several hundred questions, so they are
// started a couple at a time: hourly on the 6th, at most AEO_BATCH per pass.

import { getServerSupabase } from './lib/serverSupabase.js';
import { clientsToStart } from './autopilot-monthly.js';
import { AEO_REPORT_STATE_PREFIX } from './lib/aeoReportScan.js';
import { reportMonthFor } from './lib/reportScan.js';

export const AEO_BATCH = 2;
export const config = { schedule: '15 5-22 6 * *' };

export default async function handler() {
  const auth = process.env.WP_PROXY_AUTH;
  if (!auth) return new Response('WP_PROXY_AUTH not set', { status: 500 });
  const supabase = getServerSupabase();
  const { data: clients, error } = await supabase.from('syte_suite_clients').select('id, name, publishing_profile');
  if (error) return new Response('Client query failed', { status: 500 });
  const { data: rows } = await supabase.from('syte_suite_settings').select('data').like('id', AEO_REPORT_STATE_PREFIX + '%');
  const month = reportMonthFor();

  const due = clientsToStart(clients || [], (rows || []).map(r => r.data), month, AEO_BATCH, 'aeo_reports_enabled');
  const base = process.env.URL || 'https://syte-seo-suite.netlify.app';
  for (const c of due) {
    await fetch(base + '/.netlify/functions/aeoreport-run-background', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': auth },
      body: JSON.stringify({ clientId: c.id, month })
    });
  }
  console.log('[aeoreport-monthly] started:', due.map(c => c.name).join(', ') || '(none due)');
  return new Response('Started ' + due.length);
}
