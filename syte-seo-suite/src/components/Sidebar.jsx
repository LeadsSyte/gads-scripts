import React, { useState } from 'react';
import SuiteSettingsModal from './SuiteSettingsModal.jsx';

const MODULES = [
  { id: 'clients',   label: 'Clients',        color: '#e8e8ed' },
  { id: 'content',   label: 'Content Engine', color: 'var(--mod-content)' },
  { id: 'technical', label: 'Technical SEO',  color: 'var(--mod-technical)' },
  { id: 'aeo',       label: 'AEO Engine',     color: 'var(--mod-aeo)' },
  { id: 'reports',   label: 'Reports',        color: 'var(--mod-reports)' },
  { id: 'cms',       label: 'CMS',            color: 'var(--mod-cms)' }
];

const SUB_NAVS = {
  clients:   ['All Clients', 'Approvals', 'Implementation Progress'],
  content:   ['Auto Write', 'Topic Research', 'New Article', 'Rewrite & Expand', 'Metadata & Schema', 'Editorial Feedback', 'Clients', 'History'],
  technical: ['Dashboard', 'Task Board', 'New Scan', 'Clients', 'Team', 'Settings'],
  aeo:       ['Run Optimizations', 'Latest Results', 'Clients', 'Settings', 'History'],
  reports:   ['Monthly Report', 'AEO Snapshot', 'History'],
  cms:       ['Connector', 'Push History']
};

export default function Sidebar({ module, setModule, sub, setSub }) {
  const active = MODULES.find(m => m.id === module);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <aside className="sidebar">
      <div style={{ padding: '20px 20px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 20, lineHeight: 1.1 }}>Syte</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase' }}>SEO Suite</div>
      </div>

      <nav style={{ padding: '12px 8px' }}>
        {MODULES.map(m => {
          const isActive = m.id === module;
          return (
            <button
              key={m.id}
              onClick={() => { setModule(m.id); setSub(SUB_NAVS[m.id][0]); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '10px 12px',
                background: isActive ? 'var(--surface-2)' : 'transparent',
                border: '1px solid ' + (isActive ? m.color : 'transparent'),
                borderRadius: 'var(--radius)',
                color: isActive ? 'var(--text)' : 'var(--text-muted)',
                marginBottom: 4,
                textAlign: 'left',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400
              }}
            >
              <span className="dot" style={{ background: m.color }} />
              {m.label}
            </button>
          );
        })}
      </nav>

      {active && (
        <div style={{ padding: '8px 16px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', margin: '8px 4px' }}>
            {active.label}
          </div>
          {SUB_NAVS[module].map(s => (
            <button
              key={s}
              onClick={() => setSub(s)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '7px 10px',
                background: sub === s ? 'var(--surface-2)' : 'transparent',
                border: 'none',
                borderRadius: 'var(--radius)',
                color: sub === s ? active.color : 'var(--text-muted)',
                marginBottom: 2,
                fontSize: 12.5
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 'auto', padding: 16, borderTop: '1px solid var(--border)' }}>
        <button
          onClick={() => setSettingsOpen(true)}
          style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)' }}
        >
          Suite Settings
        </button>
      </div>

      {settingsOpen && <SuiteSettingsModal onClose={() => setSettingsOpen(false)} />}
    </aside>
  );
}
