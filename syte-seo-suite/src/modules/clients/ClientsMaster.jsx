import React, { useState, useMemo, useEffect } from 'react';
import { useClients } from '../../store/useClients.js';
import { upsertClient, diagnoseSupabase } from '../../lib/supabase.js';
import { syncWebceoClients } from '../technical/webceo.js';
import ClientModal from '../../components/ClientModal.jsx';
import ImportClientsModal from '../../components/ImportClientsModal.jsx';
import { serverAuthEnabled, listConnectedAccounts } from '../../lib/googleServerAuth.js';

// Master Clients view — the single source-of-truth UI for managing every
// client across every module. Service flags are toggled inline; changes
// write straight to Supabase via the shared store.
//
// Other modules still have per-module Clients sub-tabs but those are
// read-only filtered views. This one is editable.

const SERVICES = [
  { key: 'does_technical', label: 'Tech',    color: 'var(--mod-technical)' },
  { key: 'does_content',   label: 'Content', color: 'var(--mod-content)' },
  { key: 'does_aeo',       label: 'AEO',     color: 'var(--mod-aeo)' },
  { key: 'does_reporting', label: 'Reports', color: 'var(--mod-reports)' }
];

function ServiceToggle({ on, color, onChange, disabled }) {
  // Inline checkbox-style toggle. Compact so the table fits many columns.
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      title={on ? 'Click to disable' : 'Click to enable'}
      style={{
        width: 28, height: 28, padding: 0, borderRadius: 6,
        background: on ? color : 'transparent',
        border: '1px solid ' + (on ? color : 'var(--border)'),
        color: on ? '#0a0a0c' : 'var(--text-muted)',
        cursor: disabled ? 'wait' : 'pointer',
        fontWeight: 700, fontSize: 14
      }}
    >
      {on ? '✓' : ''}
    </button>
  );
}

export default function ClientsMaster() {
  const clients = useClients(s => s.clients);
  const reload = useClients(s => s.load);
  const [editing, setEditing] = useState(null);     // client being opened in modal
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState(null);     // id of row currently saving
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [syncResult, setSyncResult] = useState(null);
  const [customMethod, setCustomMethod] = useState('');
  const [health, setHealth] = useState(null);

  // Run the Supabase connection check on mount and after any save action
  // so the user can see exactly why a save would fail before they try.
  useEffect(() => {
    let cancelled = false;
    diagnoseSupabase().then(r => { if (!cancelled) setHealth(r); });
    return () => { cancelled = true; };
  }, []);

  // Server-auth: which Google accounts are connected, so we can flag clients
  // that still need an account assigned (or are bound to one that isn't
  // connected). Empty/no-op when server auth is off.
  const serverAuth = serverAuthEnabled();
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  useEffect(() => {
    if (!serverAuth) return;
    listConnectedAccounts()
      .then(a => setConnectedAccounts((a || []).filter(x => !x.revoked).map(x => (x.email || '').toLowerCase())))
      .catch(() => {});
  }, [serverAuth]);

  // Per-client Google-account binding status (server-auth only).
  // Returns null when there's nothing to flag.
  function accountStatus(c) {
    if (!serverAuth) return null;
    const needsGoogle = !!(c.ga4_property_id || c.gsc_property);
    if (!needsGoogle) return null;
    const bound = (c.ga4_account_email || c.gsc_account_email || c.google_account_email || '').toLowerCase();
    if (!bound) return { text: 'No Google account', color: 'var(--orange)' };
    if (connectedAccounts.length && !connectedAccounts.includes(bound)) {
      return { text: 'Account not connected', color: 'var(--red)' };
    }
    return null;
  }
  const needsAccountCount = useMemo(
    () => (serverAuth ? clients.filter(c => accountStatus(c)).length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverAuth, clients, connectedAccounts]
  );

  async function recheckHealth() {
    setHealth(null);
    const r = await diagnoseSupabase();
    setHealth(r);
  }

  const filtered = useMemo(() => {
    if (!filter.trim()) return clients;
    const q = filter.toLowerCase();
    return clients.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.url || '').toLowerCase().includes(q) ||
      (c.industry || '').toLowerCase().includes(q)
    );
  }, [clients, filter]);

  const stats = useMemo(() => ({
    total: clients.length,
    tech:    clients.filter(c => c.does_technical !== false).length,
    content: clients.filter(c => c.does_content !== false).length,
    aeo:     clients.filter(c => c.does_aeo !== false).length,
    reports: clients.filter(c => c.does_reporting !== false).length
  }), [clients]);

  async function toggleService(client, key, value) {
    setRowBusy(client.id); setErr('');
    try {
      await upsertClient({ ...client, [key]: value });
      await reload();
    } catch (e) { setErr(e.message); }
    finally { setRowBusy(null); }
  }

  async function handleSync() {
    setBusy(true); setErr(''); setMsg('Syncing from WebCEO…'); setSyncResult(null);
    try {
      const r = await syncWebceoClients(upsertClient, clients, customMethod.trim() || undefined);
      await reload();
      setSyncResult(r);
      const parts = [
        r.inserted + ' new',
        r.updated + ' updated',
        r.skipped ? r.skipped + ' skipped' : null
      ].filter(Boolean).join(' · ');
      const methodNote = r.method ? ` [method: ${r.method}]` : '';
      setMsg(`Sync complete. ${parts} (${r.total} found)${methodNote}.`);
    } catch (e) { setErr(e.message); setMsg(''); }
    finally { setBusy(false); }
  }

  async function deleteClient(client) {
    if (!confirm(`Delete "${client.name}"? This cannot be undone.`)) return;
    setRowBusy(client.id); setErr('');
    try {
      const { deleteClient: del } = await import('../../lib/supabase.js');
      await del(client.id);
      await reload();
    } catch (e) { setErr(e.message); }
    finally { setRowBusy(null); }
  }

  const showDebug = syncResult && (syncResult.total === 0 || (syncResult.inserted + syncResult.updated) === 0);

  return (
    <div className="content-area">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>All Clients</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Master view — toggle service flags inline. Each module's client dropdown is filtered by these flags.
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setEditing({})}>+ Add Client</button>
          <button onClick={() => setImporting(true)}>Import from Old Tools</button>
          <button onClick={handleSync} disabled={busy} className="primary" style={{ background: 'var(--mod-technical)', borderColor: 'var(--mod-technical)' }}>
            {busy ? 'Syncing…' : 'Sync from WebCEO'}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid-4" style={{ marginBottom: 14 }}>
        <div className="card" style={{ padding: 14 }}>
          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>Total Clients</div>
          <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 32, lineHeight: 1 }}>{stats.total}</div>
        </div>
        {[
          { label: 'Technical SEO', value: stats.tech,    color: 'var(--mod-technical)' },
          { label: 'Content',       value: stats.content, color: 'var(--mod-content)' },
          { label: 'AEO',           value: stats.aeo,     color: 'var(--mod-aeo)' }
        ].map(s => (
          <div className="card" key={s.label} style={{ padding: 14, borderColor: s.color }}>
            <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>{s.label}</div>
            <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 32, lineHeight: 1, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Supabase connection health banner */}
      {health && !health.ok && (
        <div className="card" style={{
          marginBottom: 14,
          borderColor: 'var(--red)',
          borderLeft: '4px solid var(--red)',
          background: 'color-mix(in srgb, var(--red) 6%, var(--surface))'
        }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <strong style={{ color: 'var(--red)' }}>Supabase connection problem</strong>
            <button onClick={recheckHealth} style={{ padding: '4px 10px', fontSize: 11 }}>Re-check</button>
          </div>
          <div style={{ fontSize: 13 }}>{health.detail}</div>
          <div className="muted mono" style={{ fontSize: 11, marginTop: 6 }}>
            URL: {health.url || '(empty)'} · key: {health.keyPreview}
          </div>
          <details style={{ marginTop: 8 }}>
            <summary className="muted" style={{ fontSize: 11, cursor: 'pointer' }}>What to check</summary>
            <ul style={{ margin: '6px 0 0 18px', fontSize: 12 }}>
              <li>In Netlify → Site configuration → Environment variables, confirm <code>VITE_SUPABASE_URL</code> starts with <code>https://</code> and ends with <code>.supabase.co</code> (no trailing slash).</li>
              <li>Confirm <code>VITE_SUPABASE_ANON_KEY</code> is the <strong>Publishable key</strong> (starts with <code>sb_publishable_</code>), not the secret.</li>
              <li>If you changed env vars, trigger a fresh Netlify deploy — env vars are baked into the bundle at build time.</li>
              <li>On the Supabase free tier, projects pause after 1 week of inactivity. Open your Supabase dashboard and confirm the project says "Active".</li>
              <li>Ad blockers / privacy extensions sometimes block <code>*.supabase.co</code>. Try the app in an incognito window.</li>
            </ul>
          </details>
        </div>
      )}
      {health && health.ok && (
        <div className="muted" style={{ fontSize: 11, marginBottom: 10 }}>
          <span className="dot" style={{ background: 'var(--green)', marginRight: 6 }} />
          Supabase connected · {health.url}
        </div>
      )}

      {/* Custom WebCEO method override (only shown if sync ever failed this session) */}
      {syncResult && (
        <div className="card" style={{ marginBottom: 12, padding: 10 }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <label>Custom WebCEO method name (optional)</label>
              <input
                value={customMethod}
                onChange={e => setCustomMethod(e.target.value)}
                placeholder="leave blank to auto-detect"
                className="mono"
              />
            </div>
            <div className="muted" style={{ fontSize: 11, maxWidth: 420 }}>
              If auto-detect doesn't find your clients, paste the method name from WebCEO's API docs.
            </div>
          </div>
        </div>
      )}

      {msg && <div style={{ color: 'var(--green)', marginBottom: 10, fontSize: 13 }}>{msg}</div>}
      {err && <div style={{ color: 'var(--red)', marginBottom: 10, fontSize: 13 }}>{err}</div>}

      {syncResult && (
        <details open={showDebug} style={{ marginBottom: 14, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>
            {showDebug ? '⚠ Sync returned no new clients — click to see raw WebCEO response' : 'Debug: raw WebCEO response'}
          </summary>
          {syncResult.attempts?.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <strong>Methods tried:</strong>
              <ul style={{ margin: '4px 0 8px 18px' }}>
                {syncResult.attempts.map((a, i) => (
                  <li key={i} className="mono" style={{ fontSize: 11 }}>
                    <span style={{ color: a.errormsg ? 'var(--red)' : 'var(--green)' }}>
                      {a.errormsg ? '✗' : '✓'}
                    </span>{' '}{a.method}
                    {a.errormsg && <span className="muted"> — {a.errormsg}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <pre style={{ background: 'var(--bg)', padding: 10, borderRadius: 6, fontSize: 11, overflowX: 'auto', maxHeight: 300 }}>
            {JSON.stringify(syncResult.rawResponse, null, 2)}
          </pre>
        </details>
      )}

      {/* Search */}
      <div className="row" style={{ marginBottom: 10 }}>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Search by name, URL, or industry…"
          style={{ maxWidth: 360 }}
        />
        {filter && <span className="muted" style={{ fontSize: 12 }}>{filtered.length} / {clients.length}</span>}
      </div>

      {serverAuth && needsAccountCount > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 12px', border: '1px solid var(--orange)', borderRadius: 8, color: 'var(--orange)', fontSize: 12 }}>
          ⚠ {needsAccountCount} client{needsAccountCount === 1 ? '' : 's'} need a Google account assigned before reports can pull GA4/GSC. Open each flagged client → Google Connections → pick its connected account.
        </div>
      )}

      {/* Master table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>URL</th>
              <th>Industry</th>
              {SERVICES.map(s => (
                <th key={s.key} style={{ textAlign: 'center', color: s.color }}>{s.label}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4 + SERVICES.length} className="muted" style={{ textAlign: 'center', padding: 32 }}>
                  {clients.length === 0
                    ? 'No clients yet. Click Sync from WebCEO, Import from Old Tools, or + Add Client.'
                    : 'No clients match that search.'}
                </td>
              </tr>
            )}
            {filtered.map(c => (
              <tr key={c.id}>
                <td>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {c.name}
                    {(() => {
                      const st = accountStatus(c);
                      return st ? (
                        <span
                          title="Open this client and set its Google account under Google Connections"
                          style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: st.color, border: '1px solid ' + st.color, borderRadius: 4, padding: '1px 6px' }}
                        >
                          ⚠ {st.text}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  {c.wceo_project_id && (
                    <div className="muted" style={{ fontSize: 10 }}>WebCEO: {c.wceo_project_id}</div>
                  )}
                </td>
                <td className="muted" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.url || '—'}
                </td>
                <td className="muted">{c.industry || '—'}</td>
                {SERVICES.map(s => (
                  <td key={s.key} style={{ textAlign: 'center' }}>
                    <ServiceToggle
                      on={c[s.key] !== false}
                      color={s.color}
                      disabled={rowBusy === c.id}
                      onChange={v => toggleService(c, s.key, v)}
                    />
                  </td>
                ))}
                <td>
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => setEditing(c)}>Edit</button>
                    <button onClick={() => deleteClient(c)} style={{ color: 'var(--red)' }} disabled={rowBusy === c.id}>Del</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <ClientModal initial={editing} onClose={() => setEditing(null)} />}
      {importing && <ImportClientsModal onClose={() => setImporting(false)} />}
    </div>
  );
}
