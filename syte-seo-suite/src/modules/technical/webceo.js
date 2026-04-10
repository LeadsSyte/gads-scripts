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

// WebCEO's public API has used a couple of different method names across
// revisions. Try the canonical one first, fall back if it errors or returns
// an empty/wrong-shape payload.
export async function getProjects() {
  const candidates = ['get_projects_list', 'get_projects', 'getProjects', 'getProjectsList'];
  let lastErr = null;
  let lastResp = null;
  for (const method of candidates) {
    try {
      const resp = await webceoCall(method, {});
      // If WebCEO says the method is unknown, it typically returns
      // { status: "error", error: "method ... not found" }. Skip and try next.
      const errMsg = (resp?.error || resp?.message || '').toLowerCase();
      if (errMsg.includes('method') && (errMsg.includes('not') || errMsg.includes('unknown'))) {
        lastResp = resp;
        continue;
      }
      if (resp?.status === 'error') {
        lastResp = resp;
        continue;
      }
      return resp;
    } catch (e) {
      lastErr = e;
    }
  }
  // Return whatever the last attempt gave back so the caller can diagnose.
  if (lastResp) return lastResp;
  if (lastErr) throw lastErr;
  return { projects: [] };
}

// ---------------------------------------------------------------------------
// Response parsing — WebCEO's `get_projects` response shape varies by account
// type and API revision. We walk the whole response tree and collect every
// object that *looks* like a project (has either a project/id field or a
// url/domain field). This makes the sync resilient to wrapper envelopes like
// { result: { projects: [...] } } or flat arrays or object-keyed maps.
// ---------------------------------------------------------------------------

const PROJECT_KEYS = [
  'projects', 'project_list', 'projectList', 'items', 'data', 'result', 'results'
];

const ID_KEYS  = ['project', 'project_id', 'projectId', 'id', 'pid', 'key', 'uid'];
const URL_KEYS = ['url', 'site_url', 'siteUrl', 'website', 'domain', 'site_domain', 'siteDomain', 'host', 'hostname'];
const NAME_KEYS = ['name', 'title', 'project_name', 'projectName', 'site_name', 'siteName', 'label'];

function readFirst(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return String(obj[k]);
  }
  // Also look one level inside `site` / `project` sub-objects.
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

// Recursively collect every object in `root` that looks like a project.
// Handles arrays, nested objects, and object-keyed maps like
// { "123": {url:"..."}, "456": {...} }.
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

    // Object. First check if it itself looks like a project.
    if (looksLikeProject(node)) {
      out.push(node);
      return;
    }

    // Object-keyed map of projects? e.g. {123: {...}, 456: {...}}
    const values = Object.values(node);
    const allProjects =
      values.length > 0 &&
      values.every(v => looksLikeProject(v));
    if (allProjects) {
      for (const v of values) out.push(v);
      return;
    }

    // Otherwise recurse into promising keys + everything else.
    for (const key of PROJECT_KEYS) {
      if (node[key] !== undefined) walk(node[key]);
    }
    for (const [k, v] of Object.entries(node)) {
      if (!PROJECT_KEYS.includes(k)) walk(v);
    }
  }

  walk(root);
  // Dedupe by id+url combo.
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

// Upsert WebCEO projects into the Supabase clients table. WebCEO is the
// source of truth for which clients exist. Returns detailed breakdown so the
// UI can display diagnostics when the shape is surprising.
export async function syncWebceoClients(upsertClient, existingClients) {
  const resp = await getProjects();
  // Always log the raw response — open DevTools console if the sync looks wrong.
  // eslint-disable-next-line no-console
  console.log('[WebCEO] raw get_projects response:', resp);

  const projects = extractProjects(resp);
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
    const pid  = readFirst(p, ID_KEYS).trim();
    const rawUrl = readFirst(p, URL_KEYS).trim();
    const name = (readFirst(p, NAME_KEYS) || rawUrl || pid || 'Unnamed').trim();

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
    rawResponse: resp
  };
}
