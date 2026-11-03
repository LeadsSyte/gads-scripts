// Every two minutes: bring open API jobs up to date from the suite's state
// rows and fire webhooks for the ones that finished (brief 2.3 / 2.6). The
// API also refreshes a job whenever it is read, so this only matters for a
// bot that waits for the webhook instead of polling.

import { getServerSupabase } from './lib/serverSupabase.js';
import { supaDb } from './lib/apiCore.js';
import { refreshOpenJobs } from './lib/jobStatus.js';

export const config = { schedule: '*/2 * * * *' };

export default async function handler() {
  try {
    const jobs = await refreshOpenJobs(supaDb(getServerSupabase()), { limit: 200 });
    return new Response('Refreshed ' + jobs.length + ' open job(s).', { status: 200 });
  } catch (e) {
    console.error('[jobs-sweep]', e);
    return new Response('jobs-sweep failed: ' + (e.message || e), { status: 500 });
  }
}
