import React, { useState } from 'react';
import { useClients } from '../store/useClients.js';
import { pushItemInline, clientIsConnected } from '../modules/cms/pushAction.js';

// Reusable inline "Push to CMS" button. Drop it next to any generated
// output with an `item` prop shaped like a virtual queue row.
//
// Props:
//   - item: { module, page_url, page_title, change_type, payload }
//   - label?: override button text (default "Push to CMS")
//   - onSuccess?: (result) => void
//   - disabled?: bool
export default function PushToCmsButton({ item, label = 'Push to CMS', onSuccess, disabled }) {
  const client = useClients(s => s.current());
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
        style={{ borderColor: 'var(--mod-cms)', color: 'var(--mod-cms)' }}
        title={!connected ? 'Connect a CMS first (CMS module → Connector)' : 'Push to ' + (client?.cms_type || 'CMS')}
      >
        {busy ? 'Pushing…' : result ? 'Pushed ✓' : label}
      </button>
      {result?.admin_url && (
        <a href={result.admin_url} target="_blank" rel="noreferrer" style={{ color: 'var(--mod-cms)', fontSize: 12 }}>
          Review in admin →
        </a>
      )}
      {err && <span style={{ color: 'var(--red)', fontSize: 12 }}>{err}</span>}
    </span>
  );
}
