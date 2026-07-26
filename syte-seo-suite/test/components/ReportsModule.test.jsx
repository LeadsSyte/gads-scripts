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
vi.mock('../../src/lib/supabase.js', () => ({
  listSentReports: (...a) => mockListSent(...a),
  listGeneratedReports: (...a) => mockListGenerated(...a)
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

// Helper: produce a YYYY-MM key for last month in the same way ReportsModule does.
function previousMonthKey() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

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
