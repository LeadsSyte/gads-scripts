import { ensureToken, SCOPES } from './googleAuth.js';

async function gscFetch(path, init = {}, { expectedEmail = null } = {}) {
  const token = await ensureToken([SCOPES.gsc], { expectedEmail });
  const res = await fetch('https://searchconsole.googleapis.com' + path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: 'Bearer ' + token.access_token,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    // Surface the API-disabled error with the same hint as the picker.
    if (res.status === 403 && /has not been used in project/i.test(txt)) {
      const err = new Error('Search Console API is not enabled on your Google Cloud project. Open Google Cloud Console → APIs → enable Search Console API, wait 60s, try again.');
      err.apiDisabled = true;
      throw err;
    }
    // Per-property permission error — Google account not added as user/owner.
    if (res.status === 403 && /does not have sufficient permission/i.test(txt)) {
      const siteMatch = txt.match(/site '([^']+)'/);
      const site = siteMatch ? siteMatch[1] : 'this property';
      const err = new Error(`No GSC access to ${site}. Your Google account needs to be added as a user or owner in Search Console for this specific property. This is NOT a login issue — your token is valid, but GSC requires per-property permissions.`);
      err.permissionDenied = true;
      throw err;
    }
    throw new Error('GSC ' + res.status + ' ' + txt.slice(0, 300));
  }
  return res.json();
}

export async function listSites() {
  return gscFetch('/webmasters/v3/sites');
}

// Generic keyword/page query. `dimensions` is an array like ['query'],
// ['page'], or ['query', 'page']. Caller decides timeframe and row limit.
// `expectedEmail` pins which Google account's cached token gets used —
// lets a single client pull GSC from one account while GA4 lives in
// another.
export async function querySearchAnalytics(siteUrl, {
  days = 90,
  dimensions = ['query'],
  rowLimit = 1000,
  startRow = 0,
  startDate,
  endDate,
  expectedEmail = null
} = {}) {
  const ed = endDate || new Date().toISOString().slice(0, 10);
  const sd = startDate || new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return gscFetch('/webmasters/v3/sites/' + encodeURIComponent(siteUrl) + '/searchAnalytics/query', {
    method: 'POST',
    body: JSON.stringify({
      startDate: sd,
      endDate: ed,
      dimensions,
      rowLimit,
      startRow
    })
  }, { expectedEmail });
}

// Convenience wrappers used by the Content Engine topic researcher.
export async function topQueriesByImpression(siteUrl, days = 90) {
  const data = await querySearchAnalytics(siteUrl, { days, dimensions: ['query'], rowLimit: 1000 });
  return (data.rows || [])
    .map(r => ({
      query: r.keys[0],
      clicks: r.clicks || 0,
      impressions: r.impressions || 0,
      ctr: r.ctr || 0,
      position: r.position || 0
    }))
    .sort((a, b) => b.impressions - a.impressions);
}

export async function topPagesWithQueries(siteUrl, days = 90) {
  const data = await querySearchAnalytics(siteUrl, {
    days,
    dimensions: ['page', 'query'],
    rowLimit: 2500
  });
  return (data.rows || []).map(r => ({
    page: r.keys[0],
    query: r.keys[1],
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: r.ctr || 0,
    position: r.position || 0
  }));
}
