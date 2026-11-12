import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { proxyAuthHash } from '../modules/cms/proxyAuth.js';

// "Send to Grok bot" for ONE technical fix or AEO addition.
//
// Chris, 12 Nov 2026: items the suite cannot apply itself said "apply by
// hand" and stopped there. This sends the whole request to the Grok bot
// (netlify/functions/lib/grokJobs.js): the bot logs in to the client's site,
// makes the change, and the suite emails what changed. A finished job can be
// undone — the bot puts the page back as it was.
//
// Props: client, kind 'tech' | 'aeo', taskId (tech) or url + optKey (aeo),
// primary (true when it is the only way to get the item done).

const OPEN = ['queued', 'claimed'];
const when = iso => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

// One query per client for all the buttons on a page, refreshed at most
// every few seconds.
const cache = new Map();
export async function loadGrokJobs(clientId, { fresh = false } = {}) {
  const hit = cache.get(clientId);
  if (!fresh && hit && Date.now() - hit.at < 5000) return hit.promise;
  const promise = (async () => {
    if (!supabase) return [];
    const { data } = await supabase.from('syte_suite_settings').select('data').like('id', 'grokjob:' + clientId + ':%');
    return (data || []).map(r => r.data).filter(Boolean).sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)));
  })();
  cache.set(clientId, { at: Date.now(), promise });
  return promise;
}

export const jobFor = (jobs, { kind, taskId, url, optKey }) =>
  jobs.find(j => j.kind !== 'undo' && (kind === 'tech' ? j.ref?.task_id === taskId : j.ref?.url === url && j.ref?.opt_key === optKey)) || null;

export default function GrokBotButton({ client, kind, taskId, url, optKey, primary = false }) {
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ready = !!client?.id && (kind === 'tech' ? !!taskId : !!(url && optKey));

  const refresh = async (fresh) => { if (ready) setJobs(await loadGrokJobs(client.id, { fresh })); };
  useEffect(() => { setErr(''); refresh(false); }, [client?.id, taskId, url, optKey]);

  const job = jobFor(jobs, { kind, taskId, url, optKey });
  const undo = job ? jobs.find(j => j.kind === 'undo' && j.ref?.undo_of === job.job_id) : null;
  const waiting = OPEN.includes(job?.status) || OPEN.includes(undo?.status);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => refresh(true), 20000);
    return () => clearInterval(t);
  }, [waiting, client?.id]);

  async function post(path, body) {
    setErr(''); setBusy(true);
    try {
      const res = await fetch('/api/v1' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash(), 'Idempotency-Key': 'grok-' + Date.now() + '-' + Math.random().toString(36).slice(2) },
        body: JSON.stringify(body || {})
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error?.message || j.error || j.message || 'The suite refused (' + res.status + ').');
      await refresh(true);
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  }
  const send = () => post('/clients/' + client.id + '/grok-jobs', kind === 'tech' ? { kind, taskId } : { kind, url, optKey });

  if (!ready) return null;
  const btn = { fontSize: 11, padding: '3px 10px' };
  const line = { fontSize: 11, marginTop: 4 };
  let body;
  if (!job || (['failed', 'skipped'].includes(job.status))) {
    body = (
      <>
        {job && <div style={{ ...line, color: 'var(--orange, #e8a33d)' }}>The Grok bot {job.status === 'skipped' ? 'skipped this' : 'could not do this'} ({when(job.finished_at)}): {job.note}</div>}
        <div className="row" style={{ gap: 6, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className={primary ? '' : 'ghost'} style={btn} disabled={busy} onClick={send}>{busy ? 'Sending…' : job ? 'Send to Grok bot again' : 'Send to Grok bot'}</button>
          <span className="muted" style={{ fontSize: 11 }}>The bot logs in to the site, makes this change and emails what it changed.</span>
        </div>
      </>
    );
  } else if (job.status === 'queued') {
    body = <div className="muted" style={line}>Waiting for the Grok bot · sent {when(job.requested_at)} by {job.requested_by}.</div>;
  } else if (job.status === 'claimed') {
    body = <div className="muted" style={line}>The Grok bot is working on it (started {when(job.claimed_at)})…</div>;
  } else {
    body = (
      <div style={line}>
        <div>✓ Done on the site by the Grok bot, {when(job.finished_at)}{job.note ? ': ' + job.note : '.'}</div>
        {(job.changes || []).map((c, i) => (
          <div key={i} className="muted" style={{ marginTop: 2 }}>· {c.what}{c.url ? <> — <a href={c.url} target="_blank" rel="noreferrer">open the page</a></> : null}</div>
        ))}
        {job.undone_at ? <div style={{ marginTop: 4 }}>↩ Undone by the Grok bot, {when(job.undone_at)}.</div>
          : undo && OPEN.includes(undo.status) ? <div className="muted" style={{ marginTop: 4 }}>Undo sent to the Grok bot ({undo.status === 'claimed' ? 'working on it' : 'waiting'})…</div>
          : undo && undo.status !== 'done' ? <div style={{ marginTop: 4, color: 'var(--orange, #e8a33d)' }}>The Grok bot could not undo it: {undo.note}</div>
          : !job.undone_by ? <button className="ghost" style={{ ...btn, marginTop: 4 }} disabled={busy} onClick={() => post('/grok-jobs/' + job.job_id + '/undo')}>{busy ? 'Sending…' : 'Undo via Grok bot'}</button>
          : null}
      </div>
    );
  }
  return (
    <div style={{ width: '100%' }} data-testid="grok-bot">
      {body}
      {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{err}</div>}
    </div>
  );
}
