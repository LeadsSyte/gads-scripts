import React, { useRef, useState } from 'react';
import { setCachedReportData } from '../../lib/supabase.js';
import { readGscExport, buildImportedReportData, summarizeImport } from './gscImport.js';

// Drop-in card for the one case the AEO side can't cover on its own: a client
// whose Search Console we don't have connected, but whose Performance export
// we do have on disk. It writes the parsed export into the same per-client,
// per-month report-data cache a live pull writes, so the probe grid, the
// discovery sweep and the "add GSC queries" affordance ground on real
// head-terms instead of guessed phrases.
//
// It does NOT connect anything and it does NOT unblock the SEO report — that
// gate checks the Google connection itself (gscGuard.js), which is left alone
// on purpose.
//
// Props:
//   client     — the client to import for (needs .id and .name)
//   month      — 'YYYY-MM', the report month the rows cover
//   onImported — (reportData) => void, so the parent can use it immediately
//   accent     — border/CTA colour, defaults to the AEO purple
export default function GscCsvImport({ client, month, onImported, accent = 'var(--mod-aeo)' }) {
  const [parsed, setParsed] = useState(null);   // { queries, pages, sheets }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const inputRef = useRef(null);

  async function readFiles(fileList) {
    const out = [];
    for (const file of Array.from(fileList || [])) {
      if (/\.zip$/i.test(file.name)) {
        // Search Console's Export button hands you a zip of one CSV per
        // dimension — take it as-is rather than making anyone unpack it.
        const { default: JSZip } = await import('jszip');
        const zip = await JSZip.loadAsync(file);
        for (const entry of Object.values(zip.files)) {
          if (entry.dir || !/\.(csv|tsv)$/i.test(entry.name)) continue;
          out.push({ name: entry.name, text: await entry.async('string') });
        }
      } else {
        out.push({ name: file.name, text: await file.text() });
      }
    }
    return out;
  }

  async function onPick(e) {
    setErr(''); setDone(''); setParsed(null);
    const files = e.target.files;
    if (!files?.length) return;
    setBusy(true);
    try {
      const read = await readFiles(files);
      const result = readGscExport(read);
      if (!result.queries.length) {
        setErr('No query rows found in ' + read.map(f => f.name).join(', ') +
          '. Search Console → Performance → Export gives a Queries sheet — that\'s the one this needs.');
      }
      setParsed(result);
    } catch (e2) {
      setErr('Could not read the file: ' + e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!client?.id || !parsed) return;
    setBusy(true); setErr('');
    try {
      const data = buildImportedReportData({
        client, month, queries: parsed.queries, pages: parsed.pages
      });
      await setCachedReportData(client.id, month, data);
      setDone(summarizeImport(data));
      setParsed(null);
      if (inputRef.current) inputRef.current.value = '';
      onImported?.(data);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      marginTop: 12, padding: '12px 14px',
      background: 'rgba(255,255,255,.02)',
      border: '1px dashed var(--border)',
      borderRadius: 'var(--radius)'
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>
        No Search Console connection? Import the export instead
      </div>
      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
        Search Console → Performance → Export → Download CSV, then drop the zip (or just
        Queries.csv / Pages.csv) here. The rows are stored as {client?.name || 'this client'}'s
        Search Console data for {month} and used to ground the AEO probe grid, discovery and
        head-term expansion — exactly as a live connection would. It does not connect the
        account, and the SEO report stays gated on a real connection.
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.zip"
        multiple
        onChange={onPick}
        disabled={busy || !client?.id}
        style={{ fontSize: 11 }}
      />

      {parsed && (
        <div style={{ marginTop: 8, fontSize: 11 }}>
          <div className="muted">
            {parsed.sheets.map(s => `${s.name}: ${s.kind} (${s.rows} rows)`).join(' · ')}
          </div>
          <div className="row" style={{ gap: 10, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span><strong>{parsed.queries.length}</strong> queries · <strong>{parsed.pages.length}</strong> pages ready</span>
            <button
              onClick={doImport}
              disabled={busy || !parsed.queries.length}
              style={{ fontSize: 11, padding: '5px 12px', borderColor: accent, color: accent }}
            >
              {busy ? 'Importing…' : `Import for ${month}`}
            </button>
          </div>
        </div>
      )}

      {done && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--green)' }}>
          ✓ Imported for {month} — {done}
        </div>
      )}
      {err && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--red)' }}>{err}</div>
      )}
    </div>
  );
}
