// Component test for MonthlyReport. Locks in the two guarantees the SEO /
// AEO split depends on:
//   1. The SEO report cannot be generated unless Search Console is
//      connected AND returning real data for the report month.
//   2. SEO and AEO are offered as two separate deliverables, and the AEO
//      report is not held hostage by the Search Console gate.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockClaudeComplete = vi.fn();
let mockEarlierProbe = vi.fn(async () => null);
vi.mock('../../src/lib/anthropic.js', () => ({
  claudeComplete: (...a) => mockClaudeComplete(...a),
  extractJSON: (t) => { try { return JSON.parse(t); } catch { return null; } }
}));

vi.mock('../../src/lib/supabase.js', () => ({
  // No database: the Report Autopilot box on this page shows nothing.
  supabase: null,
  updateClientFields: vi.fn().mockResolvedValue({}),
  listAeoSnapshots: vi.fn().mockResolvedValue([]),
  latestEarlierAeoProbe: (...a) => mockEarlierProbe(...a),
  logReportSent: vi.fn().mockResolvedValue({}),
  logReportGenerated: vi.fn().mockResolvedValue({}),
  getGeneratedReport: vi.fn().mockResolvedValue(null),
  getCachedReportData: vi.fn().mockResolvedValue(null),
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
    keywords: [{ query: 'shelving', position: 3, clicks: 40, impressions: 900, ctr: '4.4%' }],
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

  test('the AEO report stays available even when Search Console is broken', async () => {
    mockToken = null;
    render(<MonthlyReport />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Generate AEO Report/i })).toBeEnabled();
    });
  });
});

describe('MonthlyReport — AEO month on month', () => {
  const aeoAnswers = ({ system }) => /JSON/.test(system) && /report page|microsite/i.test(system)
    ? '{"headline":"Named in 2 of 4 prompts","summary":"ok"}'
    : /review|QA/i.test(system.slice(0, 300)) ? '{"overallScore": 8}' : 'SUBJECT: Acme in AI answers' + String.fromCharCode(10) + '---' + String.fromCharCode(10) + 'Hi team';
  const payloadOf = () => mockClaudeComplete.mock.calls.map(c => c[0]?.messages?.[0]?.content || '').find(t => /AEO PERFORMANCE REPORT/.test(t)) || '';

  test('with no AEO History, the previous month comes from the last AEO report', async () => {
    mockEarlierProbe = vi.fn(async () => ({ month: '2026-08', visibility_score: 10, detection_rate: 20, top3_rate: 5, mentions: 3, citations: 1, sentiment_score: 50, coverage_rate: 0.2, composite_index: 30, queries_count: 4, per_query: [{ query: 'q' }] }));
    mockClaudeComplete.mockImplementation(async (o) => aeoAnswers(o));
    render(<MonthlyReport />);
    await userEvent.click(await screen.findByRole('button', { name: /Generate AEO Report/i }));
    await waitFor(() => expect(payloadOf()).toMatch(/MONTH-ON-MONTH \(vs August 2026\)/), { timeout: 8000 });
    expect(mockEarlierProbe).toHaveBeenCalledWith('c1', previousMonthKey());
  });

  test('with nothing earlier, the report is framed as the first measurement', async () => {
    mockEarlierProbe = vi.fn(async () => null);
    mockClaudeComplete.mockImplementation(async (o) => aeoAnswers(o));
    render(<MonthlyReport />);
    await userEvent.click(await screen.findByRole('button', { name: /Generate AEO Report/i }));
    await waitFor(() => expect(payloadOf()).toMatch(/first AEO SNAPSHOT/), { timeout: 8000 });
  });
});
