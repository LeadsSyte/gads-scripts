import { ensureToken, SCOPES } from '../technical/googleAuth.js';
import { serverAuthEnabled, proxyGoogleFetch } from '../../lib/googleServerAuth.js';

// `expectedEmail` is the Google account this client's GA4 lives in. Under
// server auth the proxy REQUIRES it (it holds one refresh token per account);
// in browser mode it selects the right cached token. Without it this module
// was browser-only, so every AEO run lost its GA4 traffic ranking the moment
// the suite moved to server-managed accounts.
async function gFetch(url, init = {}, expectedEmail = null) {
  let res;
  if (serverAuthEnabled()) {
    res = await proxyGoogleFetch(url, { method: init.method || 'GET', body: init.body }, expectedEmail);
  } else {
    const token = await ensureToken([SCOPES.ga4], { expectedEmail });
    res = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: 'Bearer ' + token.access_token,
        'Content-Type': 'application/json'
      }
    });
  }
  if (!res.ok) throw new Error('GA4 ' + res.status + ' ' + await res.text());
  return res.json();
}

export async function listAccountSummaries(expectedEmail = null) {
  return gFetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', {}, expectedEmail);
}

export async function runReport(propertyId, days = 30, expectedEmail = null) {
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
    },
    expectedEmail
  );
}
