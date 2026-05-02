// LockScreen sad-path tests. The lock screen is the first thing every
// user sees if they're not already unlocked. Pins:
//   • Renders the password form by default
//   • If a stored key already exists, auto-unlocks (skip the screen)
//   • Wrong password shows "Wrong password" + does NOT call onUnlock
//   • Decryption that returns junk (not starting with sk-) is treated
//     as wrong password (regression for the old behaviour where AES-GCM
//     auth was bypassed and any password "worked")
//   • Submit button shows "Unlocking…" while crypto runs and is disabled

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockDecrypt = vi.fn();
const mockGetStoredApiKey = vi.fn();
const mockSetStoredApiKey = vi.fn();
vi.mock('../../src/lib/auth.js', () => ({
  decryptApiKey: (...a) => mockDecrypt(...a),
  setStoredApiKey: (...a) => mockSetStoredApiKey(...a),
  getStoredApiKey: () => mockGetStoredApiKey()
}));

import LockScreen from '../../src/components/LockScreen.jsx';

beforeEach(() => {
  mockDecrypt.mockReset();
  mockGetStoredApiKey.mockReset().mockReturnValue(null);
  mockSetStoredApiKey.mockReset();
});

describe('LockScreen', () => {
  test('renders the password form when no stored key exists', () => {
    const onUnlock = vi.fn();
    render(<LockScreen onUnlock={onUnlock} />);
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeInTheDocument();
    expect(onUnlock).not.toHaveBeenCalled();
  });

  test('auto-unlocks when a stored key already exists (skips the screen)', async () => {
    mockGetStoredApiKey.mockReturnValue('sk-existing');
    const onUnlock = vi.fn();
    render(<LockScreen onUnlock={onUnlock} />);
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
  });

  test('correct password → onUnlock fires + stores the key', async () => {
    mockDecrypt.mockResolvedValue('sk-real-key-from-decryption');
    const onUnlock = vi.fn();
    render(<LockScreen onUnlock={onUnlock} />);
    await userEvent.type(screen.getByPlaceholderText('Password'), 'rightpw');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
    expect(mockSetStoredApiKey).toHaveBeenCalledWith('sk-real-key-from-decryption');
  });

  test('wrong password → "Wrong password" + onUnlock NOT called', async () => {
    mockDecrypt.mockRejectedValue(new Error('AES-GCM auth failed'));
    const onUnlock = vi.fn();
    render(<LockScreen onUnlock={onUnlock} />);
    await userEvent.type(screen.getByPlaceholderText('Password'), 'wrongpw');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.getByText(/Wrong password/i)).toBeInTheDocument());
    expect(onUnlock).not.toHaveBeenCalled();
    expect(mockSetStoredApiKey).not.toHaveBeenCalled();
  });

  // Regression — if decryption "succeeds" but produces garbage that
  // doesn't start with sk-, we MUST treat it as a wrong password.
  // Earlier in the project this was the only safety net against AES-GCM
  // auth being broken or the wrong password silently producing junk.
  test('REGRESSION: decryption returning non-sk- output is rejected as wrong password', async () => {
    mockDecrypt.mockResolvedValue('garbage-that-is-not-an-api-key');
    const onUnlock = vi.fn();
    render(<LockScreen onUnlock={onUnlock} />);
    await userEvent.type(screen.getByPlaceholderText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.getByText(/Wrong password/i)).toBeInTheDocument());
    expect(onUnlock).not.toHaveBeenCalled();
    // Garbage MUST NOT have been stored.
    expect(mockSetStoredApiKey).not.toHaveBeenCalled();
  });

  test('decryption returning empty string is rejected', async () => {
    mockDecrypt.mockResolvedValue('');
    const onUnlock = vi.fn();
    render(<LockScreen onUnlock={onUnlock} />);
    await userEvent.type(screen.getByPlaceholderText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.getByText(/Wrong password/i)).toBeInTheDocument());
    expect(onUnlock).not.toHaveBeenCalled();
  });

  test('button shows "Unlocking…" + is disabled while crypto runs', async () => {
    let resolve;
    mockDecrypt.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<LockScreen onUnlock={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    // Mid-decryption: button shows the busy label and is disabled.
    await waitFor(() => expect(screen.getByRole('button', { name: /Unlocking/i })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Unlocking/i })).toBeDisabled();
    resolve('sk-key');
  });

  test('error message clears when user submits again', async () => {
    mockDecrypt.mockRejectedValueOnce(new Error('first attempt fails'));
    mockDecrypt.mockResolvedValueOnce('sk-good');
    const onUnlock = vi.fn();
    render(<LockScreen onUnlock={onUnlock} />);
    const input = screen.getByPlaceholderText('Password');
    const button = screen.getByRole('button', { name: 'Unlock' });

    // First attempt fails.
    await userEvent.type(input, 'wrong');
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByText(/Wrong password/i)).toBeInTheDocument());

    // Second attempt succeeds — error must clear.
    await userEvent.clear(input);
    await userEvent.type(input, 'right');
    await userEvent.click(button);
    await waitFor(() => expect(onUnlock).toHaveBeenCalled());
    expect(screen.queryByText(/Wrong password/i)).not.toBeInTheDocument();
  });
});
