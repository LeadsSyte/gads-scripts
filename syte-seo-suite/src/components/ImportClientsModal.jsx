import React, { useMemo, useState } from 'react';
import { parsePastedClients, importPastedClients } from '../lib/migration.js';
import { useClients } from '../store/useClients.js';

// One-liner the user runs in the DevTools console on each old tool site.
// It dumps every known legacy key into one JSON string and copies it to the
// clipboard.
const CONSOLE_ONE_LINER = `copy(JSON.stringify({
  "syte-tseo-clients": localStorage.getItem("syte-tseo-clients"),
  "syte-aeo-clients":  localStorage.getItem("syte-aeo-clients"),
  "syte-ce-brands":    localStorage.getItem("syte-ce-brands"),
  "tseo": localStorage.getItem("tseo-clients") || localStorage.getItem("clients"),
  "aeo":  localStorage.getItem("aeo-clients")  || localStorage.getItem("brands"),
  "ce":   localStorage.getItem("ce-brands")    || localStorage.getItem("brands")
}))`;

export default function ImportClientsModal({ onClose }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const load = useClients(s => s.load);

  const preview = useMemo(() => {
    if (!text.trim()) return null;
    try { return parsePastedClients(text); }
    catch { return null; }
  }, [text]);

  async function run() {
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await importPastedClients(text);
      setResult(r);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  function copyOneLiner() {
    navigator.clipboard.writeText(CONSOLE_ONE_LINER).catch(() => {});
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 780 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Import Clients from Old Tools</h2>
          <button onClick={onClose} className="ghost">Close</button>
        </div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          Browsers isolate data per site, so this new suite can't read the localStorage
          from your old Content Engine / Technical SEO / AEO tools directly. Instead,
          grab the data manually:
        </div>

        <ol style={{ fontSize: 13, paddingLeft: 18, marginBottom: 14 }}>
          <li>Open each old tool in a new tab.</li>
          <li>Press <code>F12</code> → <strong>Console</strong> tab.</li>
          <li>Paste the one-liner below and press Enter. It copies a JSON blob to your clipboard.</li>
          <li>Come back here, paste into the box, click <strong>Import</strong>.</li>
          <li>Repeat for each tool (the importer merges by URL, so duplicates are fine).</li>
        </ol>

        <label>Console one-liner</label>
        <pre style={{
          background: 'var(--surface-2)', padding: 10, borderRadius: 8,
          fontSize: 11, overflowX: 'auto', border: '1px solid var(--border)',
          margin: 0, marginBottom: 6
        }}>{CONSOLE_ONE_LINER}</pre>
        <button onClick={copyOneLiner} style={{ marginBottom: 16 }}>Copy one-liner</button>

        <label>Paste JSON here</label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={10}
          placeholder='{"syte-tseo-clients":"[{...}]", ...}'
        />

        {preview && (
          <div className="card" style={{ marginTop: 12, padding: 12 }}>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
              Preview — {preview.length} unique client{preview.length === 1 ? '' : 's'}
            </div>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12 }}>
              {preview.slice(0, 10).map((c, i) => (
                <li key={i}>{c.name || <em className="muted">(no name)</em>} <span className="muted">— {c.url || '—'}</span></li>
              ))}
              {preview.length > 10 && <li className="muted">…and {preview.length - 10} more</li>}
            </ul>
          </div>
        )}

        {result && (
          <div style={{ color: 'var(--green)', marginTop: 12, fontSize: 13 }}>
            Done. Inserted {result.inserted} · merged {result.merged} · skipped {result.skipped}.
          </div>
        )}
        {err && <div style={{ color: 'var(--red)', marginTop: 12 }}>{err}</div>}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16, gap: 10 }}>
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={run} disabled={busy || !preview || !preview.length}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
