import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { listAllImplementations } from '../../lib/supabase.js';
import { verifyImplementation } from '../../lib/verification.js';

// In-app view of the same data the weekly email shows. Lets Michael and
// Chris see implementation progress across all clients in real time
// without waiting for the Monday email.

const STATUS_STYLES = {
  verified: { color: 'var(--green)',  label: '✓ Verified', badge: 'green' },
  failed:   { color: 'var(--red)',    label: '✗ Failed',   badge: 'red' },
  pending:  { color: 'var(--orange)', label: '⏳ Pending', badge: 'orange' }
};

export default function ImplementationProgress() {
  const clients = useClients(s => s.clients);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | verified | failed | pending
  const [moduleFilter, setModuleFilter] = useState('all');
  const [verifyingId, setVerifyingId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const data = await listAllImplementations();
      setItems(data);
    } catch (e) {
      console.error('Failed to load implementations:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map(c => [c.id, c])),
    [clients]
  );

  const filtered = useMemo(() => {
    let list = items;
    if (filter !== 'all') list = list.filter(r => r.verification_status === filter);
    if (moduleFilter !== 'all') list = list.filter(r => r.module === moduleFilter);
    return list;
  }, [items, filter, moduleFilter]);

  // Group by client for the summary view.
  const grouped = useMemo(() => {
    const g = {};
    for (const item of filtered) {
      const cid = item.client_id;
      if (!g[cid]) g[cid] = { client: clientMap[cid] || { name: cid }, items: [] };
      g[cid].items.push(item);
    }
    return Object.values(g).sort((a, b) => b.items.length - a.items.length);
  }, [filtered, clientMap]);

  const counts = useMemo(() => ({
    total:    items.length,
    verified: items.filter(r => r.verification_status === 'verified').length,
    failed:   items.filter(r => r.verification_status === 'failed').length,
    pending:  items.filter(r => r.verification_status === 'pending').length
  }), [items]);

  const modules = useMemo(() => {
    const s = new Set(items.map(r => r.module));
    return [...s].sort();
  }, [items]);

  async function reverify(impl) {
    setVerifyingId(impl.id);
    try {
      await verifyImplementation(impl);
      await load(); // refresh the list
    } catch {}
    finally { setVerifyingId(null); }
  }

  if (loading) {
    return <div className="muted" style={{ padding: 24 }}>Loading implementation records…</div>;
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Implementation Progress</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Track what's been uploaded to client sites and whether the AI verified it's actually there.
            A summary email goes to michaelh@ and chrisf@ every Monday.
          </div>
        </div>
        <button onClick={load}>Refresh</button>
      </div>

      {/* Stats */}
      <div className="grid-4" style={{ marginBottom: 14 }}>
        <div className="card" style={{ padding: 14 }}>
          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>Total</div>
          <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 32, lineHeight: 1 }}>{counts.total}</div>
        </div>
        <div className="card" style={{ padding: 14, borderColor: 'var(--green)' }}>
          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>Verified</div>
          <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 32, lineHeight: 1, color: 'var(--green)' }}>{counts.verified}</div>
        </div>
        <div className="card" style={{ padding: 14, borderColor: 'var(--red)' }}>
          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>Failed</div>
          <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 32, lineHeight: 1, color: 'var(--red)' }}>{counts.failed}</div>
        </div>
        <div className="card" style={{ padding: 14, borderColor: 'var(--orange)' }}>
          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>Pending</div>
          <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 32, lineHeight: 1, color: 'var(--orange)' }}>{counts.pending}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {['all', 'verified', 'failed', 'pending'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              fontSize: 11, padding: '5px 12px',
              ...(filter === f
                ? { background: STATUS_STYLES[f]?.color || 'var(--text)', borderColor: STATUS_STYLES[f]?.color || 'var(--text)', color: '#0a0a0c' }
                : {})
            }}
          >
            {f === 'all' ? `All (${counts.total})` : `${STATUS_STYLES[f].label} (${counts[f]})`}
          </button>
        ))}
        <select
          value={moduleFilter}
          onChange={e => setModuleFilter(e.target.value)}
          style={{ fontSize: 11, padding: '5px 10px', width: 'auto' }}
        >
          <option value="all">All modules</option>
          {modules.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {items.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          No implementations logged yet. Use the "✓ Mark as Implemented" button on any generated
          content, AEO optimization, or technical fix to start tracking.
        </div>
      )}

      {/* Grouped by client */}
      {grouped.map(g => {
        const v = g.items.filter(r => r.verification_status === 'verified').length;
        const f = g.items.filter(r => r.verification_status === 'failed').length;
        const p = g.items.filter(r => r.verification_status === 'pending').length;
        const pct = g.items.length > 0 ? Math.round((v / g.items.length) * 100) : 0;

        return (
          <div key={g.client.id || g.client.name} className="card" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{g.client.name || '?'}</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  {v} verified · {f} failed · {p} pending · {pct}% complete
                </span>
              </div>
              <div style={{ height: 4, background: 'var(--surface)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                <div style={{ width: pct + '%', height: '100%', background: 'var(--green)', transition: 'width .3s' }} />
              </div>
            </div>

            {g.items.map(impl => {
              const st = STATUS_STYLES[impl.verification_status] || STATUS_STYLES.pending;
              return (
                <div key={impl.id} style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{impl.title}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {impl.module} · {impl.change_type} · {impl.implemented_by || '—'}
                      {impl.implemented_at && ' · ' + new Date(impl.implemented_at).toLocaleDateString('en-ZA')}
                    </div>
                    {impl.page_url && (
                      <div className="mono muted" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {impl.page_url}
                      </div>
                    )}
                    {impl.verification_detail && (
                      <div style={{
                        fontSize: 11, marginTop: 4, padding: '4px 8px',
                        background: 'var(--surface-2)', borderRadius: 4,
                        borderLeft: '2px solid ' + st.color,
                        color: 'var(--text-muted)'
                      }}>
                        {impl.verification_detail}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    <span className={'badge ' + st.badge} style={{ fontSize: 10 }}>
                      {st.label}
                    </span>
                    <button
                      onClick={() => reverify(impl)}
                      disabled={verifyingId === impl.id}
                      style={{ fontSize: 10, padding: '3px 8px' }}
                    >
                      {verifyingId === impl.id ? 'Scanning…' : 'Re-verify'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
