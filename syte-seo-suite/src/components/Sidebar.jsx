import React, { useState } from 'react';
import SuiteSettingsModal from './SuiteSettingsModal.jsx';

// Build-time info baked in by vite.config.js (defined as global). Shows
// in the sidebar footer so users can verify at a glance which version
// of the suite is running — no more "did Netlify actually deploy?"
// guesswork.
// eslint-disable-next-line no-undef
const BUILD = typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__ : { commit: 'dev', branch: 'dev', builtAt: '' };

function BuildBadge() {
  const [showFull, setShowFull] = useState(false);
  const built = BUILD.builtAt ? new Date(BUILD.builtAt) : null;
  const ago = built ? formatAgo(built) : '';
  return (
    <div
      title={`Commit: ${BUILD.fullCommit || BUILD.commit}\nBranch: ${BUILD.branch}\nBuilt: ${BUILD.builtAt}`}
      onClick={() => setShowFull(v => !v)}
      style={{
        marginTop: 10, fontSize: 10, color: 'var(--text-dim)',
        fontFamily: 'JetBrains Mono, monospace',
        cursor: 'pointer', lineHeight: 1.4, textAlign: 'center'
      }}
    >
      <div>v {BUILD.commit} · {BUILD.branch}</div>
      {ago && <div>built {ago}</div>}
      {showFull && built && (
        <div style={{ marginTop: 4, color: 'var(--text-muted)' }}>
          {built.toLocaleString()}
        </div>
      )}
    </div>
  );
}

function formatAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

const MODULES = [
  { id: 'clients',   label: 'Clients',        color: '#e8e8ed' },
  { id: 'content',   label: 'Content Engine', color: 'var(--mod-content)' },
  { id: 'technical', label: 'Technical SEO',  color: 'var(--mod-technical)' },
  { id: 'aeo',       label: 'AEO Engine',     color: 'var(--mod-aeo)' },
  { id: 'reports',   label: 'Reports',        color: 'var(--mod-reports)' },
  { id: 'cms',       label: 'CMS',            color: 'var(--mod-cms)' }
];

const SUB_NAVS = {
  clients:   ['All Clients', 'Approvals', 'Account Managers', 'Implementation Progress'],
  content:   ['Auto Write', 'Topic Research', 'New Article', 'Rewrite & Expand', 'Metadata & Schema', 'Editorial Feedback', 'Clients', 'History'],
  technical: ['Dashboard', 'Task Board', 'New Scan', 'External Work', 'Clients', 'Team', 'Settings'],
  aeo:       ['Run Optimizations', 'Query Discovery', 'Latest Results', 'Clients', 'Settings', 'History'],
  reports:   ['Monthly Report', 'AEO Snapshot', 'Dev Export', 'History'],
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
        <BuildBadge />
      </div>

      {settingsOpen && <SuiteSettingsModal onClose={() => setSettingsOpen(false)} />}
    </aside>
  );
}
