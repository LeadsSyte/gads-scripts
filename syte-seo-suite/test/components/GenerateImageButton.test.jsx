// Component test for GenerateImageButton — the dropdown + button users
// click to make an article hero. The bug we fixed (silent fallback when
// the user picked a provider) lives in imageGen.js, but this layer is
// where the user choice is bound. Locks in: the dropdown reflects which
// API keys are configured, and the click pipes the choice through.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock loadSettings + the underlying generateHeroImage so the button's
// click handler exercises the real component but never hits the network.
vi.mock('../../src/lib/settings.js', () => ({
  loadSettings: () => globalThis.__mockSettings || {}
}));

const mockGenerate = vi.fn();
vi.mock('../../src/modules/content/imageGen.js', () => ({
  generateHeroImage: (...args) => mockGenerate(...args),
  downloadImage: vi.fn()
}));

// Stub useClients so the component has a valid client.
vi.mock('../../src/store/useClients.js', () => ({
  useClients: (selector) => selector({
    current: () => ({ id: 'c1', name: 'Acme', industry: 'Hospitality' })
  })
}));

import GenerateImageButton from '../../src/components/GenerateImageButton.jsx';

beforeEach(() => {
  mockGenerate.mockReset();
});

describe('GenerateImageButton', () => {
  test('renders nothing when no image API keys are configured', () => {
    globalThis.__mockSettings = {};
    const { container } = render(<GenerateImageButton title="A Topic" keyword="kw" />);
    // Component returns null in this case → root is empty.
    expect(container.firstChild).toBeNull();
  });

  test('shows only DALL-E option when only OpenAI key is set', () => {
    globalThis.__mockSettings = { openaiKey: 'k' };
    render(<GenerateImageButton title="A Topic" keyword="kw" />);
    expect(screen.getByRole('option', { name: /DALL-E 3/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Imagen 3/i })).not.toBeInTheDocument();
  });

  test('shows only Imagen option when only Google AI key is set', () => {
    globalThis.__mockSettings = { googleAiKey: 'g' };
    render(<GenerateImageButton title="A Topic" keyword="kw" />);
    expect(screen.getByRole('option', { name: /Imagen 3/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /DALL-E 3/i })).not.toBeInTheDocument();
  });

  test('shows both options when both keys are set', () => {
    globalThis.__mockSettings = { openaiKey: 'k', googleAiKey: 'g' };
    render(<GenerateImageButton title="A Topic" keyword="kw" />);
    expect(screen.getByRole('option', { name: /DALL-E 3/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Imagen 3/i })).toBeInTheDocument();
  });

  test('clicking Generate forwards the SELECTED provider to generateHeroImage', async () => {
    globalThis.__mockSettings = { openaiKey: 'k', googleAiKey: 'g' };
    mockGenerate.mockResolvedValue({ provider: 'imagen', dataUrl: 'data:image/png;base64,X' });
    render(<GenerateImageButton title="A Topic" keyword="kw" />);
    // Switch dropdown to Imagen.
    await userEvent.selectOptions(screen.getByRole('combobox'), 'imagen');
    await userEvent.click(screen.getByRole('button', { name: /Generate hero image/i }));
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate).toHaveBeenCalledWith(
      'A Topic',
      'kw',
      expect.objectContaining({ name: 'Acme' }),
      expect.objectContaining({ preferredProvider: 'imagen' })
    );
  });

  test('an error from generateHeroImage is shown to the user (not silently swallowed)', async () => {
    globalThis.__mockSettings = { openaiKey: 'k' };
    mockGenerate.mockRejectedValue(new Error('DALL-E error 400: content policy violation'));
    render(<GenerateImageButton title="A Topic" keyword="kw" />);
    await userEvent.click(screen.getByRole('button', { name: /Generate hero image/i }));
    // Wait for the error to render.
    expect(await screen.findByText(/content policy violation/)).toBeInTheDocument();
  });
});
