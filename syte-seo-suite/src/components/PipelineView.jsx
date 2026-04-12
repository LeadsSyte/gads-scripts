// Shared pipeline section component. Shows clients grouped into colored
// workflow stages. Used by Content Engine, Technical SEO, and AEO Engine.
//
// Props:
//   sections:        [{ key, label, color, borderColor, collapsed?, clients }]
//   onAction:        (client, actionKey) => void
//   actions:         [{ key, label, condition?, color? }]
//   month:           display label
//   onExpandClient?: (client) => void — called when a card is clicked to expand
//   expandedId?:     currently expanded client ID
//   renderExpanded?: (client) => React node — renders below the expanded card

import React, { useState } from 'react';

function PipelineSection({ section, onAction, actions, onExpandClient, expandedId, renderExpanded }) {
  const [isOpen, setIsOpen] = useState(!section.collapsed);

  if (section.clients.length === 0 && section.collapsed) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        className="row"
        style={{ gap: 10, marginBottom: 8, alignItems: 'baseline', cursor: 'pointer' }}
        onClick={() => setIsOpen(v => !v)}
      >
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          background: section.color, flexShrink: 0
        }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: section.color, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          {section.label}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          {section.clients.length} client{section.clients.length === 1 ? '' : 's'}
        </span>
        <span className="muted" style={{ fontSize: 10 }}>{isOpen ? '▼' : '▶'}</span>
      </div>

      {!isOpen && section.clients.length > 0 && (
        <div className="muted" style={{ fontSize: 11, paddingLeft: 20 }}>
          {section.clients.slice(0, 5).map(c => c.client.name).join(', ')}
          {section.clients.length > 5 && ` +${section.clients.length - 5} more`}
        </div>
      )}

      {isOpen && section.clients.length === 0 && (
        <div className="muted" style={{ fontSize: 12, paddingLeft: 20 }}>None</div>
      )}

      {isOpen && section.clients.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 10
        }}>
          {section.clients.map(({ client, summary, detail }) => {
            const isExpanded = expandedId === client.id;
            return (
              <div key={client.id}>
                <div
                  className="card"
                  style={{
                    padding: 12,
                    borderColor: isExpanded ? section.color : (section.borderColor || section.color),
                    borderLeftWidth: 3,
                    borderLeftStyle: 'solid',
                    cursor: onExpandClient ? 'pointer' : undefined,
                    background: isExpanded ? 'var(--surface-2)' : undefined
                  }}
                  onClick={() => onExpandClient?.(client)}
                >
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                    <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
                      {client.name}
                    </strong>
                    <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                      {summary && (
                        <span style={{ fontSize: 11, color: section.color, fontWeight: 600 }}>
                          {summary}
                        </span>
                      )}
                      {onExpandClient && (
                        <span className="muted" style={{ fontSize: 9 }}>{isExpanded ? '▼' : '▶'}</span>
                      )}
                    </div>
                  </div>
                  {detail && (
                    <div className="muted" style={{ fontSize: 11, lineHeight: 1.3 }}>{detail}</div>
                  )}
                  {actions && actions.length > 0 && (
                    <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {actions
                        .filter(a => !a.condition || a.condition(client, section.key))
                        .map(a => (
                          <button
                            key={a.key}
                            onClick={(e) => { e.stopPropagation(); onAction(client, a.key); }}
                            style={{
                              fontSize: 10, padding: '4px 10px',
                              borderColor: a.color || section.color,
                              color: a.color || section.color
                            }}
                          >
                            {a.label}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                {/* Expanded content below the card */}
                {isExpanded && renderExpanded && (
                  <div style={{
                    marginTop: -1,
                    border: '1px solid ' + section.color,
                    borderTop: 'none',
                    borderRadius: '0 0 var(--radius) var(--radius)',
                    background: 'var(--surface)',
                    overflow: 'hidden'
                  }}>
                    {renderExpanded(client)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PipelineView({ title, month, sections, onAction, actions, onExpandClient, expandedId, renderExpanded }) {
  const total = sections.reduce((a, s) => a + s.clients.length, 0);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {total} clients · {month}
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {sections.map(s => (
            <span key={s.key} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <span style={{ color: s.color, fontWeight: 700 }}>{s.clients.length}</span>
              <span className="muted" style={{ marginLeft: 4 }}>{s.label}</span>
            </span>
          ))}
        </div>
      </div>

      {sections.map(s => (
        <PipelineSection
          key={s.key}
          section={s}
          onAction={onAction}
          actions={actions}
          onExpandClient={onExpandClient}
          expandedId={expandedId}
          renderExpanded={renderExpanded}
        />
      ))}
    </div>
  );
}
