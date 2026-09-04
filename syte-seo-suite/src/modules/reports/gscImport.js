// Search Console CSV import — run an AEO report for a client whose Search
// Console we do NOT have connected, using the Performance export they (or the
// client) downloaded from Search Console themselves.
//
// Why this exists: the AEO report itself never needed a Google connection —
// only the SEO report is gated on one (see gscGuard.js), and that gate is
// deliberately left alone. What the AEO side uses Search Console for is
// GROUNDING: the head-terms a brand already gets impressions for seed the gold
// probe grid (gridProfile/goldGrid), the discovery sweep (aeoDiscovery) and the
// "add GSC queries" affordance. Without them the probe set is built from the
// website + industry alone and comes out thin. Feeding the downloaded CSV into
// the same report-data cache the live fetch writes gives those paths the exact
// same input, for one client, without touching the connection requirement
// anywhere.
//
// Input is whatever Search Console's "Export" button produces:
//   • Queries.csv  — "Top queries, Clicks, Impressions, CTR, Position"
//   • Pages.csv    — "Top pages, Clicks, Impressions, CTR, Position"
// (the other sheets in the export — Countries, Devices, Dates, Search
// appearance, Filters — are recognised and ignored).
//
// Pure functions only — no network, no DOM, no zip handling — so the parsing
// rules are node-testable. The UI layer (GscCsvImport.jsx) does file reading,
// zip extraction and the cache write.

import { classifyKeywords, buildKeywordBuckets } from './keywordBuckets.js';
import { getReportPeriods } from './reportPeriods.js';
import { REPORT_DATA_VERSION } from './reportDataVersion.js';

// Stamped on imported blobs so every consumer can tell hand-fed data from a
// live pull — and so a later live refresh knows not to throw the import away.
export const GSC_IMPORT_SOURCE = 'csv-import';

// ─── Delimited text ──────────────────────────────────────────
// Search Console exports comma-separated UTF-8 with a BOM; a sheet re-saved
// out of Excel in a European locale comes back semicolon- or tab-separated.
// Detect the delimiter from the header line rather than assuming.
function pickDelimiter(firstLine) {
  const counts = [
    [',', (firstLine.match(/,/g) || []).length],
    [';', (firstLine.match(/;/g) || []).length],
    ['\t', (firstLine.match(/\t/g) || []).length]
  ].sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

// Minimal RFC-4180 reader: quoted fields, "" escapes, CRLF or LF rows.
export function parseDelimited(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  if (!src.trim()) return [];
  const delim = pickDelimiter(src.split(/\r?\n/)[0] || '');

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delim) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  row.push(field);
  rows.push(row);

  // Drop trailing blank lines but keep genuinely empty cells inside a row.
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

// Numbers arrive as "1,234", "1 234", "3.53%", or "8,4" (decimal comma).
export function parseNumber(raw) {
  let s = String(raw ?? '').trim().replace(/%/g, '').replace(/[\s\u00A0]/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');       // 1,234.5
  else if (s.includes(',')) {
    // Thousands grouping vs a decimal comma — "1,234" is the former,
    // "8,4" the latter. Grouping always has exactly 3 digits per group.
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function findCol(header, needles) {
  for (let i = 0; i < header.length; i++) {
    if (needles.some(n => header[i].includes(n))) return i;
  }
  return -1;
}

// Which Search Console sheet is this? Header wording first (it carries the
// dimension name), then the values — a column of URLs is the Pages sheet even
// when the export came back in another language.
function detectKind(headerCell, values) {
  const h = String(headerCell || '').toLowerCase();
  if (/date|datum|fecha/.test(h)) return 'dates';
  if (/countr|land|pa[ií]s|device|ger[aä]t|dispositivo|appearance|darstellung/.test(h)) return 'other';
  if (/page|url|seite|p[aá]gina/.test(h)) return 'pages';
  if (/quer|keyword|search term|suchanfrage|consulta|requ[eê]te/.test(h)) return 'queries';
  const urls = values.filter(v => /^https?:\/\//i.test(v)).length;
  if (values.length && urls / values.length > 0.6) return 'pages';
  if (/^\d{4}-\d{2}-\d{2}$/.test(values[0] || '')) return 'dates';
  return 'queries';
}

// Parse one exported sheet.
// Returns { kind, rows: [{ key, clicks, impressions, ctr, position }] }.
// `kind` is 'queries' | 'pages' | 'dates' | 'other' | 'unknown'.
export function parseGscSheet(text) {
  const table = parseDelimited(text);
  if (table.length < 2) return { kind: 'unknown', rows: [] };

  const header = table[0].map(h => String(h).trim().toLowerCase());
  const body = table.slice(1);
  const keys = body.map(r => String(r[0] ?? '').trim());
  const kind = detectKind(header[0], keys);

  // "Clicks 8/1/26-8/31/26" appears when the export compares date ranges —
  // the first matching column is the current period, which is what we want.
  const iClicks = findCol(header, ['click', 'klick', 'clic']);
  const iImpr = findCol(header, ['impression', 'impresion', 'anzeige']);
  const iCtr = findCol(header, ['ctr']);
  const iPos = findCol(header, ['position', 'posición', 'posicion']);

  const rows = [];
  for (let i = 0; i < body.length; i++) {
    const key = keys[i];
    if (!key) continue;
    const ctrRaw = iCtr >= 0 ? String(body[i][iCtr] ?? '').trim() : '';
    rows.push({
      key,
      clicks: iClicks >= 0 ? Math.round(parseNumber(body[i][iClicks])) : 0,
      impressions: iImpr >= 0 ? Math.round(parseNumber(body[i][iImpr])) : 0,
      ctr: ctrRaw ? (parseNumber(ctrRaw).toFixed(1) + '%') : '0%',
      position: iPos >= 0 ? +parseNumber(body[i][iPos]).toFixed(1) : 0
    });
  }
  return { kind, rows };
}

// Sort every file the operator dropped in into query rows and page rows.
// files: [{ name, text }] — name is only used for the per-file report.
export function readGscExport(files = []) {
  const queries = [];
  const pages = [];
  const sheets = [];
  for (const f of files) {
    const { kind, rows } = parseGscSheet(f?.text);
    sheets.push({ name: f?.name || '(unnamed)', kind, rows: rows.length });
    if (kind === 'queries') queries.push(...rows);
    else if (kind === 'pages') pages.push(...rows);
  }
  return { queries: dedupe(queries), pages: dedupe(pages), sheets };
}

// Same query exported twice (two files, overlapping windows) — keep the row
// with the most impressions rather than double-counting it.
function dedupe(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const k = r.key.toLowerCase();
    const seen = byKey.get(k);
    if (!seen || r.impressions > seen.impressions) byKey.set(k, r);
  }
  return [...byKey.values()];
}

// Build the report-data blob the suite already understands, from imported
// rows. Shape matches fetchReportData() so every downstream consumer
// (probeCandidatesFromGSC, the gold grid, discovery, the microsite tables)
// reads it without knowing where it came from.
//
// GA4 traffic is deliberately null: this import carries Search Console only.
// The SEO report stays blocked for an unconnected client — gscGuard checks the
// connection itself, not the data — which is exactly the intent.
export function buildImportedReportData({ client, month, queries = [], pages = [], prevQueries = [] } = {}) {
  if (!client?.name) throw new Error('A client (with a name) is required to classify branded queries.');
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw new Error('month must be YYYY-MM.');
  if (!queries.length) {
    throw new Error('No query rows found. Export Search Console → Performance → Export, and include the Queries sheet.');
  }

  const [year, mo] = String(month).split('-').map(Number);
  const period = getReportPeriods(year, mo - 1);

  const prevMap = new Map(prevQueries.map(r => [r.key.toLowerCase(), r]));
  const keywords = queries
    .map(r => {
      const prev = prevMap.get(r.key.toLowerCase());
      const prevPosition = prev ? prev.position : null;
      return {
        query: r.key,
        position: r.position,
        prevPosition,
        change: prevPosition != null ? +(prevPosition - r.position).toFixed(1) : null,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr
      };
    })
    .sort((a, b) => b.impressions - a.impressions);

  const classified = classifyKeywords(keywords, client.name);

  return {
    version: REPORT_DATA_VERSION,
    source: GSC_IMPORT_SOURCE,
    imported_at: new Date().toISOString(),
    clientType: client.client_type || 'lead_gen',
    period,
    traffic: { current: null, previous: null, yoy: null, momChange: null, yoyChange: null },
    keywords: classified,
    keywordBuckets: buildKeywordBuckets(classified, client.name),
    topPages: pages
      .map(r => ({ page: r.key, clicks: r.clicks, impressions: r.impressions, position: r.position }))
      .sort((a, b) => b.impressions - a.impressions),
    errors: [],
    // Cache-key stamps. MonthlyReport treats a cached blob as stale when the
    // client's properties or bound Google accounts no longer match the ones
    // the pull used, so an import has to carry the same fields (all null for
    // an unconnected client) or it would be discarded on the next visit.
    ga4_property_id: client.ga4_property_id || null,
    gsc_property: client.gsc_property || null,
    ga4_account_email: client.ga4_account_email || client.google_account_email || null,
    gsc_account_email: client.gsc_account_email || client.google_account_email || null
  };
}

// A live refresh must not silently drop an import. If the fresh pull came back
// with Search Console rows, it wins — it's the real thing. If it didn't (the
// usual case for an unconnected client: "GSC: No property configured"), keep
// the imported keywords so the AEO grounding that depends on them survives.
export function preserveImportedGsc(fresh, cached) {
  if (!fresh || cached?.source !== GSC_IMPORT_SOURCE) return fresh;
  if (fresh.keywords?.length) return fresh;
  return {
    ...fresh,
    source: GSC_IMPORT_SOURCE,
    imported_at: cached.imported_at,
    keywords: cached.keywords || [],
    keywordBuckets: cached.keywordBuckets || null,
    topPages: fresh.topPages?.length ? fresh.topPages : (cached.topPages || []),
    // The live pull's GSC errors are kept deliberately. They are what the SEO
    // report's readiness gate reads (gscGuard.js), and an imported CSV must
    // never make a broken connection look healthy — the import grounds AEO,
    // it does not stand in for a connection.
    errors: fresh.errors || []
  };
}

// One-line summary for the import UI.
export function summarizeImport(data) {
  if (!data) return '';
  const kw = data.keywords?.length || 0;
  const pages = data.topPages?.length || 0;
  const impressions = (data.keywords || []).reduce((s, k) => s + (k.impressions || 0), 0);
  const clicks = (data.keywords || []).reduce((s, k) => s + (k.clicks || 0), 0);
  return `${kw} queries · ${pages} pages · ${clicks.toLocaleString()} clicks · ${impressions.toLocaleString()} impressions`;
}
