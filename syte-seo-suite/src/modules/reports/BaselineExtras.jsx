import React from 'react';

// The parts of an Onboarding Baseline beyond search traffic + rankings
// (which ReportDashboard renders): technical site health and AI-engine
// visibility, as captured by netlify/functions/lib/baselineScan.js.

const SEV_COLOR = { critical: 'var(--red)', high: 'var(--orange)', medium: 'var(--yellow, #fbbf24)', low: 'var(--text-muted)' };
const ENGINE_LABEL = { openai: 'ChatGPT', chatgpt: 'ChatGPT', gemini: 'Gemini', google: 'Gemini', claude: 'Claude', anthropic: 'Claude', perplexity: 'Perplexity' };
const SOURCE_LABEL = { ok: '✓', error: 'failed', not_connected: 'not connected', skipped: 'skipped' };

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', minWidth: 110, flex: '1 1 110px' }}>
      <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 2, color: color || 'var(--text)' }}>{value ?? '—'}</div>
    </div>
  );
}

function Note({ children }) {
  return <div className="muted" style={{ fontSize: 12 }}>{children}</div>;
}

function Technical({ t }) {
  if (!t || t.status !== 'ok') {
    return <Note>{t?.error ? 'Crawl failed: ' + t.error : (t?.note || 'Not captured.')}</Note>;
  }
  const s = t.by_severity || {};
  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Stat label="Pages crawled" value={t.pages_crawled} />
        <Stat label="Pages with issues" value={t.pages_with_issues} />
        <Stat label="Unreachable" value={t.pages_unreachable} color={t.pages_unreachable ? 'var(--orange)' : undefined} />
        <Stat label="Critical" value={s.critical || 0} color={s.critical ? SEV_COLOR.critical : undefined} />
        <Stat label="High" value={s.high || 0} color={s.high ? SEV_COLOR.high : undefined} />
        <Stat label="Medium" value={s.medium || 0} />
        <Stat label="Low" value={s.low || 0} />
      </div>
      {t.top_issues?.length > 0 && (
        <table style={{ width: '100%', fontSize: 12 }}>
          <thead>
            <tr><th style={{ textAlign: 'left' }}>Most widespread issues</th><th style={{ textAlign: 'left' }}>Severity</th><th style={{ textAlign: 'right' }}>Pages</th></tr>
          </thead>
          <tbody>
            {t.top_issues.map((i, k) => (
              <tr key={k}>
                <td>{i.detail || i.type}</td>
                <td style={{ color: SEV_COLOR[i.severity] }}>{i.severity}</td>
                <td style={{ textAlign: 'right' }}>{i.pages}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {t.discovery_source && <Note>Pages found via {t.discovery_source}{t.urls_discovered ? ' · ' + t.urls_discovered + ' URLs discovered' : ''}</Note>}
    </>
  );
}

function Aeo({ a }) {
  if (!a || a.status !== 'ok') {
    return <Note>{a?.error ? 'Measurement failed: ' + a.error : (a?.note || 'Not captured.')}</Note>;
  }
  const engines = Object.keys(a.engine_scores || {});
  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Stat label="AI visibility index" value={a.composite_index} />
        <Stat label="Prompts named in" value={a.coverage_pct != null ? a.coverage_pct + '%' : null} />
        <Stat label="Share of voice" value={a.share_of_voice != null ? a.share_of_voice + '%' : null} />
        <Stat label="Mentions" value={a.mentions} />
        <Stat label="Citations" value={a.citations} />
        {engines.map(e => <Stat key={e} label={ENGINE_LABEL[e] || e} value={a.engine_scores[e] + '%'} />)}
      </div>
      {a.competitors?.length > 0 && (
        <Note>Competitors named: {a.competitors.map(c => c.name + ' (' + c.mentions + ')').join(' · ')}</Note>
      )}
      {a.prompts?.length > 0 && (
        <table style={{ width: '100%', fontSize: 12, marginTop: 10 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Prompt</th>
              {engines.map(e => <th key={e} style={{ textAlign: 'center' }}>{ENGINE_LABEL[e] || e}</th>)}
            </tr>
          </thead>
          <tbody>
            {a.prompts.map((p, k) => (
              <tr key={k}>
                <td>{p.query}</td>
                {engines.map(e => {
                  const r = p.engines?.[e];
                  return (
                    <td key={e} style={{ textAlign: 'center', color: r?.appeared ? 'var(--green)' : 'var(--text-muted)' }}>
                      {r ? (r.appeared ? '✓' + (r.position ? ' #' + r.position : '') : '—') : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Note>Measured once per prompt ({a.total_runs} answers) — a starting point, not an opportunity search.</Note>
    </>
  );
}

export default function BaselineExtras({ extras }) {
  if (!extras) return null;
  const src = extras.sources || {};
  return (
    <div>
      <Section title="Technical site health">
        <Technical t={extras.technical} />
      </Section>
      <Section title="AI-engine visibility (ChatGPT · Gemini · Claude)">
        <Aeo a={extras.aeo} />
      </Section>
      <div className="muted" style={{ fontSize: 11, marginTop: 16 }}>
        Sources — GA4 {SOURCE_LABEL[src.ga4] || src.ga4 || '—'} · Search Console {SOURCE_LABEL[src.gsc] || src.gsc || '—'} ·
        Technical {SOURCE_LABEL[src.technical] || src.technical || '—'} · AI visibility {SOURCE_LABEL[src.aeo] || src.aeo || '—'}
        {extras.mode === 'auto' ? ' · captured automatically when the client was added' : ''}
      </div>
    </div>
  );
}
