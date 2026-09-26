import React, { useState, useEffect, useRef } from 'react';
import { useClients } from '../../store/useClients.js';
import { supabase, updateClientFields } from '../../lib/supabase.js';
import { proxyAuthHash } from '../cms/proxyAuth.js';
import { getPublishingProfile } from '../cms/publishingProfile.js';
import { connectionState } from '../cms/connectionStatus.js';
import { openThemePreview } from '../cms/previewLink.js';

// Autopilot: the server writes the selected client's articles for this
// month — website scan, research, write, relevance check, independent check
// by a second AI — and, when switched on, pushes the ones that passed to the
// site as drafts. Nobody needs the suite open. See netlify/functions/lib/autopilot.js.
// Written articles also appear in the Auto Write list below like any other.

const ACTIVE = ['queued', 'researching', 'writing', 'pushing'];
const STATUS_TEXT = {
  queued: 'Starting…', researching: 'Researching topics…', writing: 'Writing articles…',
  pushing: 'Creating drafts on the site…', done: 'Finished', failed: 'Stopped with an error'
};
const ARTICLE_TEXT = {
  ready: { label: 'ready', color: 'var(--green)' },
  blocked: { label: 'held back', color: 'var(--red)' },
  failed: { label: 'failed', color: 'var(--red)' },
  skipped: { label: 'already written', color: 'var(--text-dim)' }
};
const PUSH_TEXT = {
  pushed: { label: 'draft on site', color: 'var(--green)' },
  failed: { label: 'push failed', color: 'var(--red)' },
  skipped: { label: 'already in CMS', color: 'var(--text-dim)' }
};
const CHECKBOX_LABEL = { display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 0', cursor: 'pointer', width: 'fit-content' };

export default function AutopilotPanel({ accent, onFinished }) {
  const client = useClients(s => s.current());
  const load = useClients(s => s.load);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Inline "are you sure" instead of window.confirm: embedded browsers (and
  // browser-driving bots) can auto-dismiss native dialogs, which made the
  // button silently do nothing. null | 'run' | 'push'.
  const [confirming, setConfirming] = useState(null);
  const wasActive = useRef(false);
  // Suite-wide: who gets the run summaries and "went live" emails
  // (netlify/functions/lib/reportEmail.js). Empty = no emails.
  const [reportEmail, setReportEmail] = useState('');
  const [savedReportEmail, setSavedReportEmail] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.from('syte_suite_settings').select('data').eq('id', 'autopilot-config').maybeSingle()
      .then(({ data }) => { const v = data?.data?.report_email || ''; setReportEmail(v); setSavedReportEmail(v); });
  }, []);

  async function saveReportEmail() {
    setBusy(true); setErr('');
    try {
      const value = reportEmail.trim();
      if (value && !value.split(/[,;\s]+/).filter(Boolean).every(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))) {
        throw new Error('That does not look like an email address.');
      }
      const { error } = await supabase.from('syte_suite_settings')
        .upsert({ id: 'autopilot-config', data: { report_email: value }, updated_at: new Date().toISOString() });
      if (error) throw error;
      setSavedReportEmail(value);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function refresh() {
    if (!client || !supabase) { setState(null); return; }
    const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', 'autopilot:' + client.id).maybeSingle();
    const s = data?.data?.client_id === client.id ? data.data : null;
    setState(s);
    const active = !!s && ACTIVE.includes(s.status);
    if (wasActive.current && !active && onFinished) onFinished();
    wasActive.current = active;
  }

  useEffect(() => { setErr(''); setConfirming(null); wasActive.current = false; refresh(); }, [client?.id]);
  useEffect(() => {
    if (!state || !ACTIVE.includes(state.status)) return;
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [state?.status, client?.id]);

  if (!client) return null;
  const profile = getPublishingProfile(client);
  const connected = connectionState(client).state === 'connected';
  const active = state && ACTIVE.includes(state.status);
  const thisMonth = state && state.month === new Date().toISOString().slice(0, 7);

  async function send(body) {
    setConfirming(null);
    setBusy(true); setErr('');
    try {
      const res = await fetch('/.netlify/functions/autopilot-run-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
        body: JSON.stringify({ clientId: client.id, ...body })
      });
      if (res.status !== 202) throw new Error('The server refused the request (' + res.status + ').');
      setState(s => body.mode === 'push'
        ? { ...s, status: 'pushing' }
        : { client_id: client.id, status: 'queued', month: new Date().toISOString().slice(0, 7), log: [], articles: {} });
      wasActive.current = true;
      setTimeout(refresh, 4000);
      // A background function answers 202 before it runs, even when it then
      // refuses (bad auth, missing config) — so confirm the run actually
      // wrote its state instead of trusting the 202.
      const askedAt = Date.now();
      setTimeout(async () => {
        const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', 'autopilot:' + client.id).maybeSingle();
        const updatedAt = new Date(data?.data?.updated_at || 0).getTime();
        if (updatedAt < askedAt - 5000) {
          setErr('The server did not start. Check that the suite is unlocked with the current password, then try again.');
          refresh();
        }
      }, 30000);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function setProfileFlag(key, on) {
    setBusy(true); setErr('');
    try {
      await updateClientFields(client.id, { publishing_profile: { ...profile, [key]: on } });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const plan = state?.plan || [];
  const counts = { ready: 0, blocked: 0, failed: 0, skipped: 0, pushed: 0 };
  for (const a of Object.values(state?.articles || {})) {
    counts[a.status] = (counts[a.status] || 0) + 1;
    if (a.push?.status === 'pushed') counts.pushed++;
  }
  const unpushed = Object.values(state?.articles || {}).filter(a => a.status === 'ready' && (!a.push || a.push.status === 'failed')).length;

  return (
    <div className="card" style={{ borderLeft: '4px solid ' + accent, marginTop: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <strong>Autopilot · {client.name}</strong>
          <div className="muted" style={{ fontSize: 12 }}>
            The server scans the website, researches, writes and checks this month's articles. A second AI reviews each
            one; anything it or the topic check rejects is held back. Articles that pass can go to the site as drafts —
            never published without approval.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {!active && !confirming && thisMonth && state?.status === 'done' && unpushed > 0 && connected && (
            <button disabled={busy} onClick={() => setConfirming('push')} style={{ fontSize: 12 }}>
              Push {unpushed} ready as drafts
            </button>
          )}
          {!active && !confirming && (
            <button className="primary" disabled={busy} onClick={() => setConfirming('run')}
              style={{ background: accent, borderColor: accent, color: '#0a0a0c', fontSize: 12 }}>
              {thisMonth ? 'Run again' : 'Run now'}
            </button>
          )}
        </div>
      </div>

      {confirming && !active && (
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', fontSize: 12 }}>
          <span>
            {confirming === 'push'
              ? `Create ${unpushed} draft(s) on ${client.name}'s site? They stay drafts until approved.`
              : `Write and check ${client.pages_per_month || 4} article(s) for ${client.name} now?`
                + (thisMonth ? ' This starts a fresh run for this month.' : '')
                + (profile.autopilot_push && connected ? ' Articles that pass are pushed to the site as drafts.' : ' Nothing is pushed to the website.')}
          </span>
          <button className="primary" disabled={busy}
            onClick={() => send(confirming === 'push' ? { mode: 'push' } : { restart: !!thisMonth })}
            style={{ background: accent, borderColor: accent, color: '#0a0a0c', fontSize: 12 }}>
            Yes, start
          </button>
          <button className="ghost" onClick={() => setConfirming(null)} style={{ fontSize: 12 }}>Cancel</button>
        </div>
      )}

      <label style={CHECKBOX_LABEL}>
        <input type="checkbox" checked={!!profile.autopilot_enabled} disabled={busy}
          onChange={e => setProfileFlag('autopilot_enabled', e.target.checked)} style={{ width: 'auto', margin: 0 }} />
        Run automatically on the 1st of every month (08:00)
      </label>
      <label style={{ ...CHECKBOX_LABEL, opacity: connected ? 1 : 0.5 }}
        title={connected ? '' : 'Connect this client under CMS → Connections first'}>
        <input type="checkbox" checked={!!profile.autopilot_push} disabled={busy || !connected}
          onChange={e => setProfileFlag('autopilot_push', e.target.checked)} style={{ width: 'auto', margin: 0 }} />
        Push articles that pass to the site as drafts{connected ? '' : ' (not connected)'}
      </label>

      <div className="row" style={{ gap: 8, marginTop: 10, fontSize: 12, flexWrap: 'wrap' }}>
        <span className="muted">Run summaries and "went live" emails (all clients) go to:</span>
        <input type="email" value={reportEmail} onChange={e => setReportEmail(e.target.value)} placeholder="nobody — no emails"
          style={{ width: 240, fontSize: 12, padding: '4px 8px' }} />
        {reportEmail.trim() !== savedReportEmail && (
          <button disabled={busy} onClick={saveReportEmail} style={{ fontSize: 12 }}>Save</button>
        )}
      </div>

      {err && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div>}

      {state && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <div>
            <b>{STATUS_TEXT[state.status] || state.status}</b>
            {state.month && <span className="muted"> · {state.month}</span>}
            {plan.length > 0 && (
              <span className="muted"> · {counts.ready} ready, {counts.blocked} held back, {counts.failed} failed
                {counts.skipped ? ', ' + counts.skipped + ' already written' : ''} of {plan.length}
                {counts.pushed ? ' · ' + counts.pushed + ' drafted on the site' : ''}</span>
            )}
          </div>
          {state.error && <div style={{ color: 'var(--red)', marginTop: 4 }}>{state.error}</div>}
          {[state.scan_note, state.research_note, state.push_note].filter(Boolean).map((n, i) => (
            <div key={i} className="muted" style={{ marginTop: 4 }}>{n}</div>
          ))}
          {!active && state.report?.sent_at && (
            <div className="muted" style={{ marginTop: 4 }}>Summary emailed to {(state.report.to || []).join(', ')}.</div>
          )}
          {!active && state.report?.error && (
            <div style={{ marginTop: 4, color: 'var(--orange, #e8a33d)' }}>Summary email not sent: {state.report.error}</div>
          )}

          {plan.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <tbody>
                {plan.map((opp, i) => {
                  const a = state.articles?.[i];
                  const s = a ? ARTICLE_TEXT[a.status] : null;
                  const p = a?.push ? PUSH_TEXT[a.push.status] : null;
                  const problems = [
                    ...(a?.check?.problems || []).filter(q => q.severity === 'error').map(q => q.issue),
                    ...(a?.relevance?.verdict === 'mismatch' ? (a.relevance.detail || ['Off topic for this client']) : []),
                    ...(a?.error ? [a.error] : []),
                    ...(a?.push?.status === 'failed' ? ['Push: ' + a.push.error] : [])
                  ];
                  return (
                    <tr key={i}>
                      <td style={{ width: 110 }}>
                        {s ? <span style={{ color: s.color, fontWeight: 600 }}>{s.label}</span>
                           : <span className="muted">{active ? 'waiting' : '–'}</span>}
                        {p && <div style={{ color: p.color, fontSize: 11 }}>{p.label}</div>}
                      </td>
                      <td>
                        {opp.topic_title}
                        {a?.blog_id && connected && (
                          <a href="#" style={{ marginLeft: 8, fontSize: 11, color: accent }}
                            title="See it in the client's own site design — no login needed"
                            onClick={e => { e.preventDefault(); a.push?.queue_id ? openThemePreview('q', a.push.queue_id) : openThemePreview('a', a.blog_id); }}>
                            preview in theme →
                          </a>
                        )}
                        {a?.push?.admin_url && (
                          <a href={a.push.admin_url} target="_blank" rel="noreferrer" style={{ marginLeft: 8, fontSize: 11, color: accent }}>open draft →</a>
                        )}
                        {problems.length > 0 && (
                          <ul style={{ margin: '4px 0 0 14px', padding: 0, color: 'var(--red)' }}>
                            {problems.slice(0, 4).map((q, j) => <li key={j}>{q}</li>)}
                          </ul>
                        )}
                        {a?.status === 'ready' && (a.check?.problems || []).length > 0 && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            Reviewer notes: {a.check.problems.map(q => q.issue).join(' · ')}
                          </div>
                        )}
                        {(a?.push?.warnings || []).length > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--orange, #e8a33d)' }}>
                            On the site: {a.push.warnings.join(' · ')}
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
          {state.status === 'done' && counts.pushed > 0 && (
            <div className="muted" style={{ marginTop: 6 }}>
              Drafts are waiting for review in CMS → Push History. Approve there and the publisher takes them live within 15 minutes.
            </div>
          )}
          {state.status === 'done' && counts.ready > 0 && counts.pushed === 0 && (
            <div className="muted" style={{ marginTop: 6 }}>
              The articles are in the list below. Held-back articles are saved too — read the reason before pushing one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
