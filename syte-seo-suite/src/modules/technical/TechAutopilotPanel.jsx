import React, { useState, useEffect, useRef } from 'react';
import { useClients } from '../../store/useClients.js';
import { supabase, updateClientFields } from '../../lib/supabase.js';
import { proxyAuthHash } from '../cms/proxyAuth.js';
import { getPublishingProfile } from '../cms/publishingProfile.js';
import FixSheetButtons from '../../components/FixSheetButtons.jsx';

// Tech Autopilot: the server crawls the selected client's site, writes the
// fix list, and has a second AI check every fix against the live page.
// Confirmed fixes land on the Task Board; false alarms are dropped and shown
// here. The fixes the suite can make itself (titles, descriptions, alt text)
// are applied one by one, all at once ("Apply all"), or automatically after
// each scan when the client has that switched on — and each can be undone.
// See netlify/functions/lib/techScan.js and techFixRun.js.

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

// Fix types the suite can change on a WordPress site itself (see
// netlify/functions/lib/techFix.js AUTO_FIX_TYPES).
const AUTO_FIX = ['meta_title', 'meta_description', 'image_alt'];

// Fixes still to be made: confirmed, a kind the suite can change, and not
// already applied, undone by a person, or found to need a person.
const SETTLED = ['applied', 'undone', 'manual', 'not_needed'];
export const fixesToApply = entries => (entries || []).filter(e =>
  e.check?.verdict === 'confirmed' && AUTO_FIX.includes(e.task?.fix_type) && !SETTLED.includes(e.apply?.status));

// Preview → Apply → Undo for one fix. The preview shows exactly what will
// change; Apply changes only that, then checks the live page.
function FixControls({ entry, wpConnected, accent, onPlan, onApply, onUndo }) {
  const a = entry.apply || {};
  const btn = { fontSize: 11, padding: '3px 10px' };
  if (!wpConnected) return <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Apply by hand — no working WordPress connection.</div>;
  if (a.status === 'planning') return <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Reading the current value from the site…</div>;
  if (a.status === 'applying') return <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Applying and checking the live page…</div>;
  if (a.status === 'undoing') return <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Putting it back…</div>;
  if (a.status === 'not_needed') return <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{a.reason}</div>;
  if (a.status === 'manual') return <div style={{ fontSize: 11, marginTop: 4, color: 'var(--orange, #e8a33d)' }}>Apply by hand: {a.reason}</div>;
  if (a.status === 'applied') {
    return (
      <div style={{ fontSize: 11, marginTop: 4 }}>
        <div style={{ color: a.live?.status === 'verified' ? 'var(--green)' : 'var(--orange, #e8a33d)' }}>
          {a.live?.status === 'verified' ? '✓ Applied and live on the page.' : '✓ Applied in WordPress. ' + (a.live?.detail || '')}
        </div>
        {(a.results || []).filter(r => r.ok).map((c, i) => (
          <div key={i} className="muted" style={{ margin: '2px 0' }}>Was: {c.from ? '“' + c.from + '”' : '(empty)'} → Now: “{c.to}”</div>
        ))}
        {a.error && <div style={{ color: 'var(--orange, #e8a33d)' }}>{a.error}</div>}
        <button className="ghost" style={{ ...btn, marginTop: 4 }} onClick={onUndo}>Undo</button>
      </div>
    );
  }
  const changes = a.plan?.changes || [];
  return (
    <div style={{ marginTop: 6 }}>
      {a.status === 'undone' && <div className="muted" style={{ fontSize: 11 }}>Put back to what it was. {a.note}</div>}
      {a.status === 'waiting' && <div className="muted" style={{ fontSize: 11 }}>{a.reason}</div>}
      {a.status === 'failed' && <div style={{ fontSize: 11, color: 'var(--red)' }}>Didn't apply: {a.reason || (a.results || []).filter(r => !r.ok).map(r => r.error || r.label).join('; ')}</div>}
      {a.error && <div style={{ fontSize: 11, color: 'var(--orange, #e8a33d)' }}>{a.error}</div>}
      {a.status === 'planned' && changes.map((c, i) => (
        <div key={i} style={{ fontSize: 11, margin: '4px 0', padding: '6px 8px', background: 'var(--surface-2)', borderRadius: 6 }}>
          <div className="muted">{c.label}</div>
          <div><span className="muted">Now:</span> {c.from ? '“' + c.from + '”' : <em className="muted">(empty)</em>}</div>
          <div><span className="muted">New:</span> <b>“{c.to}”</b></div>
        </div>
      ))}
      {a.status === 'planned' && a.plan?.note && <div className="muted" style={{ fontSize: 11 }}>{a.plan.note}</div>}
      <div className="row" style={{ gap: 6, marginTop: 4 }}>
        {a.status !== 'planned' && <button className="ghost" style={btn} onClick={onPlan}>Preview change</button>}
        {a.status === 'planned' && (
          <>
            <button className="primary" style={{ ...btn, background: accent, borderColor: accent, color: '#0a0a0c' }} onClick={onApply}>Apply on the site</button>
            <button className="ghost" style={btn} onClick={onPlan}>Refresh preview</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function TechAutopilotPanel({ accent, onFinished }) {
  const client = useClients(s => s.current());
  const load = useClients(s => s.load);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const wasActive = useRef(false);

  async function refresh() {
    if (!client || !supabase) { setState(null); return; }
    const [{ data }, { data: fixRows }] = await Promise.all([
      supabase.from('syte_suite_settings').select('data').eq('id', 'techscan:' + client.id).maybeSingle(),
      // Each fix's preview/apply status lives in its own row (techfix-background.js).
      supabase.from('syte_suite_settings').select('data').like('id', 'techfix:' + client.id + ':%')
    ]);
    let s = data?.data?.client_id === client.id ? data.data : null;
    if (s?.tasks) {
      const byTask = new Map((fixRows || []).map(r => [r.data?.task_id, r.data]));
      s = { ...s, tasks: s.tasks.map(e => ({ ...e, apply: byTask.get(e.task?.id) || null })) };
    }
    setState(s);
    const active = !!s && ACTIVE.includes(s.status);
    if (wasActive.current && !active && onFinished) onFinished();
    wasActive.current = active;
  }

  useEffect(() => { setErr(''); setConfirming(false); setConfirmingAll(false); wasActive.current = false; refresh(); }, [client?.id]);
  const applyingAll = state?.auto?.status === 'applying' && Date.now() - new Date(state.auto.started_at || 0).getTime() < 16 * 60 * 1000;
  const fixBusy = applyingAll || (state?.tasks || []).some(e => ['planning', 'applying', 'undoing'].includes(e.apply?.status));
  useEffect(() => {
    if (!state || (!ACTIVE.includes(state.status) && !fixBusy)) return;
    const t = setInterval(refresh, fixBusy ? 3000 : 8000);
    return () => clearInterval(t);
  }, [state?.status, client?.id, fixBusy]);

  async function fixAction(taskId, action) {
    setErr('');
    try {
      const res = await fetch('/.netlify/functions/techfix-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
        body: JSON.stringify({ clientId: client.id, taskId, action })
      });
      if (res.status !== 202) throw new Error('The server refused (' + res.status + ').');
      const busyAs = { plan: 'planning', apply: 'applying', undo: 'undoing' }[action];
      setState(s => ({ ...s, tasks: s.tasks.map(e => e.task.id === taskId ? { ...e, apply: { ...(e.apply || {}), status: busyAs, error: '' } } : e) }));
      setTimeout(refresh, 2500);
    } catch (e) { setErr(e.message); }
  }

  async function applyAll() {
    setConfirmingAll(false); setErr('');
    try {
      const res = await fetch('/.netlify/functions/techfix-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
        body: JSON.stringify({ clientId: client.id, action: 'auto_all' })
      });
      if (res.status !== 202) throw new Error('The server refused (' + res.status + ').');
      setState(s => ({ ...s, auto: { status: 'applying', started_at: new Date().toISOString() } }));
      setTimeout(refresh, 4000);
    } catch (e) { setErr(e.message); }
  }

  if (!client) return null;
  const profile = getPublishingProfile(client);
  const active = state && ACTIVE.includes(state.status);
  const wpConnected = client.cms_type === 'WordPress' && !!(client.wp_url && client.wp_username && client.wp_app_password);

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

  async function toggle(key, on) {
    setBusy(true); setErr('');
    try {
      await updateClientFields(client.id, { publishing_profile: { ...profile, [key]: on } });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const entries = state?.tasks || [];
  const count = v => entries.filter(e => e.check?.verdict === v).length;
  const order = { confirmed: 0, fix_wrong: 1, needs_human: 2, false_alarm: 3 };
  const sorted = [...entries].sort((a, b) => (order[a.check?.verdict] ?? 4) - (order[b.check?.verdict] ?? 4));
  const toApply = fixesToApply(entries);

  return (
    <div className="card" style={{ borderLeft: '4px solid ' + accent, marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <strong>Tech Autopilot · {client.name}</strong>
          <div className="muted" style={{ fontSize: 12 }}>
            The server crawls the site, writes the fix list, and a second AI checks every fix against the live page.
            Confirmed fixes go on the Task Board (replacing this client's open tasks); false alarms are dropped.
            Page titles, meta descriptions and image descriptions can then be changed on the website from here, and undone.
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
          onChange={e => toggle('techscan_enabled', e.target.checked)} style={{ width: 'auto', margin: 0 }} />
        Scan automatically on the 2nd of every month
      </label>
      <label style={CHECKBOX_LABEL}>
        <input type="checkbox" checked={!!profile.techfix_auto} disabled={busy || !wpConnected}
          onChange={e => toggle('techfix_auto', e.target.checked)} style={{ width: 'auto', margin: 0 }} />
        After each scan, make the checked fixes on the website without waiting for approval
        {!wpConnected && <span className="muted"> (needs a working WordPress connection)</span>}
      </label>

      {!active && wpConnected && toApply.length > 0 && !applyingAll && !confirmingAll && (
        <button className="primary" onClick={() => setConfirmingAll(true)}
          style={{ background: accent, borderColor: accent, color: '#0a0a0c', fontSize: 12, marginTop: 10 }}>
          Apply all {toApply.length} on the website
        </button>
      )}
      {confirmingAll && (
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', fontSize: 12 }}>
          <span>Change {toApply.length} page title{toApply.length === 1 ? '' : 's'} / description{toApply.length === 1 ? '' : 's'} / image description{toApply.length === 1 ? '' : 's'} on {client.name}'s live website now? Each one can be undone afterwards.</span>
          <button className="primary" onClick={applyAll}
            style={{ background: accent, borderColor: accent, color: '#0a0a0c', fontSize: 12 }}>Yes, apply all</button>
          <button className="ghost" onClick={() => setConfirmingAll(false)} style={{ fontSize: 12 }}>Cancel</button>
        </div>
      )}
      {applyingAll && <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Making the fixes on the website and checking each live page…</div>}
      {!applyingAll && ['failed', 'skipped'].includes(state?.auto?.status) && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{state.auto.reason}</div>}

      <FixSheetButtons client={client} accent={accent} />

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
                        {!active && e.check?.verdict === 'confirmed' && AUTO_FIX.includes(e.task.fix_type) && (
                          <FixControls entry={e} wpConnected={wpConnected} accent={accent}
                            onPlan={() => fixAction(e.task.id, 'plan')} onApply={() => fixAction(e.task.id, 'apply')}
                            onUndo={() => fixAction(e.task.id, 'undo')} />
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
