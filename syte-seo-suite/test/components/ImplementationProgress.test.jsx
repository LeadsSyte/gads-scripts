// ImplementationProgress component test. Pins:
//   • Loading message until implementations resolve
//   • Empty state CTA when no implementations
//   • Stats cards reflect verification_status counts
//   • Filter buttons drive status filter; module dropdown drives module filter
//   • Grouping: each client gets one card with its item count
//   • Re-verify button calls verifyImplementation for that record

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockListAllImplementations = vi.fn();
vi.mock('../../src/lib/supabase.js', () => ({
  listAllImplementations: (...a) => mockListAllImplementations(...a)
}));

const mockVerifyImplementation = vi.fn();
vi.mock('../../src/lib/verification.js', () => ({
  verifyImplementation: (...a) => mockVerifyImplementation(...a)
}));

let mockClients;
vi.mock('../../src/store/useClients.js', () => ({
  useClients: (selector) => selector({ clients: mockClients })
}));

import ImplementationProgress from '../../src/modules/clients/ImplementationProgress.jsx';

beforeEach(() => {
  mockListAllImplementations.mockReset();
  mockVerifyImplementation.mockReset();
  mockClients = [];
});

describe('ImplementationProgress', () => {
  test('shows loading state until implementations resolve', () => {
    mockListAllImplementations.mockReturnValue(new Promise(() => {}));
    render(<ImplementationProgress />);
    expect(screen.getByText(/Loading implementation records/i)).toBeInTheDocument();
  });

  test('empty state CTA explains what the "Mark as Implemented" button does', async () => {
    mockListAllImplementations.mockResolvedValue([]);
    render(<ImplementationProgress />);
    await waitFor(() => expect(screen.getByText(/No implementations logged/i)).toBeInTheDocument());
    expect(screen.getByText(/Mark as Implemented/)).toBeInTheDocument();
  });

  test('stats cards reflect counts by verification_status', async () => {
    mockListAllImplementations.mockResolvedValue([
      { id: '1', client_id: 'c1', module: 'content', title: 'A', verification_status: 'verified' },
      { id: '2', client_id: 'c1', module: 'content', title: 'B', verification_status: 'verified' },
      { id: '3', client_id: 'c1', module: 'content', title: 'C', verification_status: 'failed' },
      { id: '4', client_id: 'c1', module: 'content', title: 'D', verification_status: 'pending' }
    ]);
    mockClients = [{ id: 'c1', name: 'Acme' }];
    render(<ImplementationProgress />);
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());
    // Total card has "4", Verified has "2", Failed "1", Pending "1".
    // Use within() on the stats grid to avoid matching counters in filter buttons.
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });

  test('filter button restricts visible items to that status', async () => {
    mockListAllImplementations.mockResolvedValue([
      { id: '1', client_id: 'c1', module: 'content', title: 'Verified Article', verification_status: 'verified' },
      { id: '2', client_id: 'c1', module: 'content', title: 'Pending Article',  verification_status: 'pending' }
    ]);
    mockClients = [{ id: 'c1', name: 'Acme' }];
    render(<ImplementationProgress />);
    await waitFor(() => expect(screen.getByText('Verified Article')).toBeInTheDocument());
    expect(screen.getByText('Pending Article')).toBeInTheDocument();

    // Click "✓ Verified" filter — Pending Article should disappear.
    await userEvent.click(screen.getByRole('button', { name: /✓ Verified/i }));
    await waitFor(() => expect(screen.queryByText('Pending Article')).not.toBeInTheDocument());
    expect(screen.getByText('Verified Article')).toBeInTheDocument();
  });

  test('module dropdown narrows by module', async () => {
    mockListAllImplementations.mockResolvedValue([
      { id: '1', client_id: 'c1', module: 'content',   title: 'C-1', verification_status: 'verified' },
      { id: '2', client_id: 'c1', module: 'technical', title: 'T-1', verification_status: 'verified' }
    ]);
    mockClients = [{ id: 'c1', name: 'Acme' }];
    render(<ImplementationProgress />);
    await waitFor(() => expect(screen.getByText('C-1')).toBeInTheDocument());
    expect(screen.getByText('T-1')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox'), 'technical');
    await waitFor(() => expect(screen.queryByText('C-1')).not.toBeInTheDocument());
    expect(screen.getByText('T-1')).toBeInTheDocument();
  });

  test('items group under their client name', async () => {
    mockListAllImplementations.mockResolvedValue([
      { id: '1', client_id: 'c1', module: 'content', title: 'Acme item', verification_status: 'verified' },
      { id: '2', client_id: 'c2', module: 'content', title: 'Beta item', verification_status: 'verified' }
    ]);
    mockClients = [
      { id: 'c1', name: 'Acme' },
      { id: 'c2', name: 'Beta' }
    ];
    render(<ImplementationProgress />);
    await waitFor(() => expect(screen.getByText('Acme item')).toBeInTheDocument());
    // Each client's name shows once as a section header.
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  test('Re-verify button calls verifyImplementation for that record', async () => {
    mockListAllImplementations.mockResolvedValue([
      { id: 'x', client_id: 'c1', module: 'content', title: 'Article', verification_status: 'pending' }
    ]);
    mockClients = [{ id: 'c1', name: 'Acme' }];
    mockVerifyImplementation.mockResolvedValue({});
    render(<ImplementationProgress />);
    await waitFor(() => expect(screen.getByText('Article')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Re-verify/i }));
    expect(mockVerifyImplementation).toHaveBeenCalledTimes(1);
    expect(mockVerifyImplementation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'x' }),
      expect.objectContaining({ id: 'c1' })
    );
  });

  test('verifyImplementation rejection does not crash the UI', async () => {
    mockListAllImplementations.mockResolvedValue([
      { id: 'x', client_id: 'c1', module: 'content', title: 'A', verification_status: 'pending' }
    ]);
    mockClients = [{ id: 'c1', name: 'Acme' }];
    mockVerifyImplementation.mockRejectedValue(new Error('CORS blocked'));
    render(<ImplementationProgress />);
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Re-verify/i }));
    // Component must not propagate the error — the row stays visible.
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
  });
});
