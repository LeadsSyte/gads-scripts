import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../store/useClients.js';
import { logExternalWork, listExternalWork, deleteExternalWork } from '../lib/supabase.js';

// "External Work" tracker — logs technical-SEO work done OUTSIDE the suite
// (WebCEO audits, Google Search Console submissions, Screaming Frog crawls,
// Ahrefs research, etc.). Each entry takes a short description and an optional
// screenshot as proof of work, so the effort is captured against the client's
// permanent record rather than living only in the external tool.

const ACCENT = '#ff6b35';

const TOOLS = [
  'WebCEO',
  'Google Search Console',
  'Screaming Frog',
  'Ahrefs',
  'Semrush',
  'PageSpeed Insights',
  'GA4 / Analytics',
  'Google Business Profile',
  'Other'
];

const CATEGORIES = ['Audit', 'Fix', 'Submission', 'Research', 'Monitoring', 'Other'];

// Max screenshot size we'll embed as a data URL (keeps Supabase rows sane).
const MAX_SCREENSHOT_BYTES = 1_500_000; // ~1.5 MB

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ExternalWork() {
  const clients = useClients(s => s.clients);
  const topClient = useClients(s => s.current());

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [clientId, setClientId] = useState(topClient?.id || '');
  const [tool, setTool] = useState(TOOLS[0]);
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [workUrl, setWorkUrl] = useState('');
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [doneBy, setDoneBy] = useState('');
  const [screenshot, setScreenshot] = useState(''); // data URL or pasted URL
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  const [zoom, setZoom] = useState(''); // screenshot being previewed full-size

  useEffect(() => {
    if (!clientId && topClient?.id) setClientId(topClient.id);
  }, [topClient?.id]);

  async function load() {
    setLoading(true);
    try { setItems(await listExternalWork()); }
    catch { setItems([]); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function onPickFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setMsg({ ok: false, text: `Screenshot is ${(file.size / 1e6).toFixed(1)} MB — please use one under 1.5 MB (crop or compress it).` });
      e.target.value = '';
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setScreenshot(dataUrl);
      setMsg(null);
    } catch {
      setMsg({ ok: false, text: 'Could not read that image file.' });
    }
  }

  async function save() {
    if (!clientId) { setMsg({ ok: false, text: 'Select a client.' }); return; }
    if (!description.trim()) { setMsg({ ok: false, text: 'Describe the work done.' }); return; }
    setBusy(true); setMsg(null);
    const c = clients.find(x => x.id === clientId);
    try {
      const saved = await logExternalWork({
        client_id: clientId,
        client_name: c?.name || '',
        tool,
        category,
        description: description.trim(),
        work_url: workUrl.trim() || null,
        screenshot: screenshot || null,
        work_date: workDate,
        done_by: doneBy.trim() || null
      });
      setItems(prev => [saved, ...prev]);
      setMsg({ ok: true, text: `Logged ${tool} work for ${c?.name || 'client'}.` });
      // Reset the entry fields (keep client + tool + person for fast repeat entry).
      setDescription(''); setWorkUrl(''); setScreenshot('');
    } catch (e) {
      setMsg({ ok: false, text: 'Save failed: ' + e.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!confirm('Delete this external-work entry?')) return;
    try {
      await deleteExternalWork(id);
      setItems(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      setMsg({ ok: false, text: 'Delete failed: ' + e.message });
    }
  }

  const grouped = useMemo(() => {
    const g = {};
    for (const it of items) {
      const k = it.client_id || it.client_name || '?';
      if (!g[k]) g[k] = { name: it.client_name || '(unknown client)', items: [] };
      g[k].items.push(it);
    }
    return Object.values(g).sort((a, b) => b.items.length - a.items.length);
  }, [items]);

  return (
    <div className="content-area">
      <h2 style={{ marginTop: 0 }}>External Work</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 14, maxWidth: 720 }}>
        Track technical-SEO work done outside this tool — WebCEO audits, Google Search Console
        submissions, Screaming Frog crawls, Ahrefs research, and so on. Attach a screenshot as
        proof; the entry is stored against the client's permanent record so it counts toward progress.
      </div>

      {/* Entry form */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 180, flex: 1 }}>
            <label>Client</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)} disabled={busy} style={{ width: '100%' }}>
              <option value="">— Select —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 170 }}>
            <label>Tool</label>
            <select value={tool} onChange={e => setTool(e.target.value)} disabled={busy} style={{ width: '100%' }}>
              {TOOLS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label>Type</label>
            <select value={category} onChange={e => setCategory(e.target.value)} disabled={busy} style={{ width: '100%' }}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label>Date</label>
            <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} disabled={busy} style={{ width: '100%' }} />
          </div>
          <div style={{ minWidth: 150 }}>
            <label>Done by (optional)</label>
            <input type="text" value={doneBy} onChange={e => setDoneBy(e.target.value)} placeholder="Name" disabled={busy} style={{ width: '100%' }} />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <label>What was done</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Ran a full WebCEO site audit, fixed 12 broken internal links found in Screaming Frog, submitted updated sitemap in Search Console…"
            rows={3}
            disabled={busy}
            style={{ width: '100%' }}
          />
        </div>

        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
          <div style={{ flex: 2, minWidth: 240 }}>
            <label>Related URL (optional)</label>
            <input type="url" value={workUrl} onChange={e => setWorkUrl(e.target.value)} placeholder="Link to the report or page" disabled={busy} style={{ width: '100%' }} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label>Screenshot proof (optional)</label>
            <input type="file" accept="image/*" onChange={onPickFile} disabled={busy} style={{ width: '100%', fontSize: 11 }} />
          </div>
        </div>

        {screenshot && (
          <div style={{ marginTop: 10 }}>
            <img
              src={screenshot}
              alt="Screenshot preview"
              onClick={() => setZoom(screenshot)}
              style={{ maxHeight: 120, borderRadius: 6, border: '1px solid var(--border)', cursor: 'zoom-in' }}
            />
            <button onClick={() => setScreenshot('')} style={{ fontSize: 10, padding: '3px 8px', marginLeft: 10 }}>Remove</button>
          </div>
        )}

        <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          {msg
            ? <span style={{ fontSize: 12, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.text}</span>
            : <span />}
          <button
            className="primary"
            style={{ background: ACCENT, borderColor: ACCENT }}
            onClick={save}
            disabled={busy || !clientId || !description.trim()}
          >
            {busy ? 'Logging…' : 'Log Work'}
          </button>
        </div>
      </div>

      {/* History */}
      {loading ? (
        <div className="muted" style={{ padding: 16 }}>Loading…</div>
      ) : items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
          No external work logged yet. Use the form above to record work done in WebCEO, Search Console, Screaming Frog, etc.
        </div>
      ) : (
        grouped.map(g => (
          <div key={g.name} className="card" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{g.name}</strong>
                <span className="muted" style={{ fontSize: 12 }}>{g.items.length} entr{g.items.length === 1 ? 'y' : 'ies'}</span>
              </div>
            </div>
            {g.items.map(it => (
              <div key={it.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {it.screenshot && (
                  <img
                    src={it.screenshot}
                    alt="proof"
                    onClick={() => setZoom(it.screenshot)}
                    style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', cursor: 'zoom-in', flexShrink: 0 }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                    <span className="badge orange" style={{ fontSize: 10 }}>{it.tool}</span>
                    {it.category && <span className="badge" style={{ fontSize: 10 }}>{it.category}</span>}
                    <span className="muted" style={{ fontSize: 11 }}>
                      {it.work_date}{it.done_by ? ' · ' + it.done_by : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 13 }}>{it.description}</div>
                  {it.work_url && (
                    <a href={it.work_url} target="_blank" rel="noreferrer" className="mono muted" style={{ fontSize: 10 }}>
                      {it.work_url}
                    </a>
                  )}
                </div>
                <button onClick={() => remove(it.id)} style={{ fontSize: 10, padding: '3px 8px', flexShrink: 0 }}>Delete</button>
              </div>
            ))}
          </div>
        ))
      )}

      {/* Full-size screenshot lightbox */}
      {zoom && (
        <div
          onClick={() => setZoom('')}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out'
          }}
        >
          <img src={zoom} alt="Screenshot" style={{ maxWidth: '90%', maxHeight: '90%', borderRadius: 8, border: '1px solid var(--border)' }} />
        </div>
      )}
    </div>
  );
}
