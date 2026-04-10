import { ensureToken, SCOPES } from '../technical/googleAuth.js';

async function gFetch(url, init = {}) {
  const token = await ensureToken([SCOPES.ga4]);
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: 'Bearer ' + token.access_token,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) throw new Error('GA4 ' + res.status + ' ' + await res.text());
  return res.json();
}

export async function listAccountSummaries() {
  return gFetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries');
}

export async function runReport(propertyId, days = 30) {
  return gFetch(
    'https://analyticsdata.googleapis.com/v1beta/properties/' + propertyId + ':runReport',
    {
      method: 'POST',
      body: JSON.stringify({
        dateRanges: [{ startDate: days + 'daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'sessions' },
          { name: 'engagementRate' },
          { name: 'conversions' }
        ],
        limit: 200
      })
    }
  );
}
