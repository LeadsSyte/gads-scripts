// "Send to Grok bot" on a technical fix or AEO addition: sends the item,
// shows where the job is, and offers Undo once the bot has done it.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';

let mockRows;
vi.mock('../../src/lib/supabase.js', () => {
  const query = () => {
    let match = () => false;
    const q = {
      select: () => q,
      like: (_c, pattern) => { const prefix = pattern.replace(/%$/, ''); match = r => r.id.startsWith(prefix); return q; },
      then: (resolve) => resolve({ data: mockRows.filter(match) })
    };
    return q;
  };
  return { supabase: { from: () => query() } };
});
vi.mock('../../src/modules/cms/proxyAuth.js', () => ({ proxyAuthHash: async () => 'hash' }));

import GrokBotButton from '../../src/components/GrokBotButton.jsx';

let n = 0;
const client = () => ({ id: 'c' + (++n), name: 'Krost' }); // a new id per test: the job list is cached per client
const job = (c, extra) => ({ id: 'grokjob:' + c.id + ':j1', data: { job_id: 'j1', kind: 'tech', ref: { task_id: 't1' }, status: 'queued', requested_at: '2026-11-12T12:00:00Z', requested_by: 'the suite', changes: [], ...extra } });

beforeEach(() => { mockRows = []; global.fetch = vi.fn(); });

describe('GrokBotButton', () => {
  test('sends the item to the bot and then shows it is waiting', async () => {
    const c = client();
    global.fetch.mockImplementation(async () => { mockRows = [job(c)]; return { ok: true, status: 201, json: async () => ({}) }; });
    render(<GrokBotButton client={c} kind="tech" taskId="t1" primary />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send to Grok bot' }));
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/v1/clients/' + c.id + '/grok-jobs');
    expect(JSON.parse(init.body)).toEqual({ kind: 'tech', taskId: 't1' });
    expect(init.headers['X-Suite-Auth']).toBe('hash');
    await waitFor(() => expect(screen.getByText(/Waiting for the Grok bot/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Send to Grok bot/ })).toBeNull();
  });

  test('a finished job shows what changed and can be undone', async () => {
    const c = client();
    mockRows = [job(c, { status: 'done', finished_at: '2026-11-12T12:30:00Z', note: 'Added the heading.', changes: [{ url: 'https://krost.example/news/', what: 'Added the H1 "Latest News"' }] })];
    global.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    render(<GrokBotButton client={c} kind="tech" taskId="t1" />);
    expect(await screen.findByText(/Done on the site by the Grok bot/)).toBeTruthy();
    expect(screen.getByText(/Added the H1 "Latest News"/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Undo via Grok bot' }));
    expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/grok-jobs/j1/undo');
  });

  test('a job the bot could not do says why and can be sent again; refusals are shown', async () => {
    const c = client();
    mockRows = [job(c, { status: 'skipped', finished_at: '2026-11-12T12:30:00Z', note: 'The saved login was rejected.' })];
    global.fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'The independent check thinks this fix is wrong.' }) });
    render(<GrokBotButton client={c} kind="tech" taskId="t1" />);
    expect(await screen.findByText(/skipped this.*The saved login was rejected/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Send to Grok bot again' }));
    expect(await screen.findByText('The independent check thinks this fix is wrong.')).toBeTruthy();
  });

  test('AEO additions are matched by page and key', async () => {
    const c = client();
    mockRows = [{ id: 'grokjob:' + c.id + ':j2', data: { job_id: 'j2', kind: 'aeo', ref: { url: 'https://x/a/', opt_key: 'content::Table' }, status: 'claimed', claimed_at: '2026-11-12T12:10:00Z', requested_at: '2026-11-12T12:00:00Z' } }];
    render(<GrokBotButton client={c} kind="aeo" url="https://x/a/" optKey="content::Table" />);
    expect(await screen.findByText(/The Grok bot is working on it/)).toBeTruthy();
  });
});
