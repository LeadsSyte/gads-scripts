// App boot sequence tests. Pins the gating order:
//   1. LockScreen until getStoredApiKey returns truthy
//   2. "Loading…" until migration check completes
//   3. MigrationScreen if legacy data exists in localStorage
//   4. Main shell otherwise — Sidebar, ClientSelector, the routed module
//
// Also tests the no-Supabase orange banner at the top.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Stub every leaf module so App can mount without dragging the world in.
vi.mock('../../src/components/LockScreen.jsx', () => ({
  default: ({ onUnlock }) => <button data-testid="lock-screen" onClick={onUnlock}>LOCK</button>
}));
vi.mock('../../src/components/Sidebar.jsx', () => ({
  default: () => <div data-testid="sidebar">SIDEBAR</div>
}));
vi.mock('../../src/components/ClientSelector.jsx', () => ({
  default: () => <div data-testid="client-selector" />
}));
vi.mock('../../src/modules/content/ContentEngine.jsx', () => ({
  default: () => <div data-testid="content-engine" />
}));
vi.mock('../../src/modules/technical/TechnicalSEO.jsx', () => ({
  default: () => <div data-testid="technical-seo" />
}));
vi.mock('../../src/modules/aeo/AEOEngine.jsx', () => ({
  default: () => <div data-testid="aeo-engine" />
}));
vi.mock('../../src/modules/cms/CMSPush.jsx', () => ({
  default: () => <div data-testid="cms-push" />
}));
vi.mock('../../src/modules/reports/ReportsModule.jsx', () => ({
  default: () => <div data-testid="reports-module" />
}));
vi.mock('../../src/modules/clients/ClientsMaster.jsx', () => ({
  default: () => <div data-testid="clients-master" />
}));
vi.mock('../../src/modules/clients/ImplementationProgress.jsx', () => ({
  default: () => <div data-testid="impl-progress" />
}));
vi.mock('../../src/modules/clients/Approvals.jsx', () => ({
  default: () => <div data-testid="approvals" />
}));

const mockLoad = vi.fn(async () => {});
vi.mock('../../src/store/useClients.js', () => ({
  useClients: (selector) => selector({ load: mockLoad })
}));

const mockGetStoredApiKey = vi.fn();
vi.mock('../../src/lib/auth.js', () => ({
  getStoredApiKey: () => mockGetStoredApiKey()
}));

const mockNeedsMigration = vi.fn();
const mockCountLegacyClients = vi.fn();
vi.mock('../../src/lib/migration.js', () => ({
  needsMigration: (...a) => mockNeedsMigration(...a),
  countLegacyClients: (...a) => mockCountLegacyClients(...a),
  runMigration: vi.fn(async () => ({ migrated: 0, skipped: 0 }))
}));

const mockHasSupabase = vi.fn();
vi.mock('../../src/lib/supabase.js', () => ({
  get hasSupabase() { return mockHasSupabase(); }
}));

const mockBackgroundSilentRefresh = vi.fn();
const mockGetToken = vi.fn();
vi.mock('../../src/modules/technical/googleAuth.js', () => ({
  backgroundSilentRefresh: (...a) => mockBackgroundSilentRefresh(...a),
  getToken: () => mockGetToken()
}));

import App from '../../src/App.jsx';

beforeEach(() => {
  mockLoad.mockReset().mockResolvedValue();
  mockGetStoredApiKey.mockReset().mockReturnValue(null);
  mockNeedsMigration.mockReset().mockReturnValue(false);
  mockCountLegacyClients.mockReset().mockReturnValue(0);
  mockHasSupabase.mockReset().mockReturnValue(true);
  mockBackgroundSilentRefresh.mockReset();
  mockGetToken.mockReset().mockReturnValue(null);
});

describe('App', () => {
  test('renders LockScreen when no stored API key', () => {
    mockGetStoredApiKey.mockReturnValue(null);
    render(<App />);
    expect(screen.getByTestId('lock-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
  });

  test('skips LockScreen when stored API key already present', async () => {
    mockGetStoredApiKey.mockReturnValue('sk-stored');
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('sidebar')).toBeInTheDocument());
  });

  test('shows MigrationScreen when needsMigration returns true', async () => {
    mockGetStoredApiKey.mockReturnValue('sk-stored');
    mockNeedsMigration.mockReturnValue(true);
    mockCountLegacyClients.mockReturnValue(7);
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Migrate Existing Data/i)).toBeInTheDocument());
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });

  test('shows the no-Supabase banner when running on localStorage fallback', async () => {
    mockGetStoredApiKey.mockReturnValue('sk-stored');
    mockHasSupabase.mockReturnValue(false);
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Supabase not configured/i)).toBeInTheDocument());
  });

  test('hides the no-Supabase banner when Supabase is configured', async () => {
    mockGetStoredApiKey.mockReturnValue('sk-stored');
    mockHasSupabase.mockReturnValue(true);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('sidebar')).toBeInTheDocument());
    expect(screen.queryByText(/Supabase not configured/i)).not.toBeInTheDocument();
  });

  test('default module is "clients" → ClientsMaster mounts', async () => {
    mockGetStoredApiKey.mockReturnValue('sk-stored');
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('clients-master')).toBeInTheDocument());
  });

  test('backgroundSilentRefresh kicked off when no Google token', async () => {
    mockGetStoredApiKey.mockReturnValue('sk-stored');
    mockGetToken.mockReturnValue(null);
    render(<App />);
    await waitFor(() => expect(mockBackgroundSilentRefresh).toHaveBeenCalled());
  });

  test('backgroundSilentRefresh NOT kicked off when token already exists', async () => {
    mockGetStoredApiKey.mockReturnValue('sk-stored');
    mockGetToken.mockReturnValue({ access_token: 'fresh', expires_at: Date.now() + 3600_000 });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('sidebar')).toBeInTheDocument());
    // Initial mount path skips the immediate refresh; the 50-minute
    // interval is still set up but doesn't fire synchronously.
    expect(mockBackgroundSilentRefresh).not.toHaveBeenCalled();
  });

  test('clicking through LockScreen unlocks and renders the shell', async () => {
    mockGetStoredApiKey.mockReturnValue(null);
    const { rerender } = render(<App />);
    expect(screen.getByTestId('lock-screen')).toBeInTheDocument();
    // Trigger onUnlock via the stub button.
    screen.getByTestId('lock-screen').click();
    await waitFor(() => expect(screen.getByTestId('sidebar')).toBeInTheDocument());
  });
});
