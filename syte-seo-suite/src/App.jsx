import React, { useState, useEffect } from 'react';
import LockScreen from './components/LockScreen.jsx';
import Sidebar, { MODULES } from './components/Sidebar.jsx';
import ClientSelector from './components/ClientSelector.jsx';
import ContentEngine from './modules/content/ContentEngine.jsx';
import TechnicalSEO from './modules/technical/TechnicalSEO.jsx';
import AEOEngine from './modules/aeo/AEOEngine.jsx';
import CMSPush from './modules/cms/CMSPush.jsx';
import { getStoredApiKey } from './lib/auth.js';
import { maybeRunMigration } from './lib/migration.js';

export default function App() {
  const [unlocked, setUnlocked] = useState(!!getStoredApiKey());
  const [activeModule, setActiveModule] = useState('content');
  const [activeTab, setActiveTab] = useState(MODULES[0].tabs[0]);
  const [migrationStatus, setMigrationStatus] = useState(null);
  const [migrationDone, setMigrationDone] = useState(false);

  // Reset tab when module changes
  useEffect(() => {
    const mod = MODULES.find((m) => m.id === activeModule);
    if (mod) setActiveTab(mod.tabs[0]);
  }, [activeModule]);

  // Run data migration once after unlock
  useEffect(() => {
    if (!unlocked || migrationDone) return;
    (async () => {
      try {
        const result = await maybeRunMigration((msg) => setMigrationStatus(msg));
        if (result.ran) {
          setMigrationStatus(
            `Migrated ${result.inserted} clients from legacy tools. Loading suite…`
          );
          await new Promise((r) => setTimeout(r, 800));
        }
      } catch (e) {
        console.warn('Migration error', e);
      } finally {
        setMigrationStatus(null);
        setMigrationDone(true);
      }
    })();
  }, [unlocked, migrationDone]);

  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;

  if (migrationStatus) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div className="spinner" />
        <div className="serif" style={{ fontSize: 24 }}>
          {migrationStatus}
        </div>
      </div>
    );
  }

  const moduleAccent = MODULES.find((m) => m.id === activeModule)?.color;

  return (
    <div className="app-shell">
      <Sidebar
        activeModule={activeModule}
        onModuleChange={setActiveModule}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSettings={() => alert('Settings: edit clients via the top-bar selector.')}
      />
      <div className="main-area">
        <ClientSelector accent={moduleAccent} />
        <div className="module-body" style={{ '--accent': moduleAccent }}>
          {activeModule === 'content' && <ContentEngine tab={activeTab} />}
          {activeModule === 'technical' && <TechnicalSEO tab={activeTab} />}
          {activeModule === 'aeo' && <AEOEngine tab={activeTab} />}
          {activeModule === 'cms' && <CMSPush tab={activeTab} />}
        </div>
      </div>
    </div>
  );
}
