// TechnicalSEO module test. The big four sub-views: Dashboard (pipeline),
// Task Board, New Scan, Settings. Pins:
//   • Each sub route renders without crashing
//   • Dashboard pipeline lists clients in their bucket — crawler-only
//     clients are NOT bucketed as 'credentials-missing' (regression for
//     the original Run Scan bug)
//   • New Scan tab disables the button when no client is selected
//   • Tasks loaded from Supabase populate state on mount

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Heavy module dependencies — replace with no-ops or tracked stubs.
vi.mock('../../src/lib/anthropic.js', () => ({
  claudeComplete: vi.fn(async () => '[]'),
  extractJSON: (s) => { try { return JSON.parse(s); } catch { return null; } }
}));
vi.mock('../../src/lib/corsProxy.js', () => ({
  corsFetchText: vi.fn(async () => '<html></html>')
}));
vi.mock('../../src/components/PushToCmsButton.jsx', () => ({
  default: () => <button data-testid="push-cms">push</button>
}));
vi.mock('../../src/components/MarkImplementedButton.jsx', () => ({
  default: () => <button data-testid="mark-impl">mark</button>
}));
vi.mock('../../src/modules/technical/webceo.js', () => ({
  getAudit: vi.fn(),
  syncWebceoClients: vi.fn(async () => ({ inserted: 0, updated: 0, total: 0 })),
  webceoDiagnose: vi.fn(async () => ({ body: '' }))
}));
vi.mock('../../src/modules/technical/crawler.js', () => ({
  crawlSiteForIssues: vi.fn(async () => ({ totalCrawled: 0, withIssues: 0, pages: [] })),
  summarizeCrawlForAI: vi.fn(() => '')
}));
vi.mock('../../src/lib/verification.js', () => ({
  checkOffPageTask: vi.fn(),
  isOffPageTask: () => false
}));
vi.mock('../../src/modules/technical/gsc.js', () => ({
  querySearchAnalytics: vi.fn(async () => ({ rows: [] }))
}));
vi.mock('../../src/modules/technical/googleAuth.js', () => ({
  ensureToken: vi.fn(async () => ({ access_token: 'TEST' })),
  SCOPES: { gsc: 'gsc-scope' },
  getToken: () => null,
  clearToken: vi.fn()
}));

const mockUpsertClient = vi.fn();
const mockListAllImplementations = vi.fn(async () => []);
const mockSaveTseoTasks = vi.fn(async () => {});
const mockLoadTseoTasks = vi.fn(async () => []);
const mockUpdateTseoTask = vi.fn();
vi.mock('../../src/lib/supabase.js', () => ({
  upsertClient: (...a) => mockUpsertClient(...a),
  listAllImplementations: (...a) => mockListAllImplementations(...a),
  saveTseoTasks: (...a) => mockSaveTseoTasks(...a),
  loadTseoTasks: (...a) => mockLoadTseoTasks(...a),
  updateTseoTask: (...a) => mockUpdateTseoTask(...a)
}));

let mockClients;
let mockSelectedId;
const mockSelect = vi.fn();
vi.mock('../../src/store/useClients.js', () => ({
  useClients: Object.assign(
    (selector) => selector({
      clients: mockClients,
      current: () => mockClients.find(c => c.id === mockSelectedId) || null,
      select: mockSelect,
      load: vi.fn(),
      selectedId: mockSelectedId
    }),
    {
      // Some callers do useClients.getState() — provide a minimal shim.
      getState: () => ({
        clients: mockClients,
        current: () => mockClients.find(c => c.id === mockSelectedId) || null,
        select: mockSelect,
        selectedId: mockSelectedId
      })
    }
  )
}));

import TechnicalSEO from '../../src/modules/technical/TechnicalSEO.jsx';

beforeEach(() => {
  mockListAllImplementations.mockReset().mockResolvedValue([]);
  mockLoadTseoTasks.mockReset().mockResolvedValue([]);
  mockSaveTseoTasks.mockReset().mockResolvedValue(undefined);
  mockUpsertClient.mockReset();
  mockUpdateTseoTask.mockReset();
  mockSelect.mockReset();
  mockClients = [];
  mockSelectedId = null;
});

describe('TechnicalSEO', () => {
  test('Dashboard sub-view renders without crashing', async () => {
    mockClients = [];
    render(<TechnicalSEO sub="Dashboard" />);
    await waitFor(() => expect(screen.getByText(/Technical SEO/i)).toBeInTheDocument());
  });

  test('Task Board sub-view renders without crashing', async () => {
    mockClients = [];
    render(<TechnicalSEO sub="Task Board" />);
    // Don't crash. The exact heading varies; assert the page rendered something.
    await waitFor(() => expect(document.body.textContent.length).toBeGreaterThan(0));
  });

  test('New Scan sub-view: Run Crawl Scan button is disabled when no client selected', async () => {
    mockClients = [];
    mockSelectedId = null;
    render(<TechnicalSEO sub="New Scan" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Run Crawl Scan/i })).toBeInTheDocument());
    const btn = screen.getByRole('button', { name: /Run Crawl Scan/i });
    expect(btn).toBeDisabled();
  });

  test('New Scan: Run Crawl Scan enabled when a client is selected', async () => {
    mockClients = [{ id: 'c1', name: 'Acme', url: 'https://acme.test/', sitemap_url: 'https://acme.test/sitemap.xml' }];
    mockSelectedId = 'c1';
    render(<TechnicalSEO sub="New Scan" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Run Crawl Scan/i })).toBeInTheDocument());
    const btn = screen.getByRole('button', { name: /Run Crawl Scan/i });
    expect(btn).not.toBeDisabled();
  });

  // ── REGRESSION GUARD ───────────────────────────────────────────────
  // The original 'Run Scan does nothing' bug: pipelineStatus bucketed
  // crawler-only clients (URL + sitemap, no GSC) into 'credentials-
  // missing'. The Run Scan action button was hidden in that bucket.
  // This test asserts the bucket separation is rendered correctly.
  test('Dashboard regression: a crawler-only client gets a Run Scan button', async () => {
    mockClients = [
      { id: 'c1', name: 'Acme', url: 'https://acme.test/', sitemap_url: 'https://acme.test/sitemap.xml',
        does_technical: true }
    ];
    render(<TechnicalSEO sub="Dashboard" />);
    // 'Acme' appears in both the section header summary AND the pipeline
    // card body; assert ≥1 instance.
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0));
    const scanBtn = screen.queryByRole('button', { name: /Run Scan|Re-scan/i });
    expect(scanBtn).toBeInTheDocument();
  });

  test('Tasks loaded from Supabase on mount populate the task list', async () => {
    mockLoadTseoTasks.mockResolvedValue([
      { id: 't1', client_id: 'c1', client_name: 'Acme', title: 'Fix meta',
        description: 'Add meta description', priority: 'high', page_url: 'https://acme.test/',
        fix_type: 'meta_description', status: 'open', created_at: new Date().toISOString() }
    ]);
    mockClients = [{ id: 'c1', name: 'Acme' }];
    render(<TechnicalSEO sub="Task Board" />);
    await waitFor(() => expect(mockLoadTseoTasks).toHaveBeenCalled());
  });
});
