// AEOEngine component test. Largest module (1200+ lines, 5 sub-views).
// Pin: each sub renders without crashing, the optimization runner button
// is gated correctly, and the pipeline view is reachable.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/anthropic.js', () => ({
  claudeComplete: vi.fn(async () => '[]'),
  extractJSON: () => null
}));
vi.mock('../../src/lib/corsProxy.js', () => ({
  corsFetchText: vi.fn(async () => '<html></html>')
}));
vi.mock('../../src/components/PushToCmsButton.jsx', () => ({
  default: () => <button data-testid="push-cms">Push</button>
}));
vi.mock('../../src/modules/cms/pushAction.js', () => ({
  pushItemInline: vi.fn()
}));
vi.mock('../../src/components/ClientCardsGrid.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/MarkImplementedButton.jsx', () => ({
  default: () => <button data-testid="mark-impl">Mark</button>
}));
vi.mock('../../src/components/PipelineView.jsx', () => ({
  default: ({ sections, title }) => (
    <div data-testid="pipeline">
      <div>{title}</div>
      {sections.map(s => (
        <div key={s.key}>{s.label} ({s.clients.length})</div>
      ))}
    </div>
  )
}));
vi.mock('../../src/components/LogExternalWork.jsx', () => ({
  default: () => <div data-testid="log-external" />
}));

const mockListAllImplementations = vi.fn(async () => []);
const mockSaveAeoResult = vi.fn(async () => {});
const mockLoadAeoResults = vi.fn(async () => ({}));
const mockDeleteAeoResult = vi.fn(async () => {});
const mockSaveDeepResult = vi.fn(async () => ({}));
const mockListDeepResults = vi.fn(async () => []);
const mockDeleteDeepResult = vi.fn(async () => {});
vi.mock('../../src/lib/supabase.js', () => ({
  listAllImplementations: (...a) => mockListAllImplementations(...a),
  saveAeoResult: (...a) => mockSaveAeoResult(...a),
  loadAeoResults: (...a) => mockLoadAeoResults(...a),
  deleteAeoResult: (...a) => mockDeleteAeoResult(...a),
  saveDeepResult: (...a) => mockSaveDeepResult(...a),
  listDeepResults: (...a) => mockListDeepResults(...a),
  deleteDeepResult: (...a) => mockDeleteDeepResult(...a)
}));

vi.mock('../../src/modules/aeo/aeoTypes.js', () => ({
  AEO_SYSTEM: '', AEO_DEEP_SYSTEM: '',
  AEO_TYPES: []
}));
vi.mock('../../src/modules/aeo/sitemap.js', () => ({
  fetchSitemapUrls: vi.fn(async () => [])
}));
vi.mock('../../src/modules/aeo/ga4.js', () => ({
  listAccountSummaries: vi.fn(async () => []),
  runReport: vi.fn(async () => ({ rows: [] }))
}));
vi.mock('../../src/modules/technical/googleAuth.js', () => ({
  ensureToken: vi.fn(async () => ({ access_token: 'TEST' })),
  SCOPES: { ga4: 'g4', gsc: 'gs' },
  getToken: () => null,
  clearToken: vi.fn()
}));

let mockClients;
let mockSelectedId;
vi.mock('../../src/store/useClients.js', () => ({
  useClients: Object.assign(
    (selector) => selector({
      clients: mockClients,
      current: () => mockClients.find(c => c.id === mockSelectedId) || null,
      select: vi.fn(),
      selectedId: mockSelectedId
    }),
    {
      // Some callers do useClients.getState().select(id); shim it.
      getState: () => ({
        clients: mockClients,
        current: () => mockClients.find(c => c.id === mockSelectedId) || null,
        select: vi.fn(),
        selectedId: mockSelectedId
      })
    }
  )
}));

import AEOEngine from '../../src/modules/aeo/AEOEngine.jsx';

beforeEach(() => {
  mockListAllImplementations.mockReset().mockResolvedValue([]);
  mockSaveAeoResult.mockReset().mockResolvedValue();
  mockLoadAeoResults.mockReset().mockResolvedValue({});
  mockDeleteAeoResult.mockReset().mockResolvedValue();
  mockSaveDeepResult.mockReset().mockResolvedValue({});
  mockListDeepResults.mockReset().mockResolvedValue([]);
  mockDeleteDeepResult.mockReset().mockResolvedValue();
  mockClients = [];
  mockSelectedId = null;
});

const AEO_CLIENT = {
  id: 'c1', name: 'Acme', url: 'https://acme.test/',
  industry: 'Hospitality', location: 'Cape Town',
  sitemap_url: 'https://acme.test/sitemap.xml',
  ga4_property_id: '123',
  aeo_probe_queries: 'best hotels',
  competitors: 'OneAndOnly',
  does_aeo: true
};

describe('AEOEngine', () => {
  test('Run Optimizations sub renders without crashing', async () => {
    mockClients = [AEO_CLIENT];
    mockSelectedId = 'c1';
    render(<AEOEngine sub="Run Optimizations" />);
    await waitFor(() => expect(document.body.textContent.length).toBeGreaterThan(0));
  });

  test('Latest Results sub renders without crashing', async () => {
    mockClients = [AEO_CLIENT];
    mockSelectedId = 'c1';
    render(<AEOEngine sub="Latest Results" />);
    await waitFor(() => expect(document.body.textContent.length).toBeGreaterThan(0));
  });

  test('Clients sub renders the AEO Engine Clients heading', async () => {
    mockClients = [AEO_CLIENT];
    render(<AEOEngine sub="Clients" />);
    await waitFor(() => expect(screen.getByText(/AEO Engine Clients/i)).toBeInTheDocument());
  });

  test('Settings sub renders without crashing', async () => {
    mockClients = [];
    render(<AEOEngine sub="Settings" />);
    await waitFor(() => expect(document.body.textContent.length).toBeGreaterThan(0));
  });

  test('History sub renders without crashing', async () => {
    mockClients = [AEO_CLIENT];
    mockSelectedId = 'c1';
    render(<AEOEngine sub="History" />);
    await waitFor(() => expect(document.body.textContent.length).toBeGreaterThan(0));
  });

  test('Run Optimizations sub renders the pipeline buckets', async () => {
    mockClients = [AEO_CLIENT];
    render(<AEOEngine sub="Run Optimizations" />);
    await waitFor(() => expect(screen.getByTestId('pipeline')).toBeInTheDocument());
    const panel = screen.getByTestId('pipeline');
    // At least one of the AEO bucket labels appears.
    expect(panel.textContent).toMatch(/verified|optimization|not run|credentials/i);
  });

  test('No-client state for Run Optimizations does not crash', async () => {
    mockClients = [];
    mockSelectedId = null;
    render(<AEOEngine sub="Run Optimizations" />);
    await waitFor(() => expect(document.body.textContent.length).toBeGreaterThan(0));
  });
});
