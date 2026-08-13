import React, { useState, useEffect } from 'react';
import { useClients } from '../../store/useClients.js';
import { fetchReportData } from './reportData.js';
import ReportDashboard from './ReportDashboard.jsx';
import { ensureToken, SCOPES, getToken, switchAccount } from '../technical/googleAuth.js';
import { getBaseline, saveBaseline, deleteBaseline, listBaselines } from '../../lib/supabase.js';

const ACCENT = '#a78bfa';

// A baseline always covers the PREVIOUS complete month at the moment of
// onboarding — that's the "past month" snapshot the user asked for.
function previousMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}
function monthLabel(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  const d = new Date(parseInt(y), parseInt(mo) - 1, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// ─── Per-client capture / view ───────────────────────────────
function BaselineDetail() {
  const client = useClients(s => s.current());
  const [baseline, setBaseline] = useState(null);      // saved baseline row (if any)
  const [preview, setPreview] = useState(null);         // freshly fetched data awaiting save
  const [previewMonth, setPreviewMonth] = useState(previousMonth());
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Load any existing baseline whenever the client changes.
  useEffect(() => {
    let cancelled = false;
    setBaseline(null); setPreview(null); setStatus(''); setErr(''); setLoading(true);
    setPreviewMonth(previousMonth());
    if (!client?.id) { setLoading(false); return; }
    (async () => {
      try {
        const row = await getBaseline(client.id);
        if (!cancelled) setBaseline(row);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [client?.id]);

  // Pull the past month's rankings + organic traffic to preview before saving.
  async function fetchBaseline(forceReauth = false) {
    if (!client) return;
    setErr(''); setPreview(null);

    const month = previousMonth();
    setPreviewMonth(month);

    if (!client.ga4_property_id && !client.gsc_property) {
      setStatus('No GA4 or GSC configured — set up in Edit Client → Google Connections.');
      return;
    }

    let token = getToken();
    if ((forceReauth || !token?.access_token)) {
      setStatus('Connecting to Google — please sign in if prompted…');
      try {
        token = forceReauth
          ? await switchAccount([SCOPES.ga4, SCOPES.gsc])
          : await ensureToken([SCOPES.ga4, SCOPES.gsc]);
      } catch {
        setStatus('Google auth failed — try again');
        return;
      }
    }

    const [year, mo] = month.split('-').map(Number);
    setStatus('Pulling baseline rankings + organic traffic for ' + monthLabel(month) + '…');
    try {
      const data = await fetchReportData(client, year, mo);
      setPreview(data);
      const parts = [];
      if (data.traffic?.current) parts.push('GA4 ✓');
      if (data.keywords?.length > 0) parts.push('GSC ✓ (' + data.keywords.length + ' keywords)');
      if (data.errors?.length > 0) parts.push(data.errors.join(' · '));
      setStatus(parts.join(' · ') || 'No data available');
    } catch (e) {
      setStatus('Failed: ' + e.message.slice(0, 80));
    }
  }

  async function save() {
    if (!client || !preview) return;
    setSaving(true); setErr('');
    try {
      const row = await saveBaseline(client.id, previewMonth, preview);
      setBaseline(row);
      setPreview(null);
      setStatus('');
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!client || !baseline) return;
    if (!confirm('Delete this baseline? This cannot be undone.')) return;
    try {
      await deleteBaseline(client.id);
      setBaseline(null);
    } catch (e) { setErr(e.message); }
  }

  if (!client) return <div className="muted">Select a client first.</div>;
  if (loading) return <div className="muted">Loading baseline…</div>;

  const captured = !!baseline;
  const viewData = preview || baseline?.data;
  const viewMonth = preview ? previewMonth : baseline?.month;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Baseline — {client.name}</h2>

      {/* Header card */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong>Onboarding Baseline</strong>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              A one-time snapshot of {client.name}'s current keyword rankings and organic
              traffic for the past month — captured when they came on board, so future
              performance can be measured against where they started.
            </div>
            {captured && (
              <div style={{ marginTop: 8 }}>
                <span className="badge green" style={{ fontSize: 10 }}>
                  Baseline captured · {monthLabel(baseline.month)}
                </span>
                <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                  {baseline.captured_at ? new Date(baseline.captured_at).toLocaleDateString('en-ZA') : ''}
                </span>
              </div>
            )}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {!captured && !preview && (
              <button
                className="primary"
                onClick={() => fetchBaseline(false)}
                disabled={status.includes('Pulling')}
                style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}
              >
                {getToken()?.access_token ? 'Fetch Baseline Data' : 'Connect Google & Fetch'}
              </button>
            )}
            {preview && (
              <button
                className="primary"
                onClick={save}
                disabled={saving}
                style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}
              >
                {saving ? 'Saving…' : 'Save as Baseline'}
              </button>
            )}
            {captured && !preview && (
              <>
                <button onClick={() => fetchBaseline(false)} style={{ borderColor: ACCENT, color: ACCENT }}>
                  Re-capture
                </button>
                <button onClick={remove} style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Fetch status */}
      {status && (
        <div className="card" style={{ marginBottom: 14, padding: '10px 16px' }}>
          <div className="row" style={{ gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
            {status.includes('Pulling') && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />}
            <span style={{ color: status.includes('✓') ? 'var(--green)' : status.includes('Failed') || status.includes('failed') ? 'var(--orange)' : 'var(--text-muted)', flex: 1 }}>
              {status}
            </span>
            {(status.includes('403') || status.includes('permission') || status.includes('failed')) && (
              <button
                onClick={() => fetchBaseline(true)}
                style={{ fontSize: 11, padding: '4px 12px', borderColor: 'var(--blue)', color: 'var(--blue)', whiteSpace: 'nowrap' }}
              >
                Switch Google Account
              </button>
            )}
          </div>
        </div>
      )}

      {preview && (
        <div className="card" style={{ marginBottom: 14, padding: '10px 16px', borderColor: 'rgba(167,139,250,.3)' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Preview for {monthLabel(previewMonth)} — review below, then click <strong>Save as Baseline</strong> to lock it in.
          </span>
        </div>
      )}

      {/* Dashboard */}
      {viewData ? (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <strong>Baseline Snapshot — {monthLabel(viewMonth)}</strong>
            {captured && !preview && <span className="badge green" style={{ fontSize: 9 }}>Saved baseline</span>}
          </div>
          <ReportDashboard data={viewData} client={client} monthLabel={monthLabel(viewMonth)} />
        </div>
      ) : (
        !status && (
          <div className="muted" style={{ fontSize: 13 }}>
            No baseline captured yet. Click <strong>Fetch Baseline Data</strong> to snapshot this
            client's current rankings and organic traffic.
          </div>
        )
      )}

      {err && <div style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
    </div>
  );
}

// ─── Module: client grid → detail ────────────────────────────
export default function Baseline() {
  const allClients = useClients(s => s.clients);
  const select = useClients(s => s.select);
  const [showDetail, setShowDetail] = useState(false);
  const [baselines, setBaselines] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const rows = await listBaselines();
        const byClient = {};
        for (const r of rows) byClient[r.client_id] = r;
        setBaselines(byClient);
      } catch {}
    })();
  }, [showDetail]);

  if (showDetail) {
    return (
      <div className="content-area">
        <button onClick={() => setShowDetail(false)} style={{ marginBottom: 14, fontSize: 12 }}>
          ← Back to all clients
        </button>
        <BaselineDetail />
      </div>
    );
  }

  return (
    <div className="content-area">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0 }}>Client Baselines</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {allClients.length} clients · Capture a starting snapshot of rankings + organic traffic when you onboard a new client
          </div>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 10
      }}>
        {allClients.map(c => {
          const baseline = baselines[c.id];
          const has = !!baseline;
          const services = [
            c.does_content !== false && 'Content',
            c.does_technical !== false && 'Technical',
            c.does_aeo !== false && 'AEO'
          ].filter(Boolean);

          return (
            <div
              key={c.id}
              className="card"
              style={{
                padding: 14, cursor: 'pointer',
                borderColor: has ? 'rgba(52,211,153,.3)' : 'var(--border)',
                borderLeftWidth: 3, borderLeftStyle: 'solid',
                borderLeftColor: has ? 'var(--green)' : ACCENT
              }}
              onClick={() => { select(c.id); setShowDetail(true); }}
            >
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                  {c.name}
                </strong>
                {has ? (
                  <span className="badge green" style={{ fontSize: 9 }}>Captured</span>
                ) : (
                  <span className="badge" style={{ fontSize: 9, borderColor: ACCENT, color: ACCENT }}>Not set</span>
                )}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                {services.join(' · ') || 'No services'}
              </div>
              {has && (
                <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
                  {monthLabel(baseline.month)}
                  {baseline.captured_at ? ' · ' + new Date(baseline.captured_at).toLocaleDateString('en-ZA') : ''}
                </div>
              )}
              <button
                style={{ marginTop: 8, fontSize: 10, padding: '4px 10px', borderColor: ACCENT, color: ACCENT }}
                onClick={(e) => { e.stopPropagation(); select(c.id); setShowDetail(true); }}
              >
                {has ? 'View Baseline' : 'Capture Baseline'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
