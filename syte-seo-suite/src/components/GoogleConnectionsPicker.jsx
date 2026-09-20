import React, { useState, useEffect, useMemo } from 'react';
import {
  getToken,
  getCurrentEmail,
  requestToken,
  switchAccount,
  signOut,
  ALL_READ_SCOPES,
  TOKEN_EVENT
} from '../modules/technical/googleAuth.js';
import {
  fetchGa4Properties,
  fetchGscSites,
  fetchGa4PropertiesForAccount,
  fetchGscSitesForAccount,
  normalizeGa4Id,
  normalizeGscProperty,
  clearPropertyCache
} from '../lib/googleProperties.js';
import { serverAuthEnabled, listConnectedAccounts } from '../lib/googleServerAuth.js';

// Combined GA4 + GSC picker for the client edit modal.
// Props:
//   ga4Value / onChangeGa4  — current GA4 Property ID string. onChangeGa4
//                             takes (propertyId, accountEmail) — the
//                             email is set when the operator picks from
//                             the dropdown so the parent can bind that
//                             API to the picked-from account.
//   gscValue / onChangeGsc  — same shape, for Search Console.
//   savedEmail / onChangeEmail
//                           — legacy single google_account_email binding;
//                             still used as a fallback hint when the
//                             per-API ga4/gsc binding is unset.
//   savedGa4Email / savedGscEmail
//                           — per-API account binding. GA4 and Search
//                             Console are bound INDEPENDENTLY: a client's
//                             analytics and its Search Console property
//                             routinely live in different Google accounts
//                             (agency-owned GA4, client-owned GSC, or the
//                             reverse), so each has its own account and its
//                             own property list.
//   onBindGa4Account / onBindGscAccount
//                           — bind one API to a connected account.
//   onBindAccount           — bind BOTH to one account (the "same account
//                             for both" convenience).
// One connected-account dropdown. Rendered once for GA4 and once for Search
// Console so each API can point at a different account. An account that is
// bound but no longer connected stays selectable rather than silently
// resetting the binding to blank.
function AccountSelect({ value, accounts, onChange, label }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ width: '100%', marginTop: 4 }}
    >
      <option value="">— select a connected account —</option>
      {accounts.map(em => <option key={em} value={em}>{em}</option>)}
      {value && !accounts.includes(value) && (
        <option value={value}>{value} (not connected — connect it in Suite Settings)</option>
      )}
    </select>
  );
}

export default function GoogleConnectionsPicker({
  ga4Value, onChangeGa4,
  gscValue, onChangeGsc,
  savedEmail, onChangeEmail,
  savedGa4Email, savedGscEmail,
  onBindAccount, onBindGa4Account, onBindGscAccount
}) {
  const [signedIn, setSignedIn] = useState(!!getToken());
  const [email, setEmail] = useState(null);
  // Server-auth: the list of accounts connected once on the backend. In that
  // mode binding a client = picking one of these from a dropdown, instead of
  // signing into Google in this browser.
  const serverAuth = serverAuthEnabled();
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  useEffect(() => {
    if (!serverAuth) return;
    listConnectedAccounts()
      .then(a => setConnectedAccounts((a || []).filter(x => !x.revoked).map(x => x.email)))
      .catch(() => {});
  }, [serverAuth]);
  // One account per API. These used to collapse into a single value
  // (savedGa4Email || savedGscEmail || savedEmail), which meant whichever API
  // was bound first decided where BOTH property lists were read from — so a
  // client whose GSC lives in a different account than its GA4 could never
  // see, let alone pick, its Search Console property.
  const boundGa4Account = savedGa4Email || savedEmail || '';
  const boundGscAccount = savedGscEmail || savedEmail || '';

  // The picker is often rendered before App.jsx's background silent
  // refresh has finished. Re-check signed-in state whenever the auth
  // module reports a token change, plus on cross-tab storage events.
  useEffect(() => {
    const recheck = () => setSignedIn(!!getToken());
    window.addEventListener(TOKEN_EVENT, recheck);
    window.addEventListener('storage', recheck);
    return () => {
      window.removeEventListener(TOKEN_EVENT, recheck);
      window.removeEventListener('storage', recheck);
    };
  }, []);
  const [ga4Props, setGa4Props] = useState([]);
  const [gscSites, setGscSites] = useState([]);
  // Per-API loading and errors: the two lists come from two accounts and one
  // failing must not blank or block the other.
  const [ga4Loading, setGa4Loading] = useState(false);
  const [gscLoading, setGscLoading] = useState(false);
  const [ga4Err, setGa4Err] = useState('');
  const [gscErr, setGscErr] = useState('');
  const [ga4ApiErrors, setGa4ApiErrors] = useState([]);
  const [gscApiErrors, setGscApiErrors] = useState([]);
  const loading = ga4Loading || gscLoading;
  const err = [ga4Err, gscErr].filter(Boolean).join(' · ');
  const apiErrors = useMemo(() => [...ga4ApiErrors, ...gscApiErrors], [ga4ApiErrors, gscApiErrors]);

  // Manual entry fallbacks
  const [manualGa4, setManualGa4] = useState(false);
  const [manualGsc, setManualGsc] = useState(false);
  const [ga4Local, setGa4Local] = useState(ga4Value || '');
  const [gscLocal, setGscLocal] = useState(gscValue || '');

  useEffect(() => setGa4Local(ga4Value || ''), [ga4Value]);
  useEffect(() => setGscLocal(gscValue || ''), [gscValue]);

  // Load each property list from ITS OWN account. Browser mode: whenever
  // signed in (one browser session, so both come from the same place).
  // Server mode: whenever that API's bound account changes — properties come
  // from THAT account via the proxy, independently of the other API.
  useEffect(() => {
    if (serverAuth) {
      if (!boundGa4Account) { setGa4Props([]); return; }
      loadGa4({});
      return;
    }
    if (!signedIn) { setGa4Props([]); return; }
    loadGa4({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, serverAuth, boundGa4Account]);

  useEffect(() => {
    if (serverAuth) {
      if (!boundGscAccount) { setGscSites([]); return; }
      loadGsc({});
      return;
    }
    if (!signedIn) { setGscSites([]); return; }
    loadGsc({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, serverAuth, boundGscAccount]);

  // Browser mode only: whose session is this. In server mode each API names
  // its own bound account instead.
  useEffect(() => {
    if (serverAuth || !signedIn) return;
    getCurrentEmail().then(setEmail).catch(() => {});
  }, [serverAuth, signedIn]);

  async function loadGa4({ bypassCache = false } = {}) {
    setGa4Loading(true); setGa4Err(''); setGa4ApiErrors([]);
    const props = await (serverAuth
      ? fetchGa4PropertiesForAccount(boundGa4Account, { bypassCache })
      : fetchGa4Properties({ bypassCache })
    ).catch(e => {
      console.error('GA4 fetch failed', e);
      if (e.apiDisabled) setGa4ApiErrors([{ service: 'GA4 Admin', message: e.message, enableUrl: e.enableUrl }]);
      else setGa4Err('GA4: ' + e.message);
      return [];
    });
    setGa4Props(props);
    setGa4Loading(false);
  }

  async function loadGsc({ bypassCache = false } = {}) {
    setGscLoading(true); setGscErr(''); setGscApiErrors([]);
    const sites = await (serverAuth
      ? fetchGscSitesForAccount(boundGscAccount, { bypassCache })
      : fetchGscSites({ bypassCache })
    ).catch(e => {
      console.error('GSC fetch failed', e);
      if (e.apiDisabled) setGscApiErrors([{ service: 'Search Console', message: e.message, enableUrl: e.enableUrl }]);
      else setGscErr('GSC: ' + e.message);
      return [];
    });
    setGscSites(sites);
    setGscLoading(false);
  }

  // Refresh both lists, each from its own account.
  function loadProperties({ bypassCache = false } = {}) {
    loadGa4({ bypassCache });
    loadGsc({ bypassCache });
    // NOTE: we deliberately do NOT auto-bind the currently signed-in account
    // to the client here. Doing so silently rebound a client to whatever
    // account the browser was signed into when you opened/switched to it —
    // corrupting clients whose properties live in a different account (you'd
    // see "saved property not visible to <wrong account>"). Binding now only
    // happens through deliberate actions: picking a property (sets the per-API
    // ga4/gsc account), the explicit account dropdowns, or Switch account.
  }

  async function doSignIn() {
    setErr('');
    try {
      // Hint with the saved email so Google pre-selects it when the user
      // already has multiple accounts in the chooser.
      await requestToken(ALL_READ_SCOPES, { loginHint: savedEmail || null });
      setSignedIn(true);
    } catch (e) { setErr(e.message); }
  }

  async function doSwitch() {
    setErr('');
    clearPropertyCache();
    try {
      await switchAccount(ALL_READ_SCOPES);
      setSignedIn(true);
      // After a deliberate switch, capture the new email — even when there
      // was already a saved one. The whole point of switching is to re-bind.
      const newEmail = await getCurrentEmail();
      if (newEmail && onChangeEmail) onChangeEmail(newEmail);
      // signedIn was already true, so the useEffect won't re-fire — reload
      // properties explicitly to populate the dropdowns from the new account.
      loadProperties({ bypassCache: true });
    } catch (e) { setErr(e.message); }
  }

  // Explicit "Use this account for this client" button. Shown when the
  // signed-in email differs from the saved one — gives the operator a clear
  // way to re-bind without having to go through Switch account.
  function bindCurrentEmail() {
    if (email && onChangeEmail) onChangeEmail(email);
  }

  async function doSignOut() {
    clearPropertyCache();
    await signOut();
    setSignedIn(false);
    setEmail(null);
  }

  // --- GA4 manual entry handler with validation on blur ------------------
  // The blur handler only writes when the text actually changed. Focusing a
  // field and tabbing straight back out is not an edit, and letting it write
  // an empty value put a saved property one stray click away from being
  // cleared on the next Save.
  function commitGa4Manual() {
    if (ga4Local.trim() === String(ga4Value || '').trim()) return;
    if (!ga4Local.trim()) { onChangeGa4(''); return; }
    const res = normalizeGa4Id(ga4Local);
    if (res.ok) {
      setGa4Local(res.value);
      onChangeGa4(res.value);
    }
    // invalid → leave as-is, error rendered below
  }
  const ga4Validation = useMemo(() => {
    if (!ga4Local.trim()) return null;
    return normalizeGa4Id(ga4Local);
  }, [ga4Local]);

  // --- GSC manual entry handler with validation on blur -----------------
  // Same no-op-on-untouched rule as GA4 above.
  function commitGscManual() {
    if (gscLocal.trim() === String(gscValue || '').trim()) return;
    if (!gscLocal.trim()) { onChangeGsc(''); return; }
    const res = normalizeGscProperty(gscLocal);
    if (res.ok) {
      setGscLocal(res.value);
      onChangeGsc(res.value);
    }
  }
  const gscValidation = useMemo(() => {
    if (!gscLocal.trim()) return null;
    return normalizeGscProperty(gscLocal);
  }, [gscLocal]);

  // Grouped GA4 props for the <select>
  const ga4Groups = useMemo(() => {
    const g = {};
    for (const p of ga4Props) {
      if (!g[p.account]) g[p.account] = [];
      g[p.account].push(p);
    }
    return g;
  }, [ga4Props]);

  // True when the client has a saved GA4 / GSC value that isn't visible in
  // the currently signed-in account's property list. Without surfacing this
  // the dropdown silently shows "— pick a property —" and a careless Save
  // would wipe the stored ID. We render the saved value as a synthetic
  // option (and a warning) so it stays preserved + obvious.
  const ga4SavedMissing = !!ga4Value && !ga4Props.some(p => p.id === ga4Value);
  const gscSavedMissing = !!gscValue && !gscSites.some(s => s.siteUrl === gscValue);

  // Whether this client can be picked from a dropdown at all. Under server
  // auth nobody signs into Google in this browser, so gating the dropdowns on
  // `signedIn` left them permanently hidden: the properties were fetched
  // through the proxy and thrown away, and the "Use dropdown / Enter manually"
  // toggle did nothing when clicked. What matters is whether we have an
  // account to read properties from.
  const canPickGa4 = serverAuth ? !!boundGa4Account : signedIn;
  const canPickGsc = serverAuth ? !!boundGscAccount : signedIn;
  // The account each property list actually came from — used in that API's
  // labels and its "not visible to…" warning. They can differ.
  const ga4SourceAccount = (serverAuth ? boundGa4Account : email) || 'this account';
  const gscSourceAccount = (serverAuth ? boundGscAccount : email) || 'this account';

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <strong>Google Connections</strong>
        <div className="row" style={{ gap: 8 }}>
          {!serverAuth && !signedIn && (
            <button onClick={doSignIn} style={{ borderColor: '#4F8EF7', color: '#4F8EF7' }}>
              Sign in with Google
            </button>
          )}
          {!serverAuth && signedIn && (
            <>
              <span className="muted" style={{ fontSize: 11 }}>
                <span className="dot" style={{ background: 'var(--green)', marginRight: 6 }} />
                {email || '(fetching…)'}
              </span>
              <button onClick={() => loadProperties({ bypassCache: true })} disabled={loading} style={{ fontSize: 11, padding: '4px 10px' }}>
                {loading ? 'Loading…' : 'Refresh'}
              </button>
              <button onClick={doSwitch} style={{ fontSize: 11, padding: '4px 10px' }}>Switch account</button>
              <button onClick={doSignOut} style={{ fontSize: 11, padding: '4px 10px' }}>Sign out</button>
            </>
          )}
        </div>
      </div>

      {serverAuth ? (
        <div style={{ marginBottom: 12 }}>
          <div className="grid-2" style={{ gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-dim)' }}>
                GA4 account
              </label>
              <AccountSelect
                label="GA4 account"
                value={boundGa4Account}
                accounts={connectedAccounts}
                onChange={v => onBindGa4Account?.(v)}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-dim)' }}>
                Search Console account
              </label>
              <AccountSelect
                label="Search Console account"
                value={boundGscAccount}
                accounts={connectedAccounts}
                onChange={v => onBindGscAccount?.(v)}
              />
            </div>
          </div>

          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            GA4 and Search Console are bound separately — a client's analytics and its Search Console
            property often live in different Google accounts. Connect accounts once under{' '}
            <strong>Suite Settings → Connected Google Accounts</strong>, then pick each property below.
          </div>

          {/* The common case is still one account for both, so keep it one click. */}
          {boundGa4Account !== boundGscAccount && (boundGa4Account || boundGscAccount) && (
            <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="muted" style={{ fontSize: 11 }}>Different accounts for GA4 and Search Console.</span>
              <button
                onClick={() => onBindAccount?.(boundGa4Account || boundGscAccount)}
                style={{ fontSize: 11, padding: '4px 10px' }}
              >
                Use {boundGa4Account || boundGscAccount} for both
              </button>
            </div>
          )}

          {(boundGa4Account || boundGscAccount) && (
            <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => loadProperties({ bypassCache: true })} disabled={loading} style={{ fontSize: 11, padding: '4px 10px' }}>
                {loading ? 'Loading…' : 'Refresh properties'}
              </button>
              <span className="muted" style={{ fontSize: 11 }}>
                {ga4Loading ? '' : `${ga4Props.length} GA4 from ${boundGa4Account || '(no account)'}`}
                {' · '}
                {gscLoading ? '' : `${gscSites.length} Search Console from ${boundGscAccount || '(no account)'}`}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Sign in with Google to pick GA4 properties and Search Console sites from a dropdown,
          or enter them manually below. Your clients are spread across 6 accounts — use Switch account
          to sign into each one when setting up clients.
        </div>
      )}

      {!serverAuth && savedEmail && (
        <div style={{
          marginBottom: 10,
          padding: 10,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          fontSize: 12
        }}>
          <strong>Saved Google account for this client:</strong>{' '}
          <span className="mono">{savedEmail}</span>
          {signedIn && email && email.toLowerCase() !== savedEmail.toLowerCase() && (
            <div style={{ marginTop: 8, color: 'var(--orange)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              You're signed in as <span className="mono">{email}</span> — properties below will be from that account, not the saved one.
              <button onClick={doSwitch} style={{ fontSize: 11, padding: '4px 10px' }}>Switch to {savedEmail}</button>
              <button onClick={bindCurrentEmail} style={{ fontSize: 11, padding: '4px 10px' }}>Use {email} instead</button>
            </div>
          )}
        </div>
      )}

      {apiErrors.map((ae, i) => (
        <div key={i} style={{
          marginBottom: 10,
          padding: 12,
          background: 'color-mix(in srgb, var(--orange) 8%, var(--surface-2))',
          border: '1px solid color-mix(in srgb, var(--orange) 40%, var(--border))',
          borderLeft: '4px solid var(--orange)',
          borderRadius: 'var(--radius)'
        }}>
          <strong style={{ color: 'var(--orange)', fontSize: 13 }}>
            {ae.service} API needs enabling
          </strong>
          <div style={{ fontSize: 12, marginTop: 6, color: 'var(--text)' }}>
            {ae.message}
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <a
              href={ae.enableUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-block',
                padding: '6px 14px',
                background: 'var(--orange)',
                color: '#0a0a0c',
                borderRadius: 'var(--radius)',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: 12
              }}
            >
              Enable {ae.service} API →
            </a>
            <button
              onClick={() => loadProperties({ bypassCache: true })}
              disabled={loading}
              style={{ fontSize: 11, padding: '5px 10px' }}
            >
              {loading ? 'Re-checking…' : 'I\'ve enabled it — Refresh'}
            </button>
          </div>
        </div>
      ))}
      {err && <div style={{ color: 'var(--red)', marginBottom: 10, fontSize: 12 }}>{err}</div>}
      {loading && <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Loading properties…</div>}

      {/* GA4 row */}
      <div style={{ marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <label style={{ margin: 0 }}>
            GA4 Property
            {canPickGa4 && !ga4Loading && (
              <span className="muted" style={{ fontSize: 10, textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}>
                {ga4Props.length} loaded across {Object.keys(ga4Groups).length} account(s)
              </span>
            )}
          </label>
          <button
            onClick={() => setManualGa4(v => !v)}
            style={{ padding: '2px 8px', fontSize: 10 }}
          >
            {manualGa4 ? 'Use dropdown' : 'Enter manually'}
          </button>
        </div>
        {canPickGa4 && !manualGa4 && ga4Props.length > 0 ? (
          <>
            <select value={ga4Value || ''} onChange={e => onChangeGa4(e.target.value, e.target.value ? (serverAuth ? boundGa4Account : email) : null)}>
              <option value="">— pick a property —</option>
              {ga4SavedMissing && (
                <option value={ga4Value}>Saved · {ga4Value} (not visible to {ga4SourceAccount})</option>
              )}
              {Object.entries(ga4Groups).map(([account, props]) => (
                <optgroup key={account} label={account}>
                  {props.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.id}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {ga4SavedMissing && (
              <div style={{ color: 'var(--orange)', fontSize: 11, marginTop: 4 }}>
                The saved property <span className="mono">{ga4Value}</span> isn't in {ga4SourceAccount}'s list. It's still preserved — repick it, or bind the client to the account that owns it.
              </div>
            )}
            {savedGa4Email && (
              <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
                GA4 fetches use <span className="mono">{savedGa4Email}</span>
              </div>
            )}
          </>
        ) : (
          <>
            <input
              value={ga4Local}
              onChange={e => setGa4Local(e.target.value)}
              onBlur={commitGa4Manual}
              placeholder="e.g. 123456789"
              className="mono"
            />
            <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
              Numeric property ID only — not G-XXXXXX (measurement) or UA-… (deprecated).
            </div>
            {ga4Validation && !ga4Validation.ok && (
              <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>
                {ga4Validation.message}
              </div>
            )}
          </>
        )}
        {canPickGa4 && !manualGa4 && ga4Props.length === 0 && !ga4Loading && (
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            No GA4 properties visible to {ga4SourceAccount}.{serverAuth ? ' Check the account binding above, or enter the ID manually.' : ' Try Switch account.'}
          </div>
        )}
      </div>

      {/* GSC row */}
      <div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <label style={{ margin: 0 }}>
            Search Console Property
            {canPickGa4 && !ga4Loading && (
              <span className="muted" style={{ fontSize: 10, textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}>
                {gscSites.length} loaded
              </span>
            )}
          </label>
          <button
            onClick={() => setManualGsc(v => !v)}
            style={{ padding: '2px 8px', fontSize: 10 }}
          >
            {manualGsc ? 'Use dropdown' : 'Enter manually'}
          </button>
        </div>
        {canPickGsc && !manualGsc && gscSites.length > 0 ? (
          <select value={gscValue || ''} onChange={e => onChangeGsc(e.target.value, e.target.value ? (serverAuth ? boundGscAccount : email) : null)}>
            <option value="">— pick a property —</option>
            {gscSavedMissing && (
              <option value={gscValue}>Saved · {gscValue} (not visible to {gscSourceAccount})</option>
            )}
            {gscSites.map(s => (
              <option key={s.siteUrl} value={s.siteUrl}>
                {s.siteUrl} ({s.permissionLevel})
              </option>
            ))}
          </select>
        ) : null}
        {canPickGsc && !manualGsc && gscSites.length > 0 && gscSavedMissing && (
          <div style={{ color: 'var(--orange)', fontSize: 11, marginTop: 4 }}>
            The saved property <span className="mono">{gscValue}</span> isn't in {gscSourceAccount}'s list. It's still preserved — repick it, or bind the client to the account that owns it.
          </div>
        )}
        {savedGscEmail && (
          <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
            Search Console fetches use <span className="mono">{savedGscEmail}</span>
          </div>
        )}
        {!(canPickGsc && !manualGsc && gscSites.length > 0) && (
          <>
            <input
              value={gscLocal}
              onChange={e => setGscLocal(e.target.value)}
              onBlur={commitGscManual}
              placeholder="https://example.com/ or sc-domain:example.com"
              className="mono"
            />
            <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
              URL-prefix properties must end with <code>/</code>. For Domain properties use <code>sc-domain:example.com</code>.
            </div>
            {gscValidation && !gscValidation.ok && (
              <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>
                {gscValidation.message}
              </div>
            )}
          </>
        )}
        {canPickGsc && !manualGsc && gscSites.length === 0 && !gscLoading && (
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            No Search Console sites visible to {gscSourceAccount}.{serverAuth ? ' Check the account binding above, or enter the property manually.' : ' Try Switch account.'}
          </div>
        )}
      </div>
    </div>
  );
}
