import React, { useState } from 'react';
import { useClients } from '../store/useClients.js';
import ClientModal from './ClientModal.jsx';
import ImportClientsModal from './ImportClientsModal.jsx';

export default function ClientSelector({ accent }) {
  const clients   = useClients(s => s.clients);
  const selectedId = useClients(s => s.selectedId);
  const select    = useClients(s => s.select);
  const current   = useClients(s => s.current);
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);

  const active = current();

  return (
    <div className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <span className="muted" style={{ fontSize: 12 }}>Client</span>
        <select
          value={selectedId || ''}
          onChange={e => select(e.target.value)}
          style={{ maxWidth: 320, borderColor: accent ? accent : undefined }}
        >
          <option value="">— select a client —</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.url ? ' · ' + c.url : ''}</option>
          ))}
        </select>
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
