import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { corsFetchText } from '../../lib/corsProxy.js';
import PushToCmsButton from '../../components/PushToCmsButton.jsx';
import MarkImplementedButton from '../../components/MarkImplementedButton.jsx';
import PipelineView from '../../components/PipelineView.jsx';
import ExternalWork from '../../components/ExternalWork.jsx';
import { technicalPipelineStatus, monthOptions } from '../../lib/pipelineStatus.js';
import { getAudit, syncWebceoClients, webceoDiagnose } from './webceo.js';
import { crawlSiteForIssues, summarizeCrawlForAI } from './crawler.js';
import { upsertClient, listAllImplementations, saveTseoTasks, loadTseoTasks, updateTseoTask, logImplementation, updateImplementation, listTseoRejections, saveTseoRejection } from '../../lib/supabase.js';
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

// Defaults for the configurable scan depth / suggestion count (overridable
// per-scan from the New Scan screen).
const DEFAULT_CRAWL_DEPTH = 100;
const DEFAULT_SUGGESTIONS = 15;

function loadTasks() {
  // One-time migration of legacy key.
  if (!localStorage.getItem(TASKS_KEY)) {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) localStorage.setItem(TASKS_KEY, legacy);
  }
  try { return JSON.parse(localStorage.getItem(TASKS_KEY) || '[]'); } catch { return []; }
}
function saveTasks(t) {
  // localStorage is only a fallback cache — Supabase is the source of truth.
  // If we exceed the per-origin quota (typically 5–10 MB), drop the cache
  // entirely rather than crashing the module. The next reload will refill
  // from Supabase.
  const json = JSON.stringify(t);
  try {
    localStorage.setItem(TASKS_KEY, json);
  } catch (e) {
    try { localStorage.removeItem(TASKS_KEY); } catch {}
    try { localStorage.removeItem(LEGACY_KEY); } catch {}
    try { localStorage.setItem(TASKS_KEY, json); } catch {
      // Still too large — give up silently; Supabase has the data.
    }
  }
}

// Stable dedup key for a task. Same shape used by dedupeTasks and by the
// rejection blocklist so a freshly-triaged task with a new UUID but the
// same logical issue is collapsed/filtered consistently.
export function taskDedupKey(t) {
  return (t.client_id || '') + '|' + (t.page_url || t.url || '') + '|' + (t.action_summary || t.title || '');
}

// Dedupe tasks by (client_id, url, action_summary). Keeps the most
// recent (highest created_at) row per logical issue and caps OPEN
// tasks per client to 25. Done/verified tasks are preserved in full
// because they're the work-history record.
function dedupeTasks(list) {
  if (!Array.isArray(list)) return [];
  // Bucket by status — done/verified pass through untouched.
  const history = list.filter(t => t.status === 'done' || t.status === 'verified');
  const open = list.filter(t => t.status === 'open' || t.status === 'failed');
  // Keep newest per dedup key.
  const seen = new Map();
  for (const t of open.sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  )) {
    const key = taskDedupKey(t);
    if (!seen.has(key)) seen.set(key, t);
  }
  // Cap per client.
  const PER_CLIENT_MAX = 25;
  const byClient = new Map();
  const capped = [];
  for (const t of seen.values()) {
    const c = byClient.get(t.client_id) || 0;
    if (c < PER_CLIENT_MAX) {
      capped.push(t);
      byClient.set(t.client_id, c + 1);
    }
  }
  return [...capped, ...history];
}
function loadTeam() { try { return JSON.parse(localStorage.getItem(TEAM_KEY) || '[]'); } catch { return []; } }
function saveTeam(t) {
  try { localStorage.setItem(TEAM_KEY, JSON.stringify(t)); } catch {}
}

function buildTriageSystem(limit = DEFAULT_SUGGESTIONS) {
  return `
You are a senior technical SEO engineer. You receive raw site-audit data (WebCEO audit JSON or Google Search Console data) and must produce a prioritised task list.

CRITICAL RULE: Every task MUST reference a SPECIFIC page URL from the audit data — never wildcards like /products/* or generic paths. If the audit shows 50 product pages missing alt text, create tasks for the TOP ${limit} most important ones by name with the exact URL. Never generalize into one "fix all products" task.

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
- If the audit shows the same issue on many pages, pick the MOST IMPORTANT pages (homepage, high-traffic pages, key service/product pages) and create individual tasks for each.
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
- Generate up to ${limit} tasks — the MOST IMPACTFUL issues to fix, ordered biggest-win first. Quality over quantity: only create a task for a real, fixable issue present in the audit data. If there are fewer than ${limit} meaningful issues, return only the real ones — never pad the list. Critical issues come first, then the highest-ROI quick wins.
`.trim();
}

async function triageAudit(auditData, clientUrl, taskLimit = DEFAULT_SUGGESTIONS) {
  // auditData is now a pre-summarized string from the crawler (plus optional
  // GSC JSON appended). When it's a string, pass it through verbatim — Claude
  // reads the PAGE / issue / fix lines directly and creates tasks from them.
  const dataText = typeof auditData === 'string'
    ? auditData
    : JSON.stringify(auditData).slice(0, 80000);

  const text = await claudeComplete({
    system: buildTriageSystem(taskLimit),
    messages: [{
      role: 'user',
      content: `Client URL: ${clientUrl}

Crawler findings (each PAGE block lists specific issues found on that URL with suggested fixes):
${dataText.slice(0, 80000)}

Create one task per MEANINGFUL issue on a SPECIFIC page, up to ${taskLimit} tasks. Use the exact URLs shown. When the crawler suggests a fix, use it as the copy_paste_fix (refine if needed). Prioritize critical issues (noindex, missing titles) first.`
    }],
    max_tokens: 16000,
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
//
// taskClient: the client this task ACTUALLY belongs to (resolved from
// task.client_id). Passed down so the verify button checks the right
// domain — without this, the verifier used the topbar-selected client,
// which led to "robots.txt is not reachable at https://bamdiy.com/..."
// when the user was working on a Syte task with bamdiy.com selected.
// (This is also what left the Mark-as-Implemented button disabled / showing
// the not-allowed cursor when no client was selected in the topbar.)
function TaskCard({ task: t, onUpdate, onMarkDone, onVerify, onReject, busy, buildPushItem, onVerified, taskClient }) {
  const [open, setOpen] = React.useState(false);
  const copyFix = () => navigator.clipboard.writeText(t.copy_paste_fix || '').catch(() => {});

  function handleReject(e) {
    e.stopPropagation();
    const reason = window.prompt('Reject this optimization? It will be filtered out of future scans.\n\nOptional reason:') ;
    if (reason === null) return; // user cancelled
    onReject(t, reason || '');
  }

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
            {t.status === 'open' && <button onClick={() => onMarkDone(t)} style={{ fontSize: 11, padding: '4px 10px' }}>Mark Done</button>}
            {t.status === 'done' && <button onClick={() => onVerify(t)} disabled={busy} style={{ fontSize: 11, padding: '4px 10px' }}>Verify</button>}
            {t.copy_paste_fix && <PushToCmsButton item={buildPushItem(t)} label="Push to CMS" />}
            <MarkImplementedButton
              module="technical"
              changeType={t.fix_type || 'fix'}
              client={taskClient}
              pageUrl={t.page_url}
              title={t.title}
              description={t.copy_paste_fix || t.description || ''}
              onVerified={() => {
                // Marking implemented + verified must also flip the task's own
                // status, otherwise the badge stays at its last value (e.g.
                // FAILED) while a verified impl row exists — the two sources of
                // truth disagree and the pipeline card looks unverified.
                onUpdate(t.id, { status: 'verified' });
                onVerified?.();
              }}
            />
            {t.status === 'open' && onReject && (
              <button
                onClick={handleReject}
                title="Reject this optimization so it won't appear in future scans"
                style={{ fontSize: 11, padding: '4px 10px', color: 'var(--red)', borderColor: 'rgba(255,77,77,.3)' }}
              >
                Reject
              </button>
            )}
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
  // Per-scan tuning (request: "crawl deeper" + more than 5 suggestions).
  const [crawlDepth, setCrawlDepth] = useState(DEFAULT_CRAWL_DEPTH);
  const [suggestionCount, setSuggestionCount] = useState(DEFAULT_SUGGESTIONS);
  // Set of rejected dedup keys ("clientId|pageUrl|title"). Filtered out of
  // the visible task list and from any future scan-generated tasks so a
  // rejected optimization doesn't reappear next month.
  const [rejectedKeys, setRejectedKeys] = useState(() => new Set());

  // Load tasks from Supabase on mount (falls back to localStorage), then
  // auto-dedupe so existing accumulated junk from previous scans (the
  // "100 open tasks for one client" problem) gets cleaned up on the
  // next visit. Keeps newest task per (client_id, url, action_summary).
  useEffect(() => {
    loadTseoTasks()
      .then(t => setTasks(dedupeTasks(t)))
      .catch(() => setTasks(dedupeTasks(loadTasks())));
    listTseoRejections()
      .then(rows => setRejectedKeys(new Set((rows || []).map(r => (r.client_id || '') + '|' + r.dedup_key))))
      .catch(() => {});
  }, []);

  // Filter rejected open tasks out of the visible list. Rejection key
  // combines client_id with the dedup_key so it round-trips with the
  // server-side blocklist regardless of which client is selected.
  const visibleTasks = useMemo(() => {
    if (!rejectedKeys.size) return tasks;
    return tasks.filter(t => {
      if (t.status === 'done' || t.status === 'verified') return true;
      return !rejectedKeys.has((t.client_id || '') + '|' + taskDedupKey(t));
    });
  }, [tasks, rejectedKeys]);

  async function rejectTask(t, reason) {
    if (!t?.client_id) return;
    const key = taskDedupKey(t);
    const fullKey = (t.client_id || '') + '|' + key;
    // Optimistic: hide immediately, then persist. If save fails we don't
    // restore — local state already mirrors intent.
    setRejectedKeys(prev => {
      const next = new Set(prev);
      next.add(fullKey);
      return next;
    });
    setTasks(prev => prev.filter(x => x.id !== t.id));
    try {
      await saveTseoRejection(t.client_id, key, reason || '');
    } catch (e) {
      console.warn('[TSEO] saveTseoRejection failed:', e.message);
    }
  }

  // Persist tasks to both Supabase + localStorage on every change.
  useEffect(() => {
    saveTasks(tasks); // localStorage (immediate, always works)
    if (tasks.length > 0) saveTseoTasks(tasks).catch(() => {}); // Supabase (async, best-effort)
  }, [tasks]);
  useEffect(() => { saveTeam(team); }, [team]);

  const clientTasks = useMemo(
    () => client ? visibleTasks.filter(t => t.client_id === client.id) : visibleTasks,
    [visibleTasks, client]
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
      // Hint Google to the client's saved GSC account so any GSC call
      // below uses the right token and skips the account picker.
      const gscEmail = c.gsc_account_email || c.google_account_email || null;
      let auditData = null;
      let dataSource = '';

      // STEP 1: Crawl the site directly (our own audit, no dependency on WebCEO).
      setMsg(`Step 1/3 — Crawling ${c.name}…`);
      try {
        const crawl = await crawlSiteForIssues(c, {
          maxPages: crawlDepth,
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
          await ensureToken([SCOPES.gsc], { expectedEmail: gscEmail });
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
      const triaged = await triageAudit(auditData, c.url, suggestionCount);

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
      })).filter(t => !rejectedKeys.has((t.client_id || '') + '|' + taskDedupKey(t)));
      // Re-scanning the same client must REPLACE the open tasks for that
      // client — not append. Otherwise tasks accumulate every run and
      // the user ends up with 100+ stale duplicates after a few scans
      // (which is exactly what was happening). Keep done/verified tasks
      // as work history. Also cap new tasks at MAX_TASKS_PER_CLIENT to
      // stop a noisy scan flooding the board.
      const MAX_TASKS_PER_CLIENT = 25;
      const cappedNew = newTasks.slice(0, MAX_TASKS_PER_CLIENT);
      setTasks(prev => {
        const kept = prev.filter(t =>
          t.client_id !== c.id || (t.status === 'done' || t.status === 'verified')
        );
        return [...cappedNew, ...kept];
      });

      const critical = cappedNew.filter(t => t.priority === 'critical').length;
      const high = cappedNew.filter(t => t.priority === 'high').length;
      const quickWins = cappedNew.filter(t => t.effort === 'quick').length;
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
      const triaged = await triageAudit(pastedText, c.url, suggestionCount);

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
      })).filter(t => !rejectedKeys.has((t.client_id || '') + '|' + taskDedupKey(t)));
      // Replace open tasks for this client (keep done/verified for history)
      // and cap at 25 per scan — same logic as the live-scan path. Prevents
      // task accumulation across re-scans of the same client.
      const MAX_TASKS_PER_CLIENT = 25;
      const cappedNew = newTasks.slice(0, MAX_TASKS_PER_CLIENT);
      const nextTasks = (() => {
        const kept = tasks.filter(t =>
          t.client_id !== c.id || (t.status === 'done' || t.status === 'verified')
        );
        return [...cappedNew, ...kept];
      })();
      setTasks(nextTasks);
      saveTseoTasks(nextTasks).catch(() => {});

      const critical = cappedNew.filter(t => t.priority === 'critical').length;
      const high = cappedNew.filter(t => t.priority === 'high').length;
      setMsg(`Added ${cappedNew.length} tasks for ${c.name} from pasted data` +
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

  // Persist a completed task to the permanent implementations record so it
  // survives re-scans and shows in Implementation Progress + the weekly email.
  // Links the impl back to the task via impl_id to avoid duplicate rows on
  // re-verify.
  async function logTaskProgress(task, status, detail) {
    const verified = status === 'verified';
    try {
      if (task.impl_id) {
        await updateImplementation(task.impl_id, {
          verification_status: verified ? 'verified' : 'pending',
          verification_detail: detail || null,
          verified_at: verified ? new Date().toISOString() : null
        });
      } else {
        const impl = await logImplementation({
          client_id: task.client_id,
          module: 'technical',
          change_type: task.fix_type || 'fix',
          page_url: task.page_url || client?.url || '',
          title: task.title || 'Technical SEO fix',
          description: (task.copy_paste_fix || task.description || '').slice(0, 2000),
          implemented_by: task.assignee || 'Team member',
          verification_status: verified ? 'verified' : 'pending',
          verification_detail: detail || null,
          verified_at: verified ? new Date().toISOString() : null
        });
        if (impl?.id) updateTask(task.id, { impl_id: impl.id });
      }
      refreshTechImpls();
    } catch { /* best-effort — the task status itself is already saved */ }
  }

  function markDone(task) {
    updateTask(task.id, { status: 'done' });
    logTaskProgress(task, 'done');
  }

  async function handleVerify(task) {
    setBusy(true); setErr(''); setMsg('');
    try {
      // Resolve the task's actual client. Verifying against the topbar's
      // current client produced cross-domain probes ("checking
      // bamdiy.com/robots.txt for a Syte task") when users had a
      // different client selected. Fall back to the topbar selection
      // only if we can't find the task's client in the list.
      const taskClient = clients.find(c => c.id === task.client_id) || client;
      const r = await verifyFix(task, taskClient);
      // 'manual_required' = off-page check couldn't be automated. Don't
      // overwrite the task status as failed — surface a message instead so
      // the user knows to confirm manually.
      if (r.status === 'manual_required') {
        setMsg('Manual verification required: ' + (r.detail || 'this task happens off-page.'));
      } else {
        updateTask(task.id, { status: r.status });
        if (r.detail) setMsg(r.detail);
        // Record completed/verified work permanently so a re-scan can't erase it.
        if (r.status === 'verified' || r.status === 'done') {
          logTaskProgress(task, r.status, r.detail);
        }
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

  const months = useMemo(() => monthOptions(), []);
  const [selMonth, setSelMonth] = useState(new Date().toISOString().slice(0, 7));
  const currentMonth = selMonth;
  const monthLabel = months.find(m => m.value === selMonth)?.label || selMonth;

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
  // Uses visibleTasks so rejected items don't appear in the per-client view.
  function getClientTasks(clientId) {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return visibleTasks
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
    // Find clients that haven't been scanned this month — offer a one-click
    // bulk scan + auto-prompt during the first 7 days of the month so users
    // don't have to remember to click each card individually.
    const unscannedThisMonth = techClients.filter(c => {
      const cTasks = tasks.filter(t =>
        t.client_id === c.id &&
        (t.created_at || '').slice(0, 7) === currentMonth
      );
      return cTasks.length === 0;
    });
    const dayOfMonth = new Date().getDate();
    const isMonthStart = dayOfMonth <= 7;

    async function scanAllUnscanned() {
      if (busy) return;
      const list = unscannedThisMonth;
      if (!list.length) return;
      const ok = window.confirm(
        'Run Technical SEO scan for ' + list.length + ' unscanned client' +
        (list.length === 1 ? '' : 's') + '?\nThis can take a few minutes per client.'
      );
      if (!ok) return;
      for (let i = 0; i < list.length; i++) {
        setMsg('Bulk scan ' + (i + 1) + '/' + list.length + ': ' + list[i].name);
        try { await runScanForClient(list[i]); } catch {}
      }
      setMsg('Bulk scan complete — ' + list.length + ' clients scanned.');
    }

    return (
      <div className="content-area">
        {/* STICKY status banner — sticks to the top of the scroll area so a
            scan triggered from a pipeline card lower down the page can't be
            invisible behind the topbar. Includes scroll-into-view on mount
            via auto-scrolling when busy starts (handled below). */}
        {(busy || msg || err) && (
          <div className="card" style={{
            marginBottom: 12, padding: '10px 16px',
            borderColor: busy ? ACCENT : err ? 'var(--red)' : 'var(--green)',
            position: 'sticky', top: 0, zIndex: 6,
            background: 'var(--surface)'
          }}>
            <div className="row" style={{ gap: 10 }}>
              {busy && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
              <span style={{ fontSize: 13, color: err ? 'var(--red)' : busy ? 'var(--text)' : 'var(--green)' }}>
                {err || msg || 'Scanning…'}
              </span>
            </div>
          </div>
        )}

        {/* Month-start prompt: when there are unscanned clients in the first
            week of the month, surface a single "Scan all" CTA at the top
            so users don't have to chase individual cards. */}
        {unscannedThisMonth.length > 0 && (
          <div className="card" style={{
            marginBottom: 12, padding: '12px 16px',
            borderColor: isMonthStart ? ACCENT : 'var(--border)',
            borderLeftWidth: 3,
            borderLeftStyle: 'solid'
          }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {isMonthStart
                    ? 'It\'s the start of ' + monthLabel + ' — ' + unscannedThisMonth.length + ' client' + (unscannedThisMonth.length === 1 ? ' hasn\'t' : 's haven\'t') + ' been scanned yet'
                    : unscannedThisMonth.length + ' client' + (unscannedThisMonth.length === 1 ? '' : 's') + ' not yet scanned this month'}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {unscannedThisMonth.slice(0, 5).map(c => c.name).join(', ')}
                  {unscannedThisMonth.length > 5 && ` +${unscannedThisMonth.length - 5} more`}
                </div>
              </div>
              <button
                onClick={scanAllUnscanned}
                disabled={busy}
                className="primary"
                style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c', fontSize: 12 }}
              >
                {busy ? 'Scanning…' : 'Scan all ' + unscannedThisMonth.length + ' now'}
              </button>
            </div>
          </div>
        )}

        {/* Pipeline view */}
        <PipelineView
          title={`Technical SEO — ${monthLabel}`}
          month={monthLabel}
          monthSelector={
            <select value={selMonth} onChange={e => setSelMonth(e.target.value)} style={{ width: 170, fontSize: 12 }}>
              {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          }
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
            // Show highest-priority tasks with expandable fixes (cap high to
            // accommodate deeper scans without rendering an unbounded list).
            const topTasks = cTasks.slice(0, 50);
            return (
              <div>
                <div className="muted" style={{ padding: '8px 14px 4px', fontSize: 11 }}>
                  Showing {topTasks.length === cTasks.length ? 'all' : 'top'} {topTasks.length} of {cTasks.length} tasks (highest priority first)
                </div>
                {topTasks.map(t => (
                  <TaskCard
                    key={t.id} task={t}
                    onUpdate={updateTask}
                    onMarkDone={markDone}
                    onVerify={handleVerify}
                    onReject={rejectTask}
                    busy={busy}
                    buildPushItem={buildPushItem}
                    onVerified={refreshTechImpls}
                    taskClient={c}
                  />
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
                    {status === 'open' && <button onClick={() => markDone(t)}>Mark Done</button>}
                    {status === 'done' && <button onClick={() => handleVerify(t)} disabled={busy}>Verify</button>}
                    {t.copy_paste_fix && (
                      <PushToCmsButton item={buildPushItem(t)} label="Push to CMS" />
                    )}
                    {status === 'open' && (
                      <button
                        onClick={() => {
                          const reason = window.prompt('Reject this optimization? It will be filtered out of future scans.\n\nOptional reason:');
                          if (reason === null) return;
                          rejectTask(t, reason || '');
                        }}
                        title="Reject this optimization so it won't appear in future scans"
                        style={{ color: 'var(--red)', borderColor: 'rgba(255,77,77,.3)' }}
                      >
                        Reject
                      </button>
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
                        client={client}
                        pageUrl={t.page_url}
                        title={t.title}
                        description={t.copy_paste_fix || t.description || ''}
                        onVerified={() => {
                          // Keep the task badge and the verified impl row in
                          // sync — see the note on the pipeline TaskCard above.
                          updateTask(t.id, { status: 'verified' });
                          refreshTechImpls();
                        }}
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

  if (sub === 'External Work') {
    return <ExternalWork />;
  }

  if (sub === 'New Scan') {
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>New Scan</h2>

        {/* Scan depth / suggestion count — applies to both options below. */}
        <div className="card" style={{ marginBottom: 14 }}>
          <strong>Scan Depth</strong>
          <p className="muted" style={{ fontSize: 11, marginBottom: 10 }}>
            Control how deep the crawl goes and how many fixes to generate. Higher values find more issues but take longer and cost more in AI tokens.
          </p>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ minWidth: 180 }}>
              <label>Pages to crawl (max)</label>
              <input
                type="number"
                min={1}
                max={500}
                value={crawlDepth}
                onChange={e => setCrawlDepth(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || DEFAULT_CRAWL_DEPTH)))}
                disabled={busy}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ minWidth: 180 }}>
              <label>Number of suggestions</label>
              <input
                type="number"
                min={1}
                max={50}
                value={suggestionCount}
                onChange={e => setSuggestionCount(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || DEFAULT_SUGGESTIONS)))}
                disabled={busy}
                style={{ width: '100%' }}
              />
            </div>
            <span className="muted" style={{ fontSize: 11 }}>
              Crawling up to {crawlDepth} pages · generating up to {suggestionCount} prioritised fixes.
            </span>
          </div>
        </div>

        {/* Option 1: In-house crawler + GSC enrichment */}
        <div className="card" style={{ marginBottom: 14 }}>
          <strong>Option 1 — Auto-Scan (In-House Crawler)</strong>
          <p className="muted" style={{ fontSize: 12 }}>
            Client: <strong style={{ color: 'var(--text)' }}>{client?.name || 'none selected'}</strong>
          </p>
          <p className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
            Fetches the sitemap, crawls up to {crawlDepth} pages, parses each HTML response, and detects specific issues with exact URLs: missing meta titles/descriptions, missing H1s, images without alt text (with the specific image URL), missing canonicals, noindex tags, missing schema, thin content, and more. No external API dependency.
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
