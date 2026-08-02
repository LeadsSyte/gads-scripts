import React, { useState } from 'react';
import { logReportSent } from '../../lib/supabase.js';

const ACCENT = '#a78bfa';

// Max proof-PDF size we'll embed as a base64 data URL. Base64 inflates the
// payload ~1.37×, so an 8 MB PDF becomes ~11 MB of text — comfortably within
// Postgres text limits while keeping the Supabase request from getting huge.
const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8 MB

function monthLabel(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  const d = new Date(parseInt(y), parseInt(mo) - 1, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// "Mark emailed" modal. Records that a client was emailed their report — even
// one that was never generated in the tool — by attaching a PDF of what was
// sent. Writes a row to the sent-report log (manual = true) with the PDF as a
// base64 data URL, so it shows in the Sent bucket + History and the proof is
// retrievable later.
//
// Props:
//   client      — the client record ({ id, name })
//   defaultMonth— "YYYY-MM" to pre-select (the report month)
//   onClose()   — close without saving
//   onDone()    — called after a successful save (parent reloads status)
export default function MarkEmailedModal({ client, defaultMonth, onClose, onDone }) {
  const [month, setMonth] = useState(defaultMonth || new Date().toISOString().slice(0, 7));
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [pdf, setPdf] = useState(null); // { dataUrl, filename, sizeMb }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  const fileRef = React.useRef(null);

  async function onPickFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      setMsg({ ok: false, text: 'Please upload a PDF file.' });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setMsg({ ok: false, text: `PDF is ${(file.size / 1e6).toFixed(1)} MB — please use one under 8 MB (compress it, or export at a lower quality).` });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setPdf({ dataUrl, filename: file.name, sizeMb: file.size / 1e6 });
      setMsg(null);
    } catch {
      setMsg({ ok: false, text: 'Could not read that PDF file.' });
    }
  }

  async function save() {
    if (!client?.id) { setMsg({ ok: false, text: 'No client selected.' }); return; }
    if (!month) { setMsg({ ok: false, text: 'Pick the report month.' }); return; }
    if (!pdf) { setMsg({ ok: false, text: 'Upload a PDF of the report you emailed.' }); return; }
    setBusy(true); setMsg(null);
    try {
      await logReportSent({
        client_id: client.id,
        month,
        sent_date: new Date().toISOString(),
        email_subject: subject.trim() || null,
        manual: true,
        report_pdf: pdf.dataUrl,
        pdf_filename: pdf.filename,
        notes: notes.trim() || null
      });
      setMsg({ ok: true, text: 'Logged as emailed. The PDF is saved to this client’s history.' });
      onDone?.();
      setTimeout(() => onClose?.(), 600);
    } catch (e) {
      setMsg({ ok: false, text: 'Save failed: ' + (e.message || String(e)) });
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Mark as emailed</h2>
          <button onClick={onClose} className="ghost" disabled={busy}>Close</button>
        </div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          Record that <strong>{client?.name}</strong> was emailed their report — even if it wasn’t generated
          in the tool. Upload a PDF of what you sent as proof; it’s stored against the client and
          viewable later in <strong>Reports → History</strong>.
        </div>

        <div className="grid-2" style={{ gap: 12 }}>
          <div>
            <label>Report month</label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} disabled={busy} />
          </div>
          <div>
            <label>Email subject (optional)</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder={`Your ${monthLabel(month)} report`}
              disabled={busy}
            />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Report PDF (required)</label>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={onPickFile}
            disabled={busy}
            style={{ width: '100%', fontSize: 12 }}
          />
          {pdf && (
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Attached: <strong>{pdf.filename}</strong> ({pdf.sizeMb.toFixed(1)} MB)
            </div>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <label>Notes (optional)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g. Sent to john@client.com, report built manually in Looker."
            disabled={busy}
          />
        </div>

        {msg && (
          <div style={{
            marginTop: 12, padding: 10, borderRadius: 6, fontSize: 12,
            background: msg.ok ? 'rgba(52,211,153,.08)' : 'rgba(255,77,77,.06)',
            border: '1px solid ' + (msg.ok ? 'rgba(52,211,153,.2)' : 'rgba(255,77,77,.2)'),
            color: msg.ok ? 'var(--green)' : 'var(--red)'
          }}>
            {msg.text}
          </div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="primary"
            onClick={save}
            disabled={busy || !pdf}
            style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}
          >
            {busy ? 'Saving…' : 'Log as emailed'}
          </button>
        </div>
      </div>
    </div>
  );
}
