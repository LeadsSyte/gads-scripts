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

// Upsert WebCEO projects into the Supabase clients table. WebCEO is the
// source of truth for which clients exist, so this pulls the full project
// list and creates/updates rows matching by wceo_project_id (or falling back
// to the project URL). New clients default to all four services enabled.
//
// Returns { inserted, updated, total }.
export async function syncWebceoClients(upsertClient, existingClients) {
  const resp = await getProjects();
  // WebCEO returns varying shapes depending on API revision; handle both.
  const projects =
    (Array.isArray(resp?.projects) && resp.projects) ||
    (Array.isArray(resp?.data) && resp.data) ||
    (Array.isArray(resp) && resp) ||
    [];

  let inserted = 0, updated = 0;
  const byProjectId = new Map(
    existingClients
      .filter(c => c.wceo_project_id)
      .map(c => [String(c.wceo_project_id), c])
  );
  const byUrl = new Map(
    existingClients
      .map(c => [(c.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, ''), c])
      .filter(([k]) => k)
  );

  for (const p of projects) {
    // WebCEO project shapes seen in the wild:
    //   { project: "ID", site: { domain: "..." }, name: "..." }
    //   { id: "ID", url: "...", name: "..." }
    const pid = String(p.project || p.id || p.project_id || '').trim();
    const url = (p.url || p.site?.domain || p.domain || '').trim();
    const name = (p.name || p.site?.name || url || pid || 'Unnamed').trim();
    if (!pid && !url) continue;

    const normUrl = url.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const match = byProjectId.get(pid) || byUrl.get(normUrl);

    const payload = {
      ...(match || {}),
      name,
      url: url ? (url.startsWith('http') ? url : 'https://' + url) : match?.url || '',
      wceo_project_id: pid || match?.wceo_project_id || '',
      // Default service flags for brand-new clients only.
      ...(match ? {} : {
        does_technical: true,
        does_content: true,
        does_aeo: true,
        does_reporting: true
      })
    };

    await upsertClient(payload);
    if (match) updated++;
    else inserted++;
  }

  return { inserted, updated, total: projects.length };
}
