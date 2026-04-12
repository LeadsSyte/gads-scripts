import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { corsFetchText } from '../../lib/corsProxy.js';
import PushToCmsButton from '../../components/PushToCmsButton.jsx';
import { pushItemInline } from '../cms/pushAction.js';
import ClientCardsGrid from '../../components/ClientCardsGrid.jsx';
import MarkImplementedButton from '../../components/MarkImplementedButton.jsx';
import PipelineView from '../../components/PipelineView.jsx';
import { aeoPipelineStatus } from '../../lib/pipelineStatus.js';
import { listAllImplementations } from '../../lib/supabase.js';
import { AEO_SYSTEM, AEO_TYPES } from './aeoTypes.js';
import { fetchSitemapUrls } from './sitemap.js';
import { listAccountSummaries, runReport } from './ga4.js';
import { ensureToken, SCOPES, getToken, clearToken } from '../technical/googleAuth.js';

const ACCENT = '#00d4aa';
const RESULTS_KEY = 'syte-suite-aeo-results';
const HISTORY_KEY = 'syte-suite-aeo-history';
const BATCH_SIZE = 3;

function loadResults() { try { return JSON.parse(localStorage.getItem(RESULTS_KEY) || '{}'); } catch { return {}; } }
function saveResults(r) { localStorage.setItem(RESULTS_KEY, JSON.stringify(r)); }
function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } }
function saveHistory(h) { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 100))); }

async function generateForPage(pageUrl, client) {
  let pageHtml = '';
  try { pageHtml = (await corsFetchText(pageUrl)).slice(0, 30000); } catch {}

  const text = await claudeComplete({
    system: AEO_SYSTEM,
    messages: [{
      role: 'user',
      content: `Page URL: ${pageUrl}
Client: ${client?.name || ''}
Industry: ${client?.industry || ''}
Location: ${client?.location || ''}
Organization: ${client?.org_name || ''}
Author: ${client?.author || ''} ${client?.author_creds ? '(' + client.author_creds + ')' : ''}

Page HTML (truncated):
${pageHtml}`
    }],
    max_tokens: 6000,
    temperature: 0.4
  });
  const parsed = extractJSON(text);
  return parsed?.optimizations || [];
}

// Expandable optimization card for a single page — shows each optimization
// with type badge, description, and copy-paste ready code block.
const OPT_TYPE_COLORS = {
  schema: { bg: 'rgba(167,139,250,.12)', color: 'var(--purple)', border: 'rgba(167,139,250,.2)' },
  content: { bg: 'rgba(0,212,170,.12)', color: 'var(--teal)', border: 'rgba(0,212,170,.2)' },
  meta: { bg: 'rgba(77,171,255,.12)', color: 'var(--blue)', border: 'rgba(77,171,255,.2)' },
  structure: { bg: 'rgba(255,159,67,.12)', color: 'var(--orange)', border: 'rgba(255,159,67,.2)' }
};

function OptPageCard({ result: r }) {
  const [open, setOpen] = React.useState(false);
  const opts = Array.isArray(r.optimizations) ? r.optimizations : [];
  const copyAll = () => {
    const text = opts.map((o, i) =>
      `[${i + 1}] ${o.name || o.title || ''} (${o.type || ''})\n${o.description || ''}\n${o.where ? 'Where: ' + o.where + '\n' : ''}\n${o.implementation || o.code || ''}\n`
    ).join('\n' + '─'.repeat(40) + '\n\n');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={() => setOpen(v => !v)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.url?.replace(/^https?:\/\//, '').replace(/\/$/, '') || 'Page'}
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--teal)', background: 'rgba(0,212,170,.08)', padding: '2px 8px', borderRadius: 12 }}>
            {opts.length} optimizations
          </span>
          <button onClick={(e) => { e.stopPropagation(); copyAll(); }} style={{ fontSize: 10, padding: '2px 8px' }}>Copy All</button>
          <span className="muted" style={{ fontSize: 9 }}>{open ? '▼' : '▶'}</span>
        </div>
      </div>
      {r.error && <div style={{ padding: '0 14px 8px', color: 'var(--red)', fontSize: 12 }}>{r.error}</div>}
      {open && opts.map((o, i) => {
        const typeColors = OPT_TYPE_COLORS[o.type] || OPT_TYPE_COLORS.content;
        const code = o.implementation || o.code || '';
        return (
          <div key={i} style={{ margin: '0 14px 10px', padding: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '.05em', padding: '2px 7px', borderRadius: 4,
                textTransform: 'uppercase', background: typeColors.bg, color: typeColors.color,
                border: '1px solid ' + typeColors.border
              }}>{o.type || 'content'}</span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{o.name || o.title || 'Optimization'}</span>
            </div>
            {o.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{o.description}</div>}
            {o.where && <div style={{ fontSize: 11, color: 'var(--teal)', marginBottom: 6 }}>📍 {o.where}</div>}
            {code && (
              <div>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-dim)' }}>Copy-paste ready</span>
                  <button onClick={() => navigator.clipboard.writeText(code).catch(() => {})} style={{
                    fontSize: 10, padding: '2px 8px', background: 'var(--surface-3)',
                    border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer'
                  }}>Copy</button>
                </div>
                <pre style={{
                  background: '#0d0e11', border: '1px solid var(--border)', borderRadius: 8,
                  padding: 12, fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                  lineHeight: 1.6, color: '#c8d0d8', overflowX: 'auto', whiteSpace: 'pre-wrap',
                  maxHeight: 200
                }}>{code}</pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AEOEngine({ sub }) {
  const clients = useClients(s => s.clients);
  const client = useClients(s => s.current());
  const [urls, setUrls] = useState('');
  const [results, setResults] = useState(loadResults());
  const [history, setHistory] = useState(loadHistory());
  const [properties, setProperties] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { saveResults(results); }, [results]);
  useEffect(() => { saveHistory(history); }, [history]);

  async function loadGa4Properties() {
    try {
      await ensureToken([SCOPES.ga4]);
      const data = await listAccountSummaries();
      const props = [];
      for (const acc of data.accountSummaries || []) {
        for (const p of acc.propertySummaries || []) {
          props.push({ id: p.property.replace('properties/', ''), name: p.displayName, account: acc.displayName });
        }
      }
      setProperties(props);
    } catch (e) { setErr(e.message); }
  }

  // Called from the pipeline card's "Run Optimizations" button.
  // Selects the client, auto-pulls URLs from sitemap or client URL, then runs.
  async function runForClient(c) {
    if (!c) return;
    setBusy(true); setErr(''); setProgress('');
    try {
      let pageList = [];
      if (c.sitemap_url) {
        setProgress('Fetching sitemap for ' + c.name + '…');
        pageList = await fetchSitemapUrls(c.sitemap_url).catch(() => []);
        pageList = pageList.slice(0, 30);
      }
      if (!pageList.length && c.url) {
        pageList = [c.url.replace(/\/$/, '') + '/'];
      }
      if (!pageList.length) {
        setErr(c.name + ' has no sitemap URL or website URL to scan.');
        setBusy(false);
        return;
      }
      setUrls(pageList.join('\n'));
      setProgress('Generating AEO for ' + c.name + ' (' + pageList.length + ' pages)…');

      const newResults = { ...results };
      for (let i = 0; i < pageList.length; i += BATCH_SIZE) {
        const batch = pageList.slice(i, i + BATCH_SIZE);
        setProgress(`${c.name}: Batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(pageList.length / BATCH_SIZE)}`);
        const batchResults = await Promise.all(
          batch.map(u => generateForPage(u, c).catch(e => ({ error: e.message })))
        );
        batch.forEach((u, j) => {
          const key = c.id + '::' + u;
          newResults[key] = {
            url: u, client_id: c.id, generated_at: new Date().toISOString(),
            optimizations: Array.isArray(batchResults[j]) ? batchResults[j] : [],
            error: batchResults[j]?.error || null
          };
        });
        setResults({ ...newResults });
      }
      setHistory(prev => [
        { id: crypto.randomUUID(), client_id: c.id, client_name: c.name, count: pageList.length, created_at: new Date().toISOString() },
        ...prev
      ]);
      setProgress(`Done. Generated for ${pageList.length} pages for ${c.name}.`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function pullFromSitemap() {
    if (!client?.sitemap_url) { setErr('Client has no sitemap URL.'); return; }
    setBusy(true); setErr(''); setProgress('Fetching sitemap…');
    try {
      const locs = await fetchSitemapUrls(client.sitemap_url);
      setUrls(locs.slice(0, 50).join('\n'));
      setProgress(`Loaded ${locs.length} URLs (showing first 50).`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function pullFromGa4() {
    if (!client?.ga4_property_id) { setErr('Client has no GA4 property ID.'); return; }
    setBusy(true); setErr(''); setProgress('Running GA4 report…');
    try {
      const report = await runReport(client.ga4_property_id, 30);
      const rows = (report.rows || [])
        .map(r => ({
          path: r.dimensionValues?.[0]?.value || '',
          sessions: Number(r.metricValues?.[0]?.value || 0)
        }))
        .filter(r => r.path && r.path.startsWith('/'))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 30);
      const base = (client.url || '').replace(/\/$/, '');
      setUrls(rows.map(r => base + r.path).join('\n'));
      setProgress(`Loaded top ${rows.length} pages by sessions.`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function runAll() {
    if (!client) { setErr('Select a client first.'); return; }
    const pageList = urls.split('\n').map(s => s.trim()).filter(Boolean);
    if (!pageList.length) { setErr('Enter at least one URL.'); return; }

    setBusy(true); setErr(''); setProgress('');
    const newResults = { ...results };
    try {
      // Process in batches of 3 for rate-limiting.
      for (let i = 0; i < pageList.length; i += BATCH_SIZE) {
        const batch = pageList.slice(i, i + BATCH_SIZE);
        setProgress(`Batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(pageList.length / BATCH_SIZE)}`);
        const batchResults = await Promise.all(
          batch.map(u => generateForPage(u, client).catch(e => ({ error: e.message })))
        );
        batch.forEach((u, j) => {
          const key = client.id + '::' + u;
          newResults[key] = {
            url: u,
            client_id: client.id,
            generated_at: new Date().toISOString(),
            optimizations: Array.isArray(batchResults[j]) ? batchResults[j] : [],
            error: batchResults[j]?.error || null
          };
        });
        setResults({ ...newResults });
      }
      setHistory(prev => [
        { id: crypto.randomUUID(), client_id: client.id, client_name: client.name, count: pageList.length, created_at: new Date().toISOString() },
        ...prev
      ]);
      setProgress(`Done. Generated for ${pageList.length} pages.`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  function buildOptItem(pageUrl, opt) {
    return {
      module: 'aeo',
      page_url: pageUrl,
      page_title: opt.title,
      change_type: opt.type,
      payload: { code: opt.code, placement: opt.placement, reason: opt.reason }
    };
  }

  async function pushAllForClient() {
    if (!client) return;
    setBusy(true); setErr(''); setProgress('');
    const mine = Object.values(results).filter(r => r.client_id === client.id);
    let ok = 0, fail = 0;
    for (const r of mine) {
      for (const opt of r.optimizations || []) {
        try {
          await pushItemInline(client, buildOptItem(r.url, opt));
          ok++;
        } catch (e) {
          fail++;
        }
        setProgress('Pushed ' + ok + ' · failed ' + fail);
      }
    }
    setBusy(false);
  }

  // -------- Pipeline state --------
  const [aeoImpls, setAeoImpls] = useState([]);
  useEffect(() => {
    listAllImplementations().then(setAeoImpls).catch(() => {});
  }, []);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const aeoClients = clients.filter(c => c.does_aeo !== false);

  const aeoPipeline = useMemo(() => {
    const buckets = {
      'verified-on-site': [],
      'optimizations-generated': [],
      'not-run': [],
      'credentials-missing': []
    };
    for (const c of aeoClients) {
      const status = aeoPipelineStatus(c, aeoImpls, results, currentMonth);
      buckets[status.section]?.push({ client: c, summary: status.summary, detail: status.detail });
    }
    return [
      { key: 'verified-on-site',        label: 'Verified on Site',        color: 'var(--green)',      borderColor: 'var(--green)',      clients: buckets['verified-on-site'] },
      { key: 'optimizations-generated', label: 'Optimizations Generated', color: 'var(--blue)',       borderColor: 'var(--blue)',       clients: buckets['optimizations-generated'] },
      { key: 'not-run',                 label: 'Not Run Yet',             color: 'var(--text-muted)', borderColor: 'var(--border)',      clients: buckets['not-run'] },
      { key: 'credentials-missing',     label: 'Credentials Missing',     color: 'var(--red)',        borderColor: 'var(--red)',        clients: buckets['credentials-missing'] }
    ];
  }, [aeoClients, aeoImpls, results, currentMonth]);

  const [expandedClient, setExpandedClient] = useState(null);

  // Get results for a client — returns array of page results sorted by # of optimizations (most first).
  function getClientResults(clientId) {
    return Object.values(results)
      .filter(r => r.client_id === clientId)
      .sort((a, b) => (b.optimizations?.length || 0) - (a.optimizations?.length || 0));
  }

  // -------- Subviews --------
  if (sub === 'Run Optimizations') {
    return (
      <div className="content-area">
        {/* Status bar — shows progress when running from a pipeline card */}
        {(busy || progress || err) && (
          <div className="card" style={{ marginBottom: 12, padding: '10px 16px', borderColor: busy ? ACCENT : err ? 'var(--red)' : 'var(--green)' }}>
            <div className="row" style={{ gap: 10 }}>
              {busy && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
              <span style={{ fontSize: 13, color: err ? 'var(--red)' : busy ? 'var(--text)' : 'var(--green)' }}>
                {err || progress || 'Running…'}
              </span>
            </div>
          </div>
        )}

        {/* Pipeline overview */}
        <PipelineView
          title={`AEO Engine — ${monthLabel}`}
          month={monthLabel}
          sections={aeoPipeline}
          onAction={(c, action) => {
            if (action === 'run') {
              useClients.getState().select(c.id);
              runForClient(c);
            }
          }}
          actions={[
            { key: 'run', label: 'Run Optimizations', color: ACCENT,
              condition: (c, section) => section !== 'credentials-missing' && section !== 'verified-on-site' },
            { key: 'run', label: 'Re-run', color: ACCENT,
              condition: (c, section) => section === 'verified-on-site' }
          ]}
          onExpandClient={(c) => setExpandedClient(prev => prev === c.id ? null : c.id)}
          expandedId={expandedClient}
          renderExpanded={(c) => {
            const cResults = getClientResults(c.id);
            if (cResults.length === 0) {
              return <div className="muted" style={{ padding: 12, fontSize: 12 }}>No optimizations yet. Click Run Optimizations to generate.</div>;
            }
            const totalOpts = cResults.reduce((a, r) => a + (r.optimizations?.length || 0), 0);
            return (
              <div>
                <div className="muted" style={{ padding: '8px 14px 4px', fontSize: 11 }}>
                  {totalOpts} optimizations across {cResults.length} page{cResults.length > 1 ? 's' : ''}
                </div>
                {cResults.slice(0, 5).map(r => (
                  <OptPageCard key={r.url} result={r} client={c} />
                ))}
                {cResults.length > 5 && (
                  <div className="muted" style={{ padding: '8px 14px', fontSize: 11 }}>
                    …and {cResults.length - 5} more pages. View all in Latest Results.
                  </div>
                )}
              </div>
            );
          }}
        />

        <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 16 }}>
          <h3 style={{ margin: '0 0 12px' }}>Run for Selected Client</h3>
        </div>
        <div className="card">
          <div className="row" style={{ gap: 10, marginBottom: 12 }}>
            <button onClick={pullFromSitemap} disabled={!client || busy}>Pull from Sitemap</button>
            <button onClick={pullFromGa4} disabled={!client || busy}>Pull from GA4 (top 30)</button>
          </div>
          <label>Target URLs (one per line)</label>
          <textarea value={urls} onChange={e => setUrls(e.target.value)} rows={10} />
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <span className="muted" style={{ fontSize: 12 }}>{progress}</span>
            <button className="primary" style={{ background: ACCENT, borderColor: ACCENT, color: '#000' }} onClick={runAll} disabled={busy || !client}>
              {busy ? 'Generating…' : 'Generate AEO (batches of 3)'}
            </button>
          </div>
          {err && <div style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
        </div>
      </div>
    );
  }

  if (sub === 'Latest Results') {
    const mine = Object.values(results).filter(r => !client || r.client_id === client.id);
    return (
      <div className="content-area">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Latest Results</h2>
          {mine.length > 0 && (
            <button onClick={pushAllForClient} disabled={busy} style={{ borderColor: 'var(--mod-cms)', color: 'var(--mod-cms)' }}>
              {busy ? 'Pushing…' : 'Push All to CMS'}
            </button>
          )}
        </div>
        {mine.length === 0 && <div className="muted">No results yet. Run optimizations from the pipeline above.</div>}
        {mine.length > 0 && (
          <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>
            {mine.reduce((a, r) => a + (r.optimizations?.length || 0), 0)} total optimizations across {mine.length} pages
          </div>
        )}
        {mine.map(r => (
          <div className="card" key={r.url} style={{ marginBottom: 10, padding: 0, overflow: 'hidden' }}>
            <OptPageCard result={r} />
          </div>
        ))}
      </div>
    );
  }

  if (sub === 'Clients') {
    const aeoClients = clients.filter(c => c.does_aeo !== false);
    return (
      <div className="content-area">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>AEO Engine Clients</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            {aeoClients.length} / {clients.length} clients have AEO enabled
          </span>
        </div>
        <ClientCardsGrid service="aeo" accent={ACCENT} clients={aeoClients} />
      </div>
    );
  }

  if (sub === 'Settings') {
    const gToken = getToken();
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>AEO Engine Settings</h2>
        <div className="card" style={{ marginBottom: 14 }}>
          <strong>Google Analytics 4</strong>
          <div className="muted" style={{ fontSize: 12 }}>
            {gToken ? 'Connected' : 'Not connected'}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={loadGa4Properties}>Connect & List Properties</button>
            {gToken && <button onClick={() => { clearToken(); window.location.reload(); }}>Disconnect</button>}
          </div>
        </div>
        {properties.length > 0 && (
          <div className="card">
            <strong>Available GA4 Properties</strong>
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>Account</th><th>Property</th><th>ID</th></tr></thead>
              <tbody>
                {properties.map(p => (
                  <tr key={p.id}><td>{p.account}</td><td>{p.name}</td><td className="mono">{p.id}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card" style={{ marginTop: 14 }}>
          <strong>Supported AEO Types</strong>
          <ul style={{ columns: 2, margin: '10px 0 0' }}>
            {AEO_TYPES.map(t => <li key={t.id} style={{ fontSize: 12 }}>{t.label}</li>)}
          </ul>
        </div>
      </div>
    );
  }

  if (sub === 'History') {
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>AEO Run History</h2>
        <table>
          <thead><tr><th>Date</th><th>Client</th><th>Pages</th></tr></thead>
          <tbody>
            {history.map(h => (
              <tr key={h.id}>
                <td>{new Date(h.created_at).toLocaleString()}</td>
                <td>{h.client_name}</td>
                <td>{h.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}
