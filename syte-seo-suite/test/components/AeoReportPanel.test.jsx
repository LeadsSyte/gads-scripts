// The AEO Report Autopilot panel: warns about the cost before starting,
// calls the AEO function (not the SEO one), shows progress, and offers to
// carry on a run that stopped part-way.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';

let mockRows;
const mockUpdate = vi.fn().mockResolvedValue({});
vi.mock('../../src/lib/supabase.js', () => {
  const query = () => {
    let match = () => false;
    const q = {
      select: () => q,
      eq: (_c, id) => { match = r => r.id === id; return q; },
      maybeSingle: async () => ({ data: mockRows.find(match) || null })
    };
    return q;
  };
  return { supabase: { from: () => query() }, updateClientFields: (...a) => mockUpdate(...a) };
});
vi.mock('../../src/modules/cms/proxyAuth.js', () => ({ proxyAuthHash: async () => 'hash' }));
vi.mock('../../src/modules/cms/previewLink.js', () => ({ signedFnUrl: async (fn, kind, id) => 'https://suite.example/' + fn + '?' + kind + '=' + id }));
vi.mock('../../src/store/useClients.js', () => ({ useClients: (selector) => selector({ load: vi.fn() }) }));

import ReportAutopilotPanel from '../../src/modules/reports/ReportAutopilotPanel.jsx';

const CLIENT = { id: 'c1', name: 'Acme', publishing_profile: {} };
const minsAgo = m => new Date(Date.now() - m * 60000).toISOString();

beforeEach(() => {
  mockRows = [];
  mockUpdate.mockClear();
  global.fetch = vi.fn(async () => ({ status: 202 }));
});

describe('AEO Report Autopilot panel', () => {
  test('warns that it costs money and starts the AEO run for the chosen month', async () => {
    render(<ReportAutopilotPanel kind="aeo" client={CLIENT} month="2026-09" />);
    expect(screen.getByText(/AEO Report Autopilot · Acme/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Build on the server' }));
    expect(screen.getByText(/costs API money/)).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Keep it (skip)' }));
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/.netlify/functions/aeoreport-run-background');
    expect(JSON.parse(init.body)).toEqual({ clientId: 'c1', month: '2026-09', force: false });
  });

  test('shows how far a running census has got', async () => {
    mockRows = [{ id: 'aeoreport:c1', data: { client_id: 'c1', month: '2026-09', status: 'probing', stage: 'probing', prompts: 120, progress: { groups_done: 140 }, updated_at: minsAgo(2), log: [] } }];
    render(<ReportAutopilotPanel kind="aeo" client={CLIENT} month="2026-09" />);
    await screen.findByText('Asking the AI engines…');
    expect(screen.getByText(/120 prompts · 140 prompt\/engine pairs measured so far/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Build on the server|Carry on/ })).toBeNull();
  });

  test('a run that went quiet can be carried on', async () => {
    mockRows = [{ id: 'aeoreport:c1', data: { client_id: 'c1', month: '2026-09', status: 'probing', stage: 'probing', updated_at: minsAgo(40), log: [] } }];
    render(<ReportAutopilotPanel kind="aeo" client={CLIENT} month="2026-09" />);
    await screen.findByText('Stopped part-way');
    expect(screen.getByRole('button', { name: 'Carry on' })).toBeTruthy();
    expect(screen.getByText(/nothing already measured is asked again/)).toBeTruthy();
  });

  test('a finished report shows what was measured and the accuracy check', async () => {
    mockRows = [{ id: 'aeoreport:c1', data: { client_id: 'c1', month: '2026-09', status: 'done', qa_score: 9, updated_at: minsAgo(1),
      check: { verdict: 'issues', issues: [{ severity: 'error', issue: 'Says visibility grew 45%.' }] },
      summary: { prompts: 120, named_in: 31, answers: 1080, engines: ['chatgpt', 'claude', 'gemini'], compared_with: '2026-08' }, engine_notes: ['Gemini failed on 50% of calls'] } }];
    render(<ReportAutopilotPanel kind="aeo" client={CLIENT} month="2026-09" />);
    await screen.findByText(/Named in 31 of 120 prompts · 1080 answers from chatgpt, claude, gemini · compared with August 2026/);
    expect(screen.getByText('Says visibility grew 45%.')).toBeTruthy();
    expect(screen.getByText('Gemini failed on 50% of calls')).toBeTruthy();
  });

  test('the monthly switch saves the AEO flag; the SEO panel still uses its own', async () => {
    const { unmount } = render(<ReportAutopilotPanel kind="aeo" client={CLIENT} month="2026-09" />);
    await userEvent.click(screen.getByLabelText(/AEO report automatically on the 6th/));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][1].publishing_profile.aeo_reports_enabled).toBe(true);
    unmount();
    render(<ReportAutopilotPanel client={CLIENT} month="2026-09" />);
    await userEvent.click(screen.getByRole('button', { name: 'Build on the server' }));
    await userEvent.click(screen.getByRole('button', { name: 'Replace it' }));
    expect(global.fetch.mock.calls[0][0]).toBe('/.netlify/functions/report-run-background');
  });
});
