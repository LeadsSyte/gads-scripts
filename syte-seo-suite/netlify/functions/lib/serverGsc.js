// Search Console from the server, for the Autopilot. Uses the same stored
// refresh tokens as google-proxy (syte_suite_google_accounts), so a client
// works here exactly when its Google account is connected in the suite.

async function accessTokenFor(supabase, email) {
  const key = String(email || '').toLowerCase();
  const { data, error } = await supabase
    .from('syte_suite_google_accounts')
    .select('refresh_token, revoked')
    .eq('email', key)
    .single();
  if (error || !data) throw new Error('No connected Google account for ' + email);
  if (data.revoked) throw new Error('Google account ' + email + ' is disconnected');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: data.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  const tok = await res.json();
  if (!res.ok || !tok.access_token) throw new Error('Google token refresh failed for ' + email + ': ' + (tok.error || res.status));
  return tok.access_token;
}

async function searchAnalytics(token, siteUrl, days, dimensions, rowLimit) {
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const res = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(siteUrl) + '/searchAnalytics/query', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate, endDate, dimensions, rowLimit, startRow: 0 }),
    signal: AbortSignal.timeout(45000)
  });
  if (!res.ok) throw new Error('Search Console ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return (await res.json()).rows || [];
}

// Page-level traffic for the Technical SEO scan (same query the Technical
// SEO page sends: last 28 days, dimension page, 100 rows).
export async function fetchGscPages(supabase, client, days = 28) {
  if (!client?.gsc_property) return null;
  const email = client.gsc_account_email || client.google_account_email;
  if (!email) return null;
  const token = await accessTokenFor(supabase, email);
  return searchAnalytics(token, client.gsc_property, days, ['page'], 100);
}

// Returns { queries, pageQueries } in the same row shape as gsc.js.
export async function fetchGscForClient(supabase, client, days = 90) {
  if (!client?.gsc_property) throw new Error('No Search Console property set for this client');
  const email = client.gsc_account_email || client.google_account_email;
  if (!email) throw new Error('No Google account bound to this client');
  const token = await accessTokenFor(supabase, email);
  const [qRows, pqRows] = await Promise.all([
    searchAnalytics(token, client.gsc_property, days, ['query'], 1000),
    searchAnalytics(token, client.gsc_property, days, ['page', 'query'], 2500)
  ]);
  const num = r => ({ clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || 0 });
  return {
    queries: qRows.map(r => ({ query: r.keys[0], ...num(r) })).sort((a, b) => b.impressions - a.impressions),
    pageQueries: pqRows.map(r => ({ page: r.keys[0], query: r.keys[1], ...num(r) }))
  };
}
