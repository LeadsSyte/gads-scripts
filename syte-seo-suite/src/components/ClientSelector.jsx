import React, { useState, useEffect } from 'react';
import { useClients } from '../store/useClients.js';
import ClientModal from './ClientModal.jsx';

export default function ClientSelector({ accent = 'var(--accent)' }) {
  const { clients, selectedId, select, load } = useClients();
  const [editing, setEditing] = useState(null); // null | 'new' | clientObj

  useEffect(() => {
    load();
  }, [load]);

  const selected = clients.find((c) => c.id === selectedId);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 32px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Client
      </div>
      <select
        value={selectedId || ''}
        onChange={(e) => select(e.target.value)}
        style={{ maxWidth: 320, borderColor: accent }}
      >
        <option value="">— select a client —</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button onClick={() => setEditing('new')}>+ Add Client</button>
      <button onClick={() => selected && setEditing(selected)} disabled={!selected}>
        Edit
      </button>
      {selected?.url && (
        <div className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
          {selected.url}
        </div>
      )}

      {editing && (
        <ClientModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
