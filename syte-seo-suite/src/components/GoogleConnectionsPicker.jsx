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
  normalizeGa4Id,
  normalizeGscProperty,
  clearPropertyCache
} from '../lib/googleProperties.js';

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
//                           — per-API account binding shown as a small
//                             badge under each property dropdown so the
//                             operator can see which account this
//                             client's GA4 vs GSC live in.
export default function GoogleConnectionsPicker({
  ga4Value, onChangeGa4,
  gscValue, onChangeGsc,
  savedEmail, onChangeEmail,
  savedGa4Email, savedGscEmail
}) {
  const [signedIn, setSignedIn] = useState(!!getToken());
  const [email, setEmail] = useState(null);

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
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [apiErrors, setApiErrors] = useState([]); // structured API-disabled errors

  // Manual entry fallbacks
  const [manualGa4, setManualGa4] = useState(false);
  const [manualGsc, setManualGsc] = useState(false);
  const [ga4Local, setGa4Local] = useState(ga4Value || '');
  const [gscLocal, setGscLocal] = useState(gscValue || '');

  useEffect(() => setGa4Local(ga4Value || ''), [ga4Value]);
  useEffect(() => setGscLocal(gscValue || ''), [gscValue]);

  // Load properties whenever we're signed in.
  useEffect(() => {
    if (!signedIn) { setGa4Props([]); setGscSites([]); return; }
    loadProperties();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  async function loadProperties({ bypassCache = false } = {}) {
    setLoading(true); setErr(''); setApiErrors([]);
    const errors = [];
    let genericErr = '';

    const ga = await fetchGa4Properties({ bypassCache }).catch(e => {
      console.error('GA4 fetch failed', e);
      if (e.apiDisabled) errors.push({ service: 'GA4 Admin', message: e.message, enableUrl: e.enableUrl });
      else genericErr += (genericErr ? ' · ' : '') + 'GA4: ' + e.message;
      return [];
    });
    const sites = await fetchGscSites({ bypassCache }).catch(e => {
      console.error('GSC fetch failed', e);
      if (e.apiDisabled) errors.push({ service: 'Search Console', message: e.message, enableUrl: e.enableUrl });
      else genericErr += (genericErr ? ' · ' : '') + 'GSC: ' + e.message;
      return [];
    });
    const e = await getCurrentEmail();

    setEmail(e);
    setGa4Props(ga);
    setGscSites(sites);
    setApiErrors(errors);
    if (genericErr) setErr(genericErr);
    setLoading(false);
    // NOTE: we deliberately do NOT auto-bind the currently signed-in account
    // to the client here. Doing so silently rebound a client to whatever
    // account the browser was signed into when you opened/switched to it —
    // corrupting clients whose properties live in a different account (you'd
    // see "saved property not visible to <wrong account>"). Binding now only
    // happens through deliberate actions: picking a property (sets the per-API
    // ga4/gsc account), the explicit "Use this account" button, or Switch
    // account.
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
  function commitGa4Manual() {
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
  function commitGscManual() {
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

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <strong>Google Connections</strong>
        <div className="row" style={{ gap: 8 }}>
          {!signedIn && (
            <button onClick={doSignIn} style={{ borderColor: '#4F8EF7', color: '#4F8EF7' }}>
              Sign in with Google
            </button>
          )}
          {signedIn && (
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

      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Sign in with Google to pick GA4 properties and Search Console sites from a dropdown,
        or enter them manually below. Your clients are spread across 6 accounts — use Switch account
        to sign into each one when setting up clients.
      </div>

      {savedEmail && (
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
            {signedIn && !loading && (
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
        {signedIn && !manualGa4 && ga4Props.length > 0 ? (
          <>
            <select value={ga4Value || ''} onChange={e => onChangeGa4(e.target.value, e.target.value ? email : null)}>
              <option value="">— pick a property —</option>
              {ga4SavedMissing && (
                <option value={ga4Value}>Saved · {ga4Value} (not visible to {email || 'this account'})</option>
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
                The saved property <span className="mono">{ga4Value}</span> isn't in this Google account's list. It's still preserved — Switch account if you need to repick.
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
        {signedIn && !manualGa4 && ga4Props.length === 0 && !loading && (
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            No GA4 properties visible to {email || 'this account'}. Try Switch account.
          </div>
        )}
      </div>

      {/* GSC row */}
      <div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <label style={{ margin: 0 }}>
            Search Console Property
            {signedIn && !loading && (
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
        {signedIn && !manualGsc && gscSites.length > 0 ? (
          <select value={gscValue || ''} onChange={e => onChangeGsc(e.target.value, e.target.value ? email : null)}>
            <option value="">— pick a property —</option>
            {gscSavedMissing && (
              <option value={gscValue}>Saved · {gscValue} (not visible to {email || 'this account'})</option>
            )}
            {gscSites.map(s => (
              <option key={s.siteUrl} value={s.siteUrl}>
                {s.siteUrl} ({s.permissionLevel})
              </option>
            ))}
          </select>
        ) : null}
        {signedIn && !manualGsc && gscSites.length > 0 && gscSavedMissing && (
          <div style={{ color: 'var(--orange)', fontSize: 11, marginTop: 4 }}>
            The saved property <span className="mono">{gscValue}</span> isn't in this Google account's list. It's still preserved — Switch account if you need to repick.
          </div>
        )}
        {savedGscEmail && (
          <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
            Search Console fetches use <span className="mono">{savedGscEmail}</span>
          </div>
        )}
        {!(signedIn && !manualGsc && gscSites.length > 0) && (
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
        {signedIn && !manualGsc && gscSites.length === 0 && !loading && (
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            No Search Console sites visible to {email || 'this account'}. Try Switch account.
          </div>
        )}
      </div>
    </div>
  );
}
