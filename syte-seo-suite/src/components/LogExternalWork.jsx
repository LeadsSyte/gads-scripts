import React, { useState } from 'react';
import { useClients } from '../store/useClients.js';
import { corsFetch } from '../lib/corsProxy.js';

// Shared "Log External Work" card. Lets employees register manually-done
// work (blog posts, AEO optimizations) so it counts toward the client's
// monthly pipeline quota. Verifies the URL is live before logging.
//
// Props:
//   module    — 'content' | 'aeo'
//   accent    — color string
//   onLog(entry) — called with { clientId, clientName, url, title, verifiedAt }
//                   after URL verification succeeds. Parent persists to Supabase.
export default function LogExternalWork({ module, accent, onLog }) {
  const clients = useClients(s => s.clients);
  const topClient = useClients(s => s.current());

  const [clientId, setClientId] = useState(topClient?.id || '');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, message }

  React.useEffect(() => {
    if (!clientId && topClient?.id) setClientId(topClient.id);
  }, [topClient?.id]);

  async function verify() {
    const u = url.trim();
    if (!u) { setResult({ ok: false, message: 'Enter a URL.' }); return; }
    if (!clientId) { setResult({ ok: false, message: 'Select a client.' }); return; }
    try { new URL(u); } catch { setResult({ ok: false, message: 'Enter a valid URL.' }); return; }

    setBusy(true); setResult(null);
    try {
      const res = await corsFetch(u);
      if (!res.ok) throw new Error('HTTP ' + res.status);

      // Extract page title if not provided.
      let pageTitle = title.trim();
      if (!pageTitle) {
        try {
          const html = await res.text();
          const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (m) pageTitle = m[1].trim();
        } catch {}
      }
      if (!pageTitle) {
        try { pageTitle = new URL(u).pathname.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || u; } catch { pageTitle = u; }
      }

      const c = clients.find(x => x.id === clientId);
      const entry = {
        clientId,
        clientName: c?.name || '',
        url: u,
        title: pageTitle,
        verifiedAt: new Date().toISOString()
      };
      await onLog(entry);
      setResult({ ok: true, message: `Verified & logged: "${pageTitle}" for ${c?.name || 'client'}` });
      setUrl('');
      setTitle('');
    } catch (e) {
      setResult({ ok: false, message: 'URL not reachable: ' + (e.message || 'unknown error') + '. Check the URL is correct and the page is live.' });
    } finally {
      setBusy(false);
    }
  }

  const label = module === 'content' ? 'article / blog post' : 'AEO optimization';

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ margin: '0 0 4px' }}>Log External Work</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Manually wrote a {label} outside the tool? Paste the live URL below and it will be verified and counted toward the client's monthly quota.
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 180 }}>
          <label>Client</label>
          <select
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            disabled={busy}
            style={{ width: '100%' }}
          >
            <option value="">— Select —</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 2, minWidth: 240 }}>
          <label>Live URL</label>
          <input
            type="url"
            placeholder="https://client-site.com/the-published-page/"
            value={url}
            onChange={e => setUrl(e.target.value)}
            disabled={busy}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label>Title (optional — auto-detected)</label>
          <input
            type="text"
            placeholder="Page title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            disabled={busy}
            style={{ width: '100%' }}
          />
        </div>
        <button
          className="primary"
          style={{ background: accent, borderColor: accent, color: '#0a0a0c', whiteSpace: 'nowrap' }}
          onClick={verify}
          disabled={busy || !clientId || !url.trim()}
        >
          {busy ? 'Verifying…' : 'Verify & Log'}
        </button>
      </div>
      {result && (
        <div style={{
          marginTop: 10, padding: 10, borderRadius: 6, fontSize: 12,
          background: result.ok ? 'rgba(52,211,153,.08)' : 'rgba(255,77,77,.06)',
          border: '1px solid ' + (result.ok ? 'rgba(52,211,153,.2)' : 'rgba(255,77,77,.2)'),
          color: result.ok ? 'var(--green)' : 'var(--red)'
        }}>
          {result.message}
        </div>
      )}
    </div>
  );
}
