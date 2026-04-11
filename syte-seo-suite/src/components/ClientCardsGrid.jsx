import React, { useState } from 'react';
import { sortByReadiness } from '../lib/clientReadiness.js';
import { useClients } from '../store/useClients.js';
import ClientModal from './ClientModal.jsx';

// Grid of client readiness cards. Used in each module's Clients sub-tab.
// Click a card → opens the full Edit modal so you can fill in the missing
// fields right there.
//
// Props:
//   service: 'content' | 'aeo' | 'reporting' | 'technical'
//   accent:  CSS color used for the "Ready" state
//   clients: array of clients (already filtered by the service flag)
//   onRun?:  optional callback(clientId) — if provided, a "Run" button is
//            shown on cards that are fully ready.

const STATUS_STYLES = {
  ready:   { color: 'var(--green)',  label: 'Ready',       badge: 'green'  },
  partial: { color: 'var(--orange)', label: 'Partial',     badge: 'orange' },
  empty:   { color: 'var(--red)',    label: 'Not set up',  badge: 'red'    }
};

export default function ClientCardsGrid({ service, accent, clients, onRun }) {
  const select = useClients(s => s.select);
  const [editing, setEditing] = useState(null);

  const sorted = sortByReadiness(clients, service);

  if (clients.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
        No clients have this service enabled. Toggle it on in <strong>Clients → Master</strong>.
      </div>
    );
  }

  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 12
      }}>
        {sorted.map(({ client, readiness }) => {
          const style = STATUS_STYLES[readiness.status];
          return (
            <div
              key={client.id}
              className="card"
              style={{
                padding: 14,
                borderColor: readiness.status === 'ready' ? (accent || style.color) : 'var(--border)',
                cursor: 'pointer',
                transition: 'transform .1s ease, border-color .1s ease'
              }}
              onClick={() => { select(client.id); setEditing(client); }}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
            >
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <strong style={{ fontSize: 14, maxWidth: '75%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {client.name}
                </strong>
                <span className={'badge ' + style.badge} style={{ fontSize: 10 }}>
                  {readiness.status === 'partial'
                    ? `${readiness.missing.length} missing`
                    : style.label}
                </span>
              </div>
              {client.url && (
                <div className="muted" style={{ fontSize: 11, marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {client.url.replace(/^https?:\/\//, '')}
                </div>
              )}

              {/* Readiness progress bar */}
              <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{
                  width: readiness.percent + '%',
                  height: '100%',
                  background: style.color,
                  transition: 'width .3s'
                }} />
              </div>

              {readiness.missing.length > 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  <strong style={{ color: style.color }}>Missing:</strong>{' '}
                  {readiness.missing.slice(0, 3).map(m => m.label).join(', ')}
                  {readiness.missing.length > 3 && ` +${readiness.missing.length - 3} more`}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--green)' }}>
                  All fields complete · ready to run
                </div>
              )}

              {onRun && readiness.status === 'ready' && (
                <div style={{ marginTop: 10 }}>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      select(client.id);
                      onRun(client.id);
                    }}
                    style={{
                      padding: '5px 12px',
                      fontSize: 11,
                      borderColor: accent || style.color,
                      color: accent || style.color,
                      width: '100%'
                    }}
                  >
                    Run now
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <ClientModal initial={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
