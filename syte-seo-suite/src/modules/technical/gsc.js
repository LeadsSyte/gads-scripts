import { ensureToken, SCOPES } from './googleAuth.js';

async function gscFetch(path, init = {}) {
  const token = await ensureToken([SCOPES.gsc]);
  const res = await fetch('https://searchconsole.googleapis.com' + path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: 'Bearer ' + token.access_token,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) throw new Error('GSC ' + res.status + ' ' + await res.text());
  return res.json();
}

export async function listSites() {
  return gscFetch('/webmasters/v3/sites');
}

export async function querySearchAnalytics(siteUrl, days = 28) {
  const end = new Date();
  const start = new Date(Date.now() - days * 86400000);
  return gscFetch('/webmasters/v3/sites/' + encodeURIComponent(siteUrl) + '/searchAnalytics/query', {
    method: 'POST',
    body: JSON.stringify({
      startDate: start.toISOString().slice(0, 10),
      endDate:   end.toISOString().slice(0, 10),
      dimensions: ['page'],
      rowLimit: 500
    })
  });
}
