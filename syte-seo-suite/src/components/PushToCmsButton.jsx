import React, { useState } from 'react';
import { useClients } from '../store/useClients.js';
import { pushItemInline, clientIsConnected } from '../modules/cms/pushAction.js';

// Reusable inline "Push to CMS" button. Drop it next to any generated
// output with an `item` prop shaped like a virtual queue row.
//
// Props:
//   - item: { module, page_url, page_title, change_type, payload }
//   - client?: the client this item belongs to. REQUIRED anywhere the view
//     lists more than one client's content. Without it the button falls back
//     to the globally selected client, which in a multi-client list is
//     whatever happens to be in the dropdown — that published one client's
//     article to a different client's website.
//   - label?: override button text (default "Push to CMS")
//   - onSuccess?: (result) => void
//   - disabled?: bool
// `compact` matches the smaller buttons this sits beside in dense lists
// (Mark as Implemented, .txt, Delete). Without it this button renders at the
// default size and towers over its neighbours.
export default function PushToCmsButton({ item, client: clientProp, label = 'Push to CMS', onSuccess, disabled, compact = false }) {
  const selected = useClients(s => s.current());
  const client = clientProp || selected;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  const connected = clientIsConnected(client);

  async function go() {
    if (!client) { setErr('Select a client first.'); return; }
    if (!connected) {
      setErr('This client has no CMS connection yet. Open the CMS module → Connector to set one up.');
      return;
    }
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await pushItemInline(client, item);
      setResult(r);
      onSuccess?.(r);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button
        onClick={go}
        disabled={disabled || busy || !client}
        style={{
          borderColor: 'var(--mod-cms)',
          color: 'var(--mod-cms)',
          ...(compact ? { fontSize: 11, padding: '5px 14px' } : {})
        }}
        title={!connected ? 'Connect a CMS first (CMS module → Connector)' : 'Push to ' + (client?.cms_type || 'CMS')}
      >
        {busy ? 'Pushing…' : result ? 'Pushed ✓' : label}
      </button>
      {result?.admin_url && (
        <a href={result.admin_url} target="_blank" rel="noreferrer" style={{ color: 'var(--mod-cms)', fontSize: 12 }}>
          Review in admin →
        </a>
      )}
      {result?.live_url && (
        <a href={result.live_url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          {result.live_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
        </a>
      )}
      {err && <span style={{ color: 'var(--red)', fontSize: 12 }}>{err}</span>}
    </span>
  );
}
