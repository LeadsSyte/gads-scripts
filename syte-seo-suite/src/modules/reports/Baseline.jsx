import React, { useState, useEffect, useRef } from 'react';
import { useClients } from '../../store/useClients.js';
import { fetchReportData } from './reportData.js';
import ReportDashboard from './ReportDashboard.jsx';
import { ensureToken, SCOPES, getToken, switchAccount } from '../technical/googleAuth.js';
import { getBaseline, saveBaseline, deleteBaseline, listBaselines } from '../../lib/supabase.js';
import { serverAuthEnabled } from '../../lib/googleServerAuth.js';
import { startBaselineRun, loadBaselineRunState, BASELINE_RUNNING } from './baselineAuto.js';
import BaselineExtras from './BaselineExtras.jsx';

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
  const [run, setRun] = useState(null);                 // server-side baseline run state
  const running = !!run && BASELINE_RUNNING.includes(run.status);
  const [pollKey, setPollKey] = useState(0);            // bumped when a run is started here
  const askedAt = useRef(0);

  // Follow the server-side run (auto on client add, or "Run Full Baseline").
  useEffect(() => {
    let cancelled = false, timer = null, wasRunning = pollKey > 0, waits = 0;
    if (!client?.id) { setRun(null); return; }
    async function poll() {
      const st = await loadBaselineRunState(client.id);
      if (cancelled) return;
      // A run just started here may not have written its state yet.
      const stale = pollKey > 0 && (!st || new Date(st.started_at || 0).getTime() < askedAt.current - 5000);
      if (stale) {
        if (++waits <= 6) { timer = setTimeout(poll, 4000); return; }
        setRun(null);
        setErr('The server did not start the baseline run. Check that the suite is unlocked with the current password, then try again.');
        return;
      }
      setRun(st);
      const now = !!st && BASELINE_RUNNING.includes(st.status);
      if (wasRunning && !now) {
        try { const row = await getBaseline(client.id); if (!cancelled) setBaseline(row); } catch {}
      }
      wasRunning = now;
      if (now) timer = setTimeout(poll, 5000);
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [client?.id, pollKey]);
  useEffect(() => { setRun(null); setPollKey(0); }, [client?.id]);

  async function runFull() {
    if (!client) return;
    if (baseline && !confirm('Replace the saved baseline with a fresh full capture?')) return;
    setErr(''); setPreview(null); setStatus('');
    try {
      const ok = await startBaselineRun(client.id, { force: !!baseline, trigger: 'manual' });
      if (!ok) throw new Error('The server refused the baseline run. Check that the suite is unlocked with the current password.');
      askedAt.current = Date.now();
      setRun({ client_id: client.id, status: 'queued', trigger: 'manual', started_at: new Date().toISOString(), log: [] });
      // The function answers 202 before it runs; give it a moment to write its state.
      setTimeout(() => setPollKey(k => k + 1), 3000);
    } catch (e) { setErr(e.message); }
  }

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

    // Server auth: the proxy holds the tokens, so there is nothing to sign
    // into here — the browser-token gate below would block every baseline.
    let token = serverAuthEnabled() ? { access_token: 'server' } : getToken();
    if (!serverAuthEnabled() && (forceReauth || !token?.access_token)) {
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
      const extras = baseline?.data?.baseline;
      const row = await saveBaseline(client.id, previewMonth, extras ? { ...preview, baseline: extras } : preview);
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
              A one-time snapshot of where {client.name} stood when they came on board —
              last month's organic traffic and keyword rankings, technical site health and
              AI-engine visibility — so future performance can be measured against it.
              Captured automatically when the client is added.
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
            {!preview && (
              <button
                className="primary"
                onClick={runFull}
                disabled={running}
                style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}
              >
                {running ? 'Capturing…' : captured ? 'Re-run Full Baseline' : 'Run Full Baseline'}
              </button>
            )}
            {!captured && !preview && !running && (
              <button
                onClick={() => fetchBaseline(false)}
                disabled={status.includes('Pulling')}
                style={{ borderColor: ACCENT, color: ACCENT }}
                title="Rankings + traffic only, pulled in this browser with your Google sign-in"
              >
                {serverAuthEnabled() || getToken()?.access_token ? 'Rankings Only' : 'Connect Google & Fetch'}
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
            {captured && !preview && !running && (
              <>
                <button onClick={() => fetchBaseline(false)} style={{ borderColor: ACCENT, color: ACCENT }}
                  title="Re-pull rankings + traffic only, in this browser; technical and AI sections are kept">
                  Re-capture Rankings
                </button>
                <button onClick={remove} style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Server-side run (automatic on client add) */}
      {run && (running || run.status === 'failed') && (
        <div className="card" style={{ marginBottom: 14, padding: '10px 16px', borderColor: run.status === 'failed' ? 'var(--red)' : 'rgba(167,139,250,.3)' }}>
          <div className="row" style={{ gap: 8, fontSize: 12 }}>
            {running && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />}
            <span style={{ color: run.status === 'failed' ? 'var(--red)' : 'var(--text-muted)', flex: 1 }}>
              {run.status === 'failed'
                ? 'Baseline capture failed: ' + (run.error || 'unknown error')
                : (run.trigger === 'auto' ? 'Capturing the onboarding baseline automatically' : 'Capturing the full baseline') +
                  ' — ' + ((run.log || []).slice(-1)[0]?.slice(9) || 'starting…')}
            </span>
          </div>
        </div>
      )}

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
          <BaselineExtras extras={viewData.baseline || baseline?.data?.baseline} />
        </div>
      ) : (
        !status && !running && (
          <div className="muted" style={{ fontSize: 13 }}>
            No baseline captured yet. Click <strong>Run Full Baseline</strong> to snapshot where this
            client stands today.
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
  const [runs, setRuns] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const rows = await listBaselines();
        const byClient = {};
        for (const r of rows) byClient[r.client_id] = r;
        setBaselines(byClient);
      } catch {}
      try {
        const { supabase } = await import('../../lib/supabase.js');
        if (supabase) {
          const { data } = await supabase.from('syte_suite_settings').select('data').like('id', 'baseline:%');
          const byClient = {};
          for (const r of data || []) if (r.data?.client_id) byClient[r.data.client_id] = r.data;
          setRuns(byClient);
        }
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
            {allClients.length} clients · A starting snapshot is captured automatically when a client is added
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
          const capturing = BASELINE_RUNNING.includes(runs[c.id]?.status);
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
                {capturing ? (
                  <span className="badge" style={{ fontSize: 9, borderColor: ACCENT, color: ACCENT }}>Capturing…</span>
                ) : has ? (
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
