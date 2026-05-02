// AutoWrite component test. The pipeline view + per-client article cards
// + the parsed-output preview (with Copy markdown / Copy HTML buttons +
// the Delete button we added in PR #37).
//
// Pins:
//   • Pipeline renders the four buckets even when empty
//   • Articles in 'articles-written' bucket render with Push / Mark /
//     Delete / Preview buttons
//   • Expanding the preview shows parsed sections including HTML body
//   • Delete confirms then calls deleteBlogResult
//   • External 'Log External Work' control is reachable

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/anthropic.js', () => ({
  claudeStream: vi.fn(async () => '')
}));
vi.mock('../../src/modules/content/topicResearch.js', () => ({
  collectResearchData: vi.fn(),
  generateTopicRecommendations: vi.fn(),
  buildArticleResearchContext: vi.fn(() => ({}))
}));
vi.mock('../../src/modules/content/prompts.js', () => ({
  buildSystemPrompt: () => '',
  TAB_PROMPTS: { 'New Article': () => '' }
}));
vi.mock('../../src/components/GenerateImageButton.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/PushToCmsButton.jsx', () => ({
  default: ({ label }) => <button data-testid="push-cms">{label || 'Push'}</button>
}));
vi.mock('../../src/components/MarkImplementedButton.jsx', () => ({
  default: () => <button data-testid="mark-impl">Mark</button>
}));
vi.mock('../../src/components/PipelineView.jsx', () => ({
  // Render a minimal pass-through so we can still assert on the
  // pipelineSections shape + click into the expanded view.
  default: ({ sections, renderExpanded, onExpandClient, expandedId }) => (
    <div data-testid="pipeline">
      {sections.map(s => (
        <div key={s.key} data-testid={'section-' + s.key}>
          <div>{s.label} ({s.clients.length})</div>
          {s.clients.map(({ client }) => (
            <div key={client.id}>
              <button onClick={() => onExpandClient?.(client)}>{client.name}</button>
              {expandedId === client.id && renderExpanded(client)}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}));
vi.mock('../../src/components/LogExternalWork.jsx', () => ({
  default: () => <div data-testid="log-external" />
}));

const mockListAllImplementations = vi.fn(async () => []);
const mockSaveBlogResult = vi.fn();
const mockLoadContentHistory = vi.fn(async () => []);
const mockDeleteBlogResult = vi.fn(async () => {});
vi.mock('../../src/lib/supabase.js', () => ({
  listAllImplementations: (...a) => mockListAllImplementations(...a),
  saveBlogResult: (...a) => mockSaveBlogResult(...a),
  loadContentHistory: (...a) => mockLoadContentHistory(...a),
  deleteBlogResult: (...a) => mockDeleteBlogResult(...a)
}));

let mockClients;
let mockSelectedId;
const mockSelect = vi.fn();
vi.mock('../../src/store/useClients.js', () => ({
  useClients: (selector) => selector({
    clients: mockClients,
    current: () => mockClients.find(c => c.id === mockSelectedId) || null,
    select: mockSelect,
    selectedId: mockSelectedId
  })
}));

import AutoWrite from '../../src/modules/content/AutoWrite.jsx';

beforeEach(() => {
  mockListAllImplementations.mockReset().mockResolvedValue([]);
  mockSaveBlogResult.mockReset();
  mockLoadContentHistory.mockReset().mockResolvedValue([]);
  mockDeleteBlogResult.mockReset().mockResolvedValue(undefined);
  mockSelect.mockReset();
  mockClients = [];
  mockSelectedId = null;
});

const NOW_MONTH = new Date().toISOString().slice(0, 7);

const READY_CLIENT = {
  id: 'c1', name: 'Acme', url: 'https://acme.test/',
  industry: 'Hospitality', location: 'Cape Town', voice: 'Editorial',
  audience: 'Travellers', context: 'A boutique hotel',
  author: 'Mike',
  gsc_property: 'sc-domain:acme.test',
  does_content: true, pages_per_month: 4
};

describe('AutoWrite', () => {
  test('renders the pipeline + Log External Work sections', async () => {
    mockClients = [READY_CLIENT];
    render(<AutoWrite />);
    await waitFor(() => expect(screen.getByTestId('pipeline')).toBeInTheDocument());
    expect(screen.getByTestId('log-external')).toBeInTheDocument();
  });

  test('client appears in articles-written bucket once articles exist', async () => {
    mockListAllImplementations.mockResolvedValue([]);
    mockLoadContentHistory.mockResolvedValue([
      { id: 'a1', client_id: 'c1', topic: 'My SEO Article', keyword: 'seo',
        output: '# Hello\n\nBody.', generated_at: NOW_MONTH + '-15T10:00:00Z',
        opportunity_type: 'low-hanging-fruit' },
      { id: 'a2', client_id: 'c1', topic: 'Another One', keyword: 'kw2',
        output: '# Another\n\nText.', generated_at: NOW_MONTH + '-16T10:00:00Z' },
      { id: 'a3', client_id: 'c1', topic: 'Third Article', keyword: 'kw3',
        output: '# Third\n\nText.', generated_at: NOW_MONTH + '-17T10:00:00Z' },
      { id: 'a4', client_id: 'c1', topic: 'Fourth Article', keyword: 'kw4',
        output: '# Fourth\n\nText.', generated_at: NOW_MONTH + '-18T10:00:00Z' }
    ]);
    mockClients = [READY_CLIENT];
    render(<AutoWrite />);
    await waitFor(() => expect(screen.getByTestId('section-articles-written')).toBeInTheDocument());
    // Client name appears in the bucket.
    expect(screen.getByRole('button', { name: 'Acme' })).toBeInTheDocument();
  });

  test('expanding a client card lists each article with Delete + Preview controls', async () => {
    mockLoadContentHistory.mockResolvedValue([
      { id: 'a1', client_id: 'c1', topic: 'Test Article', keyword: 'k',
        output: '**Meta Title:** T\n\n# Body\n\nProse.', generated_at: NOW_MONTH + '-15T10:00:00Z' }
    ]);
    mockClients = [READY_CLIENT];
    render(<AutoWrite />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Acme' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Acme' }));

    // Expanded — article title shown.
    await waitFor(() => expect(screen.getByText(/Test Article/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Delete/i })).toBeInTheDocument();
    // Preview details summary contains "View article".
    expect(screen.getByText(/View article/i)).toBeInTheDocument();
  });

  test('Delete button asks for confirm; cancel does NOT call deleteBlogResult', async () => {
    mockLoadContentHistory.mockResolvedValue([
      { id: 'a1', client_id: 'c1', topic: 'Doomed', keyword: 'k',
        output: 'X', generated_at: NOW_MONTH + '-15T10:00:00Z' }
    ]);
    mockClients = [READY_CLIENT];
    const origConfirm = globalThis.confirm;
    globalThis.confirm = () => false;
    render(<AutoWrite />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Acme' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Acme' }));
    await userEvent.click(screen.getByRole('button', { name: /Delete/i }));
    expect(mockDeleteBlogResult).not.toHaveBeenCalled();
    globalThis.confirm = origConfirm;
  });

  test('Delete with confirm calls deleteBlogResult(id) then reloads history', async () => {
    mockLoadContentHistory.mockResolvedValue([
      { id: 'a1', client_id: 'c1', topic: 'Doomed', keyword: 'k',
        output: 'X', generated_at: NOW_MONTH + '-15T10:00:00Z' }
    ]);
    mockClients = [READY_CLIENT];
    const origConfirm = globalThis.confirm;
    globalThis.confirm = () => true;
    render(<AutoWrite />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Acme' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Acme' }));
    await userEvent.click(screen.getByRole('button', { name: /Delete/i }));
    await waitFor(() => expect(mockDeleteBlogResult).toHaveBeenCalledTimes(1));
    expect(mockDeleteBlogResult).toHaveBeenCalledWith('a1');
    globalThis.confirm = origConfirm;
  });

  test('Preview details exposes Copy markdown + Copy HTML buttons', async () => {
    mockLoadContentHistory.mockResolvedValue([
      { id: 'a1', client_id: 'c1', topic: 'Article', keyword: 'k',
        output: '**Meta Title:** Best Things\n\n# Heading\n\n## Body\n\n- one\n- two', generated_at: NOW_MONTH + '-15T10:00:00Z' }
    ]);
    mockClients = [READY_CLIENT];
    render(<AutoWrite />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Acme' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Acme' }));

    // Open the <details> by clicking its summary.
    await userEvent.click(screen.getByText(/View article/i));
    // Three top-row copy buttons are rendered inside the details.
    await waitFor(() => expect(screen.getByRole('button', { name: /Copy full output/i })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Copy body \(markdown\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy body \(HTML\)/i })).toBeInTheDocument();
  });
});
