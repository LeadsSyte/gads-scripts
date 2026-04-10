import React, { useState, useEffect } from 'react';
import { decryptApiKey, setStoredApiKey, getStoredApiKey } from '../lib/auth.js';

export default function LockScreen({ onUnlock }) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const existing = getStoredApiKey();
    if (existing) onUnlock();
  }, [onUnlock]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const key = await decryptApiKey(password);
      if (!key || !key.startsWith('sk-')) throw new Error('Invalid password');
      setStoredApiKey(key);
      onUnlock();
    } catch (e) {
      setErr('Wrong password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lock-screen">
      <form className="lock-box" onSubmit={submit}>
        <h1 style={{ margin: 0, marginBottom: 4 }}>Syte SEO Suite</h1>
        <div className="muted" style={{ marginBottom: 24, fontSize: 13 }}>Enter suite password to unlock</div>
        <input
          type="password"
          autoFocus
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        {err && <div style={{ color: 'var(--red)', marginTop: 10, fontSize: 12 }}>{err}</div>}
        <button type="submit" className="primary" style={{ width: '100%', marginTop: 16 }} disabled={busy}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
