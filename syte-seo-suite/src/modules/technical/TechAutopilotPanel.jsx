import React, { useState, useEffect, useRef } from 'react';
import { useClients } from '../../store/useClients.js';
import { supabase, updateClientFields } from '../../lib/supabase.js';
import { proxyAuthHash } from '../cms/proxyAuth.js';
import { getPublishingProfile } from '../cms/publishingProfile.js';

// Tech Autopilot: the server crawls the selected client's site, writes the
// fix list, and has a second AI check every fix against the live page.
// Confirmed fixes land on the Task Board; false alarms are dropped and shown
// here. Nothing is changed on the client's site.
// See netlify/functions/lib/techScan.js.

const ACTIVE = ['queued', 'scanning', 'triaging', 'checking', 'saving'];
const STATUS_TEXT = {
  queued: 'Starting…', scanning: 'Crawling the site…', triaging: 'Writing the fix list…',
  checking: 'Checking each fix against the live page…', saving: 'Updating the task board…',
  done: 'Finished', failed: 'Stopped with an error'
};
const VERDICT = {
  confirmed: { label: 'confirmed', color: 'var(--green)' },
  fix_wrong: { label: 'fix looks wrong', color: 'var(--red)' },
  needs_human: { label: 'needs a human', color: 'var(--orange, #e8a33d)' },
  false_alarm: { label: 'false alarm — removed', color: 'var(--text-dim)' }
};
const CHECKBOX_LABEL = { display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 0', cursor: 'pointer', width: 'fit-content' };

export default function TechAutopilotPanel({ accent, onFinished }) {
  const client = useClients(s => s.current());
  const load = useClients(s => s.load);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirming, setConfirming] = useState(false);
  const wasActive = useRef(false);

  async function refresh() {
    if (!client || !supabase) { setState(null); return; }
    const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', 'techscan:' + client.id).maybeSingle();
    const s = data?.data?.client_id === client.id ? data.data : null;
    setState(s);
    const active = !!s && ACTIVE.includes(s.status);
    if (wasActive.current && !active && onFinished) onFinished();
    wasActive.current = active;
  }

  useEffect(() => { setErr(''); setConfirming(false); wasActive.current = false; refresh(); }, [client?.id]);
  useEffect(() => {
    if (!state || !ACTIVE.includes(state.status)) return;
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [state?.status, client?.id]);

  if (!client) return null;
  const profile = getPublishingProfile(client);
  const active = state && ACTIVE.includes(state.status);

  async function start() {
    setConfirming(false); setBusy(true); setErr('');
    try {
      const res = await fetch('/.netlify/functions/techscan-run-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
        body: JSON.stringify({ clientId: client.id, restart: true })
      });
      if (res.status !== 202) throw new Error('The server refused the scan (' + res.status + ').');
      setState({ client_id: client.id, status: 'queued', tasks: null, log: [] });
      wasActive.current = true;
      setTimeout(refresh, 4000);
      // A background function answers 202 before it runs, even when it then
      // refuses — confirm the run actually wrote its state.
      const askedAt = Date.now();
      setTimeout(async () => {
        const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', 'techscan:' + client.id).maybeSingle();
        if (new Date(data?.data?.updated_at || 0).getTime() < askedAt - 5000) {
          setErr('The server did not start the scan. Check that the suite is unlocked with the current password, then try again.');
          refresh();
        }
      }, 30000);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function toggleMonthly(on) {
    setBusy(true); setErr('');
    try {
      await updateClientFields(client.id, { publishing_profile: { ...profile, techscan_enabled: on } });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const entries = state?.tasks || [];
  const count = v => entries.filter(e => e.check?.verdict === v).length;
  const order = { confirmed: 0, fix_wrong: 1, needs_human: 2, false_alarm: 3 };
  const sorted = [...entries].sort((a, b) => (order[a.check?.verdict] ?? 4) - (order[b.check?.verdict] ?? 4));

  return (
    <div className="card" style={{ borderLeft: '4px solid ' + accent, marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <strong>Tech Autopilot · {client.name}</strong>
          <div className="muted" style={{ fontSize: 12 }}>
            The server crawls the site, writes the fix list, and a second AI checks every fix against the live page.
            Confirmed fixes go on the Task Board (replacing this client's open tasks); false alarms are dropped.
            Nothing is changed on the website.
          </div>
        </div>
        {!active && !confirming && (
          <button className="primary" disabled={busy} onClick={() => setConfirming(true)}
            style={{ background: accent, borderColor: accent, color: '#0a0a0c', fontSize: 12 }}>
            Run scan now
          </button>
        )}
      </div>

      {confirming && !active && (
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', fontSize: 12 }}>
          <span>Scan {client.name} now? This replaces the client's open Technical SEO tasks with the new, checked list. Done work is kept.</span>
          <button className="primary" disabled={busy} onClick={start}
            style={{ background: accent, borderColor: accent, color: '#0a0a0c', fontSize: 12 }}>Yes, scan</button>
          <button className="ghost" onClick={() => setConfirming(false)} style={{ fontSize: 12 }}>Cancel</button>
        </div>
      )}

      <label style={CHECKBOX_LABEL}>
        <input type="checkbox" checked={!!profile.techscan_enabled} disabled={busy}
          onChange={e => toggleMonthly(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
        Scan automatically on the 2nd of every month
      </label>

      {err && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div>}

      {state && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <div>
            <b>{STATUS_TEXT[state.status] || state.status}</b>
            {state.crawl && <span className="muted"> · {state.crawl.pages} pages crawled, {state.crawl.with_issues} with issues</span>}
            {entries.length > 0 && (
              <span className="muted"> · {count('confirmed')} confirmed, {count('fix_wrong')} wrong fix, {count('needs_human')} need a human, {count('false_alarm')} false alarms</span>
            )}
          </div>
          {state.error && <div style={{ color: 'var(--red)', marginTop: 4 }}>{state.error}</div>}
          {!active && state.report?.sent_at && <div className="muted" style={{ marginTop: 4 }}>Summary emailed to {(state.report.to || []).join(', ')}.</div>}
          {!active && state.report?.error && <div style={{ marginTop: 4, color: 'var(--orange, #e8a33d)' }}>Summary email not sent: {state.report.error}</div>}

          {sorted.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <tbody>
                {sorted.map((e, i) => {
                  const v = e.check ? VERDICT[e.check.verdict] : null;
                  return (
                    <tr key={i}>
                      <td style={{ width: 130, verticalAlign: 'top' }}>
                        {v ? <span style={{ color: v.color, fontWeight: 600 }}>{v.label}</span>
                           : <span className="muted">{active ? 'waiting' : '–'}</span>}
                      </td>
                      <td>
                        <div style={{ textDecoration: e.check?.verdict === 'false_alarm' ? 'line-through' : 'none' }}>
                          {e.task.title}
                        </div>
                        <div className="muted" style={{ fontSize: 11 }}>{e.task.page_url}</div>
                        {e.check?.reason && <div style={{ fontSize: 11, color: v?.color }}>{e.check.reason}</div>}
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
