// The AEO report's Search Console gate: head-terms must be on file — from a
// live pull or an imported export — before a report can be generated.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const a = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/aeoGuard.js')).href);

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }
function eq(x, y, label) { if (x !== y) throw new Error((label || 'eq') + ': ' + JSON.stringify(x) + ' !== ' + JSON.stringify(y)); }

const MONTH = '2026-08';
const CLIENT = { name: 'Krost', gsc_property: 'sc-domain:krost.co.za' };
const NO_GSC_CLIENT = { name: 'Krost' };

const kws = (n, impressions = 100) =>
  Array.from({ length: n }, (_, i) => ({ query: 'q' + i, impressions, clicks: 1, position: 5 }));

const LIVE = { keywords: kws(40) };
const IMPORTED = { source: 'csv-import', imported_at: '2026-09-01T10:00:00.000Z', keywords: kws(40) };

t('live Search Console data passes the gate', () => {
  const r = a.evaluateAeoReadiness({ client: CLIENT, reportData: LIVE, month: MONTH });
  ok(r.ok, 'ready');
  eq(r.source, 'live', 'source');
  eq(r.blocker, null, 'no blocker');
});

t('an imported export passes the gate exactly like a live pull', () => {
  const r = a.evaluateAeoReadiness({ client: NO_GSC_CLIENT, reportData: IMPORTED, month: MONTH });
  ok(r.ok, 'ready on imported data');
  eq(r.source, 'import', 'source');
  ok(r.checks[0].note.includes('Imported CSV'), 'note names the import');
  ok(r.checks[0].note.includes('2026-09-01'), 'note dates the import');
});

t('no data at all blocks, and sends an unconnected client to the import', () => {
  const r = a.evaluateAeoReadiness({ client: NO_GSC_CLIENT, reportData: null, month: MONTH });
  ok(!r.ok, 'blocked');
  eq(r.source, null, 'no source');
  eq(r.blocker.code, 'no-gsc-data', 'code');
  eq(r.blocker.action, 'import', 'action');
  ok(/Performance → Export/.test(r.blocker.message), 'message tells them where the export comes from');
  ok(r.blocker.message.includes(MONTH), 'message names the month');
});

t('no data blocks a connected client too, but offers a refresh', () => {
  const r = a.evaluateAeoReadiness({ client: CLIENT, reportData: { keywords: [] }, month: MONTH });
  ok(!r.ok, 'blocked');
  eq(r.blocker.action, 'refresh', 'connected clients get a refresh, not an import');
  ok(/Refresh Data/.test(r.blocker.message), 'message names the refresh');
});

t('too few head-terms to ground on blocks as thin, not absent', () => {
  const r = a.evaluateAeoReadiness({ client: CLIENT, reportData: { keywords: kws(3) }, month: MONTH });
  ok(!r.ok, 'blocked');
  eq(r.blocker.code, 'thin-gsc-data', 'code');
  ok(r.checks[0].pass, 'data is present');
  ok(!r.checks[1].pass, 'grounding check is what failed');
});

t('rows with no impressions or clicks are not grounding', () => {
  const r = a.evaluateAeoReadiness({ client: CLIENT, reportData: { keywords: kws(40, 0).map(k => ({ ...k, clicks: 0 })) }, month: MONTH });
  ok(!r.ok, 'an all-zero pull does not ground a grid');
  eq(r.blocker.code, 'thin-gsc-data', 'code');
});

t('exactly the minimum passes', () => {
  const r = a.evaluateAeoReadiness({ client: CLIENT, reportData: { keywords: kws(a.MIN_GROUNDING_KEYWORDS) }, month: MONTH });
  ok(r.ok, 'boundary is inclusive');
});

t('summary line reflects where the grounding came from', () => {
  eq(a.aeoReadinessSummary(a.evaluateAeoReadiness({ client: CLIENT, reportData: LIVE, month: MONTH })),
    'Grounded on live Search Console data', 'live');
  eq(a.aeoReadinessSummary(a.evaluateAeoReadiness({ client: NO_GSC_CLIENT, reportData: IMPORTED, month: MONTH })),
    'Grounded on imported Search Console data', 'import');
  ok(/No Search Console data/.test(a.aeoReadinessSummary(a.evaluateAeoReadiness({ client: NO_GSC_CLIENT, reportData: null, month: MONTH }))), 'blocked');
  eq(a.aeoReadinessSummary(null), '', 'no readiness');
});

t('missing arguments do not throw', () => {
  const r = a.evaluateAeoReadiness();
  ok(!r.ok, 'blocked');
  ok(r.blocker.message.length > 0, 'still explains itself');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
