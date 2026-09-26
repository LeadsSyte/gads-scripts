import React, { useState, useEffect, useRef } from 'react';
import { useClients } from '../../store/useClients.js';
import { supabase, updateClientFields } from '../../lib/supabase.js';
import { proxyAuthHash } from '../cms/proxyAuth.js';
import { getPublishingProfile } from '../cms/publishingProfile.js';

// Autopilot: the server writes the selected client's articles for this
// month — research, write, relevance check, independent check by a second
// AI — with nobody needing the suite open. See netlify/functions/lib/autopilot.js.
// The finished articles appear in the Auto Write list below like any other.

const ACTIVE = ['queued', 'researching', 'writing'];
const STATUS_TEXT = {
  queued: 'Starting…', researching: 'Researching topics…', writing: 'Writing articles…',
  done: 'Finished', failed: 'Stopped with an error'
};
const ARTICLE_TEXT = {
  ready: { label: 'ready', color: 'var(--green)' },
  blocked: { label: 'held back', color: 'var(--red)' },
  failed: { label: 'failed', color: 'var(--red)' },
  skipped: { label: 'already written', color: 'var(--text-dim)' }
};

export default function AutopilotPanel({ accent, onFinished }) {
  const client = useClients(s => s.current());
  const load = useClients(s => s.load);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Inline "are you sure" instead of window.confirm: embedded browsers (and
  // browser-driving bots) can auto-dismiss native dialogs, which made the
  // button silently do nothing.
  const [confirming, setConfirming] = useState(false);
  const wasActive = useRef(false);

  async function refresh() {
    if (!client || !supabase) { setState(null); return; }
    const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', 'autopilot:' + client.id).maybeSingle();
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
  const thisMonth = state && state.month === new Date().toISOString().slice(0, 7);

  async function start(restart) {
    setConfirming(false);
    setBusy(true); setErr('');
    try {
      const res = await fetch('/.netlify/functions/autopilot-run-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
        body: JSON.stringify({ clientId: client.id, restart })
      });
      if (res.status !== 202) throw new Error('The server refused the run (' + res.status + ').');
      setState({ client_id: client.id, status: 'queued', month: new Date().toISOString().slice(0, 7), log: [], articles: {} });
      wasActive.current = true;
      setTimeout(refresh, 4000);
      // A background function answers 202 before it runs, even when it then
      // refuses (bad auth, missing config) — so confirm the run actually
      // wrote its state instead of trusting the 202.
      const askedAt = Date.now();
      setTimeout(async () => {
        const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', 'autopilot:' + client.id).maybeSingle();
        const startedAt = new Date(data?.data?.started_at || 0).getTime();
        const updatedAt = new Date(data?.data?.updated_at || 0).getTime();
        if (Math.max(startedAt, updatedAt) < askedAt - 5000) {
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
      await updateClientFields(client.id, { publishing_profile: { ...profile, autopilot_enabled: on } });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const plan = state?.plan || [];
  const counts = { ready: 0, blocked: 0, failed: 0, skipped: 0 };
  for (const a of Object.values(state?.articles || {})) counts[a.status] = (counts[a.status] || 0) + 1;

  return (
    <div className="card" style={{ borderLeft: '4px solid ' + accent, marginTop: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <strong>Autopilot · {client.name}</strong>
          <div className="muted" style={{ fontSize: 12 }}>
            The server researches, writes and checks this month's articles. A second AI reviews each one; anything it
            or the topic check rejects is held back. Nothing goes to the website.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {!active && !confirming && (
            <button className="primary" disabled={busy} onClick={() => setConfirming(true)}
              style={{ background: accent, borderColor: accent, color: '#0a0a0c', fontSize: 12 }}>
              {thisMonth ? 'Run again' : 'Run now'}
            </button>
          )}
        </div>
      </div>

      {confirming && !active && (
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', fontSize: 12 }}>
          <span>
            Write and check {client.pages_per_month || 4} article(s) for {client.name} now?
            {thisMonth ? ' This starts a fresh run for this month.' : ''} Nothing is pushed to the website.
          </span>
          <button className="primary" disabled={busy} onClick={() => start(!!thisMonth)}
            style={{ background: accent, borderColor: accent, color: '#0a0a0c', fontSize: 12 }}>
            Yes, start
          </button>
          <button className="ghost" onClick={() => setConfirming(false)} style={{ fontSize: 12 }}>Cancel</button>
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 0', cursor: 'pointer', width: 'fit-content' }}>
        <input type="checkbox" checked={!!profile.autopilot_enabled} disabled={busy}
          onChange={e => toggleMonthly(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
        Run automatically on the 1st of every month (08:00)
      </label>

      {err && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div>}

      {state && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <div>
            <b>{STATUS_TEXT[state.status] || state.status}</b>
            {state.month && <span className="muted"> · {state.month}</span>}
            {plan.length > 0 && (
              <span className="muted"> · {counts.ready} ready, {counts.blocked} held back, {counts.failed} failed
                {counts.skipped ? ', ' + counts.skipped + ' already written' : ''} of {plan.length}</span>
            )}
          </div>
          {state.error && <div style={{ color: 'var(--red)', marginTop: 4 }}>{state.error}</div>}
          {state.research_note && <div className="muted" style={{ marginTop: 4 }}>{state.research_note}</div>}

          {plan.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <tbody>
                {plan.map((opp, i) => {
                  const a = state.articles?.[i];
                  const s = a ? ARTICLE_TEXT[a.status] : null;
                  const problems = [
                    ...(a?.check?.problems || []).filter(p => p.severity === 'error').map(p => p.issue),
                    ...(a?.relevance?.verdict === 'mismatch' ? (a.relevance.detail || ['Off topic for this client']) : []),
                    ...(a?.error ? [a.error] : [])
                  ];
                  return (
                    <tr key={i}>
                      <td style={{ width: 110 }}>
                        {s ? <span style={{ color: s.color, fontWeight: 600 }}>{s.label}</span>
                           : <span className="muted">{active ? 'waiting' : '–'}</span>}
                      </td>
                      <td>
                        {opp.topic_title}
                        {problems.length > 0 && (
                          <ul style={{ margin: '4px 0 0 14px', padding: 0, color: 'var(--red)' }}>
                            {problems.slice(0, 4).map((p, j) => <li key={j}>{p}</li>)}
                          </ul>
                        )}
                        {a?.status === 'ready' && (a.check?.problems || []).length > 0 && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            Reviewer notes: {a.check.problems.map(p => p.issue).join(' · ')}
                          </div>
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
          {state.status === 'done' && counts.ready > 0 && (
            <div className="muted" style={{ marginTop: 6 }}>
              The articles are in the list below. Review them, then use "Push month to CMS" as usual. Held-back articles are
              saved too — read the reason before pushing one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
