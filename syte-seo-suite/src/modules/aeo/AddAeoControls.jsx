import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase.js';
import { proxyAuthHash } from '../cms/proxyAuth.js';
import { AeoFixControls } from './AeoAutopilotPanel.jsx';
import { siteConnected } from '../technical/ApplyFixControls.jsx';

// Preview in the page → Add to the page → Undo for ONE optimisation on the
// AEO Engine page. Replaces the "Push to CMS" button there, which refused
// ("a push would create a separate draft post") — see ApplyFixControls.jsx.
// The server (aeofix-background) finds the optimisation by page URL and key
// in the saved AEO results, previews it inside the page, adds it between
// markers so it can be removed exactly, and reads the page back.
const BUSY = ['planning', 'applying', 'undoing'];

export default function AddAeoControls({ client, url, optKey, accent }) {
  const [fix, setFix] = useState(null);
  const [err, setErr] = useState('');

  async function refresh() {
    if (!client || !url || !optKey || !supabase) return;
    const { data } = await supabase.from('syte_suite_settings').select('data').like('id', 'aeofix:' + client.id + ':%');
    setFix((data || []).map(r => r.data).find(d => d?.url === url && d?.opt_key === optKey) || null);
  }
  useEffect(() => { setErr(''); refresh(); }, [client?.id, url, optKey]);
  const busy = BUSY.includes(fix?.status);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [busy, client?.id, url, optKey]);

  async function act(action) {
    setErr('');
    try {
      const res = await fetch('/.netlify/functions/aeofix-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
        body: JSON.stringify({ clientId: client.id, url, optKey, action })
      });
      if (res.status !== 202) throw new Error('The server refused (' + res.status + ').');
      setFix(f => ({ ...(f || {}), status: { plan: 'planning', apply: 'applying', undo: 'undoing' }[action], error: '' }));
      setTimeout(refresh, 2500);
    } catch (e) { setErr(e.message); }
  }

  if (!client || !url || !optKey) return null;
  return (
    <div style={{ width: '100%' }}>
      <AeoFixControls fix={fix} wpConnected={siteConnected(client)} accent={accent} onAction={act} />
      {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{err}</div>}
    </div>
  );
}
