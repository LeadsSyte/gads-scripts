import React, { useState, useEffect } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { corsFetchText } from '../../lib/corsProxy.js';
import { queueCmsChange } from '../../lib/supabase.js';
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

  async function queueAllForClient() {
    if (!client) return;
    const mine = Object.values(results).filter(r => r.client_id === client.id);
    for (const r of mine) {
      for (const opt of r.optimizations || []) {
        await queueCmsChange({
          client_id: client.id,
          module: 'aeo',
          page_url: r.url,
          page_title: opt.title,
          change_type: opt.type,
          payload: { code: opt.code, placement: opt.placement, reason: opt.reason },
          status: 'pending'
        });
      }
    }
    alert('Queued all AEO optimizations for ' + client.name);
  }

  // -------- Subviews --------
  if (sub === 'Run Optimizations') {
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>Run AEO Optimizations</h2>
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
            <button onClick={queueAllForClient} style={{ borderColor: 'var(--mod-cms)', color: 'var(--mod-cms)' }}>
              Queue All for CMS Push
            </button>
          )}
        </div>
        {mine.length === 0 && <div className="muted">No results yet.</div>}
        {mine.map(r => (
          <div className="card" key={r.url} style={{ marginBottom: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{r.url}</strong>
              <span className="muted" style={{ fontSize: 11 }}>{new Date(r.generated_at).toLocaleString()}</span>
            </div>
            {r.error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{r.error}</div>}
            {(r.optimizations || []).map((o, i) => (
              <details key={i} style={{ marginTop: 10 }}>
                <summary>
                  <span className="badge teal" style={{ marginRight: 8 }}>{o.type}</span>
                  {o.title}
                </summary>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Placement: {o.placement} · {o.reason}</div>
                <pre style={{ background: 'var(--bg)', padding: 10, marginTop: 6, fontSize: 11, overflowX: 'auto' }}>{o.code}</pre>
              </details>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (sub === 'Clients') {
    return (
      <div className="content-area">
        <h2 style={{ marginTop: 0 }}>Clients</h2>
        <table>
          <thead><tr><th>Name</th><th>Sitemap</th><th>GA4</th><th>Results</th></tr></thead>
          <tbody>
            {clients.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted">{c.sitemap_url || '—'}</td>
                <td>{c.ga4_property_id || '—'}</td>
                <td>{Object.values(results).filter(r => r.client_id === c.id).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
