import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '../../store/useClients.js';
import {
  collectResearchData,
  generateTopicRecommendations,
  buildArticleResearchContext
} from './topicResearch.js';

const ACCENT = '#c8ff00';

function scoreColor(s) {
  if (s == null) return 'var(--text-muted)';
  if (s < 40) return 'var(--text-muted)';
  if (s < 70) return 'var(--orange)';
  return 'var(--green)';
}

const OPP_LABELS = {
  'low-hanging-fruit': 'Low-hanging fruit',
  'content-gap':       'Content gap',
  'ranking-defend':    'Defend ranking',
  'meta-rewrite':      'Meta rewrite',
  'long-tail':         'Long tail'
};

const OPP_COLORS = {
  'low-hanging-fruit': 'var(--green)',
  'content-gap':       'var(--orange)',
  'ranking-defend':    'var(--blue)',
  'meta-rewrite':      'var(--purple)',
  'long-tail':         'var(--text-muted)'
};

// Props: onWriteArticle(opportunity, researchContext) - called when the
// user clicks Write Article on one of the opportunity cards. The parent
// is expected to switch to the New Article sub-tab with the context
// pre-filled.
export default function TopicResearch({ onWriteArticle }) {
  const client = useClients(s => s.current());
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | gsc | claude | done
  const [progress, setProgress] = useState(0);
  const [research, setResearch] = useState(null);
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    // Reset when switching clients.
    setResearch(null);
    setPlan(null);
    setPhase('idle');
    setProgress(0);
    setErr('');
  }, [client?.id]);

  // Smooth ticking animation while research is in flight. Neither GSC nor
  // Claude emit real progress events, so we ease the bar toward a per-phase
  // ceiling and let the phase transitions yank it forward.
  useEffect(() => {
    if (!busy) return;
    const ceiling = phase === 'gsc' ? 40 : phase === 'claude' ? 92 : 0;
    if (ceiling === 0) return;
    const id = setInterval(() => {
      setProgress(p => {
        if (p >= ceiling) return p;
        // Ease out — slow as we approach the ceiling.
        const step = Math.max(0.3, (ceiling - p) * 0.04);
        return Math.min(ceiling, p + step);
      });
    }, 200);
    return () => clearInterval(id);
  }, [busy, phase]);

  async function runResearch() {
    if (!client) { setErr('Select a client first.'); return; }
    if (!client.gsc_property) {
      setErr('This client has no Search Console property. Open Edit Client → Google Connections.');
      return;
    }
    setBusy(true); setErr(''); setResearch(null); setPlan(null);
    setProgress(3);
    try {
      setPhase('gsc');
      const data = await collectResearchData(client, { days });
      setResearch(data);
      setProgress(p => Math.max(p, 45));

      setPhase('claude');
      const result = await generateTopicRecommendations(client, data);
      setPlan(result);
      setProgress(100);
      setPhase('done');
    } catch (e) {
      setErr(e.message);
      setPhase('idle');
      setProgress(0);
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    if (!plan?.opportunities) return [];
    if (typeFilter === 'all') return plan.opportunities;
    return plan.opportunities.filter(o => o.opportunity_type === typeFilter);
  }, [plan, typeFilter]);

  const typeCounts = useMemo(() => {
    if (!plan?.opportunities) return {};
    const c = {};
    for (const o of plan.opportunities) {
      c[o.opportunity_type] = (c[o.opportunity_type] || 0) + 1;
    }
    return c;
  }, [plan]);

  function writeArticle(opp) {
    const ctx = buildArticleResearchContext(opp, research);
    onWriteArticle(opp, ctx);
  }

  if (!client) return <div className="muted">Select a client first.</div>;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Topic Research</h2>
        <span className="badge" style={{ borderColor: ACCENT, color: ACCENT }}>
          {client.name}
        </span>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Pulls the last <strong style={{ color: 'var(--text)' }}>{days} days</strong> of
          Search Console data for {client.name}, scores every query as an opportunity
          (weighted by impressions × position × CTR potential), then asks Claude to
          build a prioritized content plan. Low-hanging fruit and content gaps surface
          at the top. Clicking <em>Write Article</em> pre-fills the New Article tab with
          full ranking context so the article is framed around beating what's actually
          in the top 10 right now.
        </div>

        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <label style={{ margin: 0, alignSelf: 'center' }}>Timeframe</label>
            <select value={days} onChange={e => setDays(parseInt(e.target.value))} style={{ width: 140 }}>
              <option value={28}>Last 28 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 6 months</option>
              <option value={365}>Last 12 months</option>
            </select>
          </div>
          <div className="row" style={{ gap: 10 }}>
            {!busy && phase === 'done' && research && (
              <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
                {research.allQueryCount} queries analyzed · {plan?.opportunities?.length || 0} opportunities
              </span>
            )}
            <button
              className="primary"
              onClick={runResearch}
              disabled={busy}
              style={{ background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' }}
            >
              {busy ? 'Researching…' : plan ? 'Re-run Research' : 'Run Topic Research'}
            </button>
          </div>
        </div>

        {/* Progress bar — shows while research is running through GSC + Claude phases. */}
        {(busy || (progress > 0 && progress < 100)) && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <div className="row" style={{ gap: 8 }}>
                {busy && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />}
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  {phase === 'gsc' && 'Pulling Search Console data…'}
                  {phase === 'claude' && 'Claude is prioritizing opportunities…'}
                  {phase === 'done' && 'Done ✓'}
                  {phase === 'idle' && 'Starting…'}
                </span>
              </div>
              <span className="muted" style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{Math.round(progress)}%</span>
            </div>
            <div style={{ height: 6, background: 'var(--surface-3, #1a1c20)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{
                width: progress + '%',
                height: '100%',
                background: 'linear-gradient(90deg, ' + ACCENT + ', #4dabff)',
                transition: 'width 300ms ease-out',
                borderRadius: 999
              }} />
            </div>
            <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>
              {phase === 'gsc' && `Fetching last ${days} days of query + page data from Search Console.`}
              {phase === 'claude' && research && `Analyzing ${research.allQueryCount} queries · ${research.totalImpressions.toLocaleString()} impressions — usually 15–40 seconds.`}
              {phase !== 'gsc' && phase !== 'claude' && 'Preparing research run…'}
            </div>
          </div>
        )}

        {err && (
          <div style={{ marginTop: 10, padding: 12, background: 'rgba(255,77,77,.06)', border: '1px solid rgba(255,77,77,.2)', borderRadius: 6 }}>
            <div style={{ color: 'var(--red)', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              {/No GSC access/i.test(err) ? 'GSC Permission Issue' : 'Research Error'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{err}</div>
            {/No GSC access/i.test(err) && (
              <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
                <strong>How to fix:</strong> Ask the site owner to open{' '}
                <em>Google Search Console → Settings → Users and permissions</em> and add your Google account
                as a Full or Restricted user. This is separate from being signed in — it's a per-property permission.
              </div>
            )}
          </div>
        )}
      </div>

      {research && plan && (
        <>
          {plan.summary && (
            <div className="card" style={{ marginBottom: 14, borderLeft: '4px solid ' + ACCENT }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)' }}>
                This month's plan
              </div>
              <div style={{ fontSize: 14, marginTop: 6 }}>{plan.summary}</div>
            </div>
          )}

          {/* Type filter chips */}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            <button
              onClick={() => setTypeFilter('all')}
              className={typeFilter === 'all' ? 'primary' : ''}
              style={{
                padding: '5px 12px',
                fontSize: 11,
                ...(typeFilter === 'all' ? { background: ACCENT, borderColor: ACCENT, color: '#0a0a0c' } : {})
              }}
            >
              All ({plan.opportunities.length})
            </button>
            {Object.entries(typeCounts).map(([type, count]) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                style={{
                  padding: '5px 12px',
                  fontSize: 11,
                  ...(typeFilter === type
                    ? { background: OPP_COLORS[type] || 'var(--surface-3)', borderColor: OPP_COLORS[type] || 'var(--border)', color: '#0a0a0c' }
                    : {})
                }}
              >
                {OPP_LABELS[type] || type} ({count})
              </button>
            ))}
          </div>

          {/* Opportunity cards */}
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
            {filtered
              .slice()
              .sort((a, b) => (a.priority || 99) - (b.priority || 99))
              .map((opp, i) => {
                const color = OPP_COLORS[opp.opportunity_type] || 'var(--text-muted)';
                return (
                  <div key={i} className="card" style={{ padding: 16, borderLeft: '3px solid ' + color }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>
                        #{opp.priority ?? i + 1} · {OPP_LABELS[opp.opportunity_type] || opp.opportunity_type}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 22, color: scoreColor(opp.opportunity_score), lineHeight: 1 }}>
                          {opp.opportunity_score ?? '—'}
                        </div>
                        <div className="muted" style={{ fontSize: 9 }}>score</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, lineHeight: 1.3 }}>
                      {opp.topic_title}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                      → {opp.primary_keyword}
                    </div>

                    <div className="grid-3" style={{ marginBottom: 10, gap: 6 }}>
                      <div>
                        <div className="muted" style={{ fontSize: 9, textTransform: 'uppercase' }}>Position</div>
                        <div style={{ fontSize: 16, fontFamily: 'Instrument Serif, serif' }}>
                          {opp.current_position != null ? Number(opp.current_position).toFixed(1) : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="muted" style={{ fontSize: 9, textTransform: 'uppercase' }}>Impressions</div>
                        <div style={{ fontSize: 16, fontFamily: 'Instrument Serif, serif' }}>
                          {(opp.current_impressions || 0).toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="muted" style={{ fontSize: 9, textTransform: 'uppercase' }}>Clicks</div>
                        <div style={{ fontSize: 16, fontFamily: 'Instrument Serif, serif' }}>
                          {(opp.current_clicks || 0).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    {opp.target_page && opp.target_page !== 'NEW' && (
                      <div className="muted" style={{ fontSize: 10, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Target: {opp.target_page}
                      </div>
                    )}

                    <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 10, lineHeight: 1.4 }}>
                      <strong className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 3 }}>Angle</strong>
                      {opp.suggested_angle}
                    </div>

                    {opp.rationale && (
                      <div className="muted" style={{ fontSize: 11, marginBottom: 12, lineHeight: 1.4 }}>
                        {opp.rationale}
                      </div>
                    )}

                    {opp.supporting_keywords?.length > 0 && (
                      <details style={{ marginBottom: 10 }}>
                        <summary className="muted" style={{ fontSize: 10, cursor: 'pointer' }}>
                          {opp.supporting_keywords.length} supporting keywords
                        </summary>
                        <div style={{ marginTop: 6, fontSize: 11 }}>
                          {opp.supporting_keywords.map((k, j) => (
                            <span key={j} className="badge" style={{ marginRight: 4, marginBottom: 4, fontSize: 10 }}>{k}</span>
                          ))}
                        </div>
                      </details>
                    )}

                    <button
                      onClick={() => writeArticle(opp)}
                      className="primary"
                      style={{
                        background: ACCENT, borderColor: ACCENT, color: '#0a0a0c',
                        width: '100%', padding: '8px 12px', fontSize: 12, fontWeight: 600
                      }}
                    >
                      Write Article →
                    </button>
                  </div>
                );
              })}
          </div>
        </>
      )}

    </div>
  );
}
