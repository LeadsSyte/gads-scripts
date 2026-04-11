import React, { useState, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import { claudeStream } from '../../lib/anthropic.js';
import {
  collectResearchData,
  generateTopicRecommendations,
  buildArticleResearchContext
} from './topicResearch.js';
import { buildSystemPrompt, TAB_PROMPTS } from './prompts.js';

const ACCENT = '#c8ff00';
const HISTORY_KEY = 'syte-suite-content-history';
const HISTORY_CAP = 500;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveHistory(h) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, HISTORY_CAP)));
}

// Per-client run state machine phases.
const PHASES = {
  idle:        { label: 'Ready',        color: 'var(--text-muted)' },
  researching: { label: 'Researching',  color: 'var(--blue)' },
  planning:    { label: 'Planning',     color: 'var(--purple)' },
  writing:     { label: 'Writing',      color: ACCENT },
  done:        { label: 'Complete',     color: 'var(--green)' },
  error:       { label: 'Error',        color: 'var(--red)' }
};

// Render the manual direction preview with a length cap.
function directionPreview(text) {
  if (!text) return null;
  const clean = text.trim();
  if (clean.length <= 140) return clean;
  return clean.slice(0, 140) + '…';
}

// Run the full pipeline for ONE client. Returns the final run state so the
// caller can save history. Progress updates flow via onProgress().
async function runClient(client, { onProgress }) {
  const manualDirection = (client.internal_notes || '').trim();
  const targetCount = Math.max(1, Math.min(client.pages_per_month || 4, 20));

  // Phase 1: GSC + scoring
  onProgress({ phase: 'researching', message: 'Pulling Search Console data…' });
  const research = await collectResearchData(client, { days: 90 });

  // Phase 2: Claude topic plan
  onProgress({
    phase: 'planning',
    message: manualDirection
      ? 'Planning topics with your manual direction + ranking data…'
      : 'Planning topics from ranking data…'
  });
  const plan = await generateTopicRecommendations(client, research);
  const opportunities = (plan.opportunities || [])
    .slice()
    .sort((a, b) => (a.priority || 99) - (b.priority || 99))
    .slice(0, targetCount);

  if (opportunities.length === 0) {
    throw new Error('Claude returned no opportunities — try re-running or set a Manual Content Direction.');
  }

  // Phase 3: write each article
  const articles = [];
  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i];
    onProgress({
      phase: 'writing',
      message: `Writing ${i + 1} / ${opportunities.length}: ${opp.topic_title}`,
      current: i,
      total: opportunities.length,
      tokens: 0
    });

    const ctx = buildArticleResearchContext(opp, research);
    const system = buildSystemPrompt(client, '', ctx);
    const userPrompt = TAB_PROMPTS['New Article'](
      opp.topic_title,
      opp.primary_keyword,
      opp.recommended_length || 1500
    );

    let buf = '';
    let tokens = 0;
    try {
      await claudeStream({
        system,
        messages: [{ role: 'user', content: userPrompt }],
        max_tokens: 8000,
        temperature: 0.7,
        onDelta: (t) => {
          buf += t;
          tokens += t.length;
          if (tokens % 200 < 10) {
            onProgress({
              phase: 'writing',
              message: `Writing ${i + 1} / ${opportunities.length}: ${opp.topic_title}`,
              current: i,
              total: opportunities.length,
              tokens
            });
          }
        }
      });
    } catch (e) {
      articles.push({
        id: crypto.randomUUID(),
        client_id: client.id,
        client_name: client.name,
        tab: 'New Article',
        topic: opp.topic_title,
        keyword: opp.primary_keyword,
        output: '',
        error: e.message,
        opportunity: opp,
        created_at: new Date().toISOString()
      });
      continue;
    }

    articles.push({
      id: crypto.randomUUID(),
      client_id: client.id,
      client_name: client.name,
      tab: 'New Article',
      topic: opp.topic_title,
      keyword: opp.primary_keyword,
      output: buf,
      opportunity: opp,
      priority: opp.priority,
      opportunity_type: opp.opportunity_type,
      created_at: new Date().toISOString()
    });
  }

  const ok = articles.filter(a => !a.error).length;
  const fail = articles.filter(a => a.error).length;

  return { articles, ok, fail, plan, research };
}

function ClientAutoCard({ client, state, onRun, onView }) {
  const direction = directionPreview(client.internal_notes);
  const phase = PHASES[state?.phase || 'idle'];
  const isRunning = state?.phase && state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error';

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong style={{ fontSize: 15, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {client.name}
          </strong>
          <div className="muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {client.url?.replace(/^https?:\/\//, '') || '—'}
          </div>
        </div>
        <span className="badge" style={{ color: phase.color, borderColor: phase.color, fontSize: 10 }}>
          {phase.label}
        </span>
      </div>

      <div className="row" style={{ fontSize: 11, gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="muted">
          <strong style={{ color: 'var(--text)' }}>{client.pages_per_month || 4}</strong> pages/mo
        </span>
        <span className="muted">
          GSC: {client.gsc_property
            ? <span style={{ color: 'var(--green)' }}>✓</span>
            : <span style={{ color: 'var(--red)' }}>missing</span>}
        </span>
      </div>

      <div style={{
        marginBottom: 10, padding: 8, borderRadius: 6,
        background: direction ? 'color-mix(in srgb, ' + ACCENT + ' 8%, var(--surface-2))' : 'var(--surface-2)',
        borderLeft: '2px solid ' + (direction ? ACCENT : 'var(--border)'),
        fontSize: 11
      }}>
        <div className="muted" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>
          {direction ? 'Manual direction set' : 'No manual direction — pure data-driven'}
        </div>
        <div style={{ color: direction ? 'var(--text)' : 'var(--text-muted)', fontStyle: direction ? 'normal' : 'italic' }}>
          {direction || 'Claude will pick topics from Search Console rankings alone.'}
        </div>
      </div>

      {/* Progress strip */}
      {state?.phase && state.phase !== 'idle' && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, marginBottom: 4, color: phase.color }}>
            {state.message || phase.label}
          </div>
          {state.total ? (
            <>
              <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  width: Math.round(((state.current + (state.tokens ? 0.5 : 0)) / state.total) * 100) + '%',
                  height: '100%', background: phase.color, transition: 'width .3s'
                }} />
              </div>
              <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>
                {state.current} / {state.total}{state.tokens ? ' · ' + Math.round(state.tokens / 4) + ' words' : ''}
              </div>
            </>
          ) : (
            <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                width: '30%', height: '100%', background: phase.color,
                animation: 'pulse 1.5s ease-in-out infinite'
              }} />
            </div>
          )}
        </div>
      )}

      {state?.result && state.phase === 'done' && (
        <div className="muted" style={{ fontSize: 11, marginBottom: 10 }}>
          ✓ {state.result.ok} articles written
          {state.result.fail > 0 && ` · ${state.result.fail} failed`}
        </div>
      )}

      {state?.phase === 'error' && (
        <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 10 }}>
          {state.message}
        </div>
      )}

      <div className="row" style={{ gap: 6 }}>
        <button
          onClick={() => onRun(client)}
          disabled={isRunning || !client.gsc_property}
          className="primary"
          style={{
            flex: 1,
            background: isRunning ? 'var(--surface-3)' : ACCENT,
            borderColor: ACCENT, color: '#0a0a0c',
            fontWeight: 600, fontSize: 12
          }}
        >
          {isRunning ? 'Running…' : state?.phase === 'done' ? 'Re-run' : 'Generate Articles'}
        </button>
        {state?.result?.articles?.length > 0 && (
          <button onClick={() => onView(client, state.result)} style={{ fontSize: 11 }}>
            View ({state.result.ok})
          </button>
        )}
      </div>
    </div>
  );
}

export default function AutoWrite() {
  const allClients = useClients(s => s.clients);
  const [states, setStates] = useState({}); // clientId -> { phase, message, current, total, tokens, result }
  const [err, setErr] = useState('');
  const [runningAll, setRunningAll] = useState(false);
  const [viewing, setViewing] = useState(null); // { client, result } when an expand panel is open

  const contentClients = useMemo(
    () => allClients.filter(c => c.does_content !== false),
    [allClients]
  );

  const withGsc = contentClients.filter(c => c.gsc_property);
  const withoutGsc = contentClients.filter(c => !c.gsc_property);

  function updateState(clientId, patch) {
    setStates(prev => ({
      ...prev,
      [clientId]: { ...(prev[clientId] || {}), ...patch }
    }));
  }

  async function runOne(client) {
    updateState(client.id, { phase: 'researching', message: 'Starting…', result: null });
    setErr('');
    try {
      const result = await runClient(client, {
        onProgress: (p) => updateState(client.id, p)
      });
      updateState(client.id, { phase: 'done', result });

      // Persist every successful article to the shared content history.
      const history = loadHistory();
      saveHistory([...result.articles.filter(a => !a.error), ...history]);
    } catch (e) {
      console.error('AutoWrite runClient error:', e);
      updateState(client.id, { phase: 'error', message: e.message });
    }
  }

  async function runAll() {
    setRunningAll(true); setErr('');
    for (const c of withGsc) {
      // Skip ones already completed this session unless the user
      // explicitly re-runs them. runOne is sequential — we await each.
      await runOne(c);
    }
    setRunningAll(false);
  }

  return (
    <div>
      <style>{`@keyframes pulse { 0%,100% { opacity:.5; } 50% { opacity:1; } }`}</style>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Auto Write</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 4, maxWidth: 720 }}>
            One click per client. Pulls live Search Console data, asks Claude to pick the top
            opportunities (weighted by ranking gaps, impressions, and any Manual Direction you've
            set in Edit Client), then writes every article in sequence with full ranking context.
            Results save to the Content Engine history.
          </div>
        </div>
        <button
          onClick={runAll}
          disabled={runningAll || withGsc.length === 0}
          className="primary"
          style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c', fontWeight: 600 }}
        >
          {runningAll ? 'Running all…' : `Run All (${withGsc.length})`}
        </button>
      </div>

      <div className="grid-3" style={{ marginBottom: 14 }}>
        <div className="card" style={{ padding: 14 }}>
          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>Content clients</div>
          <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 32, lineHeight: 1 }}>
            {contentClients.length}
          </div>
        </div>
        <div className="card" style={{ padding: 14, borderColor: 'var(--green)' }}>
          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>Ready to auto-write</div>
          <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 32, lineHeight: 1, color: 'var(--green)' }}>
            {withGsc.length}
          </div>
        </div>
        <div className="card" style={{ padding: 14, borderColor: withoutGsc.length ? 'var(--orange)' : 'var(--border)' }}>
          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>Need GSC setup</div>
          <div style={{
            fontFamily: 'Instrument Serif, serif', fontSize: 32, lineHeight: 1,
            color: withoutGsc.length ? 'var(--orange)' : 'var(--text-muted)'
          }}>
            {withoutGsc.length}
          </div>
        </div>
      </div>

      {err && <div style={{ color: 'var(--red)', marginBottom: 10 }}>{err}</div>}

      {contentClients.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          No clients have Content Engine enabled. Toggle it on in the master Clients tab.
        </div>
      )}

      {/* Ready clients */}
      {withGsc.length > 0 && (
        <>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', margin: '6px 0 8px' }}>
            Ready — {withGsc.length} client{withGsc.length === 1 ? '' : 's'}
          </div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {withGsc.map(c => (
              <ClientAutoCard
                key={c.id}
                client={c}
                state={states[c.id]}
                onRun={runOne}
                onView={(client, result) => setViewing({ client, result })}
              />
            ))}
          </div>
        </>
      )}

      {/* Not-ready clients */}
      {withoutGsc.length > 0 && (
        <>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--orange)', margin: '20px 0 8px' }}>
            Missing Search Console — {withoutGsc.length} client{withoutGsc.length === 1 ? '' : 's'}
          </div>
          <div className="card" style={{ padding: 12 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              These clients don't have a GSC property set. Open Edit Client → Google Connections to pick one.
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {withoutGsc.map(c => (
                <span key={c.id} className="badge" style={{ borderColor: 'var(--orange)', color: 'var(--orange)' }}>
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Expanded-articles panel */}
      {viewing && (
        <div className="modal-backdrop" onClick={() => setViewing(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 900 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>{viewing.client.name} — {viewing.result.ok} articles</h2>
              <button onClick={() => setViewing(null)} className="ghost">Close</button>
            </div>
            {viewing.result.plan?.summary && (
              <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                <strong>Plan summary:</strong> {viewing.result.plan.summary}
              </div>
            )}
            {viewing.result.articles.map((a, i) => (
              <details key={a.id} style={{ marginBottom: 12, padding: 10, background: 'var(--surface-2)', borderRadius: 8 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                  <strong>#{i + 1}</strong> {a.topic}
                  {a.opportunity_type && (
                    <span className="badge" style={{ marginLeft: 8, fontSize: 9 }}>{a.opportunity_type}</span>
                  )}
                  {a.error && <span style={{ color: 'var(--red)', marginLeft: 8, fontSize: 11 }}>(failed)</span>}
                </summary>
                {a.error ? (
                  <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{a.error}</div>
                ) : (
                  <pre style={{
                    marginTop: 8, padding: 12, background: 'var(--bg)',
                    fontSize: 11, overflowX: 'auto', whiteSpace: 'pre-wrap',
                    maxHeight: 400
                  }}>{a.output}</pre>
                )}
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
