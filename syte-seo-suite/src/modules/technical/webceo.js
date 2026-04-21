// WebCEO API wrapper — ported from the previous working Technical SEO tool.
// Every call goes through the Netlify proxy so CORS and the API key stay
// server-side. The request shape is { endpoint, body } — the proxy turns
// that into POST https://api.webceo.com/{endpoint}/ with { key, ...body }.

const PROXY = '/.netlify/functions/webceo-proxy';

export async function webceoRequest(endpoint, body = {}) {
  const res = await fetch(PROXY, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, body })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`WebCEO proxy error ${res.status} ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// Send a raw payload to WebCEO — supports the module+action API format.
export async function webceoRaw(payload) {
  const res = await fetch(PROXY, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ raw: payload })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`WebCEO proxy error ${res.status} ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// Per-project audit data — fetch DETAILED issues, not just the overview.
// WebCEO has two API formats:
//   OLD: { method: "get_project_overview", project_id: "..." }
//   NEW: { module: "site_audit", action: "get_report", project: "..." }
// We try both formats with multiple method/module names.
export async function getAudit(projectId) {
  const results = {};

  // Format A: the old { method, ...params } style.
  const oldStyle = [
    { key: 'overview', method: 'get_project_overview', body: { project_id: projectId } },
    { key: 'sa_results', method: 'get_sa_results', body: { project: projectId } },
    { key: 'get_sa_report', method: 'get_sa_report', body: { project: projectId, project_id: projectId } }
  ];

  // Format B: the module+action style (WebCEO v3 API).
  const modStyle = [
    { key: 'sa_report', module: 'site_audit', action: 'get_report', project: projectId },
    { key: 'sa_results_v2', module: 'site_audit', action: 'get_results', project: projectId },
    { key: 'sa_issues_v2', module: 'site_audit', action: 'get_issues', project: projectId },
    { key: 'sa_errors', module: 'site_audit', action: 'get_errors', project: projectId },
    { key: 'sa_all', module: 'site_audit', action: 'get_all', project: projectId },
    { key: 'tech_audit', module: 'technical_audit', action: 'get_report', project: projectId },
    { key: 'int_links', module: 'internal_links', action: 'get_report', project: projectId }
  ];

  function isErr(data) {
    if (!data || typeof data !== 'object') return 'empty';
    if (Array.isArray(data) && data[0]?.errormsg) return data[0].errormsg;
    if (data.errormsg) return data.errormsg;
    if (data.error) return typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
    return null;
  }

  // Try old-style methods.
  const oldFetches = oldStyle.map(async ({ key, method, body }) => {
    try {
      const data = await webceoRequest(method, body);
      const err = isErr(data);
      if (!err) { results[key] = data; console.log(`[WebCEO] method:${method} ✓`, typeof data === 'object' ? (Array.isArray(data) ? data.length + ' items' : Object.keys(data).slice(0, 5).join(', ')) : typeof data); }
      else console.log(`[WebCEO] method:${method} →`, err);
    } catch (e) { console.log(`[WebCEO] method:${method} fail:`, e.message); }
  });

  // Try module+action methods.
  const modFetches = modStyle.map(async ({ key, module, action, project }) => {
    try {
      const data = await webceoRaw({ module, action, project });
      const err = isErr(data);
      if (!err) { results[key] = data; console.log(`[WebCEO] ${module}/${action} ✓`, typeof data === 'object' ? (Array.isArray(data) ? data.length + ' items' : Object.keys(data).slice(0, 5).join(', ')) : typeof data); }
      else console.log(`[WebCEO] ${module}/${action} →`, err);
    } catch (e) { console.log(`[WebCEO] ${module}/${action} fail:`, e.message); }
  });

  await Promise.all([...oldFetches, ...modFetches]);

  const successCount = Object.keys(results).length;
  console.log(`[WebCEO] ${successCount} endpoint(s) returned data:`, Object.keys(results).join(', '));

  if (successCount === 0) {
    console.warn('[WebCEO] ALL endpoints failed. The API key or project ID may be wrong, or the API format has changed.');
    return null;
  }

  return results;
}

// Legacy alias so any code still calling getAuditData keeps working.
export const getAuditData = getAudit;

// ---------------------------------------------------------------------------
// Project listing — NEW relative to the previous tool, which didn't list
// projects at all (clients were entered manually with their WebCEO project
// ID). WebCEO's docs list `get_project_list` as the canonical method but a
// couple of variants exist. Try each URL-path endpoint and return the first
// one that responds with something that isn't an error envelope.
// ---------------------------------------------------------------------------

function isErrorResponse(resp) {
  if (!resp || typeof resp !== 'object') return 'empty';
  // Batch format: [{ method, result, errormsg }]
  if (Array.isArray(resp) && resp[0]?.errormsg) return resp[0].errormsg;
  if (resp.errormsg) return resp.errormsg;
  if (resp.error) return resp.error;
  if (resp.status === 'error') return resp.message || 'error';
  // Numeric `result` in a single-object response is a status code.
  if (Array.isArray(resp) && typeof resp[0]?.result === 'number') return 'code ' + resp[0].result;
  return null;
}

// WebCEO v3/v4 method names seen in the wild and documentation scrapes.
// The first one that responds without an error envelope wins. If none match
// your account, paste the right name into the "Custom method name" box on
// the Clients tab — you can find it in WebCEO's own help / API docs or by
// opening DevTools on the existing Technical SEO dashboard while it lists
// projects and copying the `method` field from the request.
const LIST_ENDPOINTS = [
  'get_account_info',
  'get_projects',
  'get_projects_overview',
  'get_project_overview',
  'get_all_projects',
  'get_project_list',
  'get_projects_list',
  'list_projects',
  'projects_list',
  'get_user_projects',
  'account_info'
];

export async function getProjects(customEndpoint) {
  const candidates = customEndpoint
    ? [customEndpoint, ...LIST_ENDPOINTS]
    : LIST_ENDPOINTS;

  const attempts = [];
  for (const endpoint of candidates) {
    try {
      const resp = await webceoRequest(endpoint, {});
      const err = isErrorResponse(resp);
      attempts.push({ method: endpoint, errormsg: err, raw: resp });
      if (!err) {
        return { resp, method: endpoint, attempts };
      }
    } catch (e) {
      attempts.push({ method: endpoint, errormsg: e.message });
    }
  }
  const last = attempts[attempts.length - 1];
  return { resp: last?.raw || null, method: last?.method || null, attempts };
}

// ---------------------------------------------------------------------------
// Response tree walker — finds every object that looks like a project in
// whatever shape WebCEO returns.
// ---------------------------------------------------------------------------

const PROJECT_CONTAINER_KEYS = [
  'projects', 'project_list', 'projectList', 'items', 'data', 'result', 'results'
];
const ID_KEYS   = ['project', 'project_id', 'projectId', 'id', 'pid', 'key', 'uid'];
const URL_KEYS  = ['url', 'site_url', 'siteUrl', 'website', 'domain', 'site_domain', 'siteDomain', 'host', 'hostname'];
const NAME_KEYS = ['name', 'title', 'project_name', 'projectName', 'site_name', 'siteName', 'label'];

function readFirst(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return String(obj[k]);
  }
  for (const sub of ['site', 'project', 'info', 'data']) {
    if (obj[sub] && typeof obj[sub] === 'object') {
      for (const k of keys) {
        if (obj[sub][k] != null && obj[sub][k] !== '') return String(obj[sub][k]);
      }
    }
  }
  return '';
}

function looksLikeProject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return !!(readFirst(obj, ID_KEYS) || readFirst(obj, URL_KEYS));
}

export function extractProjects(root) {
  const out = [];
  const seen = new Set();

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const child of node) {
        if (looksLikeProject(child)) out.push(child);
        else walk(child);
      }
      return;
    }
    if (looksLikeProject(node)) {
      out.push(node);
      return;
    }

    const values = Object.values(node);
    if (values.length && values.every(v => looksLikeProject(v))) {
      for (const v of values) out.push(v);
      return;
    }

    for (const key of PROJECT_CONTAINER_KEYS) {
      if (node[key] !== undefined) walk(node[key]);
    }
    for (const [k, v] of Object.entries(node)) {
      if (!PROJECT_CONTAINER_KEYS.includes(k)) walk(v);
    }
  }

  walk(root);

  const uniq = [];
  const keys = new Set();
  for (const p of out) {
    const k = (readFirst(p, ID_KEYS) || '') + '|' + (readFirst(p, URL_KEYS) || '');
    if (keys.has(k)) continue;
    keys.add(k);
    uniq.push(p);
  }
  return uniq;
}

// ---------------------------------------------------------------------------
// Sync WebCEO projects → Supabase clients. Matches by wceo_project_id first,
// falls back to normalized URL. Brand-new clients default to all four service
// flags on.
// ---------------------------------------------------------------------------

export async function syncWebceoClients(upsertClient, existingClients, customEndpoint) {
  const fetched = await getProjects(customEndpoint);
  // eslint-disable-next-line no-console
  console.log('[WebCEO] fetch result:', fetched);

  const projects = extractProjects(fetched.resp);
  // eslint-disable-next-line no-console
  console.log('[WebCEO] extracted project candidates:', projects);

  let inserted = 0, updated = 0, skipped = 0;
  const skippedReasons = [];

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
    const pid    = readFirst(p, ID_KEYS).trim();
    const rawUrl = readFirst(p, URL_KEYS).trim();
    const name   = (readFirst(p, NAME_KEYS) || rawUrl || pid || 'Unnamed').trim();

    if (!pid && !rawUrl) {
      skipped++;
      skippedReasons.push('no id or url — keys: ' + Object.keys(p).slice(0, 10).join(','));
      continue;
    }

    const normUrl = rawUrl.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const match = (pid && byProjectId.get(pid)) || (normUrl && byUrl.get(normUrl));

    const payload = {
      ...(match || {}),
      name,
      url: rawUrl ? (rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl) : match?.url || '',
      wceo_project_id: pid || match?.wceo_project_id || '',
      ...(match ? {} : {
        does_technical: true,
        does_content: true,
        does_aeo: true,
        does_reporting: true
      })
    };

    try {
      await upsertClient(payload);
      if (match) updated++;
      else inserted++;
    } catch (e) {
      skipped++;
      skippedReasons.push((name || pid) + ': ' + e.message);
    }
  }

  return {
    inserted,
    updated,
    skipped,
    total: projects.length,
    skippedReasons,
    rawResponse: fetched.resp,
    method: fetched.method,
    attempts: fetched.attempts
  };
}
