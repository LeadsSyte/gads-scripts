// The generated-report log has to survive the two failures that made
// generated reports disappear from the Reports board:
//
//   1. The SEO and AEO reports for one client+month were deduped by
//      (client_id, month) alone, so a locally-saved AEO report was thrown
//      away whenever the SEO report for that month existed — it showed
//      nowhere, on any device.
//   2. Every report (microsite JSON, the saved GA4/GSC snapshot, and an
//      edited HTML override that runs to megabytes) went into ONE
//      localStorage array. After a few clients that blew the ~5MB quota,
//      setItem threw, and the catch swallowed it — losing the status row
//      that the "Generated" card is drawn from.
//
// Runs against the no-Supabase path (no VITE_ env under node), which is the
// same local-mirror code the browser falls back to when a DB write fails.
//
// Run: node test/reportGeneratedLog.test.mjs

// A localStorage with a byte budget, so the quota path is a real test and
// not a mock of itself.
function installLocalStorage(quotaBytes = Infinity) {
  const store = new Map();
  const size = () => [...store.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem(k, v) {
      const prev = store.get(k) || '';
      store.set(k, String(v));
      if (size() > quotaBytes) {
        if (prev) store.set(k, prev); else store.delete(k);
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
    },
    removeItem: k => store.delete(k),
    key: i => [...store.keys()][i],
    get length() { return store.size; }
  };
  return store;
}

installLocalStorage();

const { logReportGenerated, listGeneratedReports, getGeneratedReport } =
  await import('../src/lib/supabase.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function assert(cond, label) {
  if (!cond) throw new Error(label || 'assertion failed');
}

const CLIENT = '11111111-1111-4111-8111-111111111111';

await t('the SEO and AEO reports for a month both survive', async () => {
  installLocalStorage();
  await logReportGenerated({
    client_id: CLIENT, month: '2026-08', report_type: 'seo',
    email_subject: 'SEO', microsite_json: { clientName: 'Acme' }
  });
  await logReportGenerated({
    client_id: CLIENT, month: '2026-08', report_type: 'aeo',
    email_subject: 'AEO', microsite_json: { clientName: 'Acme AEO' }
  });
  const rows = await listGeneratedReports(CLIENT);
  assertEq(rows.length, 2, 'row count');
  assertEq(rows.filter(r => r.report_type === 'aeo').length, 1, 'AEO row');
  assertEq(rows.filter(r => r.report_type === 'seo').length, 1, 'SEO row');
});

await t('regenerating updates in place instead of stacking rows', async () => {
  installLocalStorage();
  await logReportGenerated({ client_id: CLIENT, month: '2026-08', report_type: 'seo', qa_score: 7 });
  await logReportGenerated({ client_id: CLIENT, month: '2026-08', report_type: 'seo', qa_score: 9 });
  const rows = await listGeneratedReports(CLIENT);
  assertEq(rows.length, 1, 'row count');
  assertEq(rows[0].qa_score, 9, 'newest QA score');
});

await t('a saved report reloads with its content', async () => {
  installLocalStorage();
  await logReportGenerated({
    client_id: CLIENT, month: '2026-08', report_type: 'aeo',
    email_subject: 'Subject', email_body: 'Body',
    microsite_json: { clientName: 'Acme' }, aeo_probe: { score: 42 }
  });
  const saved = await getGeneratedReport(CLIENT, '2026-08', 'aeo');
  assertEq(saved.email_subject, 'Subject', 'subject');
  assertEq(saved.email_body, 'Body', 'body');
  assertEq(saved.microsite_json.clientName, 'Acme', 'microsite');
  assertEq(saved.aeo_probe.score, 42, 'probe');
  // The other type for the same month is a separate report, not this one.
  assertEq(await getGeneratedReport(CLIENT, '2026-08', 'seo'), null, 'SEO report');
});

await t('the list stays lean — content is not carried in it', async () => {
  installLocalStorage();
  const big = 'x'.repeat(50000);
  await logReportGenerated({
    client_id: CLIENT, month: '2026-08', report_type: 'seo',
    email_subject: 'S', microsite_html_override: big, report_data: { rows: big }
  });
  const rows = await listGeneratedReports(CLIENT);
  assertEq(rows[0].microsite_html_override, undefined, 'html override');
  assertEq(rows[0].report_data, undefined, 'report data');
  assertEq(rows[0].email_subject, 'S', 'status field kept');
});

await t('an oversized report still leaves a Generated card behind', async () => {
  // 8KB of room: the status row fits, a multi-megabyte microsite never will.
  installLocalStorage(8000);
  const huge = 'x'.repeat(200000);
  const res = await logReportGenerated({
    client_id: CLIENT, month: '2026-08', report_type: 'seo',
    email_subject: 'Acme — August', microsite_html_override: huge
  });
  assertEq(res.saved_to, 'local', 'reported where it landed');
  const rows = await listGeneratedReports(CLIENT);
  assertEq(rows.length, 1, 'status row survived the quota error');
  assertEq(rows[0].email_subject, 'Acme — August', 'status row intact');
});

await t('one huge report does not evict another report\'s status', async () => {
  installLocalStorage(20000);
  await logReportGenerated({
    client_id: CLIENT, month: '2026-07', report_type: 'seo',
    email_subject: 'July', microsite_json: { clientName: 'Acme' }
  });
  await logReportGenerated({
    client_id: CLIENT, month: '2026-08', report_type: 'seo',
    email_subject: 'August', microsite_html_override: 'x'.repeat(100000)
  });
  const rows = await listGeneratedReports(CLIENT);
  assertEq(rows.length, 2, 'both months listed');
  assert(rows.some(r => r.month === '2026-07'), 'July still there');
  assert(rows.some(r => r.month === '2026-08'), 'August still there');
});

await t('logging never throws — it reports where the row landed', async () => {
  installLocalStorage(1); // nothing fits at all
  const res = await logReportGenerated({ client_id: CLIENT, month: '2026-08', report_type: 'seo' });
  assertEq(res.saved_to, 'local', 'saved_to');
  assertEq(res.month, '2026-08', 'payload returned');
  assert(res.generated_at, 'stamped a generation time');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
