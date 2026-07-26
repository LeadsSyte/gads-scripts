// Component test for GoogleConnectionsPicker. The bug: the picker read
// getToken() once at mount and never re-checked, so when App.jsx's
// background silent refresh completed AFTER mount the user still saw
// "Sign in with Google". The fix dispatches TOKEN_EVENT and the picker
// listens. This test locks the listener in.

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';

// State the test controls.
let storedToken = null;

vi.mock('../../src/modules/technical/googleAuth.js', async () => {
  const TOKEN_EVENT = 'syte-google-token-changed';
  return {
    TOKEN_EVENT,
    getToken: () => storedToken,
    getCurrentEmail: async () => storedToken ? 'user@example.com' : null,
    requestToken: vi.fn(async () => {
      storedToken = { access_token: 'fresh', expires_at: Date.now() + 3600_000, scope: 's' };
      window.dispatchEvent(new Event(TOKEN_EVENT));
      return storedToken;
    }),
    switchAccount: vi.fn(),
    signOut: vi.fn(async () => { storedToken = null; window.dispatchEvent(new Event(TOKEN_EVENT)); }),
    ALL_READ_SCOPES: ['x', 'y']
  };
});

// Property fetchers — avoid network entirely.
vi.mock('../../src/lib/googleProperties.js', () => ({
  fetchGa4Properties: async () => [],
  fetchGscSites: async () => [],
  normalizeGa4Id: (v) => ({ ok: true, value: v }),
  normalizeGscProperty: (v) => ({ ok: true, value: v }),
  clearPropertyCache: vi.fn()
}));

import GoogleConnectionsPicker from '../../src/components/GoogleConnectionsPicker.jsx';

beforeEach(() => { storedToken = null; });

describe('GoogleConnectionsPicker', () => {
  test('shows "Sign in with Google" when no token is present at mount', () => {
    render(
      <GoogleConnectionsPicker
        ga4Value="" onChangeGa4={() => {}}
        gscValue="" onChangeGsc={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: /Sign in with Google/i })).toBeInTheDocument();
  });

  test('shows the connected state when a token already exists at mount', async () => {
    storedToken = { access_token: 'pre-existing', expires_at: Date.now() + 3600_000, scope: 's' };
    render(
      <GoogleConnectionsPicker
        ga4Value="" onChangeGa4={() => {}}
        gscValue="" onChangeGsc={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: /Sign in with Google/i })).not.toBeInTheDocument();
    // "Sign out" only renders in the connected state.
    expect(screen.getByRole('button', { name: /Sign out/i })).toBeInTheDocument();
  });

  // ── REGRESSION ─────────────────────────────────────────────────────
  // The picker mounts BEFORE App.jsx's background silent refresh has
  // completed. Without listening for the token event the user is stuck
  // on "Sign in with Google" even though the token is now in storage.
  test('updates when a silent refresh completes AFTER mount (TOKEN_EVENT)', async () => {
    render(
      <GoogleConnectionsPicker
        ga4Value="" onChangeGa4={() => {}}
        gscValue="" onChangeGsc={() => {}}
      />
    );
    // Sanity: starts unsigned.
    expect(screen.getByRole('button', { name: /Sign in with Google/i })).toBeInTheDocument();

    // Simulate the background silent refresh storing a token + firing the event.
    act(() => {
      storedToken = { access_token: 'late', expires_at: Date.now() + 3600_000, scope: 's' };
      window.dispatchEvent(new Event('syte-google-token-changed'));
    });

    // Picker should react and switch to the signed-in state.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Sign in with Google/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Sign out/i })).toBeInTheDocument();
  });

  test('also reacts to cross-tab storage events (covers "open in two tabs")', async () => {
    render(
      <GoogleConnectionsPicker
        ga4Value="" onChangeGa4={() => {}}
        gscValue="" onChangeGsc={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: /Sign in with Google/i })).toBeInTheDocument();
    act(() => {
      storedToken = { access_token: 'cross-tab', expires_at: Date.now() + 3600_000, scope: 's' };
      window.dispatchEvent(new Event('storage'));
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Sign in with Google/i })).not.toBeInTheDocument();
    });
  });
});
