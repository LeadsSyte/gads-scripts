import React, { useState, useEffect } from 'react';
import LockScreen from './components/LockScreen.jsx';
import Sidebar from './components/Sidebar.jsx';
import ClientSelector from './components/ClientSelector.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ContentEngine from './modules/content/ContentEngine.jsx';
import TechnicalSEO from './modules/technical/TechnicalSEO.jsx';
import AEOEngine from './modules/aeo/AEOEngine.jsx';
import CMSPush from './modules/cms/CMSPush.jsx';
import ReportsModule from './modules/reports/ReportsModule.jsx';
import ClientsMaster from './modules/clients/ClientsMaster.jsx';
import ImplementationProgress from './modules/clients/ImplementationProgress.jsx';
import Approvals from './modules/clients/Approvals.jsx';
import { useClients } from './store/useClients.js';
import { getStoredApiKey } from './lib/auth.js';
import { needsMigration, countLegacyClients, runMigration } from './lib/migration.js';
import { hasSupabase } from './lib/supabase.js';
import { backgroundSilentRefresh, getToken } from './modules/technical/googleAuth.js';

const ACCENTS = {
  clients:   '#e8e8ed',
  content:   '#c8ff00',
  technical: '#ff6b35',
  aeo:       '#00d4aa',
  cms:       '#4dabff',
  reports:   '#a78bfa'
};

// Service flag filter per module. null = show all clients, else filters the
// top-bar dropdown to clients with `does_<filter>` !== false.
const SERVICE_FILTER = {
  clients:   null,  // Master view — show everyone
  content:   'content',
  aeo:       'aeo',
  reports:   null,  // Reports available for all clients — generate at any stage
  technical: null,  // Technical SEO is the source of truth — always all clients
  cms:       null
};

function MigrationScreen({ count, onDone }) {
  const [status, setStatus] = useState('ready');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  async function run() {
    setStatus('migrating');
    try {
      const r = await runMigration();
      setResult(r);
      setStatus('done');
      setTimeout(onDone, 900);
    } catch (e) { setErr(e.message); setStatus('ready'); }
  }

  return (
    <div className="lock-screen">
      <div className="lock-box" style={{ width: 440 }}>
        <h1 style={{ margin: 0, marginBottom: 10 }}>Migrate Existing Data</h1>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
          Found <strong style={{ color: 'var(--text)' }}>{count}</strong> clients across your existing tools. Migrating to Supabase…
        </p>
        {status === 'ready' && <button className="primary" style={{ width: '100%' }} onClick={run}>Start Migration</button>}
        {status === 'migrating' && <div className="muted">Migrating…</div>}
        {status === 'done' && (
          <div style={{ color: 'var(--green)' }}>
            Done. Migrated {result.migrated} · skipped {result.skipped}.
          </div>
        )}
        {err && <div style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
        <button onClick={onDone} className="ghost" style={{ marginTop: 14, width: '100%' }}>Skip for now</button>
      </div>
    </div>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(!!getStoredApiKey());
  const [module, setModule] = useState('clients');
  const [sub, setSub] = useState('All Clients');
  const [migration, setMigration] = useState({ checked: false, needed: false, count: 0 });

  const load = useClients(s => s.load);

  useEffect(() => {
    if (!unlocked) return;
    (async () => {
      await load();
      const needed = needsMigration();
      setMigration({ checked: true, needed, count: needed ? countLegacyClients() : 0 });
    })();

    // On app start, attempt to silently renew the Google access token
    // if it's missing or expired. The user is usually still signed into
    // Google in this browser; this brings the token back without any
    // popup, so subsequent GA4/GSC calls just work after a page refresh.
    if (!getToken()) {
      backgroundSilentRefresh();
    }

    // Also kick a refresh every 50 minutes so a long session doesn't
    // catch a stale token mid-action. Tokens are 1-hour TTL.
    const interval = setInterval(() => {
      backgroundSilentRefresh();
    }, 50 * 60 * 1000);
    return () => clearInterval(interval);
  }, [unlocked, load]);

  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  if (!migration.checked) {
    return <div className="lock-screen"><div className="lock-box">Loading…</div></div>;
  }
  if (migration.needed) {
    return (
      <MigrationScreen
        count={migration.count}
        onDone={async () => { await load(); setMigration({ checked: true, needed: false, count: 0 }); }}
      />
    );
  }

  const accent = ACCENTS[module];

  return (
    <div className="app-shell" style={{ '--accent': accent }}>
      <Sidebar module={module} setModule={setModule} sub={sub} setSub={setSub} />
      <main className="main">
        <ClientSelector accent={accent} serviceFilter={SERVICE_FILTER[module]} />
        {!hasSupabase && (
          <div style={{ background: 'var(--surface-2)', padding: '8px 24px', fontSize: 12, color: 'var(--orange)', borderBottom: '1px solid var(--border)' }}>
            Supabase not configured — running on localStorage fallback. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env to enable sync.
          </div>
        )}
        <ErrorBoundary key={module} label={module.charAt(0).toUpperCase() + module.slice(1) + ' module'}>
          {module === 'clients' && sub === 'Implementation Progress' && <ImplementationProgress />}
          {module === 'clients' && sub === 'Approvals' && <Approvals />}
          {module === 'clients' && sub !== 'Implementation Progress' && sub !== 'Approvals' && <ClientsMaster />}
          {module === 'content'   && <ContentEngine sub={sub} setSub={setSub} />}
          {module === 'technical' && <TechnicalSEO sub={sub} />}
          {module === 'aeo'       && <AEOEngine sub={sub} />}
          {module === 'reports'   && <ReportsModule sub={sub} />}
          {module === 'cms'       && <CMSPush sub={sub} />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
