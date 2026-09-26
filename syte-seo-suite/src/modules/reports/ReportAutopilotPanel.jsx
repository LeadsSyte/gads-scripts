import React, { useState, useEffect, useRef } from 'react';
import { supabase, updateClientFields } from '../../lib/supabase.js';
import { useClients } from '../../store/useClients.js';
import { proxyAuthHash } from '../cms/proxyAuth.js';
import { signedFnUrl } from '../cms/previewLink.js';
import { getPublishingProfile } from '../cms/publishingProfile.js';
import { monthKeyLabel } from './reportMonths.js';

// Report Autopilot: the server builds this client's SEO report for the
// selected month (same data, prompts and layout as Generate below), checks
// every figure against the Google data with a second AI, and saves it as the
// month's report — ready to review and send here. Nothing goes to the client.
// See netlify/functions/lib/reportScan.js.

const ACTIVE = ['queued', 'fetching', 'writing', 'checking'];
const STATUS_TEXT = {
  queued: 'Starting…', fetching: 'Pulling GA4 + Search Console…', writing: 'Writing the email and report…',
  checking: 'Checking every figure against the data…', done: 'Report ready', skipped: 'Already had a report',
  blocked: 'Not built — Search Console problem', failed: 'Stopped with an error'
};

export default function ReportAutopilotPanel({ client, month, onFinished }) {
  const load = useClients(s => s.load);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirming, setConfirming] = useState(false);
  const wasActive = useRef(false);

  async function refresh() {
    if (!client || !supabase) { setState(null); return; }
    const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', 'reportscan:' + client.id).maybeSingle();
    const s = data?.data?.client_id === client.id ? data.data : null;
    setState(s);
    const active = !!s && ACTIVE.includes(s.status);
    if (wasActive.current && !active && s?.status === 'done' && onFinished) onFinished();
    wasActive.current = active;
  }
  useEffect(() => { setErr(''); setConfirming(false); wasActive.current = false; refresh(); }, [client?.id]);
  useEffect(() => {
    if (!state || !ACTIVE.includes(state.status)) return;
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [state?.status, client?.id]);

  if (!client) return null;
  const profile = getPublishingProfile(client);
  const active = state && ACTIVE.includes(state.status);
  const forThisMonth = state && state.month === month;

  async function start(force) {
    setConfirming(false); setBusy(true); setErr('');
    try {
      const res = await fetch('/.netlify/functions/report-run-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
        body: JSON.stringify({ clientId: client.id, month, force })
      });
      if (res.status !== 202) throw new Error('The server refused the run (' + res.status + ').');
      setState({ client_id: client.id, month, status: 'queued', log: [] });
      wasActive.current = true;
      setTimeout(refresh, 4000);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function openReport() {
    const tab = window.open('about:blank', '_blank');
    const url = await signedFnUrl('report-view', 'r', client.id + '-' + month);
    if (tab && url) tab.location.href = url; else if (tab) tab.close();
  }

  async function toggleMonthly(on) {
    setBusy(true); setErr('');
    try {
      await updateClientFields(client.id, { publishing_profile: { ...profile, reports_enabled: on } });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const accent = '#a78bfa';
  const check = forThisMonth ? state.check : null;
  return (
    <div className="card" style={{ borderLeft: '4px solid ' + accent, marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <strong>Report Autopilot · {client.name}</strong>
          <div className="muted" style={{ fontSize: 12 }}>
            The server builds the SEO report for {monthKeyLabel(month)} (same data and layout as Generate below), and a second AI
            checks every figure against the Google data. It's saved here for you to review and send — nothing goes to the client.
          </div>
        </div>
        {!active && !confirming && (
          <button className="primary" disabled={busy} onClick={() => setConfirming(true)}
            style={{ background: accent, borderColor: accent, color: '#0a0a0c', fontSize: 12 }}>
            Build on the server
          </button>
        )}
      </div>
      {confirming && !active && (
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', fontSize: 12 }}>
          <span>Build the {monthKeyLabel(month)} SEO report for {client.name}? If a report for that month already exists:</span>
          <button className="ghost" disabled={busy} onClick={() => start(false)} style={{ fontSize: 12 }}>Keep it (skip)</button>
          <button className="primary" disabled={busy} onClick={() => start(true)}
            style={{ background: accent, borderColor: accent, color: '#0a0a0c', fontSize: 12 }}>Replace it</button>
          <button className="ghost" onClick={() => setConfirming(false)} style={{ fontSize: 12 }}>Cancel</button>
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 0', cursor: 'pointer', width: 'fit-content' }}>
        <input type="checkbox" checked={!!profile.reports_enabled} disabled={busy}
          onChange={e => toggleMonthly(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
        Build last month's report automatically on the 5th of every month
      </label>
      {err && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div>}
      {state && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <b>{STATUS_TEXT[state.status] || state.status}</b> <span className="muted">· {monthKeyLabel(state.month)}</span>
          {state.error && <div style={{ color: 'var(--red)', marginTop: 4 }}>{state.error}</div>}
          {state.note && <div className="muted" style={{ marginTop: 4 }}>{state.note}</div>}
          {state.status === 'done' && forThisMonth && (
            <div style={{ marginTop: 6 }}>
              <div>QA (tone and format): <b>{state.qa_score ?? '—'}/10</b> · Accuracy:{' '}
                <b style={{ color: check?.verdict === 'accurate' ? 'var(--green)' : 'var(--red)' }}>
                  {check?.verdict === 'accurate' ? 'every figure matches the data' : 'issues found'}
                </b>
              </div>
              {(check?.issues || []).length > 0 && (
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {check.issues.map((i, k) => <li key={k} style={{ color: i.severity === 'error' ? 'var(--red)' : 'var(--orange, #e8a33d)' }}>{i.issue}</li>)}
                </ul>
              )}
              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                <button className="ghost" style={{ fontSize: 12 }} onClick={openReport}>Open the report (shareable link)</button>
                <span className="muted">It's also loaded below for editing and sending.</span>
              </div>
            </div>
          )}
          {!active && state.report?.sent_at && <div className="muted" style={{ marginTop: 4 }}>"Report ready" emailed to {(state.report.to || []).join(', ')}.</div>}
          {!active && state.report?.error && <div style={{ marginTop: 4, color: 'var(--orange, #e8a33d)' }}>"Report ready" email not sent: {state.report.error}</div>}
          {active && state.log?.length > 0 && <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>{state.log[state.log.length - 1]}</div>}
        </div>
      )}
    </div>
  );
}
