import React, { useState, useEffect } from 'react';
import { useClients } from '../../store/useClients.js';
import { listAeoSnapshots, listSentReports, deleteAeoSnapshot } from '../../lib/supabase.js';

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

  // Max score for the little sparkline bars.
  const maxScore = Math.max(100, ...snapshots.map(s => s.overall_score || 0));

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
            {/* Simple SVG line chart — no external libs. */}
            <svg width="100%" height="120" viewBox={`0 0 ${Math.max(200, snapshots.length * 60)} 120`} style={{ marginTop: 14 }}>
              <line x1="0" y1="20" x2="100%" y2="20" stroke="var(--border)" strokeDasharray="2,4" />
              <line x1="0" y1="60" x2="100%" y2="60" stroke="var(--border)" strokeDasharray="2,4" />
              <line x1="0" y1="100" x2="100%" y2="100" stroke="var(--border)" strokeDasharray="2,4" />
              <polyline
                fill="none"
                stroke={ACCENT}
                strokeWidth="2"
                points={snapshots.map((s, i) => {
                  const x = 30 + i * 60;
                  const y = 110 - (s.overall_score / maxScore) * 90;
                  return `${x},${y}`;
                }).join(' ')}
              />
              {snapshots.map((s, i) => {
                const x = 30 + i * 60;
                const y = 110 - (s.overall_score / maxScore) * 90;
                return (
                  <g key={s.id}>
                    <circle cx={x} cy={y} r="4" fill={ACCENT} />
                    <text x={x} y={y - 10} textAnchor="middle" fontSize="11" fill="var(--text)">{s.overall_score}</text>
                    <text x={x} y="118" textAnchor="middle" fontSize="10" fill="var(--text-muted)">{s.month.slice(5)}</text>
                  </g>
                );
              })}
            </svg>
            <table style={{ marginTop: 14 }}>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Overall</th>
                  <th>ChatGPT</th>
                  <th>Perplexity</th>
                  <th>Gemini</th>
                  <th>Claude</th>
                  <th>Sentiment</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {snapshots.slice().reverse().map(s => (
                  <tr key={s.id}>
                    <td>{s.month}</td>
                    <td style={{ color: scoreColor(s.overall_score), fontWeight: 600 }}>{s.overall_score}</td>
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
