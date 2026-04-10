// Thin wrapper around the WebCEO API via the Netlify proxy function.
// The proxy avoids CORS and hides the API key server-side.

const PROXY_URL = '/.netlify/functions/webceo-proxy';

export async function webceoCall(endpoint, params = {}) {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, params })
  });
  if (!res.ok) throw new Error('WebCEO proxy error ' + res.status);
  return res.json();
}

export async function getAudit(projectId) {
  return webceoCall('get_site_audit', { project: projectId });
}

export async function getProjects() {
  return webceoCall('get_projects', {});
}
