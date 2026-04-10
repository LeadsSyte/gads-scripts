import { upsertClient, listClients } from './supabase.js';

const MIGRATED_FLAG = 'syte-suite-migrated';

const SOURCES = [
  { key: 'syte-tseo-clients', label: 'Technical SEO' },
  { key: 'syte-aeo-clients',  label: 'AEO Engine' },
  { key: 'syte-ce-brands',    label: 'Content Engine' }
];

function parseJSON(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

// Map any legacy record shape into the unified syte_suite_clients shape.
function mapLegacy(rec, source) {
  if (!rec || typeof rec !== 'object') return null;
  const out = {
    name: rec.name || rec.brand || rec.clientName || rec.label || '',
    url: rec.url || rec.website || rec.site || '',
    industry: rec.industry || rec.vertical || '',
    location: rec.location || rec.geo || '',
    context: rec.context || rec.description || rec.notes || '',
    voice: rec.voice || rec.tone || '',
    audience: rec.audience || rec.targetAudience || '',
    internal_links: rec.internal_links || rec.internalLinks || '',
    ga4_property_id: rec.ga4_property_id || rec.ga4PropertyId || rec.ga4 || '',
    gsc_property: rec.gsc_property || rec.gscProperty || rec.gsc || '',
    wceo_project_id: rec.wceo_project_id || rec.webceoProjectId || rec.wceo || '',
    sitemap_url: rec.sitemap_url || rec.sitemapUrl || rec.sitemap || '',
    sitemap_raw: rec.sitemap_raw || rec.sitemapRaw || '',
    org_name: rec.org_name || rec.orgName || rec.organization || rec.name || '',
    author: rec.author || rec.authorName || '',
    author_creds: rec.author_creds || rec.authorCreds || rec.credentials || '',
    pages_per_month: rec.pages_per_month || rec.pagesPerMonth || 15
  };
  return out;
}

function mergeClient(a, b) {
  // Pick the most complete value for each field.
  const out = { ...a };
  for (const k of Object.keys(b || {})) {
    const av = a?.[k];
    const bv = b[k];
    if (bv == null || bv === '') continue;
    if (av == null || av === '') { out[k] = bv; continue; }
    if (typeof av === 'string' && typeof bv === 'string' && bv.length > av.length) out[k] = bv;
  }
  return out;
}

export function needsMigration() {
  if (localStorage.getItem(MIGRATED_FLAG)) return false;
  return SOURCES.some(s => {
    const raw = localStorage.getItem(s.key);
    if (!raw) return false;
    const parsed = parseJSON(raw);
    return Array.isArray(parsed) ? parsed.length > 0 : !!parsed;
  });
}

export function countLegacyClients() {
  const seen = new Map();
  for (const src of SOURCES) {
    const parsed = parseJSON(localStorage.getItem(src.key) || 'null');
    const arr = Array.isArray(parsed) ? parsed : parsed ? Object.values(parsed) : [];
    for (const rec of arr) {
      const mapped = mapLegacy(rec, src.label);
      if (!mapped) continue;
      const key = (mapped.url || mapped.name || '').toLowerCase().trim();
      if (!key) continue;
      if (seen.has(key)) seen.set(key, mergeClient(seen.get(key), mapped));
      else seen.set(key, mapped);
    }
  }
  return seen.size;
}

export async function runMigration() {
  if (localStorage.getItem(MIGRATED_FLAG)) return { migrated: 0, skipped: 0 };

  const existing = await listClients().catch(() => []);
  const existingByUrl = new Map(existing.map(c => [(c.url || c.name || '').toLowerCase().trim(), c]));

  const seen = new Map();
  for (const src of SOURCES) {
    const parsed = parseJSON(localStorage.getItem(src.key) || 'null');
    const arr = Array.isArray(parsed) ? parsed : parsed ? Object.values(parsed) : [];
    for (const rec of arr) {
      const mapped = mapLegacy(rec, src.label);
      if (!mapped) continue;
      const key = (mapped.url || mapped.name || '').toLowerCase().trim();
      if (!key) continue;
      if (seen.has(key)) seen.set(key, mergeClient(seen.get(key), mapped));
      else seen.set(key, mapped);
    }
  }

  let migrated = 0, skipped = 0;
  for (const [key, client] of seen) {
    if (existingByUrl.has(key)) { skipped++; continue; }
    try {
      await upsertClient(client);
      migrated++;
    } catch (e) {
      console.error('Migration failed for', client.name, e);
    }
  }

  // Do NOT delete original localStorage keys — just flip the flag.
  localStorage.setItem(MIGRATED_FLAG, '1');
  return { migrated, skipped };
}
