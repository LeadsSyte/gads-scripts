import React, { useState, useEffect, useCallback } from 'react';
import { useClients } from '../../store/useClients.js';
import { collectMonthlyOptimizations, downloadMonthlyOptimizations } from '../../lib/monthlyExport.js';

const ACCENT = '#a78bfa';

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function monthLabelOf(monthKey) {
  // Parse without timezone drift (append -01).
  const d = new Date(monthKey + '-01T00:00:00');
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// Reports → Dev Export. Bundles a month's optimizations into one ZIP a
// developer can implement from.
export default function DevExport() {
  const clients = useClients(s => s.clients);

  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [clientId, setClientId] = useState(''); // '' = all clients
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  const monthLabel = monthLabelOf(monthKey);

  const refreshPreview = useCallback(async () => {
    setLoading(true); setErr(''); setDone('');
    try {
      const { groups, totals } = await collectMonthlyOptimizations({
        monthKey,
        clientId: clientId || null,
        clients
      });
      setPreview({ groups, totals });
    } catch (e) {
      setErr(e.message || String(e));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [monthKey, clientId, clients]);

  useEffect(() => { refreshPreview(); }, [refreshPreview]);

  async function handleDownload() {
    setBusy(true); setErr(''); setDone('');
    try {
      const totals = await downloadMonthlyOptimizations({
        monthKey, monthLabel, clientId: clientId || null, clients
      });
      setDone(`Downloaded — ${totals.articles} articles, ${totals.techFixes} technical fixes, ${totals.aeoQuick} AEO blocks, ${totals.aeoDeep} deep rewrites.`);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const totals = preview?.totals;
  const isEmpty = totals && totals.grandTotal === 0;

  return (
    <div className="content-area">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Developer Export</h2>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Bundle a month's optimizations (articles, technical fixes, AEO blocks) into one ZIP to hand to a developer.
        </div>
      </div>

      {/* Controls */}
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label>Month</label>
            <input
              type="month"
              value={monthKey}
              max={currentMonthKey()}
              onChange={e => setMonthKey(e.target.value || currentMonthKey())}
            />
          </div>
          <div style={{ minWidth: 220 }}>
            <label>Client</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">All clients</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <button
              className="primary"
              onClick={handleDownload}
              disabled={busy || loading || isEmpty}
              style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}
            >
              {busy ? 'Building ZIP…' : '⬇ Download ZIP'}
            </button>
          </div>
        </div>
      </div>

      {err && (
        <div className="card" style={{ borderLeft: '4px solid var(--red)', marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--red)' }}>{err}</div>
        </div>
      )}
      {done && (
        <div className="card" style={{ borderLeft: '4px solid var(--green)', marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--green)' }}>{done}</div>
        </div>
      )}

      {loading && (
        <div className="card"><div className="row" style={{ gap: 10 }}><div className="spinner" /><span style={{ fontSize: 13 }}>Gathering {monthLabel}…</span></div></div>
      )}

      {!loading && totals && (
        <>
          {/* Totals strip */}
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            {[
              ['Articles', totals.articles, 'var(--mod-content)'],
              ['Technical fixes', totals.techFixes, 'var(--mod-technical)'],
              ['AEO blocks', totals.aeoQuick, 'var(--mod-aeo)'],
              ['Deep rewrites', totals.aeoDeep, 'var(--mod-aeo)']
            ].map(([label, n, color]) => (
              <div key={label} className="card" style={{ padding: '10px 16px', borderLeft: `3px solid ${color}`, minWidth: 130 }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{n}</div>
                <div className="muted" style={{ fontSize: 11 }}>{label}</div>
              </div>
            ))}
          </div>

          {isEmpty ? (
            <div className="card" style={{ padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Nothing produced in {monthLabel}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Try another month, or generate articles / run scans first. Technical fixes are dated by their last scan.
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 12, fontWeight: 600 }}>
                {preview.groups.length} client{preview.groups.length === 1 ? '' : 's'} in this package
              </div>
              {preview.groups.map(g => {
                const aeoBlocks = g.aeoQuick.reduce((n, r) => n + (r.optimizations?.length || 0), 0);
                return (
                  <div key={g.client_id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{g.client_name}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {g.articles.length} articles · {g.techFixes.length} technical fixes · {aeoBlocks} AEO blocks · {g.aeoDeep.length} deep rewrites
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
