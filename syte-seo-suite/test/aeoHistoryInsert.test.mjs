// AEO History inserts: the schema covers every field the snapshot writes, and
// a database that is behind the schema still gets the month (minus the
// columns it lacks) instead of rejecting the whole snapshot.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const { insertDroppingUnknownColumns } = await import(pathToFileURL(path.join(root, 'src/modules/reports/aeoHistoryInsert.js')).href);

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

// Fake PostgREST: rejects the first unknown column the way Supabase does.
function fakeTable(columns) {
  const calls = [];
  const insert = async row => {
    calls.push(Object.keys(row));
    const bad = Object.keys(row).find(k => !columns.includes(k));
    if (bad) return { data: null, error: { code: 'PGRST204', message: `Could not find the '${bad}' column of 'syte_suite_aeo_history' in the schema cache` } };
    return { data: { id: 'x', ...row }, error: null };
  };
  return { insert, calls };
}

await t('saves straight through when every column exists', async () => {
  const tbl = fakeTable(['client_id', 'month', 'avg_position']);
  const r = await insertDroppingUnknownColumns(tbl.insert, { client_id: 'c', month: '2026-09', avg_position: 2 });
  eq(r.dropped, []);
  eq(r.data.avg_position, 2);
  eq(tbl.calls.length, 1);
});

await t('drops each missing column and still saves the rest', async () => {
  const tbl = fakeTable(['client_id', 'month', 'overall_score']);
  const r = await insertDroppingUnknownColumns(tbl.insert, { client_id: 'c', month: '2026-09', overall_score: 40, avg_position: 2, top3_rate: 10 });
  eq(r.dropped, ['avg_position', 'top3_rate']);
  eq(r.data.overall_score, 40);
});

await t('other errors are thrown, not retried', async () => {
  let n = 0;
  const insert = async () => { n++; return { error: { message: 'permission denied' } }; };
  let threw = false;
  try { await insertDroppingUnknownColumns(insert, { client_id: 'c', month: 'm' }); } catch (e) { threw = e.message === 'permission denied'; }
  eq(threw, true, 'threw');
  eq(n, 1, 'attempts');
});

await t('never drops client_id or month', async () => {
  const tbl = fakeTable(['overall_score']);
  let threw = false;
  try { await insertDroppingUnknownColumns(tbl.insert, { client_id: 'c', month: 'm' }); } catch { threw = true; }
  eq(threw, true);
});

await t('the schema files define every field runSnapshot writes', async () => {
  const src = fs.readFileSync(path.join(root, 'src/modules/reports/aeoRunner.js'), 'utf8');
  const start = src.indexOf('  return {\n    client_id: client.id,');
  if (start < 0) throw new Error('snapshot return block not found');
  const block = src.slice(start, src.indexOf('\n  };\n', start));
  const keys = [...block.matchAll(/^ {4}([a-z_0-9]+)(?=[:,\n])/gm)].map(m => m[1]);
  const sql = fs.readdirSync(root).filter(f => /^supabase-schema.*\.sql$/.test(f)).map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const created = sql.match(/create table if not exists syte_suite_aeo_history \(([\s\S]*?)\n\);/)[1];
  const cols = new Set([
    ...[...created.matchAll(/^\s+([a-z_0-9]+)\s/gm)].map(m => m[1]),
    ...[...sql.matchAll(/alter table syte_suite_aeo_history add column if not exists (\w+)/g)].map(m => m[1])
  ]);
  const missing = keys.filter(k => !cols.has(k));
  if (keys.length < 20) throw new Error('parsed only ' + keys.length + ' keys');
  eq(missing, [], 'columns missing from schema');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
