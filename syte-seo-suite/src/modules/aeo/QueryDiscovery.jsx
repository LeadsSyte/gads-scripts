// AEO Query Discovery — UI for the discover-prompts feature.
// Lives under AEO Engine → Query Discovery. Runs site crawl + Claude analysis,
// renders categorised query lists with checkboxes, and lets the AM bulk-merge
// the chosen queries into the client's aeo_probe_queries field.

import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { discoverQueries, flattenQueries } from './queryDiscovery.js';

const ACCENT = '#00d4aa';
const LS_KEY = 'syte-suite-aeo-discoveries';

function loadCached() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } }
function saveCached(map) { localStorage.setItem(LS_KEY, JSON.stringify(map)); }

const VALUE_COLOR = {
  high:   { color: 'var(--green)',     bg: 'rgba(40,200,120,.08)',  border: 'rgba(40,200,120,.25)' },
  medium: { color: 'var(--blue)',      bg: 'rgba(77,171,255,.08)',  border: 'rgba(77,171,255,.25)' },
  low:    { color: 'var(--text-muted)', bg: 'var(--surface-2)',     border: 'var(--border)' }
};

function ValueBadge({ value }) {
  const v = (value || 'low').toLowerCase();
  const c = VALUE_COLOR[v] || VALUE_COLOR.low;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase',
      padding: '2px 6px', borderRadius: 4, color: c.color, background: c.bg, border: '1px solid ' + c.border
    }}>{v}</span>
  );
}

export default function QueryDiscovery() {
  const client = useClients(s => s.current());
  const save = useClients(s => s.save);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [discovery, setDiscovery] = useState(null);
  const [selected, setSelected] = useState({}); // { query: true }
  const [merging, setMerging] = useState(false);

  // Load any cached discovery for this client on mount / client switch.
  useEffect(() => {
    setDiscovery(null); setSelected({}); setErr(''); setMsg('');
    if (!client) return;
    const cache = loadCached();
    if (cache[client.id]) setDiscovery(cache[client.id]);
  }, [client?.id]);

  // Pre-tick queries that are ALREADY in the client's probe-query list, so
  // re-running discovery doesn't lose existing selections.
  useEffect(() => {
    if (!discovery || !client) return;
    const existing = new Set(
      (client.aeo_probe_queries || '').split('\n').map(s => s.trim().toLowerCase()).filter(Boolean)
    );
    const next = {};
    for (const cat of discovery.categories || []) {
      for (const q of cat.queries || []) {
        const key = (q.query || '').trim().toLowerCase();
        // Default: pre-tick high-value, plus anything already saved.
        if (existing.has(key)) next[key] = true;
        else if ((q.commercialValue || '').toLowerCase() === 'high') next[key] = true;
      }
    }
    setSelected(next);
  }, [discovery, client?.aeo_probe_queries]);

  async function runDiscovery() {
    if (!client) { setErr('Select a client first.'); return; }
    if (!client.url) { setErr('This client has no website URL. Add one in Edit Client.'); return; }
    setBusy(true); setErr(''); setMsg(''); setDiscovery(null);
    setProgress({ phase: 'starting', message: 'Starting…' });
    try {
      const result = await discoverQueries(client, {
        onProgress: (p) => setProgress(p)
      });
      setDiscovery(result);
      // Cache locally so refresh doesn't lose work.
      const cache = loadCached();
      cache[client.id] = result;
      saveCached(cache);
      setProgress({ phase: 'done', message: 'Discovery complete ✓' });
    } catch (e) {
      setErr(e.message);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  function toggle(query) {
    const k = (query || '').trim().toLowerCase();
    setSelected(prev => ({ ...prev, [k]: !prev[k] }));
  }

  function selectAllInCategory(cat, value) {
    setSelected(prev => {
      const next = { ...prev };
      for (const q of cat.queries || []) {
        next[(q.query || '').trim().toLowerCase()] = value;
      }
      return next;
    });
  }

  const allQueries = useMemo(() => flattenQueries(discovery), [discovery]);
  const selectedQueries = useMemo(
    () => allQueries.filter(q => selected[(q.query || '').trim().toLowerCase()]),
    [allQueries, selected]
  );

  async function mergeIntoProbeQueries() {
    if (!client) return;
    if (selectedQueries.length === 0) { setErr('Select at least one query first.'); return; }
    setMerging(true); setErr(''); setMsg('');
    try {
      const existing = (client.aeo_probe_queries || '')
        .split('\n').map(s => s.trim()).filter(Boolean);
      const existingLower = new Set(existing.map(s => s.toLowerCase()));
      const additions = [];
      for (const q of selectedQueries) {
        const txt = (q.query || '').trim();
        if (!txt) continue;
        if (existingLower.has(txt.toLowerCase())) continue;
        additions.push(txt);
        existingLower.add(txt.toLowerCase());
      }
      const merged = [...existing, ...additions].join('\n');
      await save({ ...client, aeo_probe_queries: merged });
      setMsg(`Saved ${additions.length} new ${additions.length === 1 ? 'query' : 'queries'} to ${client.name}. ${existing.length + additions.length} total.`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setMerging(false);
    }
  }

  function copySelectedToClipboard() {
    const text = selectedQueries.map(q => q.query).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
    setMsg(`Copied ${selectedQueries.length} ${selectedQueries.length === 1 ? 'query' : 'queries'} to clipboard.`);
  }

  function exportFullReport() {
    if (!discovery) return;
    const lines = [];
    lines.push(`# AEO Query Discovery — ${client.name}`);
    lines.push(`Generated: ${new Date(discovery.generated_at).toLocaleString()}`);
    lines.push(`Pages read: ${discovery.crawl?.pagesRead || 0}`);
    lines.push('');
    lines.push(`## Positioning`);
    lines.push(discovery.positioning || '');
    lines.push('');
    lines.push(`## Summary`);
    lines.push(discovery.summary || '');
    lines.push('');
    for (const cat of discovery.categories || []) {
      lines.push(`## ${cat.name}`);
      if (cat.intent) lines.push(`_${cat.intent}_`);
      lines.push('');
      for (const q of cat.queries || []) {
        lines.push(`- **${q.query}** [${q.commercialValue || 'low'}] — ${q.rationale || ''}`);
      }
      lines.push('');
    }
    if (discovery.topPriority?.length) {
      lines.push(`## Top Priority`);
      for (const t of discovery.topPriority) lines.push(`- **${t.query}** — ${t.reason || ''}`);
      lines.push('');
    }
    if (discovery.gaps?.length) {
      lines.push(`## Content Gaps`);
      for (const g of discovery.gaps) lines.push(`- **${g.topic}** — ${g.reason || ''}`);
    }
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
    setMsg('Full report copied to clipboard (markdown).');
  }

  if (!client) {
    return (
      <div className="content-area">
        <div className="muted">Select a client in the top bar to discover AEO probe queries for them.</div>
      </div>
    );
  }

  return (
    <div className="content-area">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Query Discovery</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Reads <strong style={{ color: ACCENT }}>{client.name}</strong>'s site and proposes the prompts they should rank for in ChatGPT, Perplexity, Gemini and Claude.
          </div>
        </div>
        <button
          className="primary"
          onClick={runDiscovery}
          disabled={busy}
          style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}
        >
          {busy ? 'Discovering…' : discovery ? 'Re-run Discovery' : 'Discover Queries'}
        </button>
      </div>

      {/* Run status */}
      {(busy || progress) && (
        <div className="card" style={{ marginBottom: 14, padding: '10px 14px' }}>
          <div className="row" style={{ gap: 10 }}>
            {busy && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
            <span style={{ fontSize: 13 }}>{progress?.message || 'Working…'}</span>
            {progress?.total ? (
              <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
                {progress.index || 0}/{progress.total}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {err && <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid var(--red)', color: 'var(--red)', fontSize: 13 }}>{err}</div>}
      {msg && <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid var(--green)', color: 'var(--green)', fontSize: 13 }}>{msg}</div>}

      {/* Empty state hint */}
      {!discovery && !busy && (
        <div className="card">
          <strong>How this works</strong>
          <ol style={{ fontSize: 13, lineHeight: 1.6, marginTop: 8, paddingLeft: 18 }}>
            <li>We fetch the homepage + up to 8 key pages from the sitemap.</li>
            <li>Claude reads the content to understand what the brand actually sells, where it operates and how it's positioned.</li>
            <li>It proposes search prompts in 5 buckets — Core Money, Local, Brand Authority, Educational, Comparison — each rated by commercial value.</li>
            <li>Pick the ones you want to track. They get appended to this client's AEO probe-query list, which is what the AEO Snapshot tool runs against ChatGPT/Perplexity/Gemini/Claude to see if the brand shows up.</li>
          </ol>
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Typical run takes 30–60 seconds. Make sure the client has a Website URL set (currently: <code>{client.url || '(none)'}</code>).
          </div>
        </div>
      )}

      {discovery && (
        <>
          {/* Positioning + crawl summary */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>Positioning (how AI sees this brand)</div>
            <div style={{ fontSize: 14, marginTop: 4 }}>{discovery.positioning}</div>
            {discovery.summary && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>{discovery.summary}</div>
            )}
            <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
              Read {discovery.crawl?.pagesRead || 0} of {discovery.crawl?.pagesAttempted || 0} pages · generated {new Date(discovery.generated_at).toLocaleString()}
            </div>
          </div>

          {/* Top priority list — the highest value */}
          {discovery.topPriority?.length > 0 && (
            <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid ' + ACCENT }}>
              <strong>Highest-Value Searches (likely revenue)</strong>
              <div className="muted" style={{ fontSize: 11, marginTop: 2, marginBottom: 10 }}>
                Prioritise these — most likely to produce actual customers, not just traffic.
              </div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                {discovery.topPriority.map((t, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    <strong>{t.query}</strong>
                    {t.reason && <span className="muted" style={{ fontSize: 12 }}> — {t.reason}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Selection bar — sticky-ish actions */}
          <div className="card" style={{ marginBottom: 14, padding: '10px 14px' }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 13 }}>
                <strong>{selectedQueries.length}</strong> selected
                <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                  · {allQueries.length} total proposed · {(client.aeo_probe_queries || '').split('\n').filter(Boolean).length} currently saved
                </span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button onClick={copySelectedToClipboard} disabled={selectedQueries.length === 0} style={{ fontSize: 12 }}>
                  Copy selected
                </button>
                <button onClick={exportFullReport} style={{ fontSize: 12 }}>
                  Export full report
                </button>
                <button
                  className="primary"
                  onClick={mergeIntoProbeQueries}
                  disabled={merging || selectedQueries.length === 0}
                  style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c', fontSize: 12 }}
                >
                  {merging ? 'Saving…' : 'Save selected to probe queries'}
                </button>
              </div>
            </div>
          </div>

          {/* Categorised lists */}
          {(discovery.categories || []).map((cat, ci) => {
            const allTicked = (cat.queries || []).every(q => selected[(q.query || '').trim().toLowerCase()]);
            return (
              <div key={ci} className="card" style={{ marginBottom: 14, padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '12px 14px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <strong style={{ fontSize: 14 }}>{cat.name}</strong>
                      {cat.intent && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{cat.intent}</div>}
                    </div>
                    <button
                      onClick={() => selectAllInCategory(cat, !allTicked)}
                      style={{ fontSize: 11, padding: '3px 8px' }}
                    >
                      {allTicked ? 'Unselect all' : 'Select all'}
                    </button>
                  </div>
                </div>
                <div>
                  {(cat.queries || []).map((q, qi) => {
                    const key = (q.query || '').trim().toLowerCase();
                    const checked = !!selected[key];
                    return (
                      <label
                        key={qi}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                          padding: '10px 14px',
                          borderBottom: qi < cat.queries.length - 1 ? '1px solid var(--border)' : 'none',
                          cursor: 'pointer',
                          background: checked ? 'rgba(0,212,170,.04)' : 'transparent'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(q.query)}
                          style={{ marginTop: 3, accentColor: ACCENT }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{q.query}</span>
                            <ValueBadge value={q.commercialValue} />
                          </div>
                          {q.rationale && (
                            <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{q.rationale}</div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Content gaps */}
          {discovery.gaps?.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <strong>Content Gaps</strong>
              <div className="muted" style={{ fontSize: 11, marginTop: 2, marginBottom: 10 }}>
                Topics the site doesn't cover well — feed these into the Content Engine.
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                {discovery.gaps.map((g, i) => (
                  <li key={i}>
                    <strong>{g.topic}</strong>
                    {g.reason && <span className="muted" style={{ fontSize: 12 }}> — {g.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Pages read — transparency */}
          {discovery.crawl?.pages?.length > 0 && (
            <details className="card" style={{ marginBottom: 14 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12 }} className="muted">
                Pages read by the crawler ({discovery.crawl.pagesRead}/{discovery.crawl.pagesAttempted})
              </summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11 }}>
                {discovery.crawl.pages.map((u, i) => (
                  <li key={i}><a href={u} target="_blank" rel="noreferrer" className="muted">{u}</a></li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
