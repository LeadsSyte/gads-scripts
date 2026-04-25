import React from 'react';

const ACCENT = '#a78bfa';

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString();
}

function ChangeArrow({ value, suffix = '%', invert = false }) {
  if (value == null || isNaN(value)) return <span className="muted">—</span>;
  const isGood = invert ? value < 0 : value > 0;
  const color = isGood ? 'var(--green)' : value === 0 ? 'var(--text-muted)' : 'var(--red)';
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '—';
  return (
    <span style={{ color, fontWeight: 600, fontSize: 12 }}>
      {arrow} {Math.abs(value)}{suffix}
    </span>
  );
}

function MetricCard({ label, value, mom, yoy, prefix = '' }) {
  return (
    <div style={{
      padding: 14, background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: 8
    }}>
      <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontFamily: 'Instrument Serif, serif', lineHeight: 1, marginBottom: 8 }}>
        {prefix}{fmt(value)}
      </div>
      <div className="row" style={{ gap: 12, fontSize: 11 }}>
        {mom != null && <div><span className="muted">MoM </span><ChangeArrow value={mom} /></div>}
        {yoy != null && <div><span className="muted">YoY </span><ChangeArrow value={yoy} /></div>}
      </div>
    </div>
  );
}

export default function ReportDashboard({ data, client, monthLabel }) {
  if (!data) return null;

  const { traffic, keywords, topPages, errors, clientType } = data;
  const isEcom = clientType === 'ecommerce';

  return (
    <div>
      {errors?.length > 0 && (
        <div style={{ marginBottom: 12, padding: 10, background: 'rgba(255,159,67,.06)', border: '1px solid rgba(255,159,67,.2)', borderRadius: 6, fontSize: 11, color: 'var(--orange)' }}>
          {errors.join(' · ')}
        </div>
      )}

      {/* Traffic + Conversions Cards */}
      {traffic?.current && (
        <>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', margin: '0 0 8px' }}>
            Organic Performance — {monthLabel}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
            <MetricCard
              label="Organic Users"
              value={traffic.current.users}
              mom={traffic.momChange?.users}
              yoy={traffic.yoyChange?.users}
            />
            <MetricCard
              label="Organic Sessions"
              value={traffic.current.sessions}
              mom={traffic.momChange?.sessions}
              yoy={traffic.yoyChange?.sessions}
            />
            <MetricCard
              label={isEcom ? 'Transactions' : 'Conversions (Leads)'}
              value={traffic.current.conversions}
              mom={traffic.momChange?.conversions}
              yoy={traffic.yoyChange?.conversions}
            />
            {isEcom && traffic.current.revenue > 0 && (
              <MetricCard
                label="Revenue"
                value={traffic.current.revenue}
                mom={traffic.momChange?.revenue}
                yoy={traffic.yoyChange?.revenue}
                prefix="R"
              />
            )}
          </div>

          {/* Period comparison table */}
          <div style={{ marginBottom: 16, overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Metric</th>
                  <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>This Month</th>
                  <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Prev Month</th>
                  <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>MoM</th>
                  <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Same Month LY</th>
                  <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>YoY</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Organic Users', 'users'],
                  ['Organic Sessions', 'sessions'],
                  [isEcom ? 'Transactions' : 'Leads', 'conversions'],
                  ...(isEcom ? [['Revenue', 'revenue']] : [])
                ].map(([label, key]) => (
                  <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{label}</td>
                    <td style={{ padding: '8px 10px' }}>{fmt(traffic.current?.[key])}</td>
                    <td style={{ padding: '8px 10px' }}>{fmt(traffic.previous?.[key])}</td>
                    <td style={{ padding: '8px 10px' }}><ChangeArrow value={traffic.momChange?.[key]} /></td>
                    <td style={{ padding: '8px 10px' }}>{fmt(traffic.yoy?.[key])}</td>
                    <td style={{ padding: '8px 10px' }}><ChangeArrow value={traffic.yoyChange?.[key]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Keyword Rankings */}
      {keywords?.length > 0 && (
        <>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', margin: '0 0 8px' }}>
            Keyword Rankings — Top {keywords.length} by Impressions
          </div>
          <div style={{ marginBottom: 16, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Keyword</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Position</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Change</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Clicks</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Impressions</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>CTR</th>
                </tr>
              </thead>
              <tbody>
                {keywords.slice(0, 30).map((kw, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 10px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {kw.query}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                      {kw.position}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                      {kw.change != null ? (
                        <ChangeArrow value={kw.change} suffix=" pos" />
                      ) : (
                        <span className="muted" style={{ fontSize: 10 }}>new</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmt(kw.clicks)}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmt(kw.impressions)}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-muted)' }}>{kw.ctr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Top Pages */}
      {topPages?.length > 0 && (
        <>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', margin: '0 0 8px' }}>
            Top Pages by Clicks
          </div>
          <div style={{ marginBottom: 16, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Page</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Clicks</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Impressions</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Avg Position</th>
                </tr>
              </thead>
              <tbody>
                {topPages.map((p, i) => {
                  let path = p.page;
                  try { path = new URL(p.page).pathname; } catch {}
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 10px', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                        {path}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmt(p.clicks)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmt(p.impressions)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>{p.position}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
