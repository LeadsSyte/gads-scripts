// WebCEO API calls via the Netlify proxy to avoid CORS.

const PROXY = '/.netlify/functions/webceo-proxy';

export async function webceoRequest(endpoint, body = {}) {
  const res = await fetch(PROXY, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, body }),
  });
  if (!res.ok) throw new Error(`WebCEO proxy error ${res.status}`);
  return res.json();
}

export async function getAuditData(projectId) {
  return webceoRequest('get_project_overview', { project_id: projectId });
}
