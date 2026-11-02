// Technical SEO → Own Fixes: notes in, applicable items out, saved to the
// board / AEO results, with the apply controls on each.

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';

const claudeComplete = vi.fn();
vi.mock('../../src/lib/anthropic.js', () => ({
  claudeComplete: (...a) => claudeComplete(...a),
  extractJSON: (t) => { try { return JSON.parse(t); } catch { return null; } }
}));
const saveTseoTasks = vi.fn(async () => {});
const loadTseoTasks = vi.fn(async () => []);
const addAeoOptimizations = vi.fn(async () => {});
vi.mock('../../src/lib/supabase.js', () => ({
  supabase: null,
  saveTseoTasks: (...a) => saveTseoTasks(...a),
  loadTseoTasks: (...a) => loadTseoTasks(...a),
  addAeoOptimizations: (...a) => addAeoOptimizations(...a)
}));
vi.mock('../../src/store/useClients.js', () => ({
  useClients: (selector) => selector({ current: () => ({ id: 'c1', name: 'Krost Shelving', url: 'https://www.krostshelving.com/' }) })
}));
vi.mock('../../src/modules/technical/ApplyFixControls.jsx', () => ({ default: ({ task }) => <div>APPLY-CONTROLS:{task.title}</div> }));
vi.mock('../../src/modules/aeo/AddAeoControls.jsx', () => ({ default: ({ optKey }) => <div>ADD-CONTROLS:{optKey}</div> }));

import OwnFixes from '../../src/modules/technical/OwnFixes.jsx';

const AI_REPLY = JSON.stringify({
  items: [
    { kind: 'fix', fix_type: 'meta_title', page_url: '/about/', title: 'New title on About', copy_paste_fix: '<title>Industrial Shelving & Racking | Krost</title>' },
    { kind: 'addition', page_url: '/racking/', name: 'FAQ section', type: 'content', where: 'end of the content', implementation: '<h2>FAQ</h2><h3>What load can racking take?</h3><p>Most selective racking carries 1,000 to 3,000 kg per level.</p>' },
    { kind: 'fix', fix_type: 'meta_description', page_url: '/about/', copy_paste_fix: 'make it better' }
  ],
  notes: ['Rewording the intro needs a person.']
});

beforeEach(() => { claudeComplete.mockReset().mockResolvedValue(AI_REPLY); saveTseoTasks.mockClear(); addAeoOptimizations.mockClear(); loadTseoTasks.mockClear().mockResolvedValue([]); });

describe('Own Fixes', () => {
  test('notes become items; the vague one is sent back; saving writes the board task and the page addition', async () => {
    render(<OwnFixes />);
    fireEvent.change(screen.getByPlaceholderText(/Examples:/), { target: { value: '/about/ meta title: Industrial Shelving & Racking | Krost\n/racking/ add an FAQ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn into fixes' }));
    await screen.findByText('Ready to save');
    expect(claudeComplete.mock.calls[0][0].messages[0].content).toMatch(/Client: Krost Shelving/);
    expect(screen.getByText('New title on About')).toBeInTheDocument();
    expect(screen.getByText(/FAQ section/)).toBeInTheDocument();
    expect(screen.getByText(/stated plainly/)).toBeInTheDocument();
    expect(screen.getByText(/Rewording the intro needs a person/)).toBeInTheDocument();

    // After saving, the saved list shows them with the apply controls.
    loadTseoTasks.mockResolvedValue([{ id: 't1', client_id: 'c1', data_source: 'Own fixes', title: 'New title on About', fix_type: 'meta_title', page_url: 'https://www.krostshelving.com/about/', copy_paste_fix: '<title>x</title>', created_at: '2026-11-02' }]);
    fireEvent.click(screen.getByRole('button', { name: /Save 2 items for Krost Shelving/ }));
    await waitFor(() => expect(saveTseoTasks).toHaveBeenCalledTimes(1));
    const task = saveTseoTasks.mock.calls[0][0][0];
    expect(task).toMatchObject({ client_id: 'c1', fix_type: 'meta_title', page_url: 'https://www.krostshelving.com/about/', status: 'open', data_source: 'Own fixes' });
    expect(addAeoOptimizations).toHaveBeenCalledWith('c1', 'https://www.krostshelving.com/racking/', [expect.objectContaining({ type: 'content', name: 'FAQ section', own: true })]);
    expect(await screen.findByText(/Saved 1 fix and 1 addition/)).toBeInTheDocument();
    expect(await screen.findByText('APPLY-CONTROLS:New title on About')).toBeInTheDocument();
  });

  test('when nothing can be applied it says so, with the reasons, and offers no save', async () => {
    claudeComplete.mockResolvedValue(JSON.stringify({ items: [{ kind: 'fix', fix_type: 'layout', page_url: '/about/', copy_paste_fix: 'move the sidebar' }], notes: [] }));
    render(<OwnFixes />);
    fireEvent.change(screen.getByPlaceholderText(/Examples:/), { target: { value: 'move the sidebar on about' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn into fixes' }));
    expect(await screen.findByText(/Nothing in those notes can be applied automatically/)).toBeInTheDocument();
    expect(screen.getByText(/Not a kind of fix the suite can apply/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
  });
});
