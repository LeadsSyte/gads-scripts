// Readiness calculator — per service, which fields a client needs before it
// can actually be used in that module. Used by the Clients sub-tab card grid
// to show setup status at a glance.

const REQUIREMENTS = {
  technical: [
    { key: 'name',             label: 'Client Name' },
    { key: 'url',              label: 'Website URL' },
    // Needs EITHER a WebCEO project ID or a GSC property — handled specially.
  ],
  content: [
    { key: 'name',             label: 'Client Name' },
    { key: 'url',              label: 'Website URL' },
    { key: 'industry',         label: 'Industry' },
    { key: 'location',         label: 'Location' },
    { key: 'voice',            label: 'Brand Voice' },
    { key: 'audience',         label: 'Target Audience' },
    { key: 'context',          label: 'Brand Context' },
    { key: 'author',           label: 'Default Author' }
  ],
  aeo: [
    { key: 'name',             label: 'Client Name' },
    { key: 'url',              label: 'Website URL' },
    { key: 'industry',         label: 'Industry' },
    { key: 'location',         label: 'Location' },
    { key: 'aeo_probe_queries', label: 'AEO Probe Queries' },
    { key: 'competitors',      label: 'Competitors' }
  ],
  reporting: [
    { key: 'name',             label: 'Client Name' },
    { key: 'url',              label: 'Website URL' },
    { key: 'reporting_email',  label: 'Reporting Email' },
    { key: 'start_date',       label: 'Start Date' }
  ]
};

function hasValue(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return true;
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}

export function readinessFor(client, service) {
  const reqs = REQUIREMENTS[service] || [];
  const missing = [];

  for (const r of reqs) {
    if (!hasValue(client[r.key])) missing.push(r);
  }

  // Technical SEO requires a crawl target. WebCEO is deprecated; the
  // in-house crawler reads sitemap_url first, then falls back to discovering
  // pages from the homepage (client.url, already required above), so a URL
  // is enough. GSC is optional traffic-context enrichment, not a hard need.

  const filled = reqs.length - missing.length;
  const total = reqs.length;
  const percent = total > 0 ? Math.round((filled / total) * 100) : 100;

  let status;
  if (missing.length === 0)              status = 'ready';
  else if (filled === 0)                 status = 'empty';
  else                                   status = 'partial';

  return { status, missing, filled, total, percent };
}

// Sort: ready clients first, then partial (most-complete first), then empty.
export function sortByReadiness(clients, service) {
  const order = { ready: 0, partial: 1, empty: 2 };
  return clients
    .map(c => ({ client: c, readiness: readinessFor(c, service) }))
    .sort((a, b) => {
      const s = order[a.readiness.status] - order[b.readiness.status];
      if (s !== 0) return s;
      return b.readiness.percent - a.readiness.percent;
    });
}
