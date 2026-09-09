// Component test for the "📧 Sent to Developer" flow.
//
// The bug this locks down: the button asked for a screenshot of the email we
// sent the client's developer, and then — whenever the AI screenshot check
// couldn't run (API down, no key, timeout, an unreadable response) — left the
// record exactly where it was. From the user's side, "Sent to Developer" asked
// for an email and then never marked anything verified once one was attached.
//
// The email IS the evidence of the handover, so attaching one must verify the
// record whether or not the checker managed to look at it. Only two things may
// stop that: Claude reading the image and saying it isn't an email, or the
// save itself failing — and the second must say so, not pretend it worked.

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const logImplementation = vi.fn();
const updateImplementation = vi.fn();
vi.mock('../../src/lib/supabase.js', () => ({
  logImplementation: (...a) => logImplementation(...a),
  updateImplementation: (...a) => updateImplementation(...a),
  getImplementationDetail: vi.fn()
}));

// The real verification.js runs — only the network edge is mocked.
const claudeComplete = vi.fn();
vi.mock('../../src/lib/anthropic.js', () => ({
  claudeComplete: (...a) => claudeComplete(...a),
  CLAUDE_MODEL: 'claude-sonnet-4-6'
}));
vi.mock('../../src/lib/corsProxy.js', () => ({
  corsFetchText: vi.fn(async () => ''),
  corsFetch: vi.fn()
}));
vi.mock('../../src/modules/technical/gsc.js', () => ({ listSites: vi.fn(async () => []) }));

vi.mock('../../src/store/useClients.js', () => ({
  useClients: (selector) => selector({ current: () => ({ id: 'c1', name: 'Acme', url: 'https://acme.test/' }) })
}));

import MarkImplementedButton from '../../src/components/MarkImplementedButton.jsx';

// jsdom never loads image bytes, so <img> fires neither load nor error and the
// component's resize step would hang forever. Failing to decode is also the
// real-world case we care about (an iPhone HEIC screenshot): the file's own
// bytes must still be kept and still verify.
class FakeImage {
  set src(_v) { setTimeout(() => this.onerror?.(new Error('undecodable')), 0); }
}

function attachEmail(container) {
  const inputs = container.querySelectorAll('input[type="file"]');
  const panelInput = inputs[inputs.length - 1];
  const file = new File(['x'.repeat(600)], 'email.png', { type: 'image/png' });
  fireEvent.change(panelInput, { target: { files: [file] } });
}

async function openSentPanel(onVerified) {
  const view = render(
    <MarkImplementedButton
      module="technical"
      changeType="meta"
      pageUrl="https://acme.test/about"
      title="Meta description"
      description="New meta description"
      onVerified={onVerified}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /Sent to Developer/i }));
  await screen.findByText('📧 Upload a screenshot of the email');
  return view;
}

beforeEach(() => {
  logImplementation.mockReset().mockImplementation(async (row) => ({ id: 'impl-1', ...row }));
  updateImplementation.mockReset().mockImplementation(async (id, patch) => ({ id, ...patch }));
  claudeComplete.mockReset();
  vi.stubGlobal('Image', FakeImage);
  // URL + "who sent it" prompts fired by the Sent-to-Developer entry point.
  vi.spyOn(window, 'prompt')
    .mockReturnValueOnce('https://acme.test/about')
    .mockReturnValueOnce('Mike');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MarkImplementedButton — Sent to Developer', () => {
  test('attaching the email verifies the handover even when the AI check is down', async () => {
    claudeComplete.mockRejectedValue(new Error('Claude API error: 529'));
    const onVerified = vi.fn();
    const { container } = await openSentPanel(onVerified);

    attachEmail(container);

    await waitFor(() => expect(updateImplementation).toHaveBeenCalled());
    const [, patch] = updateImplementation.mock.calls[0];
    expect(patch.verification_status).toBe('verified');
    expect(patch.verification_detail).toContain('[SCREENSHOT]');
    expect(patch.verification_detail).toMatch(/check unavailable/);
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
    expect(await screen.findByText('✓ Verified')).toBeInTheDocument();
  });

  test('a confirmed email screenshot verifies and keeps the proof', async () => {
    claudeComplete.mockResolvedValue(
      '{"is_email": true, "recipient": "dev@acme.test", "subject": "SEO changes", "relates": true, "evidence": "Gmail sent message."}'
    );
    const onVerified = vi.fn();
    const { container } = await openSentPanel(onVerified);

    attachEmail(container);

    await waitFor(() => expect(updateImplementation).toHaveBeenCalled());
    expect(updateImplementation.mock.calls[0][1].verification_status).toBe('verified');
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
  });

  test('a failed save keeps the panel open and says the save failed', async () => {
    claudeComplete.mockResolvedValue(
      '{"is_email": true, "recipient": "dev@acme.test", "subject": "SEO changes", "relates": true, "evidence": "Gmail sent message."}'
    );
    updateImplementation.mockRejectedValue(new Error('row too large'));
    const onVerified = vi.fn();
    const { container } = await openSentPanel(onVerified);

    attachEmail(container);

    expect(await screen.findByText(/saving it failed/i)).toBeInTheDocument();
    expect(onVerified).not.toHaveBeenCalled();
    // Panel stays open so the user can retry rather than losing the email.
    expect(screen.getByText('📧 Upload a screenshot of the email')).toBeInTheDocument();
  });

  // A handover with no usable screenshot still stays 'sent_to_developer' —
  // there's no proof to promote it to 'verified'. It is still DELIVERED work
  // (deliveryStatus.js), so the parent must be told: that's what moves the row
  // out of its list and flips the Technical SEO task off OPEN. Before this it
  // silently did nothing and the task sat there as if we'd never sent it.
  test('an unreadable attachment still records the handover and tells the parent', async () => {
    class FailingFileReader {
      readAsDataURL() { setTimeout(() => this.onerror?.(new Error('unreadable')), 0); }
    }
    vi.stubGlobal('FileReader', FailingFileReader);
    const onVerified = vi.fn();
    const { container } = await openSentPanel(onVerified);

    attachEmail(container); // read fails → the manual override appears

    const override = await screen.findByRole('button', { name: /I definitely sent it/i });
    fireEvent.click(override);

    await waitFor(() => expect(updateImplementation).toHaveBeenCalled());
    const [, patch] = updateImplementation.mock.calls[0];
    expect(patch.verification_status).toBe('sent_to_developer');
    expect(patch.verification_detail).not.toContain('[SCREENSHOT]');
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
  });

  test('an image Claude reads as "not an email" is still rejected', async () => {
    claudeComplete.mockResolvedValue(
      '{"is_email": false, "recipient": "", "subject": "", "relates": false, "evidence": "A photo of a cat."}'
    );
    const onVerified = vi.fn();
    const { container } = await openSentPanel(onVerified);

    attachEmail(container);

    expect(await screen.findByText(/does not look like an email/i)).toBeInTheDocument();
    expect(updateImplementation).not.toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
  });
});
