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

function HeadBadge() {
  return <span style={{
    display: 'inline-block', padding: '1px 6px', marginLeft: 6,
    background: 'rgba(200,240,96,.12)', color: 'var(--accent)',
    borderRadius: 4, fontSize: 9, fontWeight: 600, letterSpacing: '.04em'
  }}>HEAD</span>;
}

function KeywordRow({ kw }) {
  const isHead = kw.classification?.headTerm;
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '6px 10px', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {kw.query}{isHead && <HeadBadge />}
      </td>
      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 600 }}>
        {kw.position}
      </td>
      <td style={{ padding: '6px 10px', textAlign: 'right' }}>
        {kw.change != null
          ? <ChangeArrow value={kw.change} suffix=" pos" />
          : <span className="muted" style={{ fontSize: 10 }}>new</span>}
      </td>
      <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmt(kw.clicks)}</td>
      <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-muted)' }}>{fmt(kw.impressions)}</td>
    </tr>
  );
}

function BucketSection({ title, count, subtitle, accent, rows, max = 60 }) {
  if (!rows?.length) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)' }}>
          {title}
          <span style={{
            marginLeft: 8, padding: '2px 8px', fontSize: 11, fontWeight: 600,
            color: accent, background: accent + '1a', border: '1px solid ' + accent + '40',
            borderRadius: 4, fontFamily: 'JetBrains Mono, monospace'
          }}>{count}</span>
        </div>
      </div>
      {subtitle && <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>{subtitle}</div>}
      <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Keyword</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Position</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Change</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Clicks</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>Impressions</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, max).map((kw, i) => <KeywordRow key={i} kw={kw} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KeywordBuckets({ data }) {
  const { keywordBuckets: b, keywords } = data;
  const head = b.headTermWins?.slice(0, 8) || [];
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)', margin: '0 0 14px' }}>
        Keyword Performance — {keywords.length} non-branded keywords across {b.counts.total} total
      </div>

      {head.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="row" style={{ alignItems: 'center', marginBottom: 8, gap: 8 }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-dim)' }}>
              Head-Term Wins
            </div>
            <span style={{
              padding: '2px 8px', fontSize: 11, fontWeight: 600,
              color: 'var(--accent)', background: 'rgba(200,240,96,.12)',
              border: '1px solid rgba(200,240,96,.3)', borderRadius: 4,
              fontFamily: 'JetBrains Mono, monospace'
            }}>{b.counts.headTermWins}</span>
          </div>
          <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
            Competitive head terms ranking on page 1 — what proves market position.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {head.map((kw, i) => (
              <div key={i} style={{
                padding: 12, background: 'var(--surface)',
                border: '1px solid rgba(200,240,96,.25)',
                borderLeft: '3px solid var(--accent)',
                borderRadius: 8
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{kw.query}</div>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontFamily: 'Instrument Serif, serif', fontSize: 26, color: 'var(--accent)' }}>
                    #{kw.position}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {fmt(kw.impressions)} imp
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <BucketSection
        title="Top 3 Rankings"
        count={b.counts.top3}
        subtitle="All keywords ranking in positions 1-3. Head terms first, then by impressions."
        accent="var(--green)"
        rows={b.top3}
        max={50}
      />
      <BucketSection
        title="Top 10 Rankings"
        count={b.counts.top10}
        subtitle="Page 1 visibility — positions 4-10."
        accent="var(--accent)"
        rows={b.top10}
        max={50}
      />
      <BucketSection
        title="Most Improved"
        count={b.counts.improved}
        subtitle="Position gains of 0.5+ vs last month, sorted by improvement size."
        accent="var(--green)"
        rows={b.improved}
        max={40}
      />
      <BucketSection
        title="Striking Distance"
        count={b.counts.striking}
        subtitle="Page 2 (positions 11-20) — closest to breaking into the top 10."
        accent="var(--orange)"
        rows={b.striking}
        max={30}
      />
    </div>
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

      {/* Keyword Rankings — bucketed view: head-term wins first, then
          Top 3 / Top 10 / Improved / Striking distance. Mirrors the
          downloaded microsite so what you preview is what you ship. */}
      {keywords?.length > 0 && data.keywordBuckets && (
        <KeywordBuckets data={data} />
      )}
      {keywords?.length > 0 && !data.keywordBuckets && (
        <>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--orange)', margin: '0 0 8px' }}>
            Keyword Rankings — Legacy view ({keywords.length} keywords cached, click Refresh Data for bucketed view)
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
