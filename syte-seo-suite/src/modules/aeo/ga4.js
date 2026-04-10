import { signInWithGoogle, getGoogleToken } from '../technical/oauth.js';

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export async function ensureGa4Token() {
  let token = getGoogleToken(GA4_SCOPE);
  if (!token) token = await signInWithGoogle(GA4_SCOPE);
  return token;
}

export async function listGa4Properties() {
  const token = await ensureGa4Token();
  const res = await fetch(
    'https://analyticsadmin.googleapis.com/v1beta/accountSummaries',
    { headers: { authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`GA4 Admin error ${res.status}`);
  return res.json();
}

export async function runGa4Report(propertyId) {
  const token = await ensureGa4Token();
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'sessions' },
          { name: 'engagementRate' },
          { name: 'conversions' },
        ],
        limit: 100,
      }),
    }
  );
  if (!res.ok) throw new Error(`GA4 Data error ${res.status}`);
  return res.json();
}
