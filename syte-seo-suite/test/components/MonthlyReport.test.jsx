// MonthlyReport component test. The single biggest report-flow surface
// in the suite — Generate Full Report / Generate AEO Report buttons,
// data fetch status banner, AEO snapshot context, and after-generate
// review panel with Alice email + microsite preview + Mark Sent.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/anthropic.js', () => ({
  claudeComplete: vi.fn(async () => 'SUBJECT: Test\n---\nBody text'),
  extractJSON: () => ({ overallScore: 8, readyToSend: true, checks: [] })
}));

const mockListAeoSnapshots = vi.fn(async () => []);
const mockLogReportSent = vi.fn(async () => {});
const mockLogReportGenerated = vi.fn(async () => {});
const mockGetCachedReportData = vi.fn(async () => null);
const mockSetCachedReportData = vi.fn(async () => {});
vi.mock('../../src/lib/supabase.js', () => ({
  listAeoSnapshots: (...a) => mockListAeoSnapshots(...a),
  logReportSent: (...a) => mockLogReportSent(...a),
  logReportGenerated: (...a) => mockLogReportGenerated(...a),
  getCachedReportData: (...a) => mockGetCachedReportData(...a),
  setCachedReportData: (...a) => mockSetCachedReportData(...a)
}));

vi.mock('../../src/modules/reports/reportPrompts.js', () => ({
  ALICE_SYSTEM: '', MICROSITE_SYSTEM: '', QA_SYSTEM: '',
  ALICE_AEO_SYSTEM: '', MICROSITE_AEO_SYSTEM: '', QA_AEO_SYSTEM: '',
  buildAlicePayload: () => '',
  getWorkSummary: () => null,
  buildAeoPayload: () => ''
}));
vi.mock('../../src/modules/reports/microsite.js', () => ({
  buildMicrositeHtml: () => '<!DOCTYPE html><html><body>microsite</body></html>',
  downloadMicrosite: vi.fn()
}));
const mockRunSnapshot = vi.fn();
vi.mock('../../src/modules/reports/aeoRunner.js', () => ({
  runSnapshot: (...a) => mockRunSnapshot(...a),
  snapshotPreflight: () => ({ canRun: false, missingEngines: [], engines: [], queries: [] })
}));
vi.mock('../../src/modules/reports/aeoCompare.js', () => ({
  compareSnapshots: () => ({ has_previous: false, deltas: null }),
  rankBrandWithCompetitors: () => [],
  normalizeSnapshot: (s) => s
}));
vi.mock('../../src/modules/technical/googleAuth.js', () => ({
  ensureToken: vi.fn(async () => ({ access_token: 'TEST' })),
  SCOPES: { ga4: 'ga4', gsc: 'gsc' },
  getToken: () => null,
  switchAccount: vi.fn(),
  silentRefresh: vi.fn(async () => null)
}));
const mockFetchReportData = vi.fn(async () => null);
vi.mock('../../src/modules/reports/reportData.js', () => ({
  fetchReportData: (...a) => mockFetchReportData(...a)
}));
vi.mock('../../src/modules/reports/ReportDashboard.jsx', () => ({
  default: ({ data }) => <div data-testid="dashboard">{data ? 'has-data' : 'no-data'}</div>
}));

let mockClients;
let mockSelectedId;
vi.mock('../../src/store/useClients.js', () => ({
  useClients: (selector) => selector({
    clients: mockClients,
    current: () => mockClients.find(c => c.id === mockSelectedId) || null,
    select: vi.fn(),
    selectedId: mockSelectedId
  })
}));

import MonthlyReport from '../../src/modules/reports/MonthlyReport.jsx';

beforeEach(() => {
  mockListAeoSnapshots.mockReset().mockResolvedValue([]);
  mockLogReportSent.mockReset().mockResolvedValue();
  mockLogReportGenerated.mockReset().mockResolvedValue();
  mockGetCachedReportData.mockReset().mockResolvedValue(null);
  mockSetCachedReportData.mockReset().mockResolvedValue();
  mockRunSnapshot.mockReset();
  mockFetchReportData.mockReset().mockResolvedValue(null);
  mockClients = [];
  mockSelectedId = null;
});

const CLIENT = {
  id: 'c1', name: 'Acme', url: 'https://acme.test/',
  industry: 'Hospitality', does_content: true, does_technical: true, does_aeo: true,
  ga4_property_id: '123', gsc_property: 'sc-domain:acme.test'
};

describe('MonthlyReport', () => {
  test('shows "Select a client first" when no client selected', () => {
    mockClients = [];
    render(<MonthlyReport />);
    expect(screen.getByText(/Select a client first/i)).toBeInTheDocument();
  });

  test('renders the full report panel for the selected client', async () => {
    mockClients = [CLIENT];
    mockSelectedId = 'c1';
    render(<MonthlyReport />);
    await waitFor(() => expect(screen.getByText(/Monthly Report/i)).toBeInTheDocument());
    // Client name appears at the top.
    expect(screen.getByText(CLIENT.name)).toBeInTheDocument();
  });

  test('Generate Full Report button is reachable for SEO-eligible client', async () => {
    mockClients = [CLIENT];
    mockSelectedId = 'c1';
    render(<MonthlyReport />);
    await waitFor(() => {
      const btn = screen.queryByRole('button', { name: /Generate Full Report/i });
      expect(btn).toBeInTheDocument();
    });
  });

  test('Generate AEO Report button is reachable for AEO-eligible client', async () => {
    mockClients = [CLIENT];
    mockSelectedId = 'c1';
    render(<MonthlyReport />);
    await waitFor(() => {
      const btn = screen.queryByRole('button', { name: /Generate AEO Report/i });
      expect(btn).toBeInTheDocument();
    });
  });

  test('Generate Full Report button hidden when client opts out of content + technical', async () => {
    mockClients = [{ ...CLIENT, does_content: false, does_technical: false }];
    mockSelectedId = 'c1';
    render(<MonthlyReport />);
    await waitFor(() => expect(screen.getByText(/Monthly Report/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Generate Full Report/i })).not.toBeInTheDocument();
  });

  test('AEO snapshot found in storage shows the green badge', async () => {
    const month = new Date();
    month.setMonth(month.getMonth() - 1);
    const monthKey = month.toISOString().slice(0, 7);
    mockListAeoSnapshots.mockResolvedValue([
      { id: 's1', client_id: 'c1', month: monthKey, overall_score: 72 }
    ]);
    mockClients = [CLIENT];
    mockSelectedId = 'c1';
    render(<MonthlyReport />);
    await waitFor(() => expect(screen.getByText(/AEO snapshot:/i)).toBeInTheDocument());
    // Score appears at least once (the badge text) — also rendered in
    // the AEO Summary card below, so use getAllByText.
    expect(screen.getAllByText(/72\/100/).length).toBeGreaterThan(0);
  });

  test('Loaded-from-cache report data populates the dashboard with has-data', async () => {
    mockGetCachedReportData.mockResolvedValue({
      data: { traffic: { current: { users: 100 } }, keywords: [], topPages: [] },
      fetched_at: new Date().toISOString()
    });
    mockClients = [CLIENT];
    mockSelectedId = 'c1';
    render(<MonthlyReport />);
    await waitFor(() => expect(screen.getByTestId('dashboard').textContent).toBe('has-data'));
  });
});
