import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { corsFetchText } from '../../lib/corsProxy.js';
import PushToCmsButton from '../../components/PushToCmsButton.jsx';
import { getAudit, syncWebceoClients } from './webceo.js';
import { upsertClient } from '../../lib/supabase.js';
import { querySearchAnalytics } from './gsc.js';
import { ensureToken, SCOPES, getToken, clearToken } from './googleAuth.js';

const ACCENT = '#ff6b35';
const TASKS_KEY = 'syte-suite-tseo-tasks';
const TEAM_KEY = 'syte-suite-tseo-team';
const LEGACY_KEY = 'syte-tseo-tasks';

const STATUS_ORDER = ['open', 'done', 'verified', 'failed'];
const PRIORITIES   = ['critical', 'high', 'medium', 'low'];
const STALE_DAYS = 30;

function loadTasks() {
  // One-time migration of legacy key.
  if (!localStorage.getItem(TASKS_KEY)) {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) localStorage.setItem(TASKS_KEY, legacy);
  }
  try { return JSON.parse(localStorage.getItem(TASKS_KEY) || '[]'); } catch { return []; }
}
function saveTasks(t) { localStorage.setItem(TASKS_KEY, JSON.stringify(t)); }
function loadTeam() { try { return JSON.parse(localStorage.getItem(TEAM_KEY) || '[]'); } catch { return []; } }
function saveTeam(t) { localStorage.setItem(TEAM_KEY, JSON.stringify(t)); }

const TRIAGE_SYSTEM = `
You are a senior technical SEO engineer. You receive raw site-audit data (either WebCEO audit JSON or Google Search Console query data) and must produce a prioritised, copy-paste actionable task list.

Return ONLY valid JSON in this shape:
{
  "tasks": [
    {
      "title": "short imperative title",
      "description": "why it matters, plain English",
      "priority": "critical|high|medium|low",
      "page_url": "https://...",
      "fix_type": "meta_title|meta_description|canonical|schema|internal_link|h1|image_alt|redirect|other",
      "copy_paste_fix": "the literal string/HTML to paste into the page"
    }
  ]
}

Rules:
- Critical = indexing/canonical/redirect loops, broken pages.
- High = missing H1, broken meta title, 4xx errors.
- Medium = weak meta descriptions, thin content, missing alt text.
- Low = minor polish.
- Every task must include a copy_paste_fix unless fix_type is "other".
- Max 25 tasks.
`.trim();

async function triageAudit(auditData, clientUrl) {
  const text = await claudeComplete({
    system: TRIAGE_SYSTEM,
    messages: [{
      role: 'user',
      content: `Client URL: ${clientUrl}\n\nAudit data:\n${JSON.stringify(auditData).slice(0, 60000)}`
    }],
    max_tokens: 6000,
    temperature: 0.3
  });
  const parsed = extractJSON(text);
  return parsed?.tasks || [];
}

async function verifyFix(task) {
  const html = await corsFetchText(task.page_url);
  const verdict = await claudeComplete({
    system: 'You verify SEO fixes. Return ONLY JSON: {"implemented": true|false, "evidence": "..."}',
    messages: [{
      role: 'user',
      content: `Task: ${task.title}\nFix_type: ${task.fix_type}\nExpected fix: ${task.copy_paste_fix}\n\nLive page HTML (truncated):\n${html.slice(0, 40000)}`
    }],
    max_tokens: 500,
    temperature: 0
  });
  const parsed = extractJSON(verdict);
  return parsed?.implemented === true;
}

function priorityClass(p) {
  return { critical: 'red', high: 'orange', medium: 'blue', low: 'teal' }[p] || '';
}
function statusClass(s) {
  return { open: 'orange', done: 'blue', verified: 'green', failed: 'red' }[s] || '';
}

export default function TechnicalSEO({ sub }) {
  const clients = useClients(s => s.clients);
  const client = useClients(s => s.current());
  const reloadClients = useClients(s => s.load);
  const [tasks, setTasks] = useState(loadTasks());
  const [team, setTeam] = useState(loadTeam());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [syncResult, setSyncResult] = useState(null);
  const [customMethod, setCustomMethod] = useState('');

  useEffect(() => { saveTasks(tasks); }, [tasks]);
  useEffect(() => { saveTeam(team); }, [team]);

  const clientTasks = useMemo(
    () => client ? tasks.filter(t => t.client_id === client.id) : tasks,
    [tasks, client]
  );

  const staleClients = useMemo(() => {
    const byClient = {};
    for (const t of tasks) {
      if (!byClient[t.client_id] || t.created_at > byClient[t.client_id]) {
        byClient[t.client_id] = t.created_at;
      }
    }
    const cutoff = Date.now() - STALE_DAYS * 86400000;
    return clients.filter(c => !byClient[c.id] || new Date(byClient[c.id]).getTime() < cutoff);
  }, [tasks, clients]);

  async function runScan() {
    if (!client) { setErr('Select a client first.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      let auditData = null;
      if (client.wceo_project_id) {
        setMsg('Fetching WebCEO audit…');
        auditData = await getAudit(client.wceo_project_id);
      } else if (client.gsc_property) {
        setMsg('Fetching GSC data…');
        await ensureToken([SCOPES.gsc]);
        auditData = await querySearchAnalytics(client.gsc_property, 28);
      } else {
        throw new Error('Client needs either a WebCEO Project ID or a GSC Property.');
      }
      setMsg('Running Claude triage…');
      const triaged = await triageAudit(auditData, client.url);

      // Round-robin assign to team.
      const newTasks = triaged.map((t, i) => ({
        id: crypto.randomUUID(),
        client_id: client.id,
        client_name: client.name,
        assignee: team.length ? team[i % team.length] : '',
        status: 'open',
        created_at: new Date().toISOString(),
        ...t
      }));
      setTasks(prev => [...newTasks, ...prev]);
      setMsg(`Added ${newTasks.length} tasks.`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  function updateTask(id, patch) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }

  async function handleVerify(task) {
    setBusy(true); setErr('');
    try {
      const ok = await verifyFix(task);
      updateTask(task.id, { status: ok ? 'verified' : 'failed' });
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  function buildPushItem(task) {
    return {
      module: 'technical',
      page_url: task.page_url,
      page_title: task.title,
      change_type: task.fix_type,
      payload: { fix: task.copy_paste_fix, description: task.description }
    };
  }

  // -------- Subviews --------
  if (sub === 'Dashboard') {
    const counts = {
      open:     tasks.filter(t => t.status === 'open').length,
      done:     tasks.filter(t => t.status === 'done').length,
      verified: tasks.filter(t => t.status === 'verified').length,
      failed:   tasks.filter(t => t.status === 'failed').length
    };
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>Technical SEO Dashboard</h2>
        <div className="grid-4" style={{ marginBottom: 20 }}>
          {STATUS_ORDER.map(s => (
            <div className="card" key={s}>
              <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>{s}</div>
              <div style={{ fontSize: 36, fontFamily: 'Instrument Serif, serif' }}>{counts[s]}</div>
            </div>
          ))}
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Clients needing refresh ({staleClients.length})</h3>
          {staleClients.length === 0 && <div className="muted">All clients scanned in the last {STALE_DAYS} days.</div>}
          {staleClients.map(c => (
            <div key={c.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{c.name}</span>
              <span className="badge orange">stale</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (sub === 'Task Board') {
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>Task Board</h2>
        <div className="grid-4">
          {STATUS_ORDER.map(status => (
            <div key={status} className="card">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                <strong style={{ textTransform: 'capitalize' }}>{status}</strong>
                <span className={'badge ' + statusClass(status)}>{clientTasks.filter(t => t.status === status).length}</span>
              </div>
              {clientTasks.filter(t => t.status === status).map(t => (
                <div key={t.id} style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, marginBottom: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{t.page_url}</div>
                  <div className="row" style={{ marginTop: 8, gap: 6 }}>
                    <span className={'badge ' + priorityClass(t.priority)}>{t.priority}</span>
                    {t.assignee && <span className="badge">{t.assignee}</span>}
                  </div>
                  <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
                    {status === 'open' && <button onClick={() => updateTask(t.id, { status: 'done' })}>Mark Done</button>}
                    {status === 'done' && <button onClick={() => handleVerify(t)} disabled={busy}>Verify</button>}
                    {t.copy_paste_fix && (
                      <PushToCmsButton item={buildPushItem(t)} label="Push to CMS" />
                    )}
                  </div>
                  {t.copy_paste_fix && (
                    <details style={{ marginTop: 6 }}>
                      <summary className="muted" style={{ fontSize: 11, cursor: 'pointer' }}>Copy-paste fix</summary>
                      <pre style={{ background: 'var(--bg)', padding: 8, marginTop: 6, fontSize: 11, overflowX: 'auto' }}>{t.copy_paste_fix}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (sub === 'New Scan') {
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>New Scan</h2>
        <div className="card">
          <p className="muted">
            Client: <strong style={{ color: 'var(--text)' }}>{client?.name || 'none selected'}</strong>
          </p>
          <p className="muted">
            Will fetch {client?.wceo_project_id ? 'WebCEO audit' : client?.gsc_property ? 'GSC data' : 'nothing — missing WebCEO project ID and GSC property'},
            then run Claude triage and auto-assign tasks round-robin.
          </p>
          <div className="row">
            <button className="primary" style={{ background: ACCENT, borderColor: ACCENT }} onClick={runScan} disabled={busy || !client}>
              {busy ? 'Scanning…' : 'Run Scan'}
            </button>
            {msg && <span className="muted">{msg}</span>}
          </div>
          {err && <div style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
        </div>
      </div>
    );
  }

  if (sub === 'Clients') {
    async function doSync() {
      setBusy(true); setErr(''); setMsg('Syncing from WebCEO…'); setSyncResult(null);
      try {
        const r = await syncWebceoClients(upsertClient, clients, customMethod.trim() || undefined);
        await reloadClients();
        setSyncResult(r);
        const parts = [
          r.inserted + ' new',
          r.updated + ' updated',
          r.skipped ? r.skipped + ' skipped' : null
        ].filter(Boolean).join(' · ');
        const methodNote = r.method ? ` [method: ${r.method}]` : '';
        setMsg(`Sync complete. ${parts} (${r.total} found in WebCEO response)${methodNote}.`);
      } catch (e) { setErr(e.message); setMsg(''); }
      finally { setBusy(false); }
    }

    const showDebug = syncResult && (syncResult.total === 0 || (syncResult.inserted + syncResult.updated) === 0);

    return (
      <div className="content-area">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Clients</h2>
          <div className="row">
            <span className="muted" style={{ fontSize: 12 }}>
              WebCEO is the source of truth. Every synced client gets all four services by default — toggle off per-client in Edit.
            </span>
            <button onClick={doSync} disabled={busy} className="primary" style={{ background: ACCENT, borderColor: ACCENT }}>
              {busy ? 'Syncing…' : 'Sync from WebCEO'}
            </button>
          </div>
        </div>
        {/* Custom method name override — needed when WebCEO's method name
            isn't in our candidate list. Leave blank to auto-detect. */}
        <div className="card" style={{ marginBottom: 14, padding: 12 }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <label>Custom WebCEO method name (optional)</label>
              <input
                value={customMethod}
                onChange={e => setCustomMethod(e.target.value)}
                placeholder="leave blank to auto-detect"
                className="mono"
              />
            </div>
            <div className="muted" style={{ fontSize: 11, maxWidth: 420 }}>
              If auto-detect fails, check WebCEO's API docs or dashboard for the project-list method name and paste it here. We'll try this first, then fall back to common variants.
            </div>
          </div>
        </div>

        {msg && <div style={{ color: 'var(--green)', marginBottom: 10 }}>{msg}</div>}
        {err && <div style={{ color: 'var(--red)', marginBottom: 10 }}>{err}</div>}

        {syncResult && (
          <details open={showDebug} style={{ marginBottom: 14, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>
              {showDebug ? '⚠ Sync returned no new clients — click to see raw WebCEO response' : 'Debug: raw WebCEO response'}
            </summary>

            {syncResult.attempts?.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12 }}>
                <strong>Methods tried:</strong>
                <ul style={{ margin: '4px 0 8px 18px' }}>
                  {syncResult.attempts.map((a, i) => (
                    <li key={i} className="mono" style={{ fontSize: 11 }}>
                      <span style={{ color: a.errormsg ? 'var(--red)' : 'var(--green)' }}>
                        {a.errormsg ? '✗' : '✓'}
                      </span>
                      {' '}{a.method}
                      {a.errormsg && <span className="muted"> — {a.errormsg}</span>}
                    </li>
                  ))}
                </ul>
                {showDebug && (
                  <div className="muted" style={{ fontSize: 11 }}>
                    None of the auto-detected method names worked. Look up the right name in WebCEO's API docs and paste it into the "Custom WebCEO method name" box above.
                  </div>
                )}
              </div>
            )}

            {syncResult.skippedReasons?.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <strong style={{ color: 'var(--orange)' }}>Skipped items:</strong>
                <ul style={{ margin: '4px 0 8px 18px' }}>
                  {syncResult.skippedReasons.map((r, i) => <li key={i} className="muted">{r}</li>)}
                </ul>
              </div>
            )}

            <pre style={{ background: 'var(--bg)', padding: 10, borderRadius: 6, fontSize: 11, overflowX: 'auto', maxHeight: 400 }}>
              {JSON.stringify(syncResult.rawResponse, null, 2)}
            </pre>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Copy this whole block and paste it back to Claude so the parser can be fixed.
            </div>
          </details>
        )}

        <table>
          <thead>
            <tr>
              <th>Name</th><th>URL</th><th>WebCEO</th><th>GSC</th>
              <th>Tech</th><th>Content</th><th>AEO</th><th>Reports</th>
              <th>Tasks</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.url}</td>
                <td>{c.wceo_project_id ? <span className="badge green">✓</span> : <span className="badge">—</span>}</td>
                <td>{c.gsc_property ? <span className="badge green">✓</span> : <span className="badge">—</span>}</td>
                <td>{c.does_technical !== false ? <span className="badge orange">✓</span> : <span className="badge">—</span>}</td>
                <td>{c.does_content !== false ? <span className="badge" style={{ color: 'var(--mod-content)', borderColor: 'var(--mod-content)' }}>✓</span> : <span className="badge">—</span>}</td>
                <td>{c.does_aeo !== false ? <span className="badge teal">✓</span> : <span className="badge">—</span>}</td>
                <td>{c.does_reporting !== false ? <span className="badge" style={{ color: 'var(--mod-reports)', borderColor: 'var(--mod-reports)' }}>✓</span> : <span className="badge">—</span>}</td>
                <td>{tasks.filter(t => t.client_id === c.id).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (sub === 'Team') {
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>Team</h2>
        <div className="card">
          <label>Team members (comma separated)</label>
          <input
            value={team.join(', ')}
            onChange={e => setTeam(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
            placeholder="Alice, Bob, Priya"
          />
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            New scans assign tasks round-robin across this list.
          </div>
        </div>
      </div>
    );
  }

  if (sub === 'Settings') {
    const gToken = getToken();
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>Technical SEO Settings</h2>
        <div className="card">
          <strong>Google Search Console</strong>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {gToken ? 'Connected (expires ' + new Date(gToken.expires_at).toLocaleString() + ')' : 'Not connected'}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={() => ensureToken([SCOPES.gsc]).then(() => window.location.reload())}>
              Connect GSC
            </button>
            {gToken && <button onClick={() => { clearToken(); window.location.reload(); }}>Disconnect</button>}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
