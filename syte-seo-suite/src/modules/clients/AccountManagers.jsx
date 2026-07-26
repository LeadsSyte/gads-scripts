import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { listAllImplementations } from '../../lib/supabase.js';
import { approvalsStatus } from '../../lib/pipelineStatus.js';

// Account Managers report — groups every client by its account manager and
// shows, per person: how many clients they own, the service mix, and how many
// are fully signed off this month. Mirrors the completion logic in Approvals.

const UNASSIGNED = 'Unassigned';

function isModuleDone(client, status, mod) {
  const flagKey = 'does_' + mod;
  if (client[flagKey] === false) return true; // not subscribed → counts as done
  return status[mod]?.section === 'verified-on-site';
}

export default function AccountManagers() {
  const clients = useClients(s => s.clients);
  const [implementations, setImplementations] = useState([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    setLoading(true);
    listAllImplementations()
      .then(setImplementations)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const monthLabel = new Date(month + '-01T00:00:00')
    .toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const months = useMemo(() => {
    const out = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({
        value: d.toISOString().slice(0, 7),
        label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
      });
    }
    return out;
  }, []);

  const tasks = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('syte-suite-tseo-tasks') || '[]'); } catch { return []; }
  }, []);
  const aeoResults = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('syte-suite-aeo-results') || '{}'); } catch { return {}; }
  }, []);

  // Build one group per account manager.
  const groups = useMemo(() => {
    const byManager = {};
    for (const c of clients) {
      const key = (c.account_manager || '').trim() || UNASSIGNED;
      if (!byManager[key]) byManager[key] = { manager: key, clients: [] };
      const status = approvalsStatus(c, implementations, tasks, aeoResults, month);
      const allDone = ['content', 'technical', 'aeo'].every(mod => isModuleDone(c, status, mod));
      byManager[key].clients.push({ client: c, allDone });
    }
    const list = Object.values(byManager).map(g => ({
      ...g,
      total: g.clients.length,
      done: g.clients.filter(x => x.allDone).length,
      tech:    g.clients.filter(x => x.client.does_technical !== false).length,
      content: g.clients.filter(x => x.client.does_content !== false).length,
      aeo:     g.clients.filter(x => x.client.does_aeo !== false).length
    }));
    // Named managers first (alphabetical), Unassigned last.
    return list.sort((a, b) => {
      if (a.manager === UNASSIGNED) return 1;
      if (b.manager === UNASSIGNED) return -1;
      return a.manager.localeCompare(b.manager);
    });
  }, [clients, implementations, tasks, aeoResults, month]);

  const namedManagers = groups.filter(g => g.manager !== UNASSIGNED).length;
  const unassignedCount = groups.find(g => g.manager === UNASSIGNED)?.total || 0;

  if (loading) return <div className="content-area"><div className="muted">Loading…</div></div>;

  return (
    <div className="content-area">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Account Managers</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Clients grouped by owner · completion shown for {monthLabel}
          </div>
        </div>
        <select value={month} onChange={e => setMonth(e.target.value)} style={{ width: 200 }}>
          {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      {/* Summary strip */}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="card" style={{ padding: '10px 16px', minWidth: 130 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{namedManagers}</div>
          <div className="muted" style={{ fontSize: 11 }}>Account managers</div>
        </div>
        <div className="card" style={{ padding: '10px 16px', minWidth: 130 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{clients.length}</div>
          <div className="muted" style={{ fontSize: 11 }}>Total clients</div>
        </div>
        <div className="card" style={{ padding: '10px 16px', minWidth: 130, borderLeft: unassignedCount ? '3px solid var(--orange)' : undefined }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: unassignedCount ? 'var(--orange)' : undefined }}>{unassignedCount}</div>
          <div className="muted" style={{ fontSize: 11 }}>Unassigned</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {groups.map(g => {
          const pct = g.total > 0 ? Math.round((g.done / g.total) * 100) : 0;
          const isOpen = expanded === g.manager;
          const isUnassigned = g.manager === UNASSIGNED;
          return (
            <div
              key={g.manager}
              className="card"
              style={{ padding: 14, borderLeft: '3px solid ' + (isUnassigned ? 'var(--orange)' : 'var(--mod-reports)') }}
            >
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {isUnassigned ? '⚠ Unassigned' : '👤 ' + g.manager}
                </div>
                <span className="badge" style={{ fontSize: 10 }}>{g.total} client{g.total === 1 ? '' : 's'}</span>
              </div>

              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                Tech {g.tech} · Content {g.content} · AEO {g.aeo}
              </div>

              {/* Completion bar for the selected month */}
              <div style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                  <span className="muted">Complete this month</span>
                  <span style={{ color: pct === 100 ? 'var(--green)' : 'var(--text-muted)' }}>{g.done}/{g.total}</span>
                </div>
                <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: pct + '%', height: '100%', background: pct === 100 ? 'var(--green)' : 'var(--mod-reports)', transition: 'width .4s' }} />
                </div>
              </div>

              <button
                onClick={() => setExpanded(isOpen ? null : g.manager)}
                style={{ marginTop: 10, fontSize: 11, padding: '4px 10px' }}
              >
                {isOpen ? 'Hide clients' : 'View clients'}
              </button>

              {isOpen && (
                <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  {g.clients
                    .slice()
                    .sort((a, b) => a.client.name.localeCompare(b.client.name))
                    .map(({ client, allDone }) => (
                      <div key={client.id} className="row" style={{ justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.name}</span>
                        <span style={{ color: allDone ? 'var(--green)' : 'var(--text-dim)', flexShrink: 0, marginLeft: 8 }}>
                          {allDone ? '✓ done' : '— pending'}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
