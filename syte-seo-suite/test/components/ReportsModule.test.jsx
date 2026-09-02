// Component test for ReportsModule. Locks in the "Generated / Sent /
// Pending" bucketing of client cards we just added — and guards the
// click → MonthlyReport navigation that's the whole entry point.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock Supabase access functions.
const mockListSent = vi.fn();
const mockListGenerated = vi.fn();
const mockLogSent = vi.fn();
vi.mock('../../src/lib/supabase.js', () => ({
  listSentReports: (...a) => mockListSent(...a),
  listGeneratedReports: (...a) => mockListGenerated(...a),
  logReportSent: (...a) => mockLogSent(...a)
}));

// Mock the heavy children — they have their own tests; here we just
// confirm ReportsModule routes correctly when their sub views activate.
vi.mock('../../src/modules/reports/AEOSnapshot.jsx', () => ({
  default: () => <div data-testid="aeo-snapshot">AEO Snapshot Module</div>
}));
vi.mock('../../src/modules/reports/ReportsHistory.jsx', () => ({
  default: () => <div data-testid="reports-history">History Module</div>
}));
vi.mock('../../src/modules/reports/MonthlyReport.jsx', () => ({
  default: () => <div data-testid="monthly-report">Monthly Report Module</div>
}));

let mockClients;
let mockSelect;
vi.mock('../../src/store/useClients.js', () => ({
  useClients: (selector) => selector({
    clients: mockClients,
    select: mockSelect,
    selectedId: null
  })
}));

import ReportsModule from '../../src/modules/reports/ReportsModule.jsx';

// The same helper ReportsModule uses, so the test can't drift from the app's
// idea of which month the board defaults to.
import { previousMonthKey, shiftMonthKey, monthKeyLabel } from '../../src/modules/reports/reportMonths.js';

beforeEach(() => {
  mockListSent.mockReset();
  mockListGenerated.mockReset();
  mockSelect = vi.fn();
});

describe('ReportsModule', () => {
  test('routes to AEO Snapshot sub-view', () => {
    mockClients = [];
    mockListSent.mockResolvedValue([]);
    mockListGenerated.mockResolvedValue([]);
    render(<ReportsModule sub="AEO Snapshot" />);
    expect(screen.getByTestId('aeo-snapshot')).toBeInTheDocument();
  });

  test('routes to History sub-view', () => {
    mockClients = [];
    mockListSent.mockResolvedValue([]);
    mockListGenerated.mockResolvedValue([]);
    render(<ReportsModule sub="History" />);
    expect(screen.getByTestId('reports-history')).toBeInTheDocument();
  });

  test('shows Pending status for clients with no report', async () => {
    mockClients = [{ id: 'c1', name: 'Acme', does_content: true, does_technical: true, does_aeo: true }];
    mockListSent.mockResolvedValue([]);
    mockListGenerated.mockResolvedValue([]);
    render(<ReportsModule sub="Monthly Report" />);
    expect(screen.getByText(/Acme/)).toBeInTheDocument();
    // 'Pending' appears as a section header AND a card badge — assert ≥1.
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    // The button for a pending client offers to generate.
    expect(screen.getByRole('button', { name: /Generate Report/i })).toBeInTheDocument();
  });

  test('shows Generated status when report has been built but not sent', async () => {
    const month = previousMonthKey();
    mockClients = [{ id: 'c1', name: 'Acme' }];
    mockListSent.mockResolvedValue([]);
    mockListGenerated.mockResolvedValue([{ client_id: 'c1', month, generated_at: new Date().toISOString(), report_type: 'full' }]);
    render(<ReportsModule sub="Monthly Report" />);
    await waitFor(() => expect(screen.getAllByText('Generated').length).toBeGreaterThan(0));
    expect(screen.getByText(/Generated — awaiting send/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review & Send/i })).toBeInTheDocument();
  });

  test('shows Sent status when a report has been logged sent', async () => {
    const month = previousMonthKey();
    mockClients = [{ id: 'c1', name: 'Acme' }];
    mockListSent.mockResolvedValue([{ client_id: 'c1', month, sent_date: new Date().toISOString(), qa_score: 9 }]);
    mockListGenerated.mockResolvedValue([]);
    render(<ReportsModule sub="Monthly Report" />);
    await waitFor(() => expect(screen.getAllByText('Sent').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /Regenerate Report/i })).toBeInTheDocument();
  });

  test('Sent status takes precedence over Generated for the same client+month', async () => {
    const month = previousMonthKey();
    mockClients = [{ id: 'c1', name: 'Acme' }];
    mockListSent.mockResolvedValue([{ client_id: 'c1', month, sent_date: new Date().toISOString() }]);
    mockListGenerated.mockResolvedValue([{ client_id: 'c1', month, generated_at: new Date().toISOString(), report_type: 'full' }]);
    render(<ReportsModule sub="Monthly Report" />);
    await waitFor(() => expect(screen.getAllByText('Sent').length).toBeGreaterThan(0));
    // The "Generated — awaiting send" SECTION should not render at all
    // when the only client is in the Sent bucket. (The Sent card badge
    // says 'Sent', not 'Generated'.)
    expect(screen.queryByText(/Generated — awaiting send/)).not.toBeInTheDocument();
  });

  test('every client card offers a "Mark emailed" action, even a pending one', async () => {
    mockClients = [{ id: 'c1', name: 'Acme' }];
    mockListSent.mockResolvedValue([]);
    mockListGenerated.mockResolvedValue([]);
    render(<ReportsModule sub="Monthly Report" />);
    expect(screen.getByRole('button', { name: /Mark emailed/i })).toBeInTheDocument();
  });

  test('a manually-emailed report with proof shows Emailed + PDF badges', async () => {
    const month = previousMonthKey();
    mockClients = [{ id: 'c1', name: 'Acme' }];
    mockListSent.mockResolvedValue([
      { client_id: 'c1', month, sent_date: new Date().toISOString(), manual: true, pdf_filename: 'acme-report.pdf' }
    ]);
    mockListGenerated.mockResolvedValue([]);
    render(<ReportsModule sub="Monthly Report" />);
    await waitFor(() => expect(screen.getAllByText('Emailed').length).toBeGreaterThan(0));
    expect(screen.getByText('PDF')).toBeInTheDocument();
    // A manual send still counts as sent → regenerate is offered.
    expect(screen.getByRole('button', { name: /Regenerate Report/i })).toBeInTheDocument();
  });


  test('a newer report for another month does not hide this month\'s', async () => {
    // Regression: the board took each client's globally-newest generated row
    // and dropped the client to Pending when that row was for another month —
    // so a report generated for August disappeared the moment a September one
    // existed.
    const month = previousMonthKey();
    const later = shiftMonthKey(month, 1);
    mockClients = [{ id: 'c1', name: 'Acme' }];
    mockListSent.mockResolvedValue([]);
    mockListGenerated.mockResolvedValue([
      { client_id: 'c1', month: later, generated_at: '2030-01-02T00:00:00Z', report_type: 'seo' },
      { client_id: 'c1', month, generated_at: '2029-01-01T00:00:00Z', report_type: 'seo' }
    ]);
    render(<ReportsModule sub="Monthly Report" />);
    await waitFor(() => expect(screen.getByText(/Generated — awaiting send/)).toBeInTheDocument());
  });

  test('points at the months that do have reports when this one has none', async () => {
    const other = shiftMonthKey(previousMonthKey(), -3);
    mockClients = [{ id: 'c1', name: 'Acme' }];
    mockListSent.mockResolvedValue([]);
    mockListGenerated.mockResolvedValue([
      { client_id: 'c1', month: other, generated_at: new Date().toISOString(), report_type: 'seo' }
    ]);
    render(<ReportsModule sub="Monthly Report" />);
    // The hint names the month the reports were actually logged under...
    const link = await screen.findByRole('link', { name: monthKeyLabel(other) });
    // ...and switching to it surfaces them.
    await userEvent.click(link);
    await waitFor(() => expect(screen.getByText(/Generated — awaiting send/)).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: new RegExp(monthKeyLabel(other)) })).toBeInTheDocument();
  });

  test('surfaces a failed status read instead of showing everyone as pending', async () => {
    mockClients = [{ id: 'c1', name: 'Acme' }];
    mockListSent.mockRejectedValue(new Error('relation does not exist'));
    mockListGenerated.mockResolvedValue([]);
    render(<ReportsModule sub="Monthly Report" />);
    expect(await screen.findByText(/Could not load report status: relation does not exist/)).toBeInTheDocument();
  });

  test('clicking a pending client card calls select(client.id) and shows Monthly Report', async () => {
    mockClients = [{ id: 'c1', name: 'Acme' }];
    mockListSent.mockResolvedValue([]);
    mockListGenerated.mockResolvedValue([]);
    render(<ReportsModule sub="Monthly Report" />);
    await userEvent.click(screen.getByRole('button', { name: /Generate Report/i }));
    expect(mockSelect).toHaveBeenCalledWith('c1');
    expect(screen.getByTestId('monthly-report')).toBeInTheDocument();
  });
});
