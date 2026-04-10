import React, { useState, useEffect } from 'react';
import { unlockWithPassword, getStoredApiKey } from '../lib/auth.js';

export default function LockScreen({ onUnlock }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getStoredApiKey()) onUnlock();
  }, [onUnlock]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await unlockWithPassword(password);
      onUnlock();
    } catch {
      setError('Incorrect password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: 380,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 32,
        }}
      >
        <h1 className="h1-title" style={{ marginBottom: 8 }}>
          Syte SEO Suite
        </h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 24, fontSize: 13 }}>
          Enter the shared password to unlock.
        </p>
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          placeholder="••••••••"
        />
        {error && (
          <div className="badge red" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
        <button
          type="submit"
          className="primary"
          disabled={busy || !password}
          style={{ width: '100%', marginTop: 20 }}
        >
          {busy ? 'Unlocking...' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
