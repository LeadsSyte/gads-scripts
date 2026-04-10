import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { snapshotPreflight, runSnapshot } from './aeoRunner.js';
import { saveAeoSnapshot, listAeoSnapshots } from '../../lib/supabase.js';
import { ALL_ENGINES } from './aeoEngines.js';

const ACCENT = '#a78bfa';

function scoreColor(s) {
  if (s == null) return 'var(--text-muted)';
  if (s < 40)  return 'var(--red)';
  if (s < 70)  return 'var(--orange)';
  return 'var(--green)';
}

// Horizontal SVG bar for an engine score (0-100).
function ScoreBar({ value, label }) {
  const w = Math.max(0, Math.min(100, value || 0));
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12 }}>{label}</span>
        <span style={{ fontSize: 12, color: scoreColor(value), fontWeight: 600 }}>{value}</span>
      </div>
      <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: w + '%', height: '100%', background: scoreColor(value), transition: 'width .4s' }} />
      </div>
    </div>
  );
}

export default function AEOSnapshot() {
  const client = useClients(s => s.current());
  const [preflight, setPreflight] = useState(null);
  const [progress, setProgress] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [lastSnapshot, setLastSnapshot] = useState(null); // for delta calc
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!client) { setPreflight(null); setSnapshot(null); setLastSnapshot(null); return; }
    setPreflight(snapshotPreflight(client));
    setSnapshot(null);
    // Load the most recent saved snapshot for delta comparison.
    listAeoSnapshots(client.id).then(rows => {
      setLastSnapshot(rows[0] || null);
    }).catch(() => {});
  }, [client?.id]);

  const delta = useMemo(() => {
    if (!snapshot || !lastSnapshot) return null;
    return snapshot.overall_score - (lastSnapshot.overall_score || 0);
  }, [snapshot, lastSnapshot]);

  async function run() {
    if (!client) return;
    setBusy(true); setErr(''); setMsg(''); setSnapshot(null);
    setProgress({ phase: 'starting', index: 0, total: 0 });
    try {
      const result = await runSnapshot(client, {
        onProgress: (p) => setProgress(p)
      });
      setSnapshot(result);
      setProgress({ phase: 'complete', index: result.per_query.length, total: result.per_query.length });
    } catch (e) {
      setErr(e.message);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!snapshot) return;
    const month = snapshot.month;
    // Check if a snapshot already exists for this month and prompt to overwrite.
    const existing = lastSnapshot && lastSnapshot.month === month ? lastSnapshot : null;
    if (existing && !confirm(`A snapshot for ${month} already exists. Save another run?`)) return;
    try {
      await saveAeoSnapshot(snapshot);
      setMsg('Saved to AEO history ✓');
      const rows = await listAeoSnapshots(client.id);
      setLastSnapshot(rows[0] || null);
    } catch (e) { setErr(e.message); }
  }

  if (!client) {
    return <div className="muted">Select a client first.</div>;
  }

  const engineRow = ALL_ENGINES.map(e => ({
    id: e.id, label: e.label,
    configured: e.isConfigured(),
    score: snapshot?.engine_scores?.[e.id] ?? null
  }));

  const queries = (client.aeo_probe_queries || '').split('\n').map(s => s.trim()).filter(Boolean);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>AEO Snapshot</h2>
        <span className="badge" style={{ borderColor: ACCENT, color: ACCENT }}>
          {new Date().toISOString().slice(0, 7)}
        </span>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <strong>{client.name}</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              {queries.length} probe {queries.length === 1 ? 'query' : 'queries'} · tracking {(client.competitors || '').split(',').filter(Boolean).length} competitor(s)
            </div>
          </div>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            {engineRow.map(e => (
              <span key={e.id} style={{ fontSize: 12 }}>
                <span className="dot" style={{ background: e.configured ? 'var(--green)' : 'var(--red)', marginRight: 6 }} />
                {e.label}
              </span>
            ))}
          </div>
        </div>

        {queries.length === 0 && (
          <div style={{ color: 'var(--orange)', marginTop: 10, fontSize: 13 }}>
            This client has no probe queries. Open Edit Client → Reporting & AEO to add some.
          </div>
        )}
        {preflight?.missingEngines.length > 0 && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Missing engines: {preflight.missingEngines.map(e => e.label).join(', ')} (Suite Settings → AEO Engine Keys)
          </div>
        )}

        <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {progress ? (
              progress.phase === 'complete'
                ? 'Complete'
                : progress.phase === 'sentiment'
                  ? `Sentiment: ${progress.query?.slice(0, 40)}…`
                  : `${progress.index} / ${progress.total} — ${progress.engine || ''}`
            ) : ''}
          </span>
          <button
            className="primary"
            onClick={run}
            disabled={busy || !preflight?.canRun}
            style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}
          >
            {busy ? 'Running…' : 'Run AEO Snapshot'}
          </button>
        </div>

        {progress && progress.total > 0 && (
          <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
            <div style={{
              width: Math.round((progress.index / progress.total) * 100) + '%',
              height: '100%', background: ACCENT, transition: 'width .3s'
            }} />
          </div>
        )}

        {err && <div style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
        {msg && <div style={{ color: 'var(--green)', marginTop: 10 }}>{msg}</div>}
      </div>

      {snapshot && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Overall Visibility</div>
                <div style={{
                  fontFamily: 'Instrument Serif, serif',
                  fontSize: 72, lineHeight: 1,
                  color: scoreColor(snapshot.overall_score)
                }}>
                  {snapshot.overall_score}<span style={{ fontSize: 24, color: 'var(--text-muted)' }}>/100</span>
                </div>
                {delta != null && (
                  <div style={{ fontSize: 13, color: delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {delta >= 0 ? '+' : ''}{delta} pts vs {lastSnapshot?.month}
                  </div>
                )}
              </div>
              <div style={{ minWidth: 280, flex: 1, maxWidth: 420 }}>
                {engineRow.filter(e => e.configured).map(e => (
                  <ScoreBar key={e.id} label={e.label} value={e.score} />
                ))}
              </div>
              <button onClick={handleSave}>Save Snapshot</button>
            </div>
            <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>
              {snapshot.sentiment} · engines: {snapshot.engines_used.join(', ')}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <strong>Query × Engine</strong>
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>Query</th>
                    {ALL_ENGINES.filter(e => e.isConfigured()).map(e => (
                      <th key={e.id}>{e.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...new Set(snapshot.per_query.map(r => r.query))].map(q => (
                    <tr key={q}>
                      <td style={{ maxWidth: 280 }}>{q}</td>
                      {ALL_ENGINES.filter(e => e.isConfigured()).map(eng => {
                        const row = snapshot.per_query.find(r => r.query === q && r.engine === eng.id);
                        if (!row) return <td key={eng.id} className="muted">—</td>;
                        if (row.error) return <td key={eng.id} className="muted" title={row.error}>err</td>;
                        if (!row.mentioned) return <td key={eng.id}><span className="badge">—</span></td>;
                        const color = row.sentiment === 'positive' ? 'green'
                                    : row.sentiment === 'negative' ? 'red'
                                    : 'blue';
                        return (
                          <td key={eng.id}>
                            <span className={'badge ' + color} title={row.excerpt}>
                              #{row.position} · {row.score}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {snapshot.competitors.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <strong>Competitor Visibility</strong>
              <table style={{ marginTop: 10 }}>
                <thead><tr><th>Competitor</th><th>Appearances</th></tr></thead>
                <tbody>
                  {snapshot.competitors
                    .slice()
                    .sort((a, b) => b.appearances - a.appearances)
                    .map(c => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td>{c.appearances} / {snapshot.per_query.length}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <strong>Response Excerpts</strong>
            <div style={{ marginTop: 10 }}>
              {snapshot.per_query
                .filter(r => r.mentioned || r.error)
                .map((r, i) => (
                  <details key={i} style={{ marginBottom: 6 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                      <span className="badge" style={{ marginRight: 8 }}>{r.engine}</span>
                      {r.query}
                      {r.mentioned && <span style={{ marginLeft: 8, color: 'var(--green)', fontSize: 11 }}>#{r.position} · {r.sentiment}</span>}
                      {r.error && <span style={{ marginLeft: 8, color: 'var(--red)', fontSize: 11 }}>error</span>}
                    </summary>
                    <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                      {r.error || r.excerpt || '(no excerpt)'}
                    </div>
                  </details>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
