import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { listAllImplementations } from '../../lib/supabase.js';
import { approvalsStatus } from '../../lib/pipelineStatus.js';

// Cross-module approvals matrix. Shows every client × every module for the
// selected month. Refreshes monthly but keeps history via the month picker.

const MODULES = [
  { key: 'content',   label: 'Content',   color: 'var(--mod-content)' },
  { key: 'technical', label: 'Technical', color: 'var(--mod-technical)' },
  { key: 'aeo',       label: 'AEO',       color: 'var(--mod-aeo)' }
];

const STATUS_ICONS = {
  'verified-on-site':         { icon: '✓', color: 'var(--green)',      label: 'Verified' },
  'articles-written':         { icon: '◐', color: 'var(--blue)',       label: 'Written' },
  'fixes-generated':          { icon: '◐', color: 'var(--blue)',       label: 'Generated' },
  'optimizations-generated':  { icon: '◐', color: 'var(--blue)',       label: 'Generated' },
  'no-articles':              { icon: '—', color: 'var(--text-muted)', label: 'Not done' },
  'not-scanned':              { icon: '—', color: 'var(--text-muted)', label: 'Not done' },
  'not-run':                  { icon: '—', color: 'var(--text-muted)', label: 'Not done' },
  'credentials-missing':      { icon: '✗', color: 'var(--red)',        label: 'Missing' }
};

function StatusCell({ status }) {
  const s = STATUS_ICONS[status?.section] || STATUS_ICONS['not-run'];
  return (
    <td style={{ textAlign: 'center', padding: '8px 6px' }}>
      <div style={{ color: s.color, fontSize: 16, fontWeight: 700, lineHeight: 1 }}>{s.icon}</div>
      <div style={{ fontSize: 9, color: s.color, marginTop: 2 }}>{s.label}</div>
      {status?.summary && (
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{status.summary}</div>
      )}
    </td>
  );
}

// Generate month options for the last 12 months.
function monthOptions() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = d.toISOString().slice(0, 7);
    const label = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    out.push({ value, label });
  }
  return out;
}

export default function Approvals() {
  const clients = useClients(s => s.clients);
  const [implementations, setImplementations] = useState([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [managerFilter, setManagerFilter] = useState(''); // '' = all, '__none__' = unassigned
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listAllImplementations()
      .then(setImplementations)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const months = useMemo(() => monthOptions(), []);
  const monthLabel = months.find(m => m.value === month)?.label || month;

  // Account managers present across all clients (for the filter dropdown).
  const managers = useMemo(
    () => [...new Set(clients.map(c => (c.account_manager || '').trim()).filter(Boolean))].sort(),
    [clients]
  );

  // Apply the account-manager filter before computing rows.
  const scopedClients = useMemo(() => clients.filter(c => {
    if (managerFilter === '__none__') return !(c.account_manager || '').trim();
    if (managerFilter) return (c.account_manager || '').trim() === managerFilter;
    return true;
  }), [clients, managerFilter]);

  // Tasks from localStorage for technical pipeline.
  const tasks = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('syte-suite-tseo-tasks') || '[]'); } catch { return []; }
  }, []);

  // AEO results from localStorage for AEO pipeline.
  const aeoResults = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('syte-suite-aeo-results') || '{}'); } catch { return {}; }
  }, []);

  // Compute status per client per module.
  const rows = useMemo(() => {
    return scopedClients.map(c => {
      const status = approvalsStatus(c, implementations, tasks, aeoResults, month);
      // Overall: all three modules verified?
      const allDone = ['content', 'technical', 'aeo'].every(
        mod => status[mod]?.section === 'verified-on-site' ||
               (c['does_' + (mod === 'content' ? 'content' : mod === 'technical' ? 'technical' : 'aeo')] === false)
      );
      return { client: c, status, allDone };
    });
  }, [scopedClients, implementations, tasks, aeoResults, month]);

  // Sort: incomplete first, then by name.
  const sorted = useMemo(() => {
    return rows.slice().sort((a, b) => {
      if (a.allDone !== b.allDone) return a.allDone ? 1 : -1;
      return a.client.name.localeCompare(b.client.name);
    });
  }, [rows]);

  const completedCount = rows.filter(r => r.allDone).length;

  if (loading) return <div className="muted">Loading…</div>;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Monthly Approvals</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            All clients × all modules. Shows which monthly tasks are done for {monthLabel}.
          </div>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <select value={managerFilter} onChange={e => setManagerFilter(e.target.value)} style={{ width: 190 }} title="Filter by account manager">
            <option value="">All account managers</option>
            <option value="__none__">Unassigned</option>
            {managers.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={month} onChange={e => setMonth(e.target.value)} style={{ width: 200 }}>
            {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <span className="muted" style={{ fontSize: 12 }}>
            {completedCount}/{rows.length} fully complete
          </span>
        </div>
      </div>

      {/* Overall progress */}
      <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{
          width: rows.length > 0 ? Math.round((completedCount / rows.length) * 100) + '%' : '0%',
          height: '100%', background: 'var(--green)', transition: 'width .4s'
        }} />
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '10px 12px', minWidth: 180 }}>Client</th>
              {MODULES.map(m => (
                <th key={m.key} style={{ textAlign: 'center', padding: '10px 6px', color: m.color, width: 100 }}>
                  {m.label}
                </th>
              ))}
              <th style={{ textAlign: 'center', padding: '10px 6px', width: 80 }}>All Done</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ client, status, allDone }) => {
              // Skip modules the client doesn't subscribe to.
              const flags = {
                content: client.does_content !== false,
                technical: client.does_technical !== false,
                aeo: client.does_aeo !== false
              };
              return (
                <tr key={client.id} style={{ background: allDone ? 'color-mix(in srgb, var(--green) 4%, transparent)' : undefined }}>
                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{client.name}</div>
                    <div className="muted" style={{ fontSize: 10 }}>
                      {client.url?.replace(/^https?:\/\//, '').slice(0, 30) || '—'}
                    </div>
                    <div style={{ fontSize: 10, color: client.account_manager ? 'var(--text-muted)' : 'var(--text-dim)', marginTop: 1 }}>
                      {client.account_manager ? '👤 ' + client.account_manager : 'Unassigned'}
                    </div>
                  </td>
                  {MODULES.map(m => (
                    <React.Fragment key={m.key}>
                      {flags[m.key]
                        ? <StatusCell status={status[m.key]} />
                        : <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                            <span className="muted" style={{ fontSize: 9 }}>N/A</span>
                          </td>
                      }
                    </React.Fragment>
                  ))}
                  <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                    {allDone
                      ? <span style={{ color: 'var(--green)', fontSize: 16, fontWeight: 700 }}>✓</span>
                      : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
