// "Connect once" Google accounts manager. Only rendered when server-side
// Google auth is enabled (VITE_GOOGLE_SERVER_AUTH). Lets the operator connect
// each agency Google account a single time — the refresh token lives
// server-side after that, so reports never re-prompt for sign-in.
import React, { useEffect, useState } from 'react';
import {
  serverAuthEnabled,
  listConnectedAccounts,
  connectGoogleAccount,
  revokeConnectedAccount
} from '../lib/googleServerAuth.js';

export default function GoogleServerAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function refresh() {
    setErr('');
    try {
      setAccounts(await listConnectedAccounts());
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (serverAuthEnabled()) refresh(); }, []);

  if (!serverAuthEnabled()) return null;

  async function onConnect() {
    setBusy(true);
    try {
      await connectGoogleAccount();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(email) {
    setBusy(true);
    try {
      await revokeConnectedAccount(email);
      await refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <strong>Connected Google Accounts</strong>
      <div className="muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 12 }}>
        Connect each Google account once. Reports then pull GA4 + GSC data without
        ever prompting you to sign in again. (GA4/GSC still need the account added
        with per-property permission inside Google itself.)
      </div>

      {loading && <div className="muted" style={{ fontSize: 12 }}>Loading…</div>}
      {err && <div style={{ color: 'var(--orange)', fontSize: 12, marginBottom: 8 }}>{err}</div>}

      {!loading && accounts.length === 0 && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>No accounts connected yet.</div>
      )}

      {accounts.map(a => (
        <div key={a.email} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 13 }}>
            {a.revoked
              ? <span style={{ color: 'var(--red)' }}>● </span>
              : <span style={{ color: 'var(--green)' }}>● </span>}
            {a.email}
            {a.revoked && <span className="muted" style={{ fontSize: 11 }}> — expired, reconnect</span>}
          </span>
          <button onClick={() => onRevoke(a.email)} disabled={busy} style={{ color: 'var(--red)', fontSize: 12 }}>
            Disconnect
          </button>
        </div>
      ))}

      <button className="primary" onClick={onConnect} disabled={busy} style={{ marginTop: 12 }}>
        {busy ? 'Working…' : '+ Connect a Google account'}
      </button>
    </div>
  );
}
