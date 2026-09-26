import React, { useState, useEffect, useRef } from 'react';
import { useClients } from '../../store/useClients.js';
import { supabase, updateClientFields } from '../../lib/supabase.js';
import { proxyAuthHash } from '../cms/proxyAuth.js';
import { getPublishingProfile } from '../cms/publishingProfile.js';

// AEO Autopilot: the server picks this month's pages, generates their AEO
// optimisations (same rules as "Run Optimizations" below), and a second AI
// checks each one against the live page. Results land in the AEO Engine;
// ones the page already has are dropped. Nothing changes on the website.
// See netlify/functions/lib/aeoScan.js.

const ACTIVE = ['queued', 'discovering', 'generating', 'checking', 'saving'];
const STATUS_TEXT = {
  queued: 'Starting…', discovering: 'Finding the site\'s pages…', generating: 'Writing optimisations…',
  checking: 'Checking each one against the live page…', saving: 'Saving to the AEO Engine…',
  done: 'Finished', failed: 'Stopped with an error'
};
const VERDICT = {
  confirmed: { label: 'confirmed', color: 'var(--green)' },
  fix_wrong: { label: 'looks wrong', color: 'var(--red)' },
  needs_human: { label: 'needs a human', color: 'var(--orange, #e8a33d)' },
  false_alarm: { label: 'removed', color: 'var(--text-dim)' }
};

// Same key as aeoOptKey in AEOEngine.jsx (type::name).
const optKeyOf = o => (o.type || '') + '::' + (o.name || o.title || '');

// Preview in the page → Add to the page → (Undo). The preview is the real
// page in the client's design with the section in place.
function AeoFixControls({ fix, wpConnected, accent, onAction }) {
  const f = fix || {};
  const btn = { fontSize: 11, padding: '3px 10px' };
  const note = (text, color) => <div style={{ fontSize: 11, marginTop: 4, color: color || 'var(--text-muted)' }}>{text}</div>;
  if (!wpConnected) return note('Add by hand — no working WordPress connection.');
  if (f.status === 'planning') return note('Checking the page and building the preview…');
  if (f.status === 'applying') return note('Adding it to the page and checking the live site…');
  if (f.status === 'undoing') return note('Removing it from the page…');
  if (f.status === 'manual') return note('Add by hand: ' + f.reason, 'var(--orange, #e8a33d)');
  const row = { gap: 6, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' };
  if (f.status === 'applied') {
    return (
      <div className="row" style={row}>
        <span style={{ fontSize: 11, color: f.live?.status === 'verified' ? 'var(--green)' : 'var(--orange, #e8a33d)' }}>
          {f.live?.status === 'verified' ? '✓ Added and live on the page.' : '✓ Added in WordPress. ' + (f.live?.detail || '')}
        </span>
        <button className="ghost" style={btn} onClick={() => onAction('undo')}>Undo</button>
        {f.error && note(f.error, 'var(--red)')}
      </div>
    );
  }
  return (
    <div>
      {f.status === 'failed' && note('Didn\'t work: ' + (f.error || ''), 'var(--red)')}
      {f.status === 'removed' && note('Removed from the page.')}
      {f.status === 'planned' && f.error && note(f.error, 'var(--orange, #e8a33d)')}
      {f.status === 'planned' && note('Goes at the ' + (f.plan?.position === 'top' ? 'top of the page content' : 'end of the page content') + '.')}
      <div className="row" style={row}>
        {f.status !== 'planned' && <button className="ghost" style={btn} onClick={() => onAction('plan')}>Preview in the page</button>}
        {f.status === 'planned' && (
          <>
            {f.preview_url && <a href={f.preview_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: accent }}>Open preview →</a>}
            <button className="primary" style={{ ...btn, background: accent, borderColor: accent, color: '#0a0a0c' }} onClick={() => onAction('apply')}>Add to the page</button>
            <button className="ghost" style={btn} onClick={() => onAction('plan')}>Refresh preview</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function AeoAutopilotPanel({ accent, onFinished }) {
  const client = useClients(s => s.current());
  const load = useClients(s => s.load);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirming, setConfirming] = useState(false);
  const wasActive = useRef(false);

  const [fixes, setFixes] = useState({}); // url|optKey → aeofix status

  async function refresh() {
    if (!client || !supabase) { setState(null); return; }
    const [{ data }, { data: fixRows }] = await Promise.all([
      supabase.from('syte_suite_settings').select('data').eq('id', 'aeoscan:' + client.id).maybeSingle(),
      // Each addition's preview/apply status has its own row (aeofix-background.js).
      supabase.from('syte_suite_settings').select('data').like('id', 'aeofix:' + client.id + ':%')
    ]);
    const s = data?.data?.client_id === client.id ? data.data : null;
    setFixes(Object.fromEntries((fixRows || []).map(r => [r.data?.url + '|' + r.data?.opt_key, r.data])));
    setState(s);
    const active = !!s && ACTIVE.includes(s.status);
    if (wasActive.current && !active && onFinished) onFinished();
    wasActive.current = active;
  }

  useEffect(() => { setErr(''); setConfirming(false); wasActive.current = false; refresh(); }, [client?.id]);
  const fixBusy = Object.values(fixes).some(f => ['planning', 'applying', 'undoing'].includes(f?.status));
  useEffect(() => {
    if (!state || (!ACTIVE.includes(state.status) && !fixBusy)) return;
    const t = setInterval(refresh, fixBusy ? 3000 : 8000);
    return () => clearInterval(t);
  }, [state?.status, client?.id, fixBusy]);

  async function fixAction(url, optKey, action) {
    setErr('');
    try {
      const res = await fetch('/.netlify/functions/aeofix-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
        body: JSON.stringify({ clientId: client.id, url, optKey, action })
      });
      if (res.status !== 202) throw new Error('The server refused (' + res.status + ').');
      const busyStatus = { plan: 'planning', apply: 'applying', undo: 'undoing' }[action];
      setFixes(f => ({ ...f, [url + '|' + optKey]: { ...(f[url + '|' + optKey] || {}), status: busyStatus, error: '' } }));
      setTimeout(refresh, 2500);
    } catch (e) { setErr(e.message); }
  }

  if (!client) return null;
  const profile = getPublishingProfile(client);
  const active = state && ACTIVE.includes(state.status);
  const wpConnected = client.cms_type === 'WordPress' && !!(client.wp_url && client.wp_username && client.wp_app_password);

  async function start() {
    setConfirming(false); setBusy(true); setErr('');
    try {
      const res = await fetch('/.netlify/functions/aeoscan-run-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
        body: JSON.stringify({ clientId: client.id })
      });
      if (res.status !== 202) throw new Error('The server refused the run (' + res.status + ').');
      setState({ client_id: client.id, status: 'queued', rows: null, log: [] });
      wasActive.current = true;
      setTimeout(refresh, 4000);
      // A background function answers 202 before it runs, even when it then
      // refuses — confirm the run actually wrote its state.
      const askedAt = Date.now();
      setTimeout(async () => {
        const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', 'aeoscan:' + client.id).maybeSingle();
        if (new Date(data?.data?.updated_at || 0).getTime() < askedAt - 5000) {
          setErr('The server did not start the run. Check that the suite is unlocked with the current password, then try again.');
          refresh();
        }
      }, 30000);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function toggleMonthly(on) {
    setBusy(true); setErr('');
    try {
      await updateClientFields(client.id, { publishing_profile: { ...profile, aeoscan_enabled: on } });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const rows = state?.rows || [];
  const items = rows.flatMap(r => (r.optimizations || []).map(o => ({ url: r.url, o })));
  const count = v => items.filter(x => x.o.check?.verdict === v).length;

  return (
    <div className="card" style={{ borderLeft: '4px solid ' + accent, marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <strong>AEO Autopilot · {client.name}</strong>
          <div className="muted" style={{ fontSize: 12 }}>
            The server picks this month's pages, writes their AEO optimisations, and a second AI checks each one against the
            live page and the client's website. Results appear in the AEO Engine; anything the page already has is dropped.
            Nothing is changed on the website.
          </div>
        </div>
        {!active && !confirming && (
          <button className="primary" disabled={busy} onClick={() => setConfirming(true)}
            style={{ background: accent, borderColor: accent, color: '#0a0a0c', fontSize: 12 }}>
            Run now
          </button>
        )}
      </div>

      {confirming && !active && (
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', fontSize: 12 }}>
          <span>Run AEO optimisations for {client.name} now? Takes a few minutes; results are saved to the AEO Engine.</span>
          <button className="primary" disabled={busy} onClick={start}
            style={{ background: accent, borderColor: accent, color: '#0a0a0c', fontSize: 12 }}>Yes, start</button>
          <button className="ghost" onClick={() => setConfirming(false)} style={{ fontSize: 12 }}>Cancel</button>
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 0', cursor: 'pointer', width: 'fit-content' }}>
        <input type="checkbox" checked={!!profile.aeoscan_enabled} disabled={busy}
          onChange={e => toggleMonthly(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
        Run automatically on the 3rd of every month
      </label>

      {err && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div>}

      {state && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <div>
            <b>{STATUS_TEXT[state.status] || state.status}</b>
            {state.plan && <span className="muted"> · {state.plan.found} pages found</span>}
            {items.length > 0 && (
              <span className="muted"> · {count('confirmed')} confirmed, {count('fix_wrong')} look wrong, {count('needs_human')} need a human, {count('false_alarm')} removed</span>
            )}
          </div>
          {state.error && <div style={{ color: 'var(--red)', marginTop: 4 }}>{state.error}</div>}
          {!active && state.report?.sent_at && <div className="muted" style={{ marginTop: 4 }}>Summary emailed to {(state.report.to || []).join(', ')}.</div>}
          {!active && state.report?.error && <div style={{ marginTop: 4, color: 'var(--orange, #e8a33d)' }}>Summary email not sent: {state.report.error}</div>}

          {items.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <tbody>
                {items.map((x, i) => {
                  const v = x.o.check ? VERDICT[x.o.check.verdict] : null;
                  return (
                    <tr key={i}>
                      <td style={{ width: 120, verticalAlign: 'top' }}>
                        {v ? <span style={{ color: v.color, fontWeight: 600 }}>{v.label}</span>
                           : <span className="muted">{active ? 'waiting' : '–'}</span>}
                      </td>
                      <td>
                        <div style={{ textDecoration: x.o.check?.verdict === 'false_alarm' ? 'line-through' : 'none' }}>
                          {x.o.name || x.o.type} <span className="muted">· {x.o.type}</span>
                        </div>
                        <div className="muted" style={{ fontSize: 11 }}>{x.url}</div>
                        {x.o.check?.reason && <div style={{ fontSize: 11, color: v?.color }}>{x.o.check.reason}</div>}
                        {!active && x.o.check?.verdict === 'confirmed' && (x.o.type === 'content' || x.o.type === 'schema') && (
                          <AeoFixControls fix={fixes[x.url + '|' + optKeyOf(x.o)]} wpConnected={wpConnected} accent={accent}
                            onAction={a => fixAction(x.url, optKeyOf(x.o), a)} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {active && state.log?.length > 0 && (
            <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>{state.log[state.log.length - 1]}</div>
          )}
        </div>
      )}
    </div>
  );
}
