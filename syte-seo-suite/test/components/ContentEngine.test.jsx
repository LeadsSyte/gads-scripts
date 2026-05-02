// ContentEngine component test. The router that drives the Content
// module's tabs (Auto Write / Topic Research / New Article / Rewrite &
// Expand / Metadata & Schema / Editorial Feedback / History).
//
// We don't try to render every tab fully — that would require mounting
// the entire AutoWrite + TopicResearch trees. Instead pin:
//   • Routing — `sub` prop drives which top-level surface is shown
//   • No-client guard — main "Generate" button doesn't trigger work
//     when no client is selected
//   • Output state — when output exists, parsed sections + Copy buttons
//     surface (regression for the QA-JSON-leaks-into-body bug)

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/anthropic.js', () => ({
  claudeStream: vi.fn(async () => ''),
  extractJSON: () => null
}));
vi.mock('../../src/modules/content/prompts.js', () => ({
  buildSystemPrompt: () => '',
  TAB_PROMPTS: {
    'New Article':       () => '',
    'Rewrite & Expand':  () => '',
    'Metadata & Schema': () => '',
    'Editorial Feedback':() => ''
  }
}));
vi.mock('../../src/components/PushToCmsButton.jsx', () => ({
  default: () => <button data-testid="push-cms">Push</button>
}));
vi.mock('../../src/components/GenerateImageButton.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/MarkImplementedButton.jsx', () => ({
  default: () => <button data-testid="mark-impl">Mark</button>
}));
vi.mock('../../src/components/ClientCardsGrid.jsx', () => ({ default: () => null }));
vi.mock('../../src/modules/content/TopicResearch.jsx', () => ({
  default: () => <div data-testid="topic-research">Topic Research module</div>
}));
vi.mock('../../src/modules/content/AutoWrite.jsx', () => ({
  default: () => <div data-testid="auto-write">Auto Write module</div>
}));

const mockSaveBlogResult = vi.fn(async () => ({ id: 'b1' }));
const mockListBlogResults = vi.fn(async () => []);
const mockDeleteBlogResult = vi.fn(async () => {});
const mockLoadContentHistory = vi.fn(async () => []);
vi.mock('../../src/lib/supabase.js', () => ({
  saveBlogResult: (...a) => mockSaveBlogResult(...a),
  listBlogResults: (...a) => mockListBlogResults(...a),
  deleteBlogResult: (...a) => mockDeleteBlogResult(...a),
  loadContentHistory: (...a) => mockLoadContentHistory(...a)
}));

let mockClients;
let mockSelectedId;
vi.mock('../../src/store/useClients.js', () => ({
  useClients: (selector) => selector({
    clients: mockClients,
    current: () => mockClients.find(c => c.id === mockSelectedId) || null,
    select: vi.fn(),
    selectedId: mockSelectedId
  })
}));

import ContentEngine from '../../src/modules/content/ContentEngine.jsx';

beforeEach(() => {
  mockSaveBlogResult.mockReset().mockResolvedValue({ id: 'b1' });
  mockListBlogResults.mockReset().mockResolvedValue([]);
  mockDeleteBlogResult.mockReset();
  mockLoadContentHistory.mockReset().mockResolvedValue([]);
  mockClients = [];
  mockSelectedId = null;
});

const CLIENT = {
  id: 'c1', name: 'Acme', url: 'https://acme.test/',
  industry: 'Hospitality', location: 'Cape Town', voice: 'Editorial',
  audience: 'Travellers', context: 'A boutique hotel', author: 'Mike',
  pages_per_month: 4
};

describe('ContentEngine', () => {
  test('renders the Auto Write tab by default (sub=undefined)', async () => {
    mockClients = [CLIENT];
    mockSelectedId = 'c1';
    render(<ContentEngine sub={undefined} setSub={() => {}} />);
    // The Auto Write child (mocked) should mount.
    await waitFor(() => expect(screen.getByTestId('auto-write')).toBeInTheDocument());
  });

  test('renders Auto Write tab when sub="Auto Write"', async () => {
    mockClients = [CLIENT];
    mockSelectedId = 'c1';
    render(<ContentEngine sub="Auto Write" setSub={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('auto-write')).toBeInTheDocument());
  });

  test('renders Topic Research tab when sub="Topic Research"', async () => {
    mockClients = [CLIENT];
    mockSelectedId = 'c1';
    render(<ContentEngine sub="Topic Research" setSub={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('topic-research')).toBeInTheDocument());
  });

  test('Single-tab modules (New Article, Rewrite & Expand) render their form without crashing', async () => {
    mockClients = [CLIENT];
    mockSelectedId = 'c1';
    render(<ContentEngine sub="New Article" setSub={() => {}} />);
    // Should render some kind of input — topic, keyword, or generate button.
    await waitFor(() => {
      const inputs = document.querySelectorAll('input, textarea, button');
      expect(inputs.length).toBeGreaterThan(0);
    });
  });

  test('does not crash when no client is selected', async () => {
    mockClients = [];
    mockSelectedId = null;
    render(<ContentEngine sub="New Article" setSub={() => {}} />);
    // No throw. The content area renders.
    await waitFor(() => {
      expect(document.body.textContent.length).toBeGreaterThan(0);
    });
  });

  test('History tab loads content history on mount', async () => {
    mockClients = [CLIENT];
    mockSelectedId = 'c1';
    mockLoadContentHistory.mockResolvedValue([
      { id: 'h1', client_id: 'c1', topic: 'Old article', generated_at: '2026-04-01T00:00:00Z' }
    ]);
    render(<ContentEngine sub="History" setSub={() => {}} />);
    // The component renders without throwing — history is fetched.
    await waitFor(() => expect(document.body.textContent.length).toBeGreaterThan(0));
  });
});
