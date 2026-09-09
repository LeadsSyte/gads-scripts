// Search Console CSV import — the path that grounds an AEO report for a client
// whose Search Console we don't have connected but whose Performance export we
// do have on disk.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const g = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/gscImport.js')).href);

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }
function eq(a, b, label) { if (a !== b) throw new Error((label || 'eq') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

const CLIENT = { name: 'Krost Shelving', client_type: 'lead_gen' };

const QUERIES_CSV = '﻿Top queries,Clicks,Impressions,CTR,Position\n' +
  'industrial shelving,120,"3,400",3.53%,8.4\n' +
  '"shelving, racking",5,90,5.56%,12.1\n' +
  'krost shelving,300,1200,25%,1.2\n' +
  'mezzanine floors johannesburg,2,40,5%,18.9\n';

const PAGES_CSV = 'Top pages,Clicks,Impressions,CTR,Position\n' +
  'https://krost.co.za/shelving,50,900,5.56%,6.1\n' +
  'https://krost.co.za/racking,20,400,5%,9.3\n';

t('parseDelimited: quoted commas, BOM and CRLF survive', () => {
  const rows = g.parseDelimited('﻿a,b\r\n"x,y",2\r\n');
  eq(rows.length, 2, 'row count');
  eq(rows[0][0], 'a', 'BOM stripped from first header');
  eq(rows[1][0], 'x,y', 'quoted comma kept in one field');
});

t('parseDelimited: tab- and semicolon-separated re-saves', () => {
  eq(g.parseDelimited('a\tb\n1\t2\n')[1][1], '2', 'tabs');
  eq(g.parseDelimited('a;b\n1;2\n')[1][1], '2', 'semicolons');
});

t('parseNumber: thousands grouping, percentages and decimal commas', () => {
  eq(g.parseNumber('3,400'), 3400, 'grouping');
  eq(g.parseNumber('3.53%'), 3.53, 'percent');
  eq(g.parseNumber('8,4'), 8.4, 'decimal comma');
  eq(g.parseNumber('1,234.5'), 1234.5, 'both separators');
  eq(g.parseNumber(''), 0, 'blank');
});

t('parseGscSheet: recognises the Queries sheet and its metrics', () => {
  const { kind, rows } = g.parseGscSheet(QUERIES_CSV);
  eq(kind, 'queries', 'kind');
  eq(rows.length, 4, 'row count');
  eq(rows[0].impressions, 3400, 'grouped impressions');
  eq(rows[0].position, 8.4, 'position');
  eq(rows[0].ctr, '3.5%', 'ctr formatted like a live pull');
});

t('parseGscSheet: recognises the Pages sheet', () => {
  eq(g.parseGscSheet(PAGES_CSV).kind, 'pages', 'by header');
});

t('parseGscSheet: URLs give away a Pages sheet even under a localised header', () => {
  const csv = 'Seiten,Klicks,Impressionen,CTR,Position\nhttps://krost.co.za/a,1,2,50%,3\nhttps://krost.co.za/b,1,2,50%,4\n';
  eq(g.parseGscSheet(csv).kind, 'pages', 'localised pages sheet');
});

t('parseGscSheet: the other export sheets are recognised, not mistaken for queries', () => {
  eq(g.parseGscSheet('Date,Clicks,Impressions\n2026-08-01,5,50\n').kind, 'dates', 'dates');
  eq(g.parseGscSheet('Country,Clicks,Impressions\nZA,5,50\n').kind, 'other', 'countries');
  eq(g.parseGscSheet('Device,Clicks,Impressions\nMOBILE,5,50\n').kind, 'other', 'devices');
});

t('readGscExport: sorts a whole export into queries + pages and dedupes', () => {
  const r = g.readGscExport([
    { name: 'Queries.csv', text: QUERIES_CSV },
    { name: 'Queries-again.csv', text: 'Top queries,Clicks,Impressions,CTR,Position\nindustrial shelving,1,10,10%,9\n' },
    { name: 'Pages.csv', text: PAGES_CSV },
    { name: 'Dates.csv', text: 'Date,Clicks,Impressions\n2026-08-01,5,50\n' }
  ]);
  eq(r.queries.length, 4, 'duplicate query kept once');
  eq(r.queries.find(q => q.key === 'industrial shelving').impressions, 3400, 'stronger row wins');
  eq(r.pages.length, 2, 'pages');
  ok(r.sheets.some(s => s.kind === 'dates'), 'sheet report lists ignored sheets');
});

t('buildImportedReportData: produces the shape fetchReportData produces', () => {
  const { queries, pages } = g.readGscExport([
    { name: 'Queries.csv', text: QUERIES_CSV },
    { name: 'Pages.csv', text: PAGES_CSV }
  ]);
  const d = g.buildImportedReportData({ client: CLIENT, month: '2026-08', queries, pages });
  eq(d.source, 'csv-import', 'stamped as an import');
  eq(d.period.current.startDate, '2026-08-01', 'period from the month');
  eq(d.period.current.endDate, '2026-08-31', 'period end');
  eq(d.keywords[0].query, 'industrial shelving', 'sorted by impressions');
  ok(d.keywords.every(k => k.classification), 'keywords classified');
  ok(d.keywords.find(k => k.query === 'krost shelving').classification.branded, 'brand detected');
  ok(d.keywordBuckets, 'buckets built');
  eq(d.topPages[0].page, 'https://krost.co.za/shelving', 'top page');
  eq(d.traffic.current, null, 'no GA4 in an import');
  eq(d.errors.length, 0, 'no errors');
});

t('buildImportedReportData: carries the cache-key stamps so it is not treated as stale', () => {
  const client = { ...CLIENT, gsc_property: null, ga4_property_id: 'GA-1', google_account_email: 'ops@syte.co.za' };
  const d = g.buildImportedReportData({
    client, month: '2026-08', queries: g.parseGscSheet(QUERIES_CSV).rows
  });
  eq(d.gsc_property, null, 'gsc property');
  eq(d.ga4_property_id, 'GA-1', 'ga4 property');
  eq(d.gsc_account_email, 'ops@syte.co.za', 'legacy account fallback');
  ok(typeof d.version === 'number', 'version stamped');
});

t('buildImportedReportData: previous-month rows produce position deltas', () => {
  const cur = g.parseGscSheet(QUERIES_CSV).rows;
  const prev = g.parseGscSheet('Top queries,Clicks,Impressions,CTR,Position\nindustrial shelving,80,2000,4%,11.4\n').rows;
  const d = g.buildImportedReportData({ client: CLIENT, month: '2026-08', queries: cur, prevQueries: prev });
  const kw = d.keywords.find(k => k.query === 'industrial shelving');
  eq(kw.prevPosition, 11.4, 'previous position');
  eq(kw.change, 3, 'improvement is positive');
  eq(d.keywords.find(k => k.query === 'krost shelving').change, null, 'no previous row → no delta');
});

t('buildImportedReportData: refuses input it cannot ground on', () => {
  let threw = false;
  try { g.buildImportedReportData({ client: CLIENT, month: '2026-08', queries: [] }); } catch { threw = true; }
  ok(threw, 'empty query set rejected');
  threw = false;
  try { g.buildImportedReportData({ client: CLIENT, month: 'August', queries: [{ key: 'x', clicks: 1, impressions: 2, ctr: '1%', position: 3 }] }); } catch { threw = true; }
  ok(threw, 'bad month rejected');
});

t('preserveImportedGsc: a live pull with no GSC rows keeps the import', () => {
  const imported = g.buildImportedReportData({ client: CLIENT, month: '2026-08', queries: g.parseGscSheet(QUERIES_CSV).rows });
  const fresh = { keywords: [], topPages: [], errors: ['GSC: No property configured'], traffic: { current: { users: 10 } } };
  const merged = g.preserveImportedGsc(fresh, imported);
  eq(merged.keywords.length, 4, 'imported keywords survive the refresh');
  eq(merged.traffic.current.users, 10, 'fresh GA4 kept');
  ok(merged.errors.includes('GSC: No property configured'), 'GSC errors kept so the SEO gate still blocks');
});

t('preserveImportedGsc: real GSC rows win over an import', () => {
  const imported = g.buildImportedReportData({ client: CLIENT, month: '2026-08', queries: g.parseGscSheet(QUERIES_CSV).rows });
  const fresh = { keywords: [{ query: 'live', impressions: 1 }], topPages: [], errors: [] };
  const merged = g.preserveImportedGsc(fresh, imported);
  eq(merged.keywords.length, 1, 'live data wins');
  eq(merged.source, undefined, 'no longer flagged as an import');
});

t('preserveImportedGsc: ordinary cached data is left alone', () => {
  const fresh = { keywords: [], errors: [] };
  eq(g.preserveImportedGsc(fresh, { keywords: [{ query: 'x' }] }), fresh, 'non-import cache is not merged');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
