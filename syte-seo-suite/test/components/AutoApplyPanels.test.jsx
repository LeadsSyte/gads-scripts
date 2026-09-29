// The Tech and AEO Autopilot panels: "Apply all" asks before it touches the
// live site, the automatic switch saves to the client's profile, and an
// applied fix shows what changed with an Undo button.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';

let mockRows; // id → data, as stored in syte_suite_settings
const mockUpdate = vi.fn().mockResolvedValue({});
vi.mock('../../src/lib/supabase.js', () => {
  const query = (match) => {
    const q = {
      select: () => q,
      eq: (_c, id) => { match = r => r.id === id; return q; },
      like: (_c, pattern) => { const prefix = pattern.replace(/%$/, ''); match = r => r.id.startsWith(prefix); return q; },
      maybeSingle: async () => ({ data: mockRows.find(match) || null }),
      then: (resolve) => resolve({ data: mockRows.filter(match) })
    };
    return q;
  };
  return { supabase: { from: () => query(() => false) }, updateClientFields: (...a) => mockUpdate(...a) };
});
vi.mock('../../src/modules/cms/proxyAuth.js', () => ({ proxyAuthHash: async () => 'hash' }));
vi.mock('../../src/components/FixSheetButtons.jsx', () => ({ default: () => null }));

let mockClient;
vi.mock('../../src/store/useClients.js', () => ({
  useClients: (selector) => selector({ clients: [mockClient], current: () => mockClient, load: vi.fn() })
}));

import TechAutopilotPanel from '../../src/modules/technical/TechAutopilotPanel.jsx';
import AeoAutopilotPanel from '../../src/modules/aeo/AeoAutopilotPanel.jsx';

const task = (id, title, verdict = 'confirmed', fix_type = 'meta_title') => ({
  task: { id, title, fix_type, page_url: 'https://krost.example/' + id + '/' }, check: { verdict, reason: 'Reason ' + id }
});

beforeEach(() => {
  mockUpdate.mockClear();
  mockClient = { id: 'c1', name: 'Krost Shelving', cms_type: 'WordPress', wp_url: 'https://krost.example', wp_username: 'u', wp_app_password: 'p', publishing_profile: {} };
  global.fetch = vi.fn(async () => ({ status: 202 }));
});

describe('Tech Autopilot panel', () => {
  beforeEach(() => {
    mockRows = [
      { id: 'techscan:c1', data: { client_id: 'c1', status: 'done', tasks: [
        task('t1', 'Fix title one'), task('t2', 'Fix title two'), task('t3', 'Theme heading', 'confirmed', 'heading'), task('t4', 'Dropped', 'false_alarm')
      ] } },
      { id: 'techfix:c1:t2', data: { task_id: 't2', status: 'applied', live: { status: 'verified' }, results: [{ ok: true, label: 'SEO title', from: 'Old title –', to: 'New title | Krost' }] } }
    ];
  });

  test('Apply all counts only what is left, and asks before changing the live site', async () => {
    render(<TechAutopilotPanel accent="#0f0" />);
    const all = await screen.findByRole('button', { name: 'Apply all 1 on the website' });
    await userEvent.click(all);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/live website now\? Each one can be undone afterwards/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, apply all' }));
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/.netlify/functions/techfix-background');
    expect(JSON.parse(init.body)).toEqual({ clientId: 'c1', action: 'auto_all' });
    await screen.findByText(/Making the fixes on the website/);
  });

  test('an applied fix shows was → now and can be undone', async () => {
    render(<TechAutopilotPanel accent="#0f0" />);
    await screen.findByText(/Applied and live on the page/);
    expect(screen.getByText(/Was: “Old title –” → Now: “New title \| Krost”/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ clientId: 'c1', taskId: 't2', action: 'undo' });
  });

  test('the automatic switch is off by default and saves to the client profile', async () => {
    render(<TechAutopilotPanel accent="#0f0" />);
    const box = await screen.findByLabelText(/make the checked fixes on the website without waiting for approval/);
    expect(box.checked).toBe(false);
    await userEvent.click(box);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][1].publishing_profile.techfix_auto).toBe(true);
  });

  test('without a WordPress connection nothing can be applied', async () => {
    mockClient = { ...mockClient, wp_app_password: '' };
    render(<TechAutopilotPanel accent="#0f0" />);
    await screen.findByText('Fix title one');
    expect(screen.queryByRole('button', { name: /Apply all/ })).toBeNull();
    expect(screen.getByLabelText(/without waiting for approval/).disabled).toBe(true);
  });
});

describe('AEO Autopilot panel', () => {
  const opt = (name, verdict = 'confirmed', type = 'content') => ({ name, type, check: { verdict, reason: 'Reason' } });
  beforeEach(() => {
    mockRows = [
      { id: 'aeoscan:c1', data: { client_id: 'c1', status: 'done', rows: [
        { url: 'https://krost.example/a/', optimizations: [opt('FAQ section'), opt('Answer block'), opt('Dropped', 'false_alarm'), opt('Rename heading', 'confirmed', 'structure')] }
      ] } },
      { id: 'aeofix:c1:k1', data: { url: 'https://krost.example/a/', opt_key: 'content::Answer block', key: 'k1', status: 'manual', reason: 'Page builder.' } }
    ];
  });

  test('Add all counts only sections still to add, and asks first', async () => {
    render(<AeoAutopilotPanel accent="#0f0" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add all 1 to the website' }));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/Visitors will see it/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, add all' }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ clientId: 'c1', action: 'auto_all' });
  });

  test('switching on automatic adding warns that it puts new wording on live pages', async () => {
    mockClient = { ...mockClient, publishing_profile: { aeofix_auto: true } };
    render(<AeoAutopilotPanel accent="#0f0" />);
    expect((await screen.findByLabelText(/add the checked sections to the website without waiting for approval/)).checked).toBe(true);
    expect(screen.getByText(/new AI-written wording on the client's live pages/)).toBeTruthy();
  });
});
