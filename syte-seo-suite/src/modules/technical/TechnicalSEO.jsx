import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { corsFetchText } from '../../lib/corsProxy.js';
import PushToCmsButton from '../../components/PushToCmsButton.jsx';
import MarkImplementedButton from '../../components/MarkImplementedButton.jsx';
import PipelineView from '../../components/PipelineView.jsx';
import { technicalPipelineStatus } from '../../lib/pipelineStatus.js';
import { getAudit, syncWebceoClients, webceoDiagnose } from './webceo.js';
import { crawlSiteForIssues, summarizeCrawlForAI } from './crawler.js';
import { upsertClient, listAllImplementations, saveTseoTasks, loadTseoTasks, updateTseoTask } from '../../lib/supabase.js';
import { checkOffPageTask, isOffPageTask } from '../../lib/verification.js';
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
You are a senior technical SEO engineer. You receive raw site-audit data (WebCEO audit JSON or Google Search Console data) and must produce a prioritised task list.

CRITICAL RULE: Every task MUST reference a SPECIFIC page URL from the audit data — never wildcards like /products/* or generic paths. If the audit shows 50 product pages missing alt text, create tasks for the TOP 5 most important ones by name with the exact URL. Never generalize into one "fix all products" task.

Return ONLY valid JSON in this shape:
{
  "tasks": [
    {
      "title": "short imperative title — include the specific page name",
      "description": "what is wrong on THIS specific page + expected impact",
      "priority": "critical|high|medium|low",
      "page_url": "the EXACT full URL from the audit data (e.g. https://example.com/products/hi-tall-harness-boot, NOT https://example.com/products/*)",
      "fix_type": "meta_title|meta_description|canonical|schema|internal_link|h1|image_alt|redirect|robots|sitemap|sitemap_submission|page_speed|structured_data|gsc_setup|domain_ownership|analytics_setup|gtm_setup|other",
      "copy_paste_fix": "the ACTUAL finished code/text for THIS specific page — no placeholders like [PRODUCT_NAME], use the real page title/content from the audit data",
      "impact": "high|medium|low",
      "effort": "quick|moderate|complex"
    }
  ]
}

RULES:
- Every page_url must be a real, complete URL found in the audit data. NEVER use wildcards (*), generic paths, or invented URLs.
- Every copy_paste_fix must be FINISHED — ready to paste. No [PLACEHOLDER] values. Use the actual page title, product name, or content from the audit data. For alt text, describe what the image shows based on the filename/context.
- If the audit shows the same issue on many pages, pick the 3-5 MOST IMPORTANT pages (homepage, high-traffic pages, key service/product pages) and create individual tasks for each.
- For image alt text issues: include the specific image URL and the specific page where it's found, with a real descriptive alt text based on the image filename and page context.
- For missing meta titles/descriptions: write the actual title/description for that specific page.
- For missing schema: write the complete JSON-LD for that specific page using real data from the audit.

OFF-PAGE / BACKEND fix_types — use these when the work happens in an external admin console rather than in page HTML:
- gsc_setup / domain_ownership: Google Search Console property creation, ownership verification (TXT record, HTML file, GSC tag).
- sitemap_submission: submitting an XML sitemap inside Search Console (different from creating the sitemap itself, which is fix_type=sitemap).
- analytics_setup / gtm_setup: installing GA4, Universal Analytics, or a GTM container.
For these tasks, copy_paste_fix should describe the exact step-by-step admin actions (e.g. "1. Open search.google.com/search-console 2. Add property fleetwoodonsea.co.za 3. Choose DNS verification 4. Copy TXT record into Cloudflare DNS"). Do NOT write HTML/markup — there's nothing to paste into the page.

PRIORITIZATION (biggest wins first):
- Critical = indexing blocked, canonical loops, redirect chains, robots.txt errors, broken pages returning 4xx/5xx.
- High = missing/duplicate H1, missing meta title on key pages, missing schema on service pages, noindex on pages that should be indexed.
- Medium = weak meta descriptions, missing alt text on important images, thin content pages, slow pages, missing breadcrumb schema.
- Low = minor polish, cosmetic heading issues, optional schema types.
- Sort: critical first, then high + quick effort, then high + moderate, then medium, then low.
- Generate exactly 5 tasks — the 5 MOST IMPACTFUL issues to fix THIS MONTH. Quality over quantity. Pick the fixes that will move the needle most for rankings and user experience. If there are critical issues, those come first. Otherwise, pick the highest-ROI quick wins.
`.trim();

async function triageAudit(auditData, clientUrl) {
  // auditData is now a pre-summarized string from the crawler (plus optional
  // GSC JSON appended). When it's a string, pass it through verbatim — Claude
  // reads the PAGE / issue / fix lines directly and creates tasks from them.
  const dataText = typeof auditData === 'string'
    ? auditData
    : JSON.stringify(auditData).slice(0, 80000);

  const text = await claudeComplete({
    system: TRIAGE_SYSTEM,
    messages: [{
      role: 'user',
      content: `Client URL: ${clientUrl}

Crawler findings (each PAGE block lists specific issues found on that URL with suggested fixes):
${dataText.slice(0, 80000)}

Create one task per MEANINGFUL issue on a SPECIFIC page. Use the exact URLs shown. When the crawler suggests a fix, use it as the copy_paste_fix (refine if needed). Prioritize critical issues (noindex, missing titles) first.`
    }],
    max_tokens: 10000,
    temperature: 0.3
  });
  const parsed = extractJSON(text);
  return parsed?.tasks || [];
}

async function verifyFix(task, client) {
  // Off-page tasks (GSC setup, domain ownership, sitemap submission,
  // analytics install, robots) cannot be confirmed from page HTML. Run
  // the targeted off-page check instead — it returns 'verified',
  // 'failed', or 'manual_required'.
  const looksOffPage = isOffPageTask({
    change_type: task.fix_type,
    title: task.title,
    description: task.description
  });
  if (looksOffPage) {
    const synthetic = {
      change_type: task.fix_type,
      page_url: task.page_url,
      title: task.title,
      description: task.description
    };
    return checkOffPageTask(synthetic, client);
  }

  // Standard HTML verification for all other fix types.
  let html = '';
  try {
    const res = await fetch('/.netlify/functions/page-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: task.page_url })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.html && data.html.length > 200) html = data.html;
    }
  } catch {}
  if (!html) {
    try { html = await corsFetchText(task.page_url); } catch {}
  }
  if (!html || html.length < 200) {
    return { status: 'failed', detail: 'Could not fetch the page to verify.' };
  }

  const verdict = await claudeComplete({
    system: 'You verify SEO fixes on live pages. Be LENIENT — different formatting, wording, or styling from the expected fix is acceptable as long as the core fix is present. Return ONLY JSON: {"implemented": true|false, "evidence": "..."}',
    messages: [{
      role: 'user',
      content: `Task: ${task.title}\nFix_type: ${task.fix_type}\nExpected fix: ${task.copy_paste_fix}\n\nLive page HTML (truncated):\n${html.slice(0, 40000)}`
    }],
    max_tokens: 500,
    temperature: 0
  });
  const parsed = extractJSON(verdict);
  return {
    status: parsed?.implemented === true ? 'verified' : 'failed',
    detail: parsed?.evidence || ''
  };
}

function priorityClass(p) {
  return { critical: 'red', high: 'orange', medium: 'blue', low: 'teal' }[p] || '';
}
function statusClass(s) {
  return { open: 'orange', done: 'blue', verified: 'green', failed: 'red' }[s] || '';
}

// Expandable task card for the pipeline view — shows priority, description,
// copy-paste fix in a code block, and action buttons.
function TaskCard({ task: t, onUpdate, onVerify, busy, buildPushItem, onVerified }) {
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
          {t.effort === 'quick' && (
            <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, background: 'rgba(52,211,153,.12)', color: 'var(--green)', border: '1px solid rgba(52,211,153,.2)', fontWeight: 700 }}>⚡ QUICK WIN</span>
          )}
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
              onVerified={onVerified}
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
  const [tasks, setTasks] = useState([]);
  const [team, setTeam] = useState(loadTeam());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [pastedAudit, setPastedAudit] = useState('');
  const [diagResult, setDiagResult] = useState('');
  const [err, setErr] = useState('');
  const [syncResult, setSyncResult] = useState(null);
  const [customMethod, setCustomMethod] = useState('');

  // Load tasks from Supabase on mount (falls back to localStorage).
  useEffect(() => {
    loadTseoTasks().then(t => setTasks(t)).catch(() => setTasks(loadTasks()));
  }, []);

  // Persist tasks to both Supabase + localStorage on every change.
  useEffect(() => {
    saveTasks(tasks); // localStorage (immediate, always works)
    if (tasks.length > 0) saveTseoTasks(tasks).catch(() => {}); // Supabase (async, best-effort)
  }, [tasks]);
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

  // Full Technical SEO scan pipeline — in-house crawler primary (fetches
  // each page, parses HTML, detects issues), GSC enrichment secondary.
  // Steps: 1) Crawl site  2) AI triage & prioritize  3) Generate tasks
  async function runScanForClient(c) {
    if (!c) { setErr('Select a client first.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      let auditData = null;
      let dataSource = '';

      // STEP 1: Crawl the site directly (our own audit, no dependency on WebCEO).
      setMsg(`Step 1/3 — Crawling ${c.name}…`);
      try {
        const crawl = await crawlSiteForIssues(c, {
          maxPages: 50,
          onProgress: (done, total) => setMsg(`Step 1/3 — Crawling ${c.name}: ${done}/${total} pages`)
        });
        auditData = summarizeCrawlForAI(crawl);
        dataSource = 'In-house Crawler';
        setMsg(`Step 1/3 — Crawled ${crawl.totalCrawled} pages, ${crawl.withIssues} have issues ✓`);
      } catch (e) {
        setMsg(`Step 1/3 — Crawler failed (${e.message.slice(0, 60)}), trying GSC…`);
      }

      // STEP 1b: Enrich with GSC data if available (for traffic/impression context).
      if (c.gsc_property) {
        try {
          await ensureToken([SCOPES.gsc]);
          const gscData = await querySearchAnalytics(c.gsc_property, { days: 28, dimensions: ['page'], rowLimit: 100 });
          auditData = (auditData || '') + '\n\n=== GSC TRAFFIC DATA (last 28 days) ===\n' + JSON.stringify(gscData).slice(0, 20000);
          dataSource += (dataSource ? ' + GSC' : 'GSC');
        } catch (e) {
          // GSC optional — don't fail the scan.
        }
      }

      if (!auditData) {
        throw new Error(`${c.name}: Could not crawl site. Ensure the client has a sitemap URL or valid website URL.`);
      }

      // STEP 2: AI triage — send crawl findings to Claude for prioritized task generation
      setMsg(`Step 2/3 — AI analyzing ${dataSource} data for ${c.name} (biggest wins first)…`);
      const triaged = await triageAudit(auditData, c.url);

      if (!triaged.length) {
        setMsg(`No issues found for ${c.name} — site looks clean from ${dataSource} data.`);
        setBusy(false);
        return;
      }

      // STEP 3: Create tasks (already sorted by priority from Claude)
      setMsg(`Step 3/3 — Creating ${triaged.length} tasks for ${c.name}…`);
      const newTasks = triaged.map((t, i) => ({
        id: crypto.randomUUID(),
        client_id: c.id,
        client_name: c.name,
        assignee: team.length ? team[i % team.length] : '',
        status: 'open',
        data_source: dataSource,
        created_at: new Date().toISOString(),
        ...t
      }));
      setTasks(prev => [...newTasks, ...prev]);

      const critical = newTasks.filter(t => t.priority === 'critical').length;
      const high = newTasks.filter(t => t.priority === 'high').length;
      const quickWins = newTasks.filter(t => t.effort === 'quick').length;
      setMsg(
        `Added ${newTasks.length} tasks for ${c.name} from ${dataSource}` +
        (critical ? ` · ${critical} critical` : '') +
        (high ? ` · ${high} high priority` : '') +
        (quickWins ? ` · ${quickWins} quick wins` : '')
      );
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // Process pasted WebCEO audit data (HTML tables, text, CSV) through Claude.
  // Process pasted WebCEO audit data (HTML tables, text, CSV) through Claude.
  async function runFromPaste(c, pastedText) {
    if (!c) { setErr('Select a client first.'); return; }
    if (!pastedText?.trim()) { setErr('Paste the WebCEO audit data first.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      setMsg(`Step 1/2 — AI analyzing pasted audit data for ${c.name}…`);
      const triaged = await triageAudit(pastedText, c.url);

      if (!triaged.length) {
        setMsg(`No actionable issues found in pasted data for ${c.name}.`);
        setBusy(false);
        return;
      }

      setMsg(`Step 2/2 — Creating ${triaged.length} tasks for ${c.name}…`);
      const newTasks = triaged.map((t, i) => ({
        id: crypto.randomUUID(),
        client_id: c.id,
        client_name: c.name,
        assignee: team.length ? team[i % team.length] : '',
        status: 'open',
        data_source: 'WebCEO (pasted)',
        created_at: new Date().toISOString(),
        ...t
      }));
      setTasks(prev => [...newTasks, ...prev]);
      saveTseoTasks([...newTasks, ...tasks]).catch(() => {});

      const critical = newTasks.filter(t => t.priority === 'critical').length;
      const high = newTasks.filter(t => t.priority === 'high').length;
      setMsg(`Added ${newTasks.length} tasks for ${c.name} from pasted data` +
        (critical ? ` · ${critical} critical` : '') +
        (high ? ` · ${high} high priority` : ''));
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function runScan() { return runScanForClient(client); }

  function updateTask(id, patch) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
    updateTseoTask(id, patch).catch(() => {}); // persist to Supabase
  }

  async function handleVerify(task) {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await verifyFix(task, client);
      // 'manual_required' = off-page check couldn't be automated. Don't
      // overwrite the task status as failed — surface a message instead so
      // the user knows to confirm manually.
      if (r.status === 'manual_required') {
        setMsg('Manual verification required: ' + (r.detail || 'this task happens off-page.'));
      } else {
        updateTask(task.id, { status: r.status });
        if (r.detail) setMsg(r.detail);
      }
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
  function refreshTechImpls() {
    listAllImplementations().then(setTechImpls).catch(() => {});
  }
  useEffect(() => { refreshTechImpls(); }, []);

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
                  <TaskCard key={t.id} task={t} onUpdate={updateTask} onVerify={handleVerify} busy={busy} buildPushItem={buildPushItem} onVerified={refreshTechImpls} />
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
                        onVerified={refreshTechImpls}
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

        {/* Option 1: In-house crawler + GSC enrichment */}
        <div className="card" style={{ marginBottom: 14 }}>
          <strong>Option 1 — Auto-Scan (In-House Crawler)</strong>
          <p className="muted" style={{ fontSize: 12 }}>
            Client: <strong style={{ color: 'var(--text)' }}>{client?.name || 'none selected'}</strong>
          </p>
          <p className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
            Fetches the sitemap, crawls up to 50 pages, parses each HTML response, and detects specific issues with exact URLs: missing meta titles/descriptions, missing H1s, images without alt text (with the specific image URL), missing canonicals, noindex tags, missing schema, thin content, and more. No external API dependency.
            {client?.gsc_property && ' GSC traffic data is merged in for traffic context.'}
          </p>
          <div className="row">
            <button className="primary" style={{ background: ACCENT, borderColor: ACCENT }} onClick={runScan} disabled={busy || !client}>
              {busy ? 'Scanning…' : 'Run Crawl Scan'}
            </button>
            {msg && <span className="muted" style={{ fontSize: 11 }}>{msg}</span>}
          </div>
        </div>

        {/* Option 2: Paste WebCEO audit data */}
        <div className="card">
          <strong>Option 2 — Paste from WebCEO</strong>
          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Open WebCEO → Site Audit for this client → select all the issues text (Ctrl+A on each report page) → paste below. Claude will extract every specific URL and issue and create actionable tasks with exact copy-paste fixes.
          </p>
          <div className="muted" style={{ fontSize: 11, marginBottom: 8, padding: 8, background: 'var(--surface-2)', borderRadius: 6, lineHeight: 1.5 }}>
            <strong>How to copy from WebCEO:</strong><br/>
            1. Go to online.webceo.com → select the project<br/>
            2. Open Site Audit → click each issue category (Missing ALT, Missing Meta, Broken Links, etc.)<br/>
            3. Select all the text in the report (Ctrl+A) and copy (Ctrl+C)<br/>
            4. Paste below — you can paste multiple reports, just keep adding
          </div>
          <textarea
            value={pastedAudit}
            onChange={e => setPastedAudit(e.target.value)}
            placeholder="Paste WebCEO audit report text here — tables, issue lists, everything. The more detail you paste, the more specific the tasks will be."
            rows={10}
            disabled={busy}
          />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <span className="muted" style={{ fontSize: 11 }}>
              {pastedAudit.length > 0 ? `${Math.round(pastedAudit.length / 1000)}k chars pasted` : 'Nothing pasted yet'}
            </span>
            <button
              className="primary"
              style={{ background: ACCENT, borderColor: ACCENT }}
              onClick={() => runFromPaste(client, pastedAudit)}
              disabled={busy || !client || !pastedAudit.trim()}
            >
              {busy ? 'Analyzing…' : 'Generate Tasks from Pasted Data'}
            </button>
          </div>
        </div>

        {err && <div style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}

        {/* Diagnostic — shows full raw WebCEO API response */}
        <div className="card" style={{ marginTop: 14 }}>
          <strong>WebCEO API Diagnostic</strong>
          <p className="muted" style={{ fontSize: 11 }}>
            Sends a test request and shows the full raw response. Paste the output below if you need help debugging.
          </p>
          <button
            onClick={async () => {
              if (!client) { setDiagResult('Select a client first'); return; }
              setDiagResult('Final scan — testing remaining possibilities...');
              const pid = client.wceo_project_id || '';
              // Last batch of guesses + module/action with extra required params
              const tests = [
                // Rank tracking / other tools that might work
                { label: 'get_keywords', raw: { method: 'get_keywords', project: pid } },
                { label: 'get_rankings', raw: { method: 'get_rankings', project: pid } },
                { label: 'get_backlinks', raw: { method: 'get_backlinks', project: pid } },
                { label: 'get_competitors', raw: { method: 'get_competitors', project: pid } },
                { label: 'get_account_info', raw: { method: 'get_account_info' } },
                { label: 'get_account', raw: { method: 'get_account' } },
                // module/action with category + date
                { label: 'SA + category=errors', raw: { module: 'site_audit', action: 'get_report', project: pid, category: 'errors' } },
                { label: 'SA + type=all', raw: { module: 'site_audit', action: 'get_report', project: pid, type: 'all' } },
                { label: 'SA + report=issues', raw: { module: 'site_audit', action: 'get_report', project: pid, report: 'issues' } },
                { label: 'SA get_list', raw: { module: 'site_audit', action: 'get_list', project: pid } },
                { label: 'SA list', raw: { module: 'site_audit', action: 'list', project: pid } },
                // Try direct audit tools
                { label: 'auditor module', raw: { module: 'auditor', action: 'get_report', project: pid } },
                { label: 'crawler module', raw: { module: 'crawler', action: 'get_results', project: pid } }
              ];
              const lines = [];
              for (const t of tests) {
                try {
                  const r = await webceoDiagnose({ raw: t.raw });
                  const body = r.body.slice(0, 400);
                  const isUnknown = body.includes('Unknown command');
                  const isBadArgs = body.includes('Bad Arguments');
                  const mark = (!isUnknown && !isBadArgs) ? '✓✓✓' : isUnknown ? '✗' : '?';
                  lines.push(`${mark} [${t.label}]: ${body}`);
                } catch (e) { lines.push(`✗ [${t.label}] ${e.message}`); }
              }
              setDiagResult(lines.join('\n\n'));
            }}
            disabled={busy || !client}
            style={{ fontSize: 11, padding: '5px 12px' }}
          >
            Run API Diagnostic
          </button>
          {diagResult && (
            <pre style={{
              marginTop: 10, padding: 12, background: '#0d0e11', border: '1px solid var(--border)',
              borderRadius: 6, fontSize: 10, lineHeight: 1.5, color: '#c8d0d8',
              whiteSpace: 'pre-wrap', maxHeight: 400, overflowY: 'auto'
            }}>{diagResult}</pre>
          )}
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
