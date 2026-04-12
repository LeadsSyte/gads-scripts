// Shared pipeline section component. Shows clients grouped into colored
// workflow stages. Used by Content Engine, Technical SEO, and AEO Engine
// as their default landing view.
//
// Props:
//   sections: [{ key, label, color, borderColor, clients: [{client, summary, detail}] }]
//   onAction:  (client, actionKey) => void — called when a card button is clicked
//   actions:   [{ key, label, condition: (client, sectionKey) => bool }]
//   month:     "YYYY-MM" label shown in the header

import React, { useState } from 'react';

function PipelineSection({ section, onAction, actions }) {
  const [expanded, setExpanded] = useState(section.clients.length <= 12);

  return (
    <div style={{ marginBottom: 20 }}>
      <div className="row" style={{ gap: 10, marginBottom: 10, alignItems: 'baseline' }}>
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
      </div>

      {section.clients.length === 0 && (
        <div className="muted" style={{ fontSize: 12, paddingLeft: 20 }}>
          None
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 10
      }}>
        {(expanded ? section.clients : section.clients.slice(0, 8)).map(({ client, summary, detail }) => (
          <div
            key={client.id}
            className="card"
            style={{
              padding: 12,
              borderColor: section.borderColor || section.color,
              borderLeftWidth: 3,
              borderLeftStyle: 'solid'
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                {client.name}
              </strong>
              {summary && (
                <span style={{ fontSize: 11, color: section.color, fontWeight: 600, flexShrink: 0 }}>
                  {summary}
                </span>
              )}
            </div>
            {detail && (
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.3 }}>
                {detail}
              </div>
            )}
            {actions && actions.length > 0 && (
              <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {actions
                  .filter(a => !a.condition || a.condition(client, section.key))
                  .map(a => (
                    <button
                      key={a.key}
                      onClick={() => onAction(client, a.key)}
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
        ))}
      </div>

      {!expanded && section.clients.length > 8 && (
        <button
          onClick={() => setExpanded(true)}
          style={{ marginTop: 8, fontSize: 11, padding: '4px 12px' }}
        >
          Show all {section.clients.length}
        </button>
      )}
    </div>
  );
}

export default function PipelineView({ title, month, sections, onAction, actions }) {
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
        <div className="row" style={{ gap: 6 }}>
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
        />
      ))}
    </div>
  );
}
