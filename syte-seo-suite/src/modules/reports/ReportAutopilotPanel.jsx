import React, { useState, useEffect, useRef } from 'react';
import { supabase, updateClientFields } from '../../lib/supabase.js';
import { useClients } from '../../store/useClients.js';
import { proxyAuthHash } from '../cms/proxyAuth.js';
import { signedFnUrl } from '../cms/previewLink.js';
import { getPublishingProfile } from '../cms/publishingProfile.js';
import { monthKeyLabel } from './reportMonths.js';

// Report Autopilot: the server builds this client's report for the selected
// month (same data, prompts and layout as Generate below), checks every
// figure with a second AI, and saves it as the month's report — ready to
// review and send here. Nothing goes to the client.
//   kind 'seo' — netlify/functions/lib/reportScan.js
//   kind 'aeo' — netlify/functions/lib/aeoReportScan.js (asks ChatGPT, Claude
//                and Gemini several hundred questions; takes 30–60 minutes)

const KINDS = {
  seo: {
    title: 'Report Autopilot', label: 'SEO', stateId: 'reportscan:', fn: 'report-run-background', link: 'r', flag: 'reports_enabled',
    active: ['queued', 'fetching', 'writing', 'checking'],
    about: month => `The server builds the SEO report for ${monthKeyLabel(month)} (same data and layout as Generate below), and a second AI checks every figure against the Google data. It's saved here for you to review and send — nothing goes to the client.`,
    monthly: 'Build last month\'s report automatically on the 5th of every month',
    accurate: 'every figure matches the data',
    status: {
      queued: 'Starting…', fetching: 'Pulling GA4 + Search Console…', writing: 'Writing the email and report…',
      checking: 'Checking every figure against the data…', done: 'Report ready', skipped: 'Already had a report',
      blocked: 'Not built — Search Console problem', failed: 'Stopped with an error'
    }
  },
  aeo: {
    title: 'AEO Report Autopilot', label: 'AEO', stateId: 'aeoreport:', fn: 'aeoreport-run-background', link: 'e', flag: 'aeo_reports_enabled',
    active: ['queued', 'preparing', 'probing', 'writing', 'checking'],
    about: month => `The server asks ChatGPT, Claude and Gemini this client's buyer prompts, builds the AEO report for ${monthKeyLabel(month)} (same as Generate AEO report below), and a second AI checks every figure. It takes 30 to 60 minutes and you can close this page. Nothing goes to the client.`,
    monthly: 'Build last month\'s AEO report automatically on the 6th of every month',
    accurate: 'every figure matches the measured results',
    status: {
      queued: 'Starting…', preparing: 'Preparing the prompts to measure…', probing: 'Asking the AI engines…', writing: 'Writing the email and report…',
      checking: 'Checking every figure…', done: 'Report ready', skipped: 'Already had a report',
      blocked: 'Not built — no prompts to measure', failed: 'Stopped with an error'
    }
  }
};

export default function ReportAutopilotPanel({ client, month, onFinished, kind = 'seo' }) {
  const K = KINDS[kind] || KINDS.seo;
  const load = useClients(s => s.load);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirming, setConfirming] = useState(false);
  const wasActive = useRef(false);

  // A run that hasn't written anything for 25 minutes has stopped.
  const isActive = s => !!s && K.active.includes(s.status) && Date.now() - new Date(s.updated_at || Date.now()).getTime() < 25 * 60 * 1000;

  async function refresh() {
    if (!client || !supabase) { setState(null); return; }
    const { data } = await supabase.from('syte_suite_settings').select('data').eq('id', K.stateId + client.id).maybeSingle();
    const s = data?.data?.client_id === client.id ? data.data : null;
    setState(s);
    const active = isActive(s);
    if (wasActive.current && !active && s?.status === 'done' && onFinished) onFinished();
    wasActive.current = active;
  }
  useEffect(() => { setErr(''); setConfirming(false); wasActive.current = false; refresh(); }, [client?.id, kind]);
  useEffect(() => {
    if (!isActive(state)) return;
    const t = setInterval(refresh, kind === 'aeo' ? 15000 : 6000);
    return () => clearInterval(t);
  }, [state?.status, state?.updated_at, client?.id]);

  if (!client) return null;
  const profile = getPublishingProfile(client);
  const active = isActive(state);
  const stopped = !!state && K.active.includes(state.status) && !active;
  const forThisMonth = state && state.month === month;

  async function start(force) {
    setConfirming(false); setBusy(true); setErr('');
    try {
      const res = await fetch('/.netlify/functions/' + K.fn, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
        body: JSON.stringify({ clientId: client.id, month, force })
      });
      if (res.status !== 202) throw new Error('The server refused the run (' + res.status + ').');
      setState(s => ({ ...(s || {}), client_id: client.id, month, status: 'queued', updated_at: new Date().toISOString(), log: [] }));
      wasActive.current = true;
      setTimeout(refresh, 4000);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function openReport() {
    const tab = window.open('about:blank', '_blank');
    const url = await signedFnUrl('report-view', K.link, client.id + '-' + month);
    if (tab && url) tab.location.href = url; else if (tab) tab.close();
  }

  async function toggleMonthly(on) {
    setBusy(true); setErr('');
    try {
      await updateClientFields(client.id, { publishing_profile: { ...profile, [K.flag]: on } });
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const accent = '#a78bfa';
  const check = forThisMonth ? state.check : null;
  const sum = forThisMonth ? state.summary : null;
  return (
    <div className="card" style={{ borderLeft: '4px solid ' + accent, marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <strong>{K.title} · {client.name}</strong>
          <div className="muted" style={{ fontSize: 12 }}>{K.about(month)}</div>
        </div>
        {!active && !confirming && (
          <button className="primary" disabled={busy} onClick={() => setConfirming(true)}
            style={{ background: accent, borderColor: accent, color: '#0a0a0c', fontSize: 12 }}>
            {stopped ? 'Carry on' : 'Build on the server'}
          </button>
        )}
      </div>
      {confirming && !active && (
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', fontSize: 12 }}>
          <span>
            Build the {monthKeyLabel(month)} {K.label} report for {client.name}?
            {kind === 'aeo' && ' This asks the AI engines several hundred questions, which costs API money.'}
            {' '}If a report for that month already exists:
          </span>
          <button className="ghost" disabled={busy} onClick={() => start(false)} style={{ fontSize: 12 }}>Keep it (skip)</button>
          <button className="primary" disabled={busy} onClick={() => start(true)}
            style={{ background: accent, borderColor: accent, color: '#0a0a0c', fontSize: 12 }}>Replace it</button>
          <button className="ghost" onClick={() => setConfirming(false)} style={{ fontSize: 12 }}>Cancel</button>
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 0', cursor: 'pointer', width: 'fit-content' }}>
        <input type="checkbox" checked={!!profile[K.flag]} disabled={busy}
          onChange={e => toggleMonthly(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
        {K.monthly}
      </label>
      {err && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div>}
      {state && (
        <div style={{ marginTop: 10, fontSize: 12 }}>
          <b>{stopped ? 'Stopped part-way' : (K.status[state.status] || state.status)}</b> <span className="muted">· {monthKeyLabel(state.month)}</span>
          {stopped && <div style={{ color: 'var(--orange, #e8a33d)', marginTop: 4 }}>The run stopped before it finished. "Carry on" picks up where it stopped — nothing already measured is asked again.</div>}
          {active && state.status === 'probing' && (
            <div className="muted" style={{ marginTop: 4 }}>
              {state.prompts ? state.prompts + ' prompts' : ''}{state.progress?.groups_done ? ' · ' + state.progress.groups_done + ' prompt/engine pairs measured so far' : ''}
            </div>
          )}
          {state.error && <div style={{ color: 'var(--red)', marginTop: 4 }}>{state.error}</div>}
          {state.note && <div className="muted" style={{ marginTop: 4 }}>{state.note}</div>}
          {state.status === 'done' && forThisMonth && (
            <div style={{ marginTop: 6 }}>
              {sum && (
                <div className="muted" style={{ marginBottom: 4 }}>
                  Named in {sum.named_in} of {sum.prompts} prompts · {sum.answers} answers from {(sum.engines || []).join(', ')}
                  {sum.compared_with ? ' · compared with ' + monthKeyLabel(sum.compared_with) : ' · no earlier month to compare with'}
                </div>
              )}
              {(state.engine_notes || []).map((n, k) => <div key={k} style={{ color: 'var(--orange, #e8a33d)' }}>{n}</div>)}
              <div>QA (tone and format): <b>{state.qa_score ?? '—'}/10</b> · Accuracy:{' '}
                <b style={{ color: check?.verdict === 'accurate' ? 'var(--green)' : 'var(--red)' }}>
                  {check?.verdict === 'accurate' ? K.accurate : 'issues found'}
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
