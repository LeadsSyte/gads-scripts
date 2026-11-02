import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase.js';
import { proxyAuthHash } from '../cms/proxyAuth.js';
import { FixControls } from './TechAutopilotPanel.jsx';

// Preview → Apply on the site → Undo for ONE task on the Technical SEO board.
//
// Until Nov 2026 every task offered "Push to CMS", which refused ("can't be
// applied to a page automatically — a push would create a separate draft
// post") while the real apply path only existed in the Autopilot panel, for
// the Autopilot's own scan. Chris pushed, got the refusal, and had nowhere
// else to go. This is the same control the panel uses, for any task: the
// server (techfix-background) previews the exact change, applies it, reads
// it back, checks the live page, and can put it back.
const BUSY = ['planning', 'applying', 'undoing'];

export function siteConnected(client) {
  return (client?.cms_type === 'WordPress' && !!(client.wp_url && client.wp_username && client.wp_app_password))
    || (client?.cms_type === 'Shopify' && !!(client.shopify_store && client.shopify_token));
}

export default function ApplyFixControls({ task, client, accent }) {
  const [fix, setFix] = useState(null);
  const [err, setErr] = useState('');

  async function refresh() {
    if (!client || !task?.id || !supabase) return;
    const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', 'techfix:' + client.id + ':' + task.id).maybeSingle();
    setFix(data?.data || null);
  }
  useEffect(() => { setErr(''); refresh(); }, [client?.id, task?.id]);
  const busy = BUSY.includes(fix?.status);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [busy, client?.id, task?.id]);

  async function act(action) {
    setErr('');
    try {
      const res = await fetch('/.netlify/functions/techfix-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
        body: JSON.stringify({ clientId: client.id, taskId: task.id, action })
      });
      if (res.status !== 202) throw new Error('The server refused (' + res.status + ').');
      setFix(f => ({ ...(f || {}), status: { plan: 'planning', apply: 'applying', undo: 'undoing' }[action], error: '' }));
      setTimeout(refresh, 2500);
    } catch (e) { setErr(e.message); }
  }

  if (!client || !task?.id) return null;
  return (
    <div style={{ width: '100%' }}>
      <FixControls entry={{ task, apply: fix }} wpConnected={siteConnected(client)} accent={accent}
        onPlan={() => act('plan')} onApply={() => act('apply')} onUndo={() => act('undo')} />
      {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{err}</div>}
    </div>
  );
}
