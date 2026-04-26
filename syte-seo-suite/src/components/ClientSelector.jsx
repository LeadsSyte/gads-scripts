import React, { useState, useEffect } from 'react';
import { useClients } from '../store/useClients.js';
import ClientModal from './ClientModal.jsx';
import ImportClientsModal from './ImportClientsModal.jsx';

// Optional serviceFilter prop — when set to "content" / "aeo" / "reporting" /
// "technical", the dropdown only lists clients with that service flag true.
// If the currently selected client is hidden by the filter, we auto-switch to
// the first visible one so downstream module code never renders against a
// client that shouldn't appear here.
export default function ClientSelector({ accent, serviceFilter }) {
  const clients   = useClients(s => s.clients);
  const selectedId = useClients(s => s.selectedId);
  const select    = useClients(s => s.select);
  const current   = useClients(s => s.current);
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);

  const active = current();

  const flagKey = serviceFilter ? 'does_' + serviceFilter : null;
  const visible = flagKey
    ? clients.filter(c => c[flagKey] !== false)
    : clients;

  // If current selection is filtered out, auto-pick the first visible client.
  useEffect(() => {
    if (!flagKey) return;
    if (!selectedId) return;
    const stillVisible = visible.some(c => c.id === selectedId);
    if (!stillVisible && visible.length > 0) {
      select(visible[0].id);
    }
  }, [flagKey, selectedId, visible, select]);

  return (
    <div className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Client{serviceFilter ? ` (${serviceFilter})` : ''}
        </span>
        <select
          value={selectedId || ''}
          onChange={e => select(e.target.value)}
          style={{ maxWidth: 320, borderColor: accent ? accent : undefined }}
        >
          <option value="">— select a client —</option>
          {visible.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.url ? ' · ' + c.url : ''}</option>
          ))}
        </select>
        {flagKey && visible.length !== clients.length && (
          <span className="muted" style={{ fontSize: 11 }}>
            {visible.length}/{clients.length} shown
          </span>
        )}
        <button onClick={() => setEditing({})}>+ Add Client</button>
        {active && <button onClick={() => setEditing(active)}>Edit</button>}
        <button onClick={() => setImporting(true)}>Import from Old Tools</button>
      </div>
      {active?.cms_type && (
        <span className="badge blue">{active.cms_type}</span>
      )}
      {editing && (
        <ClientModal
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && <ImportClientsModal onClose={() => setImporting(false)} />}
    </div>
  );
}
