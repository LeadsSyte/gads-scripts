import React from 'react';

export const MODULES = [
  { id: 'content', label: 'Content Engine', color: '#c8ff00', tabs: ['New Article', 'Rewrite & Expand', 'Metadata & Schema', 'Editorial Feedback', 'History'] },
  { id: 'technical', label: 'Technical SEO', color: '#ff6b35', tabs: ['Dashboard', 'Task Board', 'New Scan', 'Clients', 'Team', 'Settings'] },
  { id: 'aeo', label: 'AEO Engine', color: '#00d4aa', tabs: ['Run Optimizations', 'Latest Results', 'Clients', 'Settings', 'History'] },
  { id: 'cms', label: 'CMS Push', color: '#4dabff', tabs: ['Connector', 'Push Queue', 'Push History'] },
];

export default function Sidebar({ activeModule, onModuleChange, activeTab, onTabChange, onSettings }) {
  const current = MODULES.find((m) => m.id === activeModule) || MODULES[0];
  return (
    <aside
      style={{
        width: 240,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <div style={{ padding: '20px 20px 16px' }}>
        <div className="serif" style={{ fontSize: 22, lineHeight: 1.1 }}>
          Syte SEO
        </div>
        <div className="serif" style={{ fontSize: 22, lineHeight: 1.1, color: 'var(--text-muted)' }}>
          Suite
        </div>
      </div>

      <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {MODULES.map((m) => {
          const active = m.id === activeModule;
          return (
            <button
              key={m.id}
              onClick={() => onModuleChange(m.id)}
              style={{
                background: active ? 'var(--surface-3)' : 'transparent',
                border: '1px solid transparent',
                borderRadius: 'var(--radius)',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                justifyContent: 'flex-start',
                color: active ? m.color : 'var(--text)',
                fontWeight: active ? 600 : 500,
                textAlign: 'left',
              }}
            >
              <span className="dot" style={{ background: m.color }} />
              {m.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '16px 12px 0', flex: 1, overflowY: 'auto' }}>
        <div
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            color: 'var(--text-dim)',
            padding: '8px 12px',
          }}
        >
          {current.label}
        </div>
        {current.tabs.map((tab) => {
          const isActive = tab === activeTab;
          return (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                padding: '8px 12px',
                borderRadius: 'var(--radius)',
                color: isActive ? current.color : 'var(--text-muted)',
                fontWeight: isActive ? 600 : 400,
                fontSize: 13,
              }}
            >
              {tab}
            </button>
          );
        })}
      </div>

      <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
        <button
          onClick={onSettings}
          style={{
            width: '100%',
            background: 'transparent',
            border: '1px solid var(--border)',
            justifyContent: 'flex-start',
            display: 'flex',
          }}
        >
          Settings
        </button>
      </div>
    </aside>
  );
}
