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

// Server-auth mode flag the tests control.
let serverAuth = false;
vi.mock('../../src/lib/googleServerAuth.js', () => ({
  serverAuthEnabled: () => serverAuth,
  listConnectedAccounts: async () => [
    { email: 'admin@syte.co.za', revoked: false },
    { email: 'analytics@agency.co.za', revoked: false },
    { email: 'seo@client.co.za', revoked: false }
  ]
}));

// Property fetchers — avoid network entirely. These are ACCOUNT-AWARE: each
// account sees only its own properties, which is the whole point of binding
// GA4 and Search Console separately. A fetcher that ignored its account
// argument would make the split impossible to test.
const GA4_BY_ACCOUNT = {
  'admin@syte.co.za': [{ id: '496943428', name: 'Acme Web', account: 'Acme' }],
  'analytics@agency.co.za': [{ id: '111111111', name: 'Agency GA4', account: 'Agency' }]
};
const GSC_BY_ACCOUNT = {
  'admin@syte.co.za': [{ siteUrl: 'sc-domain:acme.co.za', permissionLevel: 'siteOwner' }],
  'seo@client.co.za': [{ siteUrl: 'sc-domain:client.co.za', permissionLevel: 'siteOwner' }]
};
let ga4Calls = [];
let gscCalls = [];
vi.mock('../../src/lib/googleProperties.js', () => ({
  fetchGa4Properties: async () => [],
  fetchGscSites: async () => [],
  fetchGa4PropertiesForAccount: async (account) => {
    ga4Calls.push(account);
    return GA4_BY_ACCOUNT[account] || [];
  },
  fetchGscSitesForAccount: async (account) => {
    gscCalls.push(account);
    return GSC_BY_ACCOUNT[account] || [];
  },
  normalizeGa4Id: (v) => ({ ok: true, value: v }),
  normalizeGscProperty: (v) => ({ ok: true, value: v }),
  clearPropertyCache: vi.fn()
}));

import GoogleConnectionsPicker from '../../src/components/GoogleConnectionsPicker.jsx';

beforeEach(() => { storedToken = null; serverAuth = false; ga4Calls = []; gscCalls = []; });

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

  // ── REGRESSION ─────────────────────────────────────────────────────
  // With server-managed Google accounts nobody signs into Google in this
  // browser, so getToken() is always null. The GA4/GSC dropdowns were gated
  // on that browser sign-in state, so they never rendered: the properties
  // were fetched through the proxy and thrown away, both fields were stuck
  // as manual text boxes, and the "Use dropdown / Enter manually" toggle did
  // nothing when clicked. The gate is now "do we have an account to read
  // properties from", which is what actually decides whether a list exists.
  describe('server-managed accounts (no browser token)', () => {
    const renderBound = (props = {}) => render(
      <GoogleConnectionsPicker
        ga4Value="" onChangeGa4={() => {}}
        gscValue="" onChangeGsc={() => {}}
        savedGscEmail="admin@syte.co.za"
        savedGa4Email="admin@syte.co.za"
        onBindAccount={() => {}}
        {...props}
      />
    );

    test('renders the GA4 + Search Console dropdowns for the bound account', async () => {
      serverAuth = true;
      renderBound();
      expect(storedToken).toBe(null); // no browser sign-in anywhere in this flow
      await waitFor(() => {
        expect(screen.getByRole('option', { name: /sc-domain:acme\.co\.za/ })).toBeInTheDocument();
      });
      expect(screen.getByRole('option', { name: /Acme Web · 496943428/ })).toBeInTheDocument();
    });

    test('picking a Search Console property reports the bound account', async () => {
      serverAuth = true;
      const onChangeGsc = vi.fn();
      renderBound({ onChangeGsc });
      const option = await screen.findByRole('option', { name: /sc-domain:acme\.co\.za/ });
      const select = option.closest('select');
      act(() => {
        select.value = 'sc-domain:acme.co.za';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await waitFor(() => expect(onChangeGsc).toHaveBeenCalled());
      expect(onChangeGsc).toHaveBeenCalledWith('sc-domain:acme.co.za', 'admin@syte.co.za');
    });

    test('a saved property that the account cannot see is preserved, not dropped', async () => {
      serverAuth = true;
      renderBound({ gscValue: 'https://other.example.com/' });
      await waitFor(() => {
        expect(screen.getByRole('option', { name: /Saved · https:\/\/other\.example\.com\// }))
          .toBeInTheDocument();
      });
    });

    // ── REGRESSION ───────────────────────────────────────────────────
    // GA4 and Search Console were read from a SINGLE bound account
    // (savedGa4Email || savedGscEmail || savedEmail). Whichever API was
    // bound first decided where BOTH lists came from, so a client whose
    // Search Console lives in a different Google account than its GA4
    // could never see its GSC property — the dropdown listed the GA4
    // account's sites, and binding the GSC account stole GA4's list.
    describe('GA4 and Search Console in different accounts', () => {
      const renderSplit = (props = {}) => render(
        <GoogleConnectionsPicker
          ga4Value="" onChangeGa4={() => {}}
          gscValue="" onChangeGsc={() => {}}
          savedGa4Email="analytics@agency.co.za"
          savedGscEmail="seo@client.co.za"
          onBindGa4Account={() => {}}
          onBindGscAccount={() => {}}
          onBindAccount={() => {}}
          {...props}
        />
      );

      test('each API is queried with its OWN account', async () => {
        serverAuth = true;
        renderSplit();
        await waitFor(() => expect(ga4Calls.length).toBeGreaterThan(0));
        await waitFor(() => expect(gscCalls.length).toBeGreaterThan(0));
        expect(ga4Calls).toContain('analytics@agency.co.za');
        expect(gscCalls).toContain('seo@client.co.za');
        // The bug: GSC was fetched with the GA4 account.
        expect(gscCalls).not.toContain('analytics@agency.co.za');
        expect(ga4Calls).not.toContain('seo@client.co.za');
      });

      test('both property lists render, each from its own account', async () => {
        serverAuth = true;
        renderSplit();
        await waitFor(() => {
          expect(screen.getByRole('option', { name: /sc-domain:client\.co\.za/ })).toBeInTheDocument();
        });
        expect(screen.getByRole('option', { name: /Agency GA4 · 111111111/ })).toBeInTheDocument();
      });

      test('picking each property reports that API\'s own account', async () => {
        serverAuth = true;
        const onChangeGa4 = vi.fn();
        const onChangeGsc = vi.fn();
        renderSplit({ onChangeGa4, onChangeGsc });

        const gscOption = await screen.findByRole('option', { name: /sc-domain:client\.co\.za/ });
        act(() => {
          const sel = gscOption.closest('select');
          sel.value = 'sc-domain:client.co.za';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await waitFor(() => expect(onChangeGsc).toHaveBeenCalled());
        expect(onChangeGsc).toHaveBeenCalledWith('sc-domain:client.co.za', 'seo@client.co.za');

        const ga4Option = await screen.findByRole('option', { name: /Agency GA4 · 111111111/ });
        act(() => {
          const sel = ga4Option.closest('select');
          sel.value = '111111111';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await waitFor(() => expect(onChangeGa4).toHaveBeenCalled());
        expect(onChangeGa4).toHaveBeenCalledWith('111111111', 'analytics@agency.co.za');
      });

      test('binding one API does not touch the other', async () => {
        serverAuth = true;
        const onBindGa4Account = vi.fn();
        const onBindGscAccount = vi.fn();
        renderSplit({ onBindGa4Account, onBindGscAccount });

        const gscAccountSelect = await screen.findByLabelText('Search Console account');
        act(() => {
          gscAccountSelect.value = 'admin@syte.co.za';
          gscAccountSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await waitFor(() => expect(onBindGscAccount).toHaveBeenCalledWith('admin@syte.co.za'));
        expect(onBindGa4Account).not.toHaveBeenCalled();
      });

      test('a GA4-only binding does not make Search Console read that account', async () => {
        serverAuth = true;
        render(
          <GoogleConnectionsPicker
            ga4Value="" onChangeGa4={() => {}}
            gscValue="" onChangeGsc={() => {}}
            savedGa4Email="analytics@agency.co.za"
            onBindGa4Account={() => {}}
            onBindGscAccount={() => {}}
          />
        );
        await waitFor(() => expect(ga4Calls).toContain('analytics@agency.co.za'));
        // No GSC account bound, so nothing should have been fetched for it.
        expect(gscCalls).toEqual([]);
      });
    });

    test('falls back to manual entry when no account is bound yet', async () => {
      serverAuth = true;
      render(
        <GoogleConnectionsPicker
          ga4Value="" onChangeGa4={() => {}}
          gscValue="" onChangeGsc={() => {}}
          onBindAccount={() => {}}
        />
      );
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/sc-domain:example\.com/)).toBeInTheDocument();
      });
      expect(screen.queryByRole('option', { name: /sc-domain:acme\.co\.za/ })).not.toBeInTheDocument();
    });
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
