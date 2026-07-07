import React, { useState, useEffect } from 'react';
import { useClients } from '../../store/useClients.js';
import { listAeoSnapshots, listSentReports, deleteAeoSnapshot } from '../../lib/supabase.js';
import { normalizeSnapshot } from './aeoCompare.js';

const ACCENT = '#a78bfa';

function scoreColor(s) {
  if (s == null) return 'var(--text-muted)';
  if (s < 40) return 'var(--red)';
  if (s < 70) return 'var(--orange)';
  return 'var(--green)';
}

export default function ReportsHistory() {
  const client = useClients(s => s.current());
  const [snapshots, setSnapshots] = useState([]);
  const [reports, setReports] = useState([]);
  const [err, setErr] = useState('');

  async function reload() {
    if (!client) { setSnapshots([]); setReports([]); return; }
    setErr('');
    try {
      const [snaps, reps] = await Promise.all([
        listAeoSnapshots(client.id),
        listSentReports(client.id)
      ]);
      // Sort ascending by month for the timeline view.
      setSnapshots(snaps.slice().sort((a, b) => a.month.localeCompare(b.month)));
      setReports(reps);
    } catch (e) { setErr(e.message); }
  }

  useEffect(() => { reload(); }, [client?.id]);

  async function removeSnapshot(id) {
    if (!confirm('Delete this snapshot? This cannot be undone.')) return;
    try { await deleteAeoSnapshot(id); await reload(); }
    catch (e) { setErr(e.message); }
  }

  if (!client) return <div className="muted">Select a client first.</div>;

  // Normalize so pre-v2 single-shot snapshots gain coverage_rate +
  // composite_index and plot on the same axes as v2 snapshots.
  const norm = snapshots.map(s => normalizeSnapshot(s));
  const coveragePct = s => Math.round((s.coverage_rate ?? 0) * 100);
  const composite = s => s.composite_index ?? s.overall_score ?? 0;
  const BLUE = 'var(--blue, #4F8EF7)';

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>History</h2>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>AEO Snapshot Timeline</strong>
          <span className="muted" style={{ fontSize: 12 }}>{snapshots.length} saved</span>
        </div>
        {snapshots.length === 0 && (
          <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>No snapshots yet for {client.name}.</div>
        )}
        {snapshots.length > 0 && (
          <>
            {/* Coverage rate + composite index over time. Old snapshots plot
                via the normalize shim. Both metrics share a 0-100 axis. */}
            <div className="row" style={{ gap: 16, marginTop: 12, fontSize: 11 }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 3, background: ACCENT, marginRight: 5, verticalAlign: 'middle' }} />AEO Index</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 3, background: BLUE, marginRight: 5, verticalAlign: 'middle' }} />Coverage rate %</span>
            </div>
            <svg width="100%" height="130" viewBox={`0 0 ${Math.max(200, norm.length * 60)} 130`} style={{ marginTop: 8 }}>
              <line x1="0" y1="20" x2="100%" y2="20" stroke="var(--border)" strokeDasharray="2,4" />
              <line x1="0" y1="65" x2="100%" y2="65" stroke="var(--border)" strokeDasharray="2,4" />
              <line x1="0" y1="110" x2="100%" y2="110" stroke="var(--border)" strokeDasharray="2,4" />
              {[[composite, ACCENT], [s => coveragePct(s), BLUE]].map(([fn, color], li) => (
                <polyline key={li} fill="none" stroke={color} strokeWidth="2"
                  points={norm.map((s, i) => `${30 + i * 60},${110 - (fn(s) / 100) * 90}`).join(' ')} />
              ))}
              {norm.map((s, i) => {
                const x = 30 + i * 60;
                const yC = 110 - (composite(s) / 100) * 90;
                const yCov = 110 - (coveragePct(s) / 100) * 90;
                return (
                  <g key={s.id}>
                    <circle cx={x} cy={yC} r="3.5" fill={ACCENT} />
                    <circle cx={x} cy={yCov} r="3.5" fill={BLUE} />
                    <text x={x} y={yC - 8} textAnchor="middle" fontSize="10" fill="var(--text)">{composite(s)}</text>
                    <text x={x} y="126" textAnchor="middle" fontSize="10" fill="var(--text-muted)">{s.month.slice(5)}</text>
                  </g>
                );
              })}
            </svg>
            <div style={{ overflowX: 'auto' }}>
            <table style={{ marginTop: 14 }}>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Coverage</th>
                  <th>AEO Index</th>
                  <th>ChatGPT</th>
                  <th>Perplexity</th>
                  <th>Gemini</th>
                  <th>Claude</th>
                  <th>Sentiment</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {norm.slice().reverse().map(s => (
                  <tr key={s.id}>
                    <td>{s.month}</td>
                    <td style={{ fontWeight: 600 }}>{coveragePct(s)}%</td>
                    <td style={{ color: scoreColor(composite(s)), fontWeight: 600 }}>{composite(s)}</td>
                    <td>{s.engine_scores?.chatgpt ?? '—'}</td>
                    <td>{s.engine_scores?.perplexity ?? '—'}</td>
                    <td>{s.engine_scores?.gemini ?? '—'}</td>
                    <td>{s.engine_scores?.claude ?? '—'}</td>
                    <td className="muted">{s.sentiment || '—'}</td>
                    <td>
                      <button onClick={() => removeSnapshot(s.id)} style={{ color: 'var(--red)', fontSize: 11, padding: '4px 10px' }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>Sent Reports</strong>
          <span className="muted" style={{ fontSize: 12 }}>{reports.length} logged</span>
        </div>
        {reports.length === 0 && (
          <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>No reports logged yet.</div>
        )}
        {reports.length > 0 && (
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr><th>Sent</th><th>Month</th><th>Subject</th><th>QA</th><th>AEO</th></tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <tr key={r.id}>
                  <td className="muted" style={{ fontSize: 12 }}>{new Date(r.sent_date).toLocaleDateString()}</td>
                  <td>{r.month}</td>
                  <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.email_subject || '—'}</td>
                  <td>{r.qa_score ? r.qa_score + '/10' : '—'}</td>
                  <td>{r.aeo_snapshot_score != null ? r.aeo_snapshot_score + '/100' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {err && <div style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
    </div>
  );
}
