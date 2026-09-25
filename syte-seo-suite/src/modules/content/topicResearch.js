// Topic research for the Content Engine — browser entry point. Pulls real
// Search Console data for the selected client; the scoring, the Claude topic
// plan and the article research context live in topicResearchCore.js, which
// the server-side Autopilot shares.

import { topQueriesByImpression, topPagesWithQueries } from '../technical/gsc.js';
import { summarizeResearch } from './topicResearchCore.js';

export * from './topicResearchCore.js';

export async function collectResearchData(client, { days = 90 } = {}) {
  if (!client?.gsc_property) {
    throw new Error('This client has no Search Console property set. Open Edit Client → Google Connections to pick one.');
  }

  // Resolve which Google account this client's GSC lives on (same convention as
  // the monthly report). Required under server auth — the proxy attaches that
  // account's token; without it proxyGoogleFetch throws "no Google account bound".
  const gscEmail = client.gsc_account_email || client.google_account_email || null;

  const [queries, pageQueries] = await Promise.all([
    topQueriesByImpression(client.gsc_property, days, gscEmail),
    topPagesWithQueries(client.gsc_property, days, gscEmail)
  ]);

  return summarizeResearch(queries, pageQueries, days);
}
