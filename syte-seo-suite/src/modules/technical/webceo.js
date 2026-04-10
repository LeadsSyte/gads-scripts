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

// Per-project audit data — exactly what the previous tool used.
export async function getAudit(projectId) {
  return webceoRequest('get_project_overview', { project_id: projectId });
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

const LIST_ENDPOINTS = [
  'get_project_list',
  'get_projects_list',
  'get_all_projects',
  'list_projects',
  'get_projects'
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
