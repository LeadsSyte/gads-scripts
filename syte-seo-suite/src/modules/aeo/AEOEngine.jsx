import React, { useState, useEffect } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeComplete } from '../../lib/anthropic.js';
import { addToCmsQueue } from '../../lib/supabase.js';
import { fetchTextWithCors } from '../../lib/cors.js';
import { AEO_TYPES } from './aeoTypes.js';
import { listGa4Properties, runGa4Report } from './ga4.js';

const ACCENT = '#00d4aa';
const HISTORY_KEY = 'syte-suite:aeo-history';
const RESULTS_KEY = 'syte-suite:aeo-latest';

function loadResults() {
  try {
    return JSON.parse(localStorage.getItem(RESULTS_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveResults(r) {
  localStorage.setItem(RESULTS_KEY, JSON.stringify(r));
}
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveHistory(h) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 200)));
}

async function parseSitemap(url) {
  const xml = await fetchTextWithCors(url);
  const matches = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
  return matches;
}

async function optimizePage(pageUrl, client) {
  const system = `You are an Answer Engine Optimization specialist. Given a page URL and brand context, generate 4-8 of the most valuable AEO optimizations as copy-paste ready code.

Return a JSON array. Each item:
{
  "type": one of ${AEO_TYPES.map((t) => `"${t.id}"`).join(', ')},
  "label": human readable label,
  "code": ready-to-paste HTML or JSON-LD,
  "notes": short implementation instructions
}

Rules:
- Focus on the highest-impact types for this page.
- JSON-LD must be valid.
- No markdown fences, return JSON only.`;

  let pageHtml = '';
  try {
    pageHtml = (await fetchTextWithCors(pageUrl)).slice(0, 15000);
  } catch {
    pageHtml = '(page content unavailable)';
  }

  const user = `Brand: ${client?.name || ''}
URL: ${pageUrl}
Industry: ${client?.industry || ''}
Location: ${client?.location || ''}
Org: ${client?.org_name || ''}
Author: ${client?.author || ''} ${client?.author_creds || ''}

Page HTML:
${pageHtml}`;

  const { text } = await claudeComplete({
    system,
    messages: [{ role: 'user', content: user }],
    max_tokens: 5000,
    temperature: 0.3,
  });
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return [];
  }
}

async function processBatch(urls, client, onProgress) {
  const out = [];
  for (let i = 0; i < urls.length; i += 3) {
    const batch = urls.slice(i, i + 3);
    const batchResults = await Promise.all(
      batch.map(async (url) => ({ url, opts: await optimizePage(url, client) }))
    );
    out.push(...batchResults);
    onProgress(out.length, urls.length);
  }
  return out;
}

function RunOptimizations({ client, onDone }) {
  const [urls, setUrls] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  async function fetchFromSitemap() {
    if (!client?.sitemap_url) {
      alert('No sitemap URL on client.');
      return;
    }
    try {
      const list = await parseSitemap(client.sitemap_url);
      setUrls(list.slice(0, client.pages_per_month || 15).join('\n'));
    } catch (e) {
      alert('Sitemap fetch failed: ' + e.message);
    }
  }

  async function fetchFromGa4() {
    if (!client?.ga4_property_id) {
      alert('No GA4 property ID on client.');
      return;
    }
    try {
      const data = await runGa4Report(client.ga4_property_id);
      const pages = (data.rows || [])
        .map((r) => r.dimensionValues?.[0]?.value)
        .filter(Boolean)
        .map((p) => (p.startsWith('http') ? p : (client.url || '').replace(/\/$/, '') + p));
      setUrls(pages.slice(0, client.pages_per_month || 15).join('\n'));
    } catch (e) {
      alert('GA4 fetch failed: ' + e.message);
    }
  }

  async function run() {
    const list = urls.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!list.length || !client) return;
    setBusy(true);
    setProgress('');
    try {
      const results = await processBatch(list, client, (done, total) => {
        setProgress(`${done} / ${total} pages processed`);
      });
      const all = loadResults();
      all[client.id] = {
        ran_at: new Date().toISOString(),
        pages: results,
      };
      saveResults(all);

      const hist = loadHistory();
      hist.unshift({
        id: Date.now(),
        client_id: client.id,
        client_name: client.name,
        ran_at: new Date().toISOString(),
        page_count: results.length,
      });
      saveHistory(hist);

      onDone();
    } catch (e) {
      alert('Run failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div style={{ fontWeight: 600 }}>Run AEO Optimizations</div>
      <div className="row">
        <button onClick={fetchFromSitemap} disabled={busy}>Load from Sitemap</button>
        <button onClick={fetchFromGa4} disabled={busy}>Load Top Pages from GA4</button>
      </div>
      <div>
        <label>URLs (one per line)</label>
        <textarea value={urls} onChange={(e) => setUrls(e.target.value)} style={{ minHeight: 180 }} />
      </div>
      <div className="row">
        <button
          className="primary"
          style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}
          onClick={run}
          disabled={busy || !urls.trim()}
        >
          {busy ? 'Processing…' : 'Run Optimizations'}
        </button>
        {progress && <span className="muted">{progress}</span>}
      </div>
    </div>
  );
}

function LatestResults({ client }) {
  const all = loadResults();
  const data = client ? all[client.id] : null;

  async function queueAll() {
    if (!data) return;
    const items = [];
    for (const page of data.pages) {
      for (const opt of page.opts || []) {
        items.push({
          client_id: client.id,
          module: 'aeo',
          page_url: page.url,
          page_title: opt.label,
          change_type: opt.type?.includes('schema') ? 'schema' : 'content',
          payload: { code: opt.code, notes: opt.notes, type: opt.type },
          status: 'pending',
        });
      }
    }
    if (!items.length) return;
    await addToCmsQueue(items);
    alert(`Queued ${items.length} items for CMS Push.`);
  }

  if (!data) return <div className="muted">No results yet. Run optimizations first.</div>;

  return (
    <div className="stack">
      <div className="row">
        <div className="muted">Ran: {new Date(data.ran_at).toLocaleString()}</div>
        <button style={{ marginLeft: 'auto' }} onClick={queueAll}>
          Queue ALL for CMS Push
        </button>
      </div>
      {data.pages.map((p, i) => (
        <div key={i} className="card stack">
          <div style={{ fontWeight: 600 }}>{p.url}</div>
          {(p.opts || []).map((opt, j) => (
            <div key={j} style={{ borderLeft: `2px solid ${ACCENT}`, paddingLeft: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div style={{ fontWeight: 500 }}>{opt.label}</div>
                <span className="badge teal">{opt.type}</span>
              </div>
              <div className="muted" style={{ fontSize: 12, margin: '4px 0' }}>{opt.notes}</div>
              <pre className="output" style={{ maxHeight: 240 }}>{opt.code}</pre>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function AeoHistory() {
  const [hist, setHist] = useState(loadHistory());
  useEffect(() => {
    setHist(loadHistory());
  }, []);
  if (!hist.length) return <div className="muted">No history.</div>;
  return (
    <div className="stack">
      {hist.map((h) => (
        <div key={h.id} className="card">
          <div>{h.client_name}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {new Date(h.ran_at).toLocaleString()} · {h.page_count} pages
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AEOEngine({ tab }) {
  const { clients, getSelected } = useClients();
  const client = getSelected();
  const [, force] = useState(0);

  return (
    <div>
      <h1 className="h1-title">AEO Engine</h1>
      <div className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        {client ? client.name : 'Select a client.'}
      </div>
      {tab === 'Run Optimizations' && <RunOptimizations client={client} onDone={() => force((n) => n + 1)} />}
      {tab === 'Latest Results' && <LatestResults client={client} />}
      {tab === 'Clients' && (
        <div className="stack">
          {clients.map((c) => (
            <div key={c.id} className="card">
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                GA4: {c.ga4_property_id || '—'} · Sitemap: {c.sitemap_url || '—'}
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'Settings' && (
        <div className="card stack">
          <button
            onClick={async () => {
              try {
                const props = await listGa4Properties();
                alert(`Loaded ${props.accountSummaries?.length || 0} GA4 account summaries`);
              } catch (e) {
                alert('GA4 auth error: ' + e.message);
              }
            }}
          >
            Connect / List GA4 Properties
          </button>
        </div>
      )}
      {tab === 'History' && <AeoHistory />}
    </div>
  );
}
