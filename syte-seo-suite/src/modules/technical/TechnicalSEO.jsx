import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { corsFetchText } from '../../lib/corsProxy.js';
import PushToCmsButton from '../../components/PushToCmsButton.jsx';
import MarkImplementedButton from '../../components/MarkImplementedButton.jsx';
import PipelineView from '../../components/PipelineView.jsx';
import { technicalPipelineStatus } from '../../lib/pipelineStatus.js';
import { getAudit, syncWebceoClients } from './webceo.js';
import { upsertClient, listAllImplementations } from '../../lib/supabase.js';
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

// Expandable task card for the pipeline view — shows priority, description,
// copy-paste fix in a code block, and action buttons.
function TaskCard({ task: t, onUpdate, onVerify, busy, buildPushItem }) {
  const [open, setOpen] = React.useState(false);
  const copyFix = () => navigator.clipboard.writeText(t.copy_paste_fix || '').catch(() => {});

  return (
    <div style={{
      padding: '10px 14px', borderBottom: '1px solid var(--border)',
      background: open ? 'var(--surface-2)' : undefined
    }}>
      <div
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}
        onClick={() => setOpen(v => !v)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{t.title}</div>
          <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
            {t.page_url || ''}
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          <span className={'badge badge-' + (t.priority || 'medium')} style={{
            fontSize: 9, padding: '2px 7px',
            background: { critical: 'rgba(255,77,77,.12)', high: 'rgba(255,159,67,.12)', medium: 'rgba(77,171,255,.12)', low: 'rgba(52,211,153,.12)' }[t.priority] || 'var(--surface-2)',
            color: { critical: 'var(--red)', high: 'var(--orange)', medium: 'var(--blue)', low: 'var(--green)' }[t.priority] || 'var(--text-muted)',
            border: '1px solid ' + ({ critical: 'rgba(255,77,77,.2)', high: 'rgba(255,159,67,.2)', medium: 'rgba(77,171,255,.2)', low: 'rgba(52,211,153,.2)' }[t.priority] || 'var(--border)'),
            borderRadius: 4, textTransform: 'uppercase', fontWeight: 700
          }}>{t.priority}</span>
          <span className={'badge badge-' + (t.status || 'open')} style={{
            fontSize: 9, padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase', fontWeight: 700,
            background: { open: 'rgba(255,107,53,.12)', done: 'rgba(52,211,153,.12)', verified: 'rgba(167,139,250,.12)', failed: 'rgba(255,77,77,.12)' }[t.status] || 'var(--surface-2)',
            color: { open: 'var(--accent)', done: 'var(--green)', verified: 'var(--purple)', failed: 'var(--red)' }[t.status] || 'var(--text-muted)',
            border: '1px solid ' + ({ open: 'rgba(255,107,53,.2)', done: 'rgba(52,211,153,.2)', verified: 'rgba(167,139,250,.2)', failed: 'rgba(255,77,77,.2)' }[t.status] || 'var(--border)')
          }}>{t.status}</span>
          <span className="muted" style={{ fontSize: 9 }}>{open ? '▼' : '▶'}</span>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          {t.description && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
              {t.description}
            </div>
          )}
          {t.copy_paste_fix && (
            <div style={{ position: 'relative' }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-dim)' }}>
                  Copy-paste fix
                </span>
                <button onClick={copyFix} style={{
                  fontSize: 10, padding: '2px 8px', background: 'var(--surface-3)',
                  border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer'
                }}>Copy</button>
              </div>
              <pre style={{
                background: '#0d0e11', border: '1px solid var(--border)', borderRadius: 8,
                padding: 12, fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                lineHeight: 1.6, color: '#c8d0d8', overflowX: 'auto', whiteSpace: 'pre-wrap',
                maxHeight: 200
              }}>{t.copy_paste_fix}</pre>
            </div>
          )}
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {t.status === 'open' && <button onClick={() => onUpdate(t.id, { status: 'done' })} style={{ fontSize: 11, padding: '4px 10px' }}>Mark Done</button>}
            {t.status === 'done' && <button onClick={() => onVerify(t)} disabled={busy} style={{ fontSize: 11, padding: '4px 10px' }}>Verify</button>}
            {t.copy_paste_fix && <PushToCmsButton item={buildPushItem(t)} label="Push to CMS" />}
            <MarkImplementedButton
              module="technical"
              changeType={t.fix_type || 'fix'}
              pageUrl={t.page_url}
              title={t.title}
              description={t.copy_paste_fix || t.description || ''}
            />
          </div>
        </div>
      )}
    </div>
  );
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

  // Core scan logic — accepts a client explicitly so it can be called both
  // from the "New Scan" tab (uses the zustand-selected client) and from
  // the pipeline card's "Run Scan" button (passes the client directly).
  async function runScanForClient(c) {
    if (!c) { setErr('Select a client first.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      let auditData = null;
      if (c.wceo_project_id) {
        setMsg('Fetching WebCEO audit for ' + c.name + '…');
        auditData = await getAudit(c.wceo_project_id);
      } else if (c.gsc_property) {
        setMsg('Fetching GSC data for ' + c.name + '…');
        await ensureToken([SCOPES.gsc]);
        auditData = await querySearchAnalytics(c.gsc_property, { days: 28, dimensions: ['page'], rowLimit: 500 });
      } else {
        throw new Error(c.name + ' needs either a WebCEO Project ID or a GSC Property.');
      }
      setMsg('Running Claude triage for ' + c.name + '…');
      const triaged = await triageAudit(auditData, c.url);

      // Round-robin assign to team.
      const newTasks = triaged.map((t, i) => ({
        id: crypto.randomUUID(),
        client_id: c.id,
        client_name: c.name,
        assignee: team.length ? team[i % team.length] : '',
        status: 'open',
        created_at: new Date().toISOString(),
        ...t
      }));
      setTasks(prev => [...newTasks, ...prev]);
      setMsg(`Added ${newTasks.length} tasks for ${c.name}.`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function runScan() { return runScanForClient(client); }

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

  // -------- Pipeline state --------
  const [techImpls, setTechImpls] = useState([]);
  useEffect(() => {
    listAllImplementations().then(setTechImpls).catch(() => {});
  }, []);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const techClients = clients.filter(c => c.does_technical !== false);
  const techPipeline = useMemo(() => {
    const buckets = {
      'verified-on-site': [],
      'fixes-generated': [],
      'not-scanned': [],
      'credentials-missing': []
    };
    for (const c of techClients) {
      const status = technicalPipelineStatus(c, techImpls, tasks, currentMonth);
      buckets[status.section]?.push({ client: c, summary: status.summary, detail: status.detail });
    }
    return [
      { key: 'verified-on-site',   label: 'Fixes Verified on Site', color: 'var(--green)',      borderColor: 'var(--green)',      clients: buckets['verified-on-site'] },
      { key: 'fixes-generated',    label: 'Fixes Generated',        color: 'var(--blue)',       borderColor: 'var(--blue)',       clients: buckets['fixes-generated'] },
      { key: 'not-scanned',        label: 'Not Scanned Yet',        color: 'var(--text-muted)', borderColor: 'var(--border)',      clients: buckets['not-scanned'] },
      { key: 'credentials-missing', label: 'Credentials Missing',   color: 'var(--red)',        borderColor: 'var(--red)',        clients: buckets['credentials-missing'] }
    ];
  }, [techClients, techImpls, tasks, currentMonth]);

  const [expandedClient, setExpandedClient] = useState(null);

  // Get tasks for a specific client, sorted by priority (critical first).
  function getClientTasks(clientId) {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return tasks
      .filter(t => t.client_id === clientId)
      .sort((a, b) => (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4));
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
        {/* Status bar — shows progress when a scan is running from a pipeline card */}
        {(busy || msg || err) && (
          <div className="card" style={{ marginBottom: 12, padding: '10px 16px', borderColor: busy ? ACCENT : err ? 'var(--red)' : 'var(--green)' }}>
            <div className="row" style={{ gap: 10 }}>
              {busy && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
              <span style={{ fontSize: 13, color: err ? 'var(--red)' : busy ? 'var(--text)' : 'var(--green)' }}>
                {err || msg || 'Scanning…'}
              </span>
            </div>
          </div>
        )}

        {/* Pipeline view */}
        <PipelineView
          title={`Technical SEO — ${monthLabel}`}
          month={monthLabel}
          sections={techPipeline}
          onAction={(c, action) => {
            if (action === 'scan') {
              useClients.getState().select(c.id);
              runScanForClient(c);
            }
          }}
          actions={[
            { key: 'scan', label: 'Run Scan', color: ACCENT,
              condition: (c, section) => section !== 'credentials-missing' && section !== 'verified-on-site' },
            { key: 'scan', label: 'Re-scan', color: ACCENT,
              condition: (c, section) => section === 'verified-on-site' }
          ]}
          onExpandClient={(c) => setExpandedClient(prev => prev === c.id ? null : c.id)}
          expandedId={expandedClient}
          renderExpanded={(c) => {
            const cTasks = getClientTasks(c.id);
            if (cTasks.length === 0) {
              return <div className="muted" style={{ padding: 12, fontSize: 12 }}>No tasks yet. Click Run Scan to generate.</div>;
            }
            // Show top 10 highest priority tasks with expandable fixes.
            const topTasks = cTasks.slice(0, 10);
            return (
              <div>
                <div className="muted" style={{ padding: '8px 14px 4px', fontSize: 11 }}>
                  Showing top {topTasks.length} of {cTasks.length} tasks (highest priority first)
                </div>
                {topTasks.map(t => (
                  <TaskCard key={t.id} task={t} onUpdate={updateTask} onVerify={handleVerify} busy={busy} buildPushItem={buildPushItem} />
                ))}
              </div>
            );
          }}
        />

        {/* Task status counts */}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 16 }}>
          <h3 style={{ margin: '0 0 12px' }}>Task Status</h3>
          <div className="grid-4">
            {STATUS_ORDER.map(s => (
              <div className="card" key={s}>
                <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>{s}</div>
                <div style={{ fontSize: 36, fontFamily: 'Instrument Serif, serif' }}>{counts[s]}</div>
              </div>
            ))}
          </div>
        </div>

        {staleClients.length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Clients needing refresh ({staleClients.length})</h3>
            {staleClients.map(c => (
              <div key={c.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span>{c.name}</span>
                <span className="badge orange">stale</span>
              </div>
            ))}
          </div>
        )}
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
                  {(status === 'done' || status === 'open') && t.page_url && (
                    <div style={{ marginTop: 6 }}>
                      <MarkImplementedButton
                        module="technical"
                        changeType={t.fix_type || 'fix'}
                        pageUrl={t.page_url}
                        title={t.title}
                        description={t.copy_paste_fix || t.description || ''}
                      />
                    </div>
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
