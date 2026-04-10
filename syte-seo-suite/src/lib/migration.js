// Migrate legacy tools' localStorage into Supabase on first load.
// Sources:
//   - syte-tseo-clients  (Technical SEO)
//   - syte-aeo-clients   (AEO Engine)
//   - syte-ce-brands     (Content Engine brand presets)

import { fetchClients, upsertClient } from './supabase.js';

const MIGRATED_FLAG = 'syte-suite-migrated';

function safeParse(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function normUrl(u) {
  if (!u) return '';
  return u
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

function mostComplete(a, b) {
  // For every field, take the longer / truthier value.
  const out = { ...a };
  for (const k of Object.keys(b || {})) {
    const av = a?.[k];
    const bv = b[k];
    if (!av) out[k] = bv;
    else if (bv && String(bv).length > String(av).length) out[k] = bv;
  }
  return out;
}

function mapTseo(c) {
  return {
    name: c.name || c.label || 'Untitled',
    url: c.url || c.site || '',
    industry: c.industry || '',
    location: c.location || '',
    wceo_project_id: c.wceoProjectId || c.webceoProjectId || '',
    gsc_property: c.gscProperty || c.gsc || '',
  };
}

function mapAeo(c) {
  return {
    name: c.name || 'Untitled',
    url: c.url || c.site || '',
    industry: c.industry || '',
    location: c.location || '',
    ga4_property_id: c.ga4PropertyId || c.ga4 || '',
    sitemap_url: c.sitemapUrl || c.sitemap || '',
    org_name: c.orgName || '',
    author: c.author || '',
  };
}

function mapBrand(b) {
  return {
    name: b.name || b.brand || 'Untitled',
    url: b.url || b.site || '',
    industry: b.industry || '',
    location: b.location || '',
    context: b.context || b.brief || '',
    voice: b.voice || b.tone || '',
    audience: b.audience || '',
    internal_links: b.internalLinks || '',
    author: b.author || '',
    author_creds: b.authorCreds || '',
  };
}

export async function maybeRunMigration(onStatus = () => {}) {
  if (localStorage.getItem(MIGRATED_FLAG) === '1') return { ran: false };

  const tseo = safeParse('syte-tseo-clients') || [];
  const aeo = safeParse('syte-aeo-clients') || [];
  const brands = safeParse('syte-ce-brands') || [];

  const totalFound = tseo.length + aeo.length + brands.length;
  if (totalFound === 0) {
    localStorage.setItem(MIGRATED_FLAG, '1');
    return { ran: false };
  }

  onStatus(`Found ${totalFound} clients across your existing tools. Migrating to Supabase...`);

  // Merge by normalized URL.
  const merged = new Map();
  const add = (mapped) => {
    const key = normUrl(mapped.url) || mapped.name.toLowerCase();
    if (merged.has(key)) {
      merged.set(key, mostComplete(merged.get(key), mapped));
    } else {
      merged.set(key, mapped);
    }
  };
  tseo.forEach((c) => add(mapTseo(c)));
  aeo.forEach((c) => add(mapAeo(c)));
  brands.forEach((b) => add(mapBrand(b)));

  // Avoid duplicates vs existing Supabase rows.
  let existing = [];
  try {
    existing = await fetchClients();
  } catch {
    existing = [];
  }
  const existingKeys = new Set(
    existing.map((c) => normUrl(c.url) || (c.name || '').toLowerCase())
  );

  let inserted = 0;
  for (const [key, row] of merged.entries()) {
    if (existingKeys.has(key)) continue;
    try {
      await upsertClient(row);
      inserted += 1;
    } catch (e) {
      console.warn('Migration insert failed for', row.name, e);
    }
  }

  localStorage.setItem(MIGRATED_FLAG, '1');
  return { ran: true, found: totalFound, inserted };
}
