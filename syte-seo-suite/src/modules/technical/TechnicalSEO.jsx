import React, { useState, useEffect } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeComplete } from '../../lib/anthropic.js';
import { addToCmsQueue } from '../../lib/supabase.js';
import { fetchTextWithCors } from '../../lib/cors.js';
import { signInWithGoogle, getGoogleToken } from './oauth.js';
import { getAuditData } from './webceo.js';

const ACCENT = '#ff6b35';
const TASKS_KEY_LEGACY = 'syte-tseo-tasks';
const TASKS_KEY = 'syte-suite:technical-tasks';
const TEAM_KEY = 'syte-suite:technical-team';
const STALE_DAYS = 30;

const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['open', 'done', 'verified', 'failed'];

const PRIORITY_COLOR = {
  critical: 'red',
  high: 'orange',
  medium: 'blue',
  low: 'purple',
};

function loadTasks() {
  // migrate legacy tasks on first load
  try {
    const legacy = localStorage.getItem(TASKS_KEY_LEGACY);
    const fresh = localStorage.getItem(TASKS_KEY);
    if (legacy && !fresh) {
      localStorage.setItem(TASKS_KEY, legacy);
    }
    return JSON.parse(localStorage.getItem(TASKS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveTasks(t) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(t));
}

function loadTeam() {
  try {
    return JSON.parse(localStorage.getItem(TEAM_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveTeam(t) {
  localStorage.setItem(TEAM_KEY, JSON.stringify(t));
}

function roundRobinAssign(tasks, team) {
  if (!team.length) return tasks;
  let i = 0;
  return tasks.map((t) => {
    if (t.assignee) return t;
    const assignee = team[i % team.length];
    i += 1;
    return { ...t, assignee };
  });
}

async function triageWithClaude({ dataSummary, client }) {
  const system = `You are a senior technical SEO engineer. Analyze the audit data and output a JSON array of prioritized tasks with copy-paste ready fixes.

Each task object MUST have:
- id (unique string)
- title
- description
- priority ("critical" | "high" | "medium" | "low")
- page_url
- fix_code (a ready-to-paste HTML/JSON/text snippet when applicable)
- fix_notes (short plain-English steps)
- change_type ("meta" | "schema" | "content" | "redirect" | "robots" | "other")

Output ONLY valid JSON, no markdown fences.`;
  const user = `Client: ${client?.name || 'Unknown'}
URL: ${client?.url || ''}

Audit data:
${JSON.stringify(dataSummary).slice(0, 12000)}

Return the task list.`;
  const { text } = await claudeComplete({
    system,
    messages: [{ role: 'user', content: user }],
    max_tokens: 4000,
    temperature: 0.2,
  });
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function verifyFixWithClaude(task, html) {
  const system = `You verify whether a technical SEO fix has been implemented on a page. Reply with exactly "VERIFIED" or "FAILED" followed by a one-line reason.`;
  const user = `Task: ${task.title}
Expected fix: ${task.fix_code || task.fix_notes}
Page HTML (truncated):
${html.slice(0, 15000)}`;
  const { text } = await claudeComplete({
    system,
    messages: [{ role: 'user', content: user }],
    max_tokens: 200,
    temperature: 0,
  });
  return text.trim().startsWith('VERIFIED');
}

function Dashboard({ tasks, clients }) {
  const counts = {
    total: tasks.length,
    open: tasks.filter((t) => t.status === 'open').length,
    done: tasks.filter((t) => t.status === 'done').length,
    verified: tasks.filter((t) => t.status === 'verified').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
  };
  const stale = clients.filter((c) => {
    const latest = tasks
      .filter((t) => t.client_id === c.id)
      .map((t) => new Date(t.created_at).getTime())
      .sort((a, b) => b - a)[0];
    if (!latest) return true;
    return Date.now() - latest > STALE_DAYS * 24 * 60 * 60 * 1000;
  });

  return (
    <div className="stack">
      <div className="grid-3">
        {Object.entries(counts).map(([k, v]) => (
          <div key={k} className="card">
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
              {k}
            </div>
            <div style={{ fontSize: 28, color: ACCENT }}>{v}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Clients needing refresh (&gt;{STALE_DAYS}d)</div>
        {stale.length ? (
          stale.map((c) => (
            <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              {c.name} <span className="muted" style={{ fontSize: 12 }}>{c.url}</span>
            </div>
          ))
        ) : (
          <div className="muted">All clients fresh.</div>
        )}
      </div>
    </div>
  );
}

function TaskBoard({ tasks, updateTask, client }) {
  const [filter, setFilter] = useState('all');
  const list = tasks
    .filter((t) => !client || t.client_id === client.id)
    .filter((t) => filter === 'all' || t.status === filter);

  async function queue(task) {
    if (!task.fix_code) return;
    await addToCmsQueue({
      client_id: task.client_id,
      module: 'technical',
      page_url: task.page_url,
      page_title: task.title,
      change_type: task.change_type || 'other',
      payload: { fix_code: task.fix_code, fix_notes: task.fix_notes },
      status: 'pending',
    });
    alert('Queued for CMS Push.');
  }

  async function verify(task) {
    try {
      const html = await fetchTextWithCors(task.page_url);
      const ok = await verifyFixWithClaude(task, html);
      updateTask(task.id, { status: ok ? 'verified' : 'failed' });
    } catch (e) {
      updateTask(task.id, { status: 'failed', error: e.message });
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <label style={{ margin: 0 }}>Filter</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 200 }}>
          <option value="all">All</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {list.length === 0 && <div className="muted">No tasks.</div>}
      {list.map((t) => (
        <div key={t.id} className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{t.title}</div>
              <div className="muted" style={{ fontSize: 12 }}>{t.page_url}</div>
            </div>
            <div className="row">
              <span className={`badge ${PRIORITY_COLOR[t.priority] || ''}`}>{t.priority}</span>
              <span className="badge">{t.status}</span>
              {t.assignee && <span className="badge purple">{t.assignee}</span>}
            </div>
          </div>
          <div style={{ fontSize: 13 }}>{t.description}</div>
          {t.fix_code && <pre className="output" style={{ maxHeight: 200 }}>{t.fix_code}</pre>}
          <div className="row">
            <button onClick={() => updateTask(t.id, { status: 'done' })}>Mark Done</button>
            <button onClick={() => verify(t)}>AI Verify</button>
            {t.fix_code && <button onClick={() => queue(t)}>Queue for CMS Push</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewScan({ client, onTasks }) {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);

  const add = (l) => setLog((prev) => [...prev, l]);

  async function runGSC() {
    setBusy(true);
    setLog([]);
    try {
      add('Authenticating with Google Search Console…');
      let token = getGoogleToken('https://www.googleapis.com/auth/webmasters.readonly');
      if (!token) {
        token = await signInWithGoogle('https://www.googleapis.com/auth/webmasters.readonly');
      }
      add('Fetching GSC data…');
      const res = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
          client.gsc_property || client.url
        )}/searchAnalytics/query`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            startDate: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
            endDate: new Date().toISOString().slice(0, 10),
            dimensions: ['page'],
            rowLimit: 100,
          }),
        }
      );
      const data = await res.json();
      add('Running Claude triage…');
      const tasks = await triageWithClaude({ dataSummary: data, client });
      add(`Generated ${tasks.length} tasks.`);
      onTasks(tasks);
    } catch (e) {
      add(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function runWebCEO() {
    if (!client?.wceo_project_id) {
      alert('Set WebCEO Project ID on the client first.');
      return;
    }
    setBusy(true);
    setLog([]);
    try {
      add('Fetching WebCEO audit…');
      const data = await getAuditData(client.wceo_project_id);
      add('Running Claude triage…');
      const tasks = await triageWithClaude({ dataSummary: data, client });
      add(`Generated ${tasks.length} tasks.`);
      onTasks(tasks);
    } catch (e) {
      add(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div style={{ fontWeight: 600 }}>Run a new scan for {client?.name || '(no client)'}</div>
      <div className="row">
        <button className="primary" style={{ background: ACCENT, borderColor: ACCENT }} onClick={runWebCEO} disabled={!client || busy}>
          Scan via WebCEO
        </button>
        <button onClick={runGSC} disabled={!client || busy}>
          Scan via Google Search Console
        </button>
      </div>
      {log.length > 0 && (
        <pre className="output">{log.join('\n')}</pre>
      )}
    </div>
  );
}

function ClientsTab({ clients }) {
  return (
    <div className="stack">
      {clients.map((c) => (
        <div key={c.id} className="card row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{c.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>{c.url}</div>
          </div>
          <div className="row">
            {c.wceo_project_id && <span className="badge">WebCEO</span>}
            {c.gsc_property && <span className="badge blue">GSC</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function TeamTab() {
  const [team, setTeam] = useState(loadTeam());
  const [name, setName] = useState('');

  function add() {
    if (!name.trim()) return;
    const next = [...team, name.trim()];
    setTeam(next);
    saveTeam(next);
    setName('');
  }

  function remove(i) {
    const next = team.filter((_, idx) => idx !== i);
    setTeam(next);
    saveTeam(next);
  }

  return (
    <div className="card stack">
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Team member name" />
        <button onClick={add}>Add</button>
      </div>
      {team.map((m, i) => (
        <div key={i} className="row" style={{ justifyContent: 'space-between' }}>
          <span>{m}</span>
          <button onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
    </div>
  );
}

export default function TechnicalSEO({ tab }) {
  const { clients, getSelected } = useClients();
  const client = getSelected();
  const [tasks, setTasks] = useState(loadTasks());

  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  function updateTask(id, patch) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function addTasks(newOnes) {
    if (!client) return;
    const team = loadTeam();
    const stamped = newOnes.map((t, i) => ({
      ...t,
      id: t.id || `${Date.now()}-${i}`,
      status: 'open',
      client_id: client.id,
      created_at: new Date().toISOString(),
    }));
    setTasks((prev) => [...roundRobinAssign(stamped, team), ...prev]);
  }

  return (
    <div>
      <h1 className="h1-title">Technical SEO</h1>
      <div className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        {client ? client.name : 'Select a client.'}
      </div>
      {tab === 'Dashboard' && <Dashboard tasks={tasks} clients={clients} />}
      {tab === 'Task Board' && <TaskBoard tasks={tasks} updateTask={updateTask} client={client} />}
      {tab === 'New Scan' && <NewScan client={client} onTasks={addTasks} />}
      {tab === 'Clients' && <ClientsTab clients={clients} />}
      {tab === 'Team' && <TeamTab />}
      {tab === 'Settings' && (
        <div className="card muted">Technical SEO module settings — configure via the shared Client modal.</div>
      )}
    </div>
  );
}
