import React, { useState, useMemo, useEffect } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeStream } from '../../lib/anthropic.js';
import {
  collectResearchData,
  generateTopicRecommendations,
  buildArticleResearchContext
} from './topicResearch.js';
import { buildSystemPrompt, TAB_PROMPTS } from './prompts.js';
import GenerateImageButton from '../../components/GenerateImageButton.jsx';
import PushToCmsButton from '../../components/PushToCmsButton.jsx';
import MarkImplementedButton from '../../components/MarkImplementedButton.jsx';
import PipelineView from '../../components/PipelineView.jsx';
import { contentPipelineStatus } from '../../lib/pipelineStatus.js';
import { listAllImplementations, saveBlogResult, loadContentHistory } from '../../lib/supabase.js';

const ACCENT = '#c8ff00';

function directionPreview(text) {
  if (!text) return null;
  const clean = text.trim();
  return clean.length <= 140 ? clean : clean.slice(0, 140) + '…';
}

const OPP_COLORS = {
  'low-hanging-fruit': 'var(--green)',
  'content-gap':       'var(--orange)',
  'ranking-defend':    'var(--blue)',
  'meta-rewrite':      'var(--purple)',
  'long-tail':         'var(--text-muted)'
};

export default function AutoWrite() {
  const allClients = useClients(s => s.clients);

  // Active client: the one we're currently working on.
  const [activeId, setActiveId] = useState(null);
  // Research state for the active client.
  const [research, setResearch] = useState(null);
  const [plan, setPlan] = useState(null);
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchErr, setResearchErr] = useState('');
  // Per-article state: Map<opportunityIndex, { status, output, error, words }>
  const [articleStates, setArticleStates] = useState({});
  // Currently writing index (only one at a time).
  const [writingIdx, setWritingIdx] = useState(null);
  // Batch mode — writing all remaining articles sequentially.
  const [batchMode, setBatchMode] = useState(false);

  const [implementations, setImplementations] = useState([]);
  const [showPipeline, setShowPipeline] = useState(true);
  const [sharedHistory, setSharedHistory] = useState([]);

  const contentClients = useMemo(
    () => allClients.filter(c => c.does_content !== false),
    [allClients]
  );
  const activeClient = useMemo(
    () => contentClients.find(c => c.id === activeId) || null,
    [contentClients, activeId]
  );
  const withGsc = contentClients.filter(c => c.gsc_property);
  const withoutGsc = contentClients.filter(c => !c.gsc_property);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

  // Load implementations + content history for pipeline view.
  useEffect(() => {
    listAllImplementations().then(setImplementations).catch(() => {});
    loadContentHistory().then(setSharedHistory).catch(() => {});
  }, []);

  // Warn before navigating away during active writing.
  useEffect(() => {
    if (writingIdx === null && !researchBusy) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = 'Article writing is in progress. Are you sure you want to leave?';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [writingIdx, researchBusy]);

  // Compute pipeline sections.
  const pipelineSections = useMemo(() => {
    const buckets = {
      'verified-on-site': [],
      'articles-written': [],
      'no-articles': [],
      'credentials-missing': []
    };
    for (const c of contentClients) {
      const status = contentPipelineStatus(c, implementations, currentMonth, sharedHistory);
      buckets[status.section]?.push({ client: c, summary: status.summary, detail: status.detail });
    }
    return [
      { key: 'verified-on-site', label: 'Verified on Site', color: 'var(--green)', borderColor: 'var(--green)', clients: buckets['verified-on-site'] },
      { key: 'articles-written', label: 'Articles Written', color: 'var(--blue)', borderColor: 'var(--blue)', clients: buckets['articles-written'] },
      { key: 'no-articles', label: 'No Articles Yet', color: 'var(--text-muted)', borderColor: 'var(--border)', clients: buckets['no-articles'], collapsed: true },
      { key: 'credentials-missing', label: 'Credentials Missing', color: 'var(--red)', borderColor: 'var(--red)', clients: buckets['credentials-missing'], collapsed: true }
    ];
  }, [contentClients, implementations, currentMonth, sharedHistory]);

  // Expanded client in the pipeline (for viewing articles in "Articles Written").
  const [expandedPipelineClient, setExpandedPipelineClient] = useState(null);
  // Track real WordPress permalinks per article so MarkImplementedButton
  // verifies the correct URL instead of re-deriving a mismatched slug.
  const [pushedUrls, setPushedUrls] = useState({});

  // Get articles for a specific client from shared content history.
  function getClientArticles(clientId) {
    return sharedHistory.filter(h => h.client_id === clientId && ((h.generated_at || h.created_at || '').slice(0, 7) === currentMonth));
  }

  // ─── Phase 1: Research ───────────────────────────────
  async function startResearch(client) {
    setActiveId(client.id);
    setResearch(null); setPlan(null); setArticleStates({}); setResearchErr('');
    setResearchBusy(true); setBatchMode(false); setWritingIdx(null);
    try {
      let data;
      let gscFailed = false;
      try {
        data = await collectResearchData(client, { days: 90 });
      } catch (gscErr) {
        // GSC unavailable (permission, not connected, etc.) — fall back to
        // generating topics from client context alone. Don't block the flow.
        gscFailed = true;
        data = {
          days: 90, totalImpressions: 0, totalClicks: 0, siteAvgCtr: 0,
          queries: [], topOpportunities: [], pageByQuery: {}, allQueryCount: 0
        };
        setResearchErr('GSC unavailable — ' + (gscErr.message || '').slice(0, 120) + '. Generating topics from client context instead.');
      }
      setResearch(data);
      const targetArticles = Math.max(1, Math.min(client.pages_per_month || 4, 50));
      const result = await generateTopicRecommendations(client, data, { targetArticles });
      const sorted = (result.opportunities || [])
        .slice()
        .sort((a, b) => (a.priority || 99) - (b.priority || 99));
      setPlan({ ...result, opportunities: sorted });
      if (gscFailed) {
        setResearchErr(prev => prev + ' Topics generated from industry context — no ranking data available.');
      }
    } catch (e) {
      setResearchErr(e.message);
    } finally {
      setResearchBusy(false);
    }
  }

  // ─── Phase 2: Write ONE article ──────────────────────
  function updateArticle(idx, patch) {
    setArticleStates(prev => ({ ...prev, [idx]: { ...(prev[idx] || {}), ...patch } }));
  }

  async function writeOne(idx) {
    if (!activeClient || !plan || !research) return;
    const opp = plan.opportunities[idx];
    if (!opp) return;

    setWritingIdx(idx);
    updateArticle(idx, { status: 'writing', output: '', error: null, words: 0 });

    const ctx = buildArticleResearchContext(opp, research);
    const system = buildSystemPrompt(activeClient, '', ctx);
    const userPrompt = TAB_PROMPTS['New Article'](
      opp.topic_title,
      opp.primary_keyword,
      opp.recommended_length || 1500
    );

    let buf = '';
    try {
      await claudeStream({
        system,
        messages: [{ role: 'user', content: userPrompt }],
        max_tokens: 8000,
        temperature: 0.7,
        onDelta: (t) => {
          buf += t;
          const words = Math.round(buf.length / 5);
          updateArticle(idx, { status: 'writing', output: buf, words });
        }
      });
      updateArticle(idx, { status: 'done', output: buf, words: Math.round(buf.length / 5) });

      // Persist to Supabase (shared across all browsers/users).
      try {
        await saveBlogResult({
          client_id: activeClient.id,
          client_name: activeClient.name,
          tab: 'Auto Write',
          topic: opp.topic_title,
          keyword: opp.primary_keyword,
          length: opp.recommended_length || 1500,
          output: buf,
          opportunity_type: opp.opportunity_type,
          generated_at: new Date().toISOString()
        });
        // Refresh shared history so pipeline updates immediately.
        loadContentHistory().then(setSharedHistory).catch(() => {});
      } catch (saveErr) {
        console.warn('[AutoWrite] save to Supabase failed:', saveErr.message);
      }
    } catch (e) {
      updateArticle(idx, { status: 'error', error: e.message });
    } finally {
      setWritingIdx(null);
    }
  }

  // ─── Phase 2b: Write ALL remaining ───────────────────
  async function writeAllRemaining() {
    if (!plan) return;
    setBatchMode(true);
    for (let i = 0; i < plan.opportunities.length; i++) {
      const state = articleStates[i];
      if (state?.status === 'done') continue; // skip already-written
      await writeOne(i);
    }
    setBatchMode(false);
  }

  function stopBatch() { setBatchMode(false); }

  // Derived counts.
  const doneCount = Object.values(articleStates).filter(s => s?.status === 'done').length;
  const errorCount = Object.values(articleStates).filter(s => s?.status === 'error').length;
  const pendingCount = plan ? plan.opportunities.length - doneCount - errorCount : 0;

  // ─── Render ──────────────────────────────────────────
  return (
    <div>
      <style>{`@keyframes pulse { 0%,100% { opacity:.5; } 50% { opacity:1; } }`}</style>

      {/* Pipeline view — monthly workflow sections */}
      <PipelineView
        title={`Content Engine — ${monthLabel}`}
        month={monthLabel}
        sections={pipelineSections}
        onAction={(client, action) => {
          if (action === 'generate') {
            startResearch(client);
          }
        }}
        actions={[
          { key: 'generate', label: 'Generate Articles', color: ACCENT,
            condition: (c, section) => section !== 'credentials-missing' && section !== 'verified-on-site' },
          { key: 'generate', label: 'Generate More', color: ACCENT,
            condition: (c, section) => section === 'verified-on-site' }
        ]}
        expandedId={expandedPipelineClient}
        onExpandClient={(client) => {
          setExpandedPipelineClient(prev => prev === client.id ? null : client.id);
        }}
        renderExpanded={(client) => {
          const articles = getClientArticles(client.id);
          if (articles.length === 0) {
            return <div className="muted" style={{ padding: 12, fontSize: 12 }}>No articles found for this month.</div>;
          }
          const hasWp = client.cms_type === 'WordPress' && client.wp_url && client.wp_username && client.wp_app_password;
          return (
            <div>
              {articles.map((a, i) => (
                <div key={a.id || i} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{a.topic || a.keyword || 'Untitled'}</div>
                      <div className="muted" style={{ fontSize: 10 }}>
                        {a.tab || 'Auto Write'} · {new Date(a.created_at).toLocaleDateString('en-ZA')}
                        {a.opportunity_type && <span className="badge" style={{ marginLeft: 6, fontSize: 8 }}>{a.opportunity_type}</span>}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                      {hasWp && (
                        <PushToCmsButton
                          item={{
                            module: 'content',
                            page_url: client.url || '',
                            page_title: a.topic || a.keyword || 'Article',
                            change_type: 'article',
                            payload: { html: a.output, meta_title: a.topic, primary_keyword: a.keyword }
                          }}
                          label="Push to WP"
                          onSuccess={r => { if (r?.live_url) setPushedUrls(prev => ({ ...prev, [a.id || i]: r.live_url })); }}
                        />
                      )}
                      <MarkImplementedButton
                        module="content"
                        changeType="article"
                        pageUrl={pushedUrls[a.id || i] || client.url || ''}
                        title={a.topic || a.keyword || 'Article'}
                        description={`Article: ${a.topic || ''}`}
                      />
                      <button onClick={() => {
                        const blob = new Blob([a.output || ''], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const el = document.createElement('a');
                        el.href = url; el.download = (a.topic || 'article') + '.txt';
                        el.click(); URL.revokeObjectURL(url);
                      }} style={{ fontSize: 10, padding: '4px 8px' }}>.txt</button>
                    </div>
                  </div>
                  {a.output && (
                    <details style={{ marginTop: 6 }}>
                      <summary className="muted" style={{ fontSize: 10, cursor: 'pointer' }}>Preview</summary>
                      <pre style={{ marginTop: 4, padding: 8, background: 'var(--bg)', fontSize: 10, whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto', borderRadius: 4 }}>
                        {a.output.slice(0, 1500)}{a.output.length > 1500 ? '…' : ''}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          );
        }}
      />

      {/* Research status banner — shown at the TOP so it's always visible
          regardless of how many pipeline cards are below */}
      {researchBusy && (
        <div className="card" style={{ borderLeft: '4px solid var(--blue)', marginTop: 14 }}>
          <div className="row" style={{ gap: 10 }}>
            <div className="spinner" />
            <span style={{ fontSize: 13 }}>
              Researching topics for <strong>{activeClient?.name || '…'}</strong>…
            </span>
          </div>
        </div>
      )}
      {researchErr && (
        <div className="card" style={{ borderLeft: '4px solid var(--red)', marginTop: 14 }}>
          <strong style={{ color: 'var(--red)' }}>Research error</strong>
          <div style={{ fontSize: 12, marginTop: 6 }}>{researchErr}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Common causes: Google token expired (refresh the page and sign in again), no Search Console property set on this client, or the client's GSC property has no data for the last 90 days.
          </div>
        </div>
      )}

      {/* Client picker grid */}
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', margin: '14px 0 8px' }}>
        Or click a client to research topics from Search Console
      </div>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', marginBottom: 20 }}>
        {withGsc.map(c => {
          const isActive = c.id === activeId;
          const isLoading = researchBusy && activeId === c.id;
          const direction = directionPreview(c.internal_notes);
          return (
            <button
              key={c.id}
              onClick={() => {
                if (isActive && plan) return; // Already researched, don't re-run accidentally
                if (!confirm(`Research & plan ${c.pages_per_month || 4} topics for "${c.name}" from Search Console data?`)) return;
                startResearch(c);
              }}
              disabled={researchBusy || writingIdx !== null}
              style={{
                textAlign: 'left', padding: 12, borderRadius: 'var(--radius)',
                background: isActive ? 'var(--surface-2)' : 'var(--surface)',
                border: '1px solid ' + (isActive ? ACCENT : 'var(--border)'),
                color: 'var(--text)',
                cursor: (researchBusy || writingIdx !== null) ? 'wait' : 'pointer',
                opacity: isLoading ? 0.7 : 1,
                position: 'relative'
              }}
            >
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name}
                </div>
                {isLoading && <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
                {isActive && plan && !isLoading && (
                  <span style={{ fontSize: 9, color: 'var(--green)' }}>
                    {doneCount}/{plan.opportunities.length} done
                  </span>
                )}
              </div>
              <div className="muted" style={{ fontSize: 10 }}>
                {isLoading
                  ? 'Researching topics…'
                  : `${c.pages_per_month || 4} articles · click to research`}
                {!isLoading && direction && ' · direction set'}
              </div>
            </button>
          );
        })}
      </div>

      {withoutGsc.length > 0 && (
        <div className="card" style={{ padding: 10, marginBottom: 20 }}>
          <div className="muted" style={{ fontSize: 11 }}>
            <strong style={{ color: 'var(--orange)' }}>Missing Search Console ({withoutGsc.length}):</strong>{' '}
            {withoutGsc.slice(0, 8).map(c => c.name).join(', ')}
            {withoutGsc.length > 8 && ` +${withoutGsc.length - 8} more`}
          </div>
        </div>
      )}

      {/* Plan + article-by-article writing */}
      {plan && activeClient && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            {/* Progress summary bar */}
            <div className="row" style={{ gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 11 }}>
                <span className="muted">Planned:</span>{' '}
                <strong>{plan.opportunities.length}</strong>
              </div>
              <div style={{ fontSize: 11, color: 'var(--green)' }}>
                <span className="muted">Written:</span>{' '}
                <strong>{doneCount}</strong>
              </div>
              {pendingCount > 0 && (
                <div style={{ fontSize: 11, color: ACCENT }}>
                  <span className="muted">Remaining:</span>{' '}
                  <strong>{pendingCount}</strong>
                </div>
              )}
              {errorCount > 0 && (
                <div style={{ fontSize: 11, color: 'var(--red)' }}>
                  <span className="muted">Failed:</span>{' '}
                  <strong>{errorCount}</strong>
                </div>
              )}
            </div>
            {/* Overall progress bar */}
            <div style={{ height: 6, background: 'var(--surface)', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }}>
              <div style={{
                width: plan.opportunities.length > 0 ? Math.round((doneCount / plan.opportunities.length) * 100) + '%' : '0%',
                height: '100%', background: 'var(--green)', transition: 'width .4s'
              }} />
            </div>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <strong>{activeClient.name}</strong>
                {pendingCount === 0 && doneCount > 0 && (
                  <span style={{ marginLeft: 10, color: 'var(--green)', fontSize: 12 }}>
                    All articles complete ✓
                  </span>
                )}
              </div>
              <div className="row" style={{ gap: 8 }}>
                {pendingCount > 0 && (
                  <button
                    onClick={batchMode ? stopBatch : writeAllRemaining}
                    disabled={writingIdx !== null && !batchMode}
                    className="primary"
                    style={{ background: batchMode ? 'var(--red)' : ACCENT, borderColor: batchMode ? 'var(--red)' : ACCENT, color: '#0a0a0c', fontSize: 12 }}
                  >
                    {batchMode ? 'Stop batch' : `Write all remaining (${pendingCount})`}
                  </button>
                )}
              </div>
            </div>
            {plan.summary && (
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{plan.summary}</div>
            )}
          </div>

          {plan.opportunities.map((opp, idx) => {
            const state = articleStates[idx] || {};
            const color = OPP_COLORS[opp.opportunity_type] || 'var(--text-muted)';
            const isWriting = writingIdx === idx;
            const isDone = state.status === 'done';
            const isError = state.status === 'error';

            return (
              <div key={idx} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color, fontWeight: 700 }}>
                        #{opp.priority ?? idx + 1} · {opp.opportunity_type}
                      </span>
                      <span className="mono muted" style={{ fontSize: 10 }}>
                        pos {opp.current_position != null ? Number(opp.current_position).toFixed(1) : '—'}
                        {' '}· {(opp.current_impressions || 0).toLocaleString()} imp
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3, marginBottom: 2 }}>
                      {opp.topic_title}
                    </div>
                    <div className="mono muted" style={{ fontSize: 11 }}>→ {opp.primary_keyword}</div>
                    {opp.suggested_angle && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.3 }}>
                        {opp.suggested_angle}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    {isDone && <span className="badge green" style={{ fontSize: 10 }}>Done · {state.words} words</span>}
                    {isError && <span className="badge red" style={{ fontSize: 10 }}>Error</span>}
                    {isWriting && <span className="badge" style={{ color: ACCENT, borderColor: ACCENT, fontSize: 10 }}>Writing · {state.words || 0}w</span>}
                    {!isDone && !isWriting && !isError && (
                      <button
                        onClick={() => writeOne(idx)}
                        disabled={writingIdx !== null}
                        style={{ padding: '5px 14px', fontSize: 11, borderColor: ACCENT, color: ACCENT }}
                      >
                        Write this
                      </button>
                    )}
                    {isError && (
                      <button
                        onClick={() => writeOne(idx)}
                        disabled={writingIdx !== null}
                        style={{ padding: '4px 10px', fontSize: 10 }}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>

                {isWriting && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ height: 3, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        width: '60%', height: '100%', background: ACCENT,
                        animation: 'pulse 1.5s ease-in-out infinite'
                      }} />
                    </div>
                  </div>
                )}

                {isError && state.error && (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--red)' }}>{state.error}</div>
                )}

                {isDone && state.output && (
                  <details style={{ marginTop: 8 }}>
                    <summary className="muted" style={{ fontSize: 11, cursor: 'pointer' }}>
                      View generated article ({state.words} words)
                    </summary>
                    <pre style={{
                      marginTop: 6, padding: 12, background: 'var(--bg)',
                      fontSize: 11, overflowX: 'auto', whiteSpace: 'pre-wrap',
                      maxHeight: 400, borderRadius: 6
                    }}>{state.output}</pre>
                    <GenerateImageButton title={opp.topic_title} keyword={opp.primary_keyword} />
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
