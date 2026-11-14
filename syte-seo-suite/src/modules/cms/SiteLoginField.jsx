import React, { useState, useEffect } from 'react';
import { fnUrl } from '../../lib/fnUrl.js';

// "Website login" on CMS → Connector: for client sites with no API
// connection (custom sites, Wix, Propdata…), the login the Grok bot uses to
// make changes by hand. Chris, 12 Nov 2026. Saved straight to a server-only
// table by netlify/functions/site-login.js — not with "Save Profile" — and the
// password is never shown again; the bot gets it only for a job it is doing.
export default function SiteLoginField({ client, disabled }) {
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState({ login_url: '', username: '', password: '', notes: '' });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function call(body) {
    const res = await fetch(fnUrl('site-login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await (globalThis.__SYTE_AUTH_HEADERS?.() ?? {})) },
      body: JSON.stringify({ clientId: client.id, ...body })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'The suite refused (' + res.status + ').');
    return j;
  }
  useEffect(() => {
    if (!client?.id) return;
    let live = true;
    setInfo(null); setEditing(false); setErr(''); setMsg('');
    call({ action: 'get' }).then(j => { if (live) setInfo(j); }).catch(e => { if (live) { setInfo({ set: false }); setErr(e.message); } });
    return () => { live = false; };
  }, [client?.id]);

  const startEdit = () => {
    setForm({ login_url: info?.login_url || client?.url || '', username: info?.username || '', password: '', notes: info?.notes || '' });
    setEditing(true); setErr(''); setMsg('');
  };
  async function save() {
    setBusy(true); setErr(''); setMsg('');
    try { const j = await call({ action: 'save', ...form }); setInfo(j); setEditing(false); setMsg('Saved.'); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function clear() {
    setBusy(true); setErr(''); setMsg('');
    try { const j = await call({ action: 'clear' }); setInfo(j); setEditing(false); setMsg('Removed.'); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  if (!client?.id) return null;
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const small = { fontSize: 11, padding: '3px 10px' };
  return (
    <div style={{ marginTop: 14 }}>
      <label style={{ margin: 0 }}>Website login (for the Grok bot)</label>
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        For sites the suite can't connect to (custom sites, Wix, Propdata…): the login the Grok bot uses to make technical and
        AEO changes by hand. It is stored server-side, never shown again, and given to the bot only while it works on a job for
        this client. Saved straight away — not with Save Profile.
      </div>
      {!editing && (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          {info === null ? <span className="muted">Loading…</span>
            : info.set ? <>✓ <strong>{info.username}</strong>{info.login_url ? <> at <a href={info.login_url} target="_blank" rel="noreferrer">{info.login_url}</a></> : null} — password stored{info.updated_at ? ' (saved ' + String(info.updated_at).slice(0, 10) + ')' : ''}{info.notes ? <div className="muted">{info.notes}</div> : null}</>
            : <span className="muted">None stored. The bot uses the Grok Vault login, if there is one.</span>}
        </div>
      )}
      {editing ? (
        <div style={{ display: 'grid', gap: 6, marginTop: 6, maxWidth: 520 }}>
          <input aria-label="Login page" placeholder="Login page, e.g. https://example.co.za/admin" value={form.login_url} onChange={set('login_url')} disabled={busy} />
          <input aria-label="Username" placeholder="Username or email" value={form.username} onChange={set('username')} disabled={busy} autoComplete="off" />
          <input aria-label="Password" type="password" placeholder={info?.has_password ? 'Password (leave blank to keep the stored one)' : 'Password'} value={form.password} onChange={set('password')} disabled={busy} autoComplete="new-password" />
          <input aria-label="Notes" placeholder="Notes for the bot (e.g. 2FA goes to Chris's phone; editor is under Pages)" value={form.notes} onChange={set('notes')} disabled={busy} />
          <div className="row" style={{ gap: 6 }}>
            <button style={small} disabled={busy || disabled} onClick={save}>{busy ? 'Saving…' : 'Save login'}</button>
            <button className="ghost" style={small} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <button className="ghost" style={small} disabled={disabled || info === null} onClick={startEdit}>{info?.set ? 'Change login' : 'Add a login'}</button>
          {info?.set && <button className="ghost" style={small} disabled={busy || disabled} onClick={clear}>Remove</button>}
        </div>
      )}
      {msg && <div style={{ fontSize: 11, marginTop: 4 }}>✓ {msg}</div>}
      {err && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 4 }}>{err}</div>}
    </div>
  );
}
