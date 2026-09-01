import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { listAllImplementations } from '../../lib/supabase.js';
import { approvalsStatus } from '../../lib/pipelineStatus.js';
import { SERVICE_META, serviceEnabled, serviceAssignee } from '../../lib/serviceAssignments.js';

// Account Managers report — groups clients by the people assigned to them.
// People are now assigned per service, so one client can appear under several
// people, each responsible for a different service. Per person we show: how
// many clients they touch, which services, and how many of *their* services
// are signed off this month. Mirrors the completion logic in Approvals.

const UNASSIGNED = 'Unassigned';

// The SEO services this view cares about — the ones with a tracked completion
// status in approvalsStatus. Monthly reporting is deliberately excluded: it has
// no sign-off of its own, so it is neither listed nor counted here.
const TRACKED = ['content', 'technical', 'aeo'];
const SERVICES = SERVICE_META.filter(s => TRACKED.includes(s.service));

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

  // Build one group per person. A client is added to a person's group once,
  // carrying the set of services that person is responsible for on it.
  const groups = useMemo(() => {
    const byPerson = {};
    for (const c of clients) {
      const status = approvalsStatus(c, implementations, tasks, aeoResults, month);
      // person -> Set(service) for this client
      const perPerson = {};
      for (const s of SERVICES) {
        if (!serviceEnabled(c, s.flag)) continue;
        const person = serviceAssignee(c, s.mgr) || UNASSIGNED;
        (perPerson[person] ||= new Set()).add(s.service);
      }
      // Client with no enabled services still surfaces under its owner.
      if (Object.keys(perPerson).length === 0) {
        const owner = (c.account_manager || '').trim() || UNASSIGNED;
        perPerson[owner] = new Set();
      }
      for (const [person, services] of Object.entries(perPerson)) {
        const g = (byPerson[person] ||= { manager: person, clients: [] });
        // Done = every service this person owns here is verified.
        const allDone = [...services].every(mod => isModuleDone(c, status, mod));
        g.clients.push({ client: c, services, allDone });
      }
    }
    const has = (g, svc) => g.clients.filter(x => x.services.has(svc)).length;
    const list = Object.values(byPerson).map(g => ({
      ...g,
      total: g.clients.length,
      done: g.clients.filter(x => x.allDone).length,
      tech:    has(g, 'technical'),
      content: has(g, 'content'),
      aeo:     has(g, 'aeo')
    }));
    // Named people first (alphabetical), Unassigned last.
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
            Clients grouped by assigned person · a client can appear under several people · completion shown for {monthLabel}
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
                    .map(({ client, services, allDone }) => {
                      const svcLabels = SERVICES
                        .filter(s => services.has(s.service))
                        .map(s => s.label);
                      return (
                        <div key={client.id} className="row" style={{ justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                            {client.name}
                            {svcLabels.length > 0 && (
                              <span className="muted" style={{ fontSize: 10, marginLeft: 6 }}>
                                {svcLabels.join(' · ')}
                              </span>
                            )}
                          </span>
                          <span style={{ color: allDone ? 'var(--green)' : 'var(--text-dim)', flexShrink: 0, marginLeft: 8 }}>
                            {allDone ? '✓ done' : '— pending'}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
