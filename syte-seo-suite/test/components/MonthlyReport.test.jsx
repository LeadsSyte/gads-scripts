// Component test for MonthlyReport. Locks in the two guarantees the SEO /
// AEO split depends on:
//   1. The SEO report cannot be generated unless Search Console is
//      connected AND returning real data for the report month.
//   2. The AEO report cannot be generated without Search Console head-terms
//      to ground its probe grid — a live pull or an imported export both
//      count, a broken Google connection on its own does not block it.
//   3. SEO and AEO are offered as two separate deliverables, and the AEO
//      report is not held hostage by the Search Console gate.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockClaudeComplete = vi.fn();
// Report data already sitting in the cache for this client/month. Lets a test
// say "the data is on file" independently of whether a live fetch could run —
// which is the whole distinction the AEO gate turns on.
let mockCachedData;
vi.mock('../../src/lib/anthropic.js', () => ({
  claudeComplete: (...a) => mockClaudeComplete(...a),
  extractJSON: (t) => { try { return JSON.parse(t); } catch { return null; } }
}));

vi.mock('../../src/lib/supabase.js', () => ({
  listAeoSnapshots: vi.fn().mockResolvedValue([]),
  logReportSent: vi.fn().mockResolvedValue({}),
  logReportGenerated: vi.fn().mockResolvedValue({}),
  getGeneratedReport: vi.fn().mockResolvedValue(null),
  getCachedReportData: vi.fn(async () => (mockCachedData ? { data: mockCachedData, fetched_at: '2026-09-01T10:00:00.000Z' } : null)),
  setCachedReportData: vi.fn().mockResolvedValue({}),
  persistAeoRuns: vi.fn().mockResolvedValue({}),
  saveAeoSnapshot: vi.fn().mockResolvedValue({})
}));

// vi.mock factories are hoisted above the module body, so the scope URLs
// have to be inlined here rather than referenced from a const.
let mockToken;
vi.mock('../../src/lib/googleServerAuth.js', () => ({ serverAuthEnabled: () => false }));
vi.mock('../../src/lib/settings.js', () => ({ SETTINGS_EVENT: 'syte-settings-changed' }));
vi.mock('../../src/modules/reports/aeoEngines.js', () => ({
  CORE_ENGINE_IDS: ['claude'],
  ALL_ENGINES: [{ id: 'claude', label: 'Claude', isConfigured: () => true }]
}));
vi.mock('../../src/modules/reports/grounding.js', () => ({
  groundClientForAeo: vi.fn(async (c) => ({ client: c }))
}));
vi.mock('../../src/modules/reports/gridProfile.js', () => ({
  buildGoldProbesForClient: vi.fn(async () => [])
}));
vi.mock('../../src/modules/reports/aeoProbes.js', () => ({
  parseProbes: () => [], migrateClientProbes: (c) => c, addProbes: (a) => a, probesToProbeList: () => []
}));
vi.mock('../../src/modules/technical/googleAuth.js', () => ({
  SCOPES: {
    gsc: 'https://www.googleapis.com/auth/webmasters.readonly',
    ga4: 'https://www.googleapis.com/auth/analytics.readonly'
  },
  TOKEN_EVENT: 'syte-google-token-changed',
  getToken: () => mockToken,
  getCurrentEmail: () => 'ops@syte.co.za',
  getTokenForEmail: vi.fn(async () => mockToken),
  ensureToken: vi.fn(async () => mockToken),
  silentRefresh: vi.fn(async () => mockToken),
  switchAccount: vi.fn(async () => mockToken)
}));
const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

let mockFetchedData;
vi.mock('../../src/modules/reports/reportData.js', () => ({
  fetchReportData: vi.fn(async () => mockFetchedData)
}));

vi.mock('../../src/modules/reports/aeoRunner.js', () => ({
  snapshotPreflight: () => ({ canRun: true }),
  runSnapshot: vi.fn(async () => ({
    visibility_score: 40, detection_rate: 50, top3_rate: 10,
    mentions: 4, citations: 2, sentiment_score: 70,
    engines_used: ['chatgpt'], queries_count: 2, per_query: [{ query: 'q', mentioned: true }]
  }))
}));

vi.mock('../../src/modules/reports/ReportDashboard.jsx', () => ({
  default: () => <div data-testid="dashboard" />
}));

let mockClient;
vi.mock('../../src/store/useClients.js', () => ({
  useClients: (selector) => selector({
    clients: [mockClient],
    current: () => mockClient,
    select: vi.fn()
  })
}));

import MonthlyReport from '../../src/modules/reports/MonthlyReport.jsx';

// The report month always defaults to the previous month.
function previousMonthKey() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}
function goodData() {
  const m = previousMonthKey();
  return {
    version: 3,
    clientType: 'lead_gen',
    period: { current: { startDate: m + '-01', endDate: m + '-28' } },
    // Six head-terms: the SEO gate only needs one row with impressions, but
    // the AEO gate needs MIN_GROUNDING_KEYWORDS (5) to call it grounding.
    keywords: Array.from({ length: 6 }, (_, i) => ({
      query: 'shelving ' + i, position: 3 + i, clicks: 40 - i, impressions: 900 - i * 10, ctr: '4.4%'
    })),
    keywordBuckets: { headTermWins: [], top3: [], top10: [], improved: [], striking: [], branded: [], counts: {} },
    topPages: [{ page: 'https://acme.co.za/s', clicks: 40, impressions: 900, position: 3 }],
    traffic: { current: { users: 100, sessions: 150, conversions: 4 } },
    errors: []
  };
}

beforeEach(() => {
  mockClaudeComplete.mockReset();
  mockClient = {
    id: 'c1', name: 'Acme', does_content: true, does_technical: true, does_aeo: true,
    ga4_property_id: '123', gsc_property: 'sc-domain:acme.co.za'
  };
  mockToken = { access_token: 'tok', scope: GSC_SCOPE + ' ' + GA4_SCOPE };
  mockFetchedData = goodData();
  mockCachedData = null;
});

describe('MonthlyReport — Search Console gate', () => {
  test('offers the SEO and AEO reports as two separate deliverables', async () => {
    render(<MonthlyReport />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Generate SEO Report/i })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Generate AEO Report/i })).toBeInTheDocument();
    // No blended "full report" option remains.
    expect(screen.queryByRole('button', { name: /Full Report/i })).not.toBeInTheDocument();
  });

  test('enables the SEO report when GSC is connected and reading', async () => {
    render(<MonthlyReport />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Generate SEO Report/i })).toBeEnabled();
    });
    expect(screen.getByText(/Search Console connected & reading/)).toBeInTheDocument();
  });

  test('blocks the SEO report when the Google account is not connected', async () => {
    mockToken = null;
    render(<MonthlyReport />);
    await waitFor(() => expect(screen.getByText(/Search Console is not connected/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Blocked — fix Search Console first/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Generate SEO Report/i })).not.toBeInTheDocument();
  });

  test('blocks the SEO report when no GSC property is configured', async () => {
    mockClient = { ...mockClient, gsc_property: '' };
    render(<MonthlyReport />);
    await waitFor(() => expect(screen.getByText(/No Search Console property is set/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Blocked — fix Search Console first/i })).toBeDisabled();
  });

  test('blocks the SEO report when GSC errors out', async () => {
    mockFetchedData = { ...goodData(), errors: ['GSC: 403 does not have sufficient permission'] };
    render(<MonthlyReport />);
    await waitFor(() => expect(screen.getByText(/cannot be trusted/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Blocked — fix Search Console first/i })).toBeDisabled();
  });

  test('blocks the SEO report when GSC returns no rows for the month', async () => {
    mockFetchedData = { ...goodData(), keywords: [], topPages: [] };
    render(<MonthlyReport />);
    await waitFor(() => expect(screen.getByText(/returned no clicks or impressions/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Blocked — fix Search Console first/i })).toBeDisabled();
  });

  test('a blocked SEO report never calls the model', async () => {
    mockToken = null;
    render(<MonthlyReport />);
    const btn = await screen.findByRole('button', { name: /Blocked — fix Search Console first/i });
    await userEvent.click(btn);
    expect(mockClaudeComplete).not.toHaveBeenCalled();
  });

  // The AEO gate asks a different question to the SEO one: not "is Google
  // connected?" but "is there Search Console data on file to ground the probe
  // grid?". A broken connection with data already cached still generates; no
  // data at all does not, however healthy the connection.
  test('the AEO report runs on data already on file even when the Google connection is broken', async () => {
    mockToken = null;
    // Stamped to match the client, so the cache is accepted rather than
    // refetched — the live pull can't run without a token, which is the point.
    mockCachedData = {
      ...goodData(),
      ga4_property_id: '123',
      gsc_property: 'sc-domain:acme.co.za',
      ga4_account_email: null,
      gsc_account_email: null
    };
    render(<MonthlyReport />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Generate AEO Report/i })).toBeEnabled();
    });
    // ...while the SEO report, which needs the connection itself, is blocked.
    expect(screen.getByRole('button', { name: /Blocked — fix Search Console first/i })).toBeDisabled();
  });

  test('blocks the AEO report when no Search Console data is on file', async () => {
    mockFetchedData = { ...goodData(), keywords: [], topPages: [] };
    render(<MonthlyReport />);
    await waitFor(() => expect(screen.getByText(/No Search Console data to ground the probe grid/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Blocked — no Search Console data/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Generate AEO Report/i })).not.toBeInTheDocument();
  });

  test('blocks the AEO report when there are too few head-terms to ground on', async () => {
    mockFetchedData = { ...goodData(), keywords: goodData().keywords.slice(0, 2) };
    render(<MonthlyReport />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Blocked — no Search Console data/i })).toBeDisabled());
  });

  test('a blocked AEO report never calls the model', async () => {
    mockFetchedData = { ...goodData(), keywords: [], topPages: [] };
    render(<MonthlyReport />);
    const btn = await screen.findByRole('button', { name: /Blocked — no Search Console data/i });
    await userEvent.click(btn);
    expect(mockClaudeComplete).not.toHaveBeenCalled();
  });

  test('an imported Search Console export unblocks the AEO report with no connection at all', async () => {
    mockClient = { ...mockClient, gsc_property: '', ga4_property_id: '' };
    mockToken = null;
    mockFetchedData = { ...goodData(), source: 'csv-import', imported_at: '2026-09-01T10:00:00.000Z' };
    render(<MonthlyReport />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Generate AEO Report/i })).toBeEnabled();
    });
    expect(screen.getByText(/Grounded on imported Search Console data/)).toBeInTheDocument();
  });

  test('offering the import card is what a blocked AEO report leads with', async () => {
    mockClient = { ...mockClient, gsc_property: '' };
    mockFetchedData = { ...goodData(), keywords: [], topPages: [] };
    render(<MonthlyReport />);
    await waitFor(() => expect(screen.getByText(/No Search Console connection\? Import the export instead/)).toBeInTheDocument());
  });
});
