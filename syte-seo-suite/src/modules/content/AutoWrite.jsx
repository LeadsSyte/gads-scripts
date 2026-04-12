import React, { useState, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeStream } from '../../lib/anthropic.js';
import {
  collectResearchData,
  generateTopicRecommendations,
  buildArticleResearchContext
} from './topicResearch.js';
import { buildSystemPrompt, TAB_PROMPTS } from './prompts.js';
import GenerateImageButton from '../../components/GenerateImageButton.jsx';

const ACCENT = '#c8ff00';
const HISTORY_KEY = 'syte-suite-content-history';
const HISTORY_CAP = 500;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveToHistory(article) {
  const h = loadHistory();
  h.unshift(article);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, HISTORY_CAP)));
}

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

  // ─── Phase 1: Research ───────────────────────────────
  async function startResearch(client) {
    setActiveId(client.id);
    setResearch(null); setPlan(null); setArticleStates({}); setResearchErr('');
    setResearchBusy(true); setBatchMode(false); setWritingIdx(null);
    try {
      const data = await collectResearchData(client, { days: 90 });
      setResearch(data);
      const targetArticles = Math.max(1, Math.min(client.pages_per_month || 4, 50));
      const result = await generateTopicRecommendations(client, data, { targetArticles });
      const sorted = (result.opportunities || [])
        .slice()
        .sort((a, b) => (a.priority || 99) - (b.priority || 99));
      setPlan({ ...result, opportunities: sorted });
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

      // Persist to shared history.
      saveToHistory({
        id: crypto.randomUUID(),
        client_id: activeClient.id,
        client_name: activeClient.name,
        tab: 'Auto Write',
        topic: opp.topic_title,
        keyword: opp.primary_keyword,
        output: buf,
        opportunity_type: opp.opportunity_type,
        created_at: new Date().toISOString()
      });
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

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Auto Write</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 4, maxWidth: 720 }}>
            Pick a client → research topics from Search Console → write articles one by one
            (or batch). Each article uses live ranking data and the client's Manual Content
            Direction if set.
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid-3" style={{ marginBottom: 14 }}>
        <div className="card" style={{ padding: 14 }}>
          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>Content clients</div>
          <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 32, lineHeight: 1 }}>{contentClients.length}</div>
        </div>
        <div className="card" style={{ padding: 14, borderColor: 'var(--green)' }}>
          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>Ready (GSC set)</div>
          <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 32, lineHeight: 1, color: 'var(--green)' }}>{withGsc.length}</div>
        </div>
        <div className="card" style={{ padding: 14, borderColor: withoutGsc.length ? 'var(--orange)' : 'var(--border)' }}>
          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>Need GSC</div>
          <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 32, lineHeight: 1, color: withoutGsc.length ? 'var(--orange)' : 'var(--text-muted)' }}>{withoutGsc.length}</div>
        </div>
      </div>

      {/* Client picker grid */}
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', margin: '6px 0 8px' }}>
        Click a client to research topics from Search Console
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

      {/* Research phase */}
      {researchBusy && (
        <div className="card" style={{ borderLeft: '4px solid var(--blue)' }}>
          <div className="row" style={{ gap: 10 }}>
            <div className="spinner" />
            <span style={{ fontSize: 13 }}>
              Researching topics for <strong>{activeClient?.name}</strong>…
            </span>
          </div>
        </div>
      )}
      {researchErr && (
        <div className="card" style={{ borderLeft: '4px solid var(--red)' }}>
          <strong style={{ color: 'var(--red)' }}>Research error</strong>
          <div style={{ fontSize: 12, marginTop: 6 }}>{researchErr}</div>
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
