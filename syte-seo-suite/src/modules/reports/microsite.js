// Generate a self-contained, downloadable HTML string for the client
// monthly report microsite. No external JS, only Google Fonts via CDN.

function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scoreColor(s) {
  const v = typeof s === 'string' ? parseFloat(s) : s;
  if (v == null || isNaN(v)) return '#8b8b96';
  if (v < 40) return '#ff4d4d';
  if (v < 70) return '#ff9f43';
  return '#34d399';
}

function fmtDelta(delta, suffix = 'pp') {
  if (!delta || delta.absolute == null) return '';
  const sign = delta.absolute >= 0 ? '+' : '';
  const arrow = delta.absolute >= 0 ? '↑' : '↓';
  const colour = delta.absolute >= 0 ? 'var(--green)' : 'var(--red)';
  const pct = delta.percent != null ? ` (${delta.percent >= 0 ? '+' : ''}${delta.percent}%)` : '';
  return `<span style="color:${colour};font-weight:600;">${arrow} ${sign}${delta.absolute}${suffix}${pct}</span>`;
}

function fmt(n) {
  if (n == null || n === '') return '—';
  return typeof n === 'number' ? n.toLocaleString() : String(n);
}

function changePill(change) {
  if (change == null) return '<span style="color:var(--muted);font-size:10px;">new</span>';
  if (change > 0) return '<span style="color:var(--green);font-weight:600;">▲ ' + Math.abs(change).toFixed(1) + '</span>';
  if (change < 0) return '<span style="color:var(--red);font-weight:600;">▼ ' + Math.abs(change).toFixed(1) + '</span>';
  return '<span style="color:var(--muted);">—</span>';
}

function keywordRow(kw, opts = {}) {
  const headBadge = kw.classification?.headTerm
    ? '<span style="display:inline-block;padding:1px 6px;margin-left:6px;background:rgba(200,240,96,.12);color:var(--accent);border-radius:4px;font-size:10px;font-weight:600;letter-spacing:.04em;">HEAD</span>'
    : '';
  const showChange = opts.showChange !== false;
  return `<tr style="border-bottom:1px solid var(--border);">
    <td style="padding:6px 10px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
      ${esc(kw.query)}${headBadge}
    </td>
    <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace;font-weight:600;">${kw.position}</td>
    ${showChange ? `<td style="padding:6px 10px;text-align:right;">${changePill(kw.change)}</td>` : ''}
    <td style="padding:6px 10px;text-align:right;">${Number(kw.clicks).toLocaleString()}</td>
    <td style="padding:6px 10px;text-align:right;color:var(--muted);">${Number(kw.impressions).toLocaleString()}</td>
  </tr>`;
}

// Render the bucketed keyword sections — top 3, top 10, improved,
// striking distance — instead of a flat top-N-by-impressions table.
// Clients care more about competitive head-term wins than long-tail
// volume, so head terms are flagged and surfaced first within each bucket.
function renderKeywordSections(rd) {
  const buckets = rd.keywordBuckets;
  if (!buckets) {
    // Fallback for legacy callers that don't provide buckets.
    return '';
  }

  const tableHead = (extraCol = true) => `
    <thead>
      <tr style="border-bottom:2px solid var(--border);text-align:left;">
        <th style="padding:8px 10px;color:var(--muted);font-size:10px;text-transform:uppercase;">Keyword</th>
        <th style="padding:8px 10px;text-align:right;color:var(--muted);font-size:10px;text-transform:uppercase;">Position</th>
        ${extraCol ? '<th style="padding:8px 10px;text-align:right;color:var(--muted);font-size:10px;text-transform:uppercase;">Change</th>' : ''}
        <th style="padding:8px 10px;text-align:right;color:var(--muted);font-size:10px;text-transform:uppercase;">Clicks</th>
        <th style="padding:8px 10px;text-align:right;color:var(--muted);font-size:10px;text-transform:uppercase;">Impressions</th>
      </tr>
    </thead>`;

  const sectionTable = (rows, title, subtitle, accent, max = 25) => {
    if (!rows.length) return '';
    return `
      <section>
        <h2 style="display:flex;align-items:center;gap:10px;">
          <span>${title}</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:14px;color:${accent};background:${accent}1a;border:1px solid ${accent}40;padding:2px 10px;border-radius:6px;">${rows.length}</span>
        </h2>
        <p style="color:var(--muted);font-size:13px;margin-bottom:14px;">${subtitle}</p>
        <table class="data-table" style="width:100%;border-collapse:collapse;font-size:12px;">
          ${tableHead(true)}
          <tbody>${rows.slice(0, max).map(kw => keywordRow(kw)).join('')}</tbody>
        </table>
      </section>`;
  };

  // Showcase strip: top head-term wins as feature cards (the showpiece).
  const headWins = buckets.headTermWins.slice(0, 8);
  const headWinsHtml = headWins.length > 0 ? `
    <section>
      <h2>Head-Term Wins</h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:14px;">
        Competitive, high-volume keywords ranking on page 1. These are the terms that prove market position —
        clients win on "shelving" and "racking", not on long-tail location queries.
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">
        ${headWins.map(kw => `
          <div style="padding:14px 16px;background:var(--surface);border:1px solid rgba(200,240,96,.25);border-left:3px solid var(--accent);border-radius:8px;">
            <div style="font-size:14px;font-weight:600;margin-bottom:6px;">${esc(kw.query)}</div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;">
              <span style="font-family:'DM Serif Display',serif;font-size:32px;color:var(--accent);">#${kw.position}</span>
              <span style="font-size:11px;color:var(--muted);">${Number(kw.impressions).toLocaleString()} imp · ${changePill(kw.change)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </section>` : '';

  return [
    headWinsHtml,
    sectionTable(buckets.top3,     'Top 3 Rankings',     'Keywords ranking in the top 3 positions on Google. Head terms first, then by impressions.', 'var(--green)', 30),
    sectionTable(buckets.top10,    'Top 10 Rankings',    'Page 1 visibility — positions 4-10. Head terms flagged.', 'var(--accent)', 30),
    sectionTable(buckets.improved, 'Most Improved',      'Biggest position gains vs last month. Movement of 0.5+ positions only.', 'var(--green)', 25),
    sectionTable(buckets.striking, 'Striking Distance',  'Page 2 keywords (positions 11-20) — the queries closest to breaking into the top 10. Highest-impact next push.', 'var(--orange)', 25),
    buckets.branded.length > 0 ? `
      <section>
        <h2 style="display:flex;align-items:center;gap:10px;"><span>Branded Queries</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:14px;color:var(--muted);background:rgba(154,154,166,.1);border:1px solid var(--border);padding:2px 10px;border-radius:6px;">${buckets.branded.length}</span>
        </h2>
        <p style="color:var(--muted);font-size:13px;margin-bottom:14px;">Searches that include the brand name — context only, not part of competitive SEO performance.</p>
        <table class="data-table" style="width:100%;border-collapse:collapse;font-size:12px;">
          ${tableHead(true)}
          <tbody>${buckets.branded.slice(0, 12).map(kw => keywordRow(kw)).join('')}</tbody>
        </table>
      </section>
    ` : '',
    `<section>
      <h2 style="display:flex;align-items:center;gap:10px;"><span>Full Keyword Detail</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:14px;color:var(--muted);background:rgba(154,154,166,.1);border:1px solid var(--border);padding:2px 10px;border-radius:6px;">${buckets.counts.eligible}</span>
      </h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:14px;">Every non-branded keyword GSC reported, sorted by impressions.</p>
      <table class="data-table" style="width:100%;border-collapse:collapse;font-size:12px;">
        ${tableHead(true)}
        <tbody>
          ${(rd.keywords || [])
            .filter(kw => !kw.classification || !kw.classification.branded)
            .slice(0, 60)
            .map(kw => keywordRow(kw)).join('')}
        </tbody>
      </table>
    </section>`
  ].filter(Boolean).join('');
}

// micro: parsed microsite JSON from Claude, client: full client record,
// monthLabel: e.g. "April 2026", rankscale: optional share URL.
// aeoCompare: { current, previous, deltas, has_previous } from aeoCompare.js
// aeoRanking: sorted competitive landscape including the brand
// aeoOnly: when true, suppress all SEO sections (traffic table, keywords,
//          top pages, PPC equivalent, generic top-pages from microJson).
export function buildMicrositeHtml({ micro, client, monthLabel, previousMonthLabel, rankscale, reportData, aeoProbe, aeoCompare, aeoRanking, aeoOnly = false }) {
  const aeo = micro?.aeoSection || {};
  const showAeo = !!aeo.show && !aeoOnly;
  const ppc = micro?.ppcEquivalent || {};
  const showPpc = !!ppc.show && !aeoOnly;
  const work = micro?.workDone || {};
  const showWork = !!work.show && (work.items || []).length > 0 && !aeoOnly;
  const rd = aeoOnly ? {} : (reportData || {});
  const traffic = rd.traffic || {};
  const isEcom = rd.clientType === 'ecommerce';
  const probe = aeoProbe || {};
  const cmp = aeoCompare || null;
  const ranking = aeoRanking || null;
  const brandRank = ranking ? ranking.findIndex(r => r.isBrand) + 1 : null;

  const highlights = (micro?.highlights || []).map(h => `
    <div class="metric">
      <div class="metric-val">${esc(h.value)}</div>
      <div class="metric-label">${esc(h.label)}</div>
      <div class="metric-delta ${h.positive ? 'pos' : 'neg'}">${esc(h.delta || '')}</div>
    </div>
  `).join('');

  // Top performing pages — prefer real GSC data over AI-fabricated lists.
  // The AI was inventing pages with "0 users" because it didn't have the
  // real data in scope. Always defer to rd.topPages when available; only
  // fall back to micro.topPages if GSC data is missing AND we're not in
  // AEO-only mode.
  let topPages = '';
  if (!aeoOnly) {
    if ((rd.topPages || []).length > 0) {
      topPages = rd.topPages.slice(0, 8).map(p => {
        let path = p.page;
        try { path = new URL(p.page).pathname; } catch {}
        return `<li>
          <span class="page-path">${esc(path)}</span>
          <span class="page-users">${Number(p.clicks).toLocaleString()} clicks · ${Number(p.impressions).toLocaleString()} imp</span>
          <span class="page-delta">avg pos #${p.position}</span>
        </li>`;
      }).join('');
    } else if ((micro?.topPages || []).length > 0) {
      // Only render AI-supplied list if it has at least one entry with
      // a non-zero users figure — drops the "0 users" fabrications.
      const real = (micro.topPages || []).filter(p => Number(String(p.users || '').replace(/,/g, '')) > 0);
      topPages = real.slice(0, 8).map(p => `
        <li>
          <span class="page-path">${esc(p.page)}</span>
          <span class="page-users">${esc(p.users)} users</span>
          <span class="page-delta">${esc(p.delta || '')}</span>
        </li>
      `).join('');
    }
  }

  const engineTiles = showAeo ? Object.entries(aeo.byEngine || {}).map(([k, v]) => `
    <div class="engine-tile">
      <div class="engine-name">${esc(k)}</div>
      <div class="engine-score" style="color:${scoreColor(v)}">${esc(v)}</div>
      <div class="engine-bar">
        <div style="width:${Math.max(0, Math.min(100, Number(v) || 0))}%; background:${scoreColor(v)}"></div>
      </div>
    </div>
  `).join('') : '';

  const queryRows = showAeo ? (aeo.topQueries || []).map(q => `
    <tr>
      <td>${esc(q.query)}</td>
      <td>${q.chatgpt    ? '✓' : '—'}</td>
      <td>${q.perplexity ? '✓' : '—'}</td>
      <td>${q.gemini     ? '✓' : '—'}</td>
      <td>${q.claude     ? '✓' : '—'}</td>
    </tr>
  `).join('') : '';

  const competitors = showAeo ? (aeo.competitors || []).map(c => `
    <div class="comp-row">
      <span class="comp-name">${esc(c.name)}</span>
      <div class="comp-bar">
        <div style="width:${Math.max(0, Math.min(100, Number(c.score) || 0))}%"></div>
      </div>
      <span class="comp-val">${esc(c.score)}</span>
    </div>
  `).join('') : '';

  const rankscaleBtn = rankscale
    ? `<a class="btn" href="${esc(rankscale)}" target="_blank" rel="noreferrer">View Full Rankscale Dashboard →</a>`
    : '';

  const overallScore = aeo.score != null ? String(aeo.score) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(client.name || 'Client')} — ${esc(monthLabel)} Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0c0c0e;
    --surface: #15151a;
    --surface-2: #1d1d24;
    --border: #2a2a33;
    --text: #f5f5f7;
    --muted: #9a9aa6;
    --faint: #5a5a66;
    --accent: #c8f060;
    --accent-blue: #4F8EF7;
    --green: #4ade80;
    --red: #f87171;
    --orange: #fbbf24;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--text);
    font-family: 'Syne', system-ui, sans-serif;
    line-height: 1.55; font-size: 15px;
  }
  h1, h2, h3 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; letter-spacing: -0.01em; }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 48px 24px; }
  .logo { font-family: 'Syne', sans-serif; font-size: 22px; font-weight: 800; letter-spacing: .02em; text-transform: uppercase; }
  .pill {
    display: inline-block; padding: 4px 12px; border-radius: 999px;
    background: var(--surface-2); border: 1px solid var(--border);
    font-size: 12px; color: var(--muted); margin-top: 12px;
  }
  .hero { padding: 32px 0 48px; border-bottom: 1px solid var(--border); }
  .hero h1 { font-size: 48px; margin: 14px 0 8px; line-height: 1.1; }
  .hero .subhead { color: var(--muted); font-size: 18px; max-width: 640px; }
  .hero .prepared {
    display: inline-block; margin-top: 20px; padding: 6px 12px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    font-size: 12px; color: var(--muted);
  }
  section { padding: 40px 0; border-bottom: 1px solid var(--border); }
  section h2 { font-size: 28px; margin-bottom: 16px; }
  .narrative { max-width: 700px; color: var(--text); font-size: 16px; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin-top: 20px; }
  .metric {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 18px;
  }
  .metric-val { font-family: 'DM Serif Display', serif; font-size: 36px; line-height: 1; }
  .metric-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin-top: 6px; }
  .metric-delta { margin-top: 4px; font-size: 13px; font-weight: 500; }
  .metric-delta.pos { color: var(--green); }
  .metric-delta.neg { color: var(--red); }
  ul.pages { list-style: none; margin-top: 14px; }
  ul.pages li {
    display: flex; justify-content: space-between; gap: 12px;
    padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 14px;
  }
  .page-path { flex: 1; color: var(--text); font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; }
  .page-users { color: var(--muted); }
  .page-delta { color: var(--green); font-weight: 500; min-width: 60px; text-align: right; }

  .aeo { background: linear-gradient(180deg, rgba(167, 139, 250, .06), transparent); }
  .aeo-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 20px; margin-bottom: 20px; }
  .aeo-score {
    font-family: 'DM Serif Display', serif; font-size: 88px; line-height: 1;
  }
  .aeo-score-delta { color: var(--muted); font-size: 14px; }
  .engines { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 20px 0; }
  .engine-tile { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
  .engine-name { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  .engine-score { font-family: 'DM Serif Display', serif; font-size: 28px; margin: 4px 0 8px; }
  .engine-bar { height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
  .engine-bar > div { height: 100%; transition: width .3s; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; text-transform: uppercase; font-size: 11px; letter-spacing: .05em; }
  .comp-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
  .comp-name { min-width: 160px; font-size: 13px; }
  .comp-bar { flex: 1; height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
  .comp-bar > div { height: 100%; background: var(--accent); }
  .comp-val { color: var(--muted); font-size: 12px; min-width: 30px; text-align: right; }
  .sentiment-badge {
    display: inline-block; margin-top: 10px; padding: 6px 14px;
    background: rgba(52, 211, 153, .1); color: var(--green);
    border: 1px solid rgba(52, 211, 153, .4); border-radius: 999px; font-size: 12px;
  }
  .aeo-footer { color: var(--muted); font-size: 11px; margin-top: 16px; font-style: italic; }
  .btn {
    display: inline-block; margin-top: 16px;
    padding: 10px 18px; background: var(--accent); color: #0a0a0c;
    border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px;
  }

  .work-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 16px; }
  .work-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; padding: 16px; border-left: 3px solid var(--accent);
  }
  .work-cat { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--accent); margin-bottom: 4px; }
  .work-summary { font-size: 15px; font-weight: 600; }
  .work-detail { font-size: 12px; color: var(--muted); margin-top: 4px; }

  .ppc-card {
    background: linear-gradient(135deg, rgba(52, 211, 153, .08), rgba(167, 139, 250, .06));
    border: 1px solid rgba(52, 211, 153, .3); border-radius: 12px;
    padding: 24px; margin-top: 16px; text-align: center;
  }
  .ppc-value { font-family: 'DM Serif Display', serif; font-size: 48px; color: var(--green); line-height: 1; }
  .ppc-label { color: var(--muted); font-size: 13px; margin-top: 8px; }
  .ppc-detail { color: var(--muted); font-size: 12px; margin-top: 4px; }

  .next {
    background: var(--surface); border: 1px solid var(--border);
    border-left: 4px solid var(--accent); padding: 20px 24px; border-radius: 10px;
    font-size: 16px; max-width: 700px;
  }

  footer { padding: 40px 0 0; color: var(--muted); font-size: 12px; text-align: center; }
  footer .logo { font-size: 18px; color: var(--muted); }
  footer .confidential { margin-top: 8px; font-style: italic; }

  @media (max-width: 640px) {
    .wrap { padding: 32px 18px; }
    .hero h1 { font-size: 34px; }
    .aeo-score { font-size: 64px; }
  }
</style>
</head>
<body>
  <div class="wrap">

    <header class="hero">
      <div class="logo">SYTE</div>
      <div class="pill">${esc(monthLabel)} Report</div>
      <h1>${esc(micro?.headline || 'Monthly performance update')}</h1>
      <p class="subhead">${esc(micro?.subheadline || '')}</p>
      <div class="prepared">Prepared by Alice, Syte Digital Agency — for ${esc(client.name)}</div>
    </header>

    <section>
      <h2>The Story This Month</h2>
      <p class="narrative">${esc(micro?.narrative || '')}</p>
    </section>

    ${highlights ? `
    <section>
      <h2>Key Metrics</h2>
      <div class="metrics">${highlights}</div>
    </section>` : ''}

    ${topPages ? `
    <section>
      <h2>Top Performing Pages</h2>
      <ul class="pages">${topPages}</ul>
    </section>` : ''}

    ${showWork ? `
    <section>
      <h2>What Syte Did This Month</h2>
      <div class="work-grid">
        ${(work.items || []).map(w => `
          <div class="work-card">
            <div class="work-cat">${esc(w.category)}</div>
            <div class="work-summary">${esc(w.summary)}</div>
            ${w.detail ? `<div class="work-detail">${esc(w.detail)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </section>` : ''}

    ${showPpc ? `
    <section>
      <h2>PPC Equivalent Value</h2>
      <div class="ppc-card">
        <div class="ppc-value">${esc(ppc.value)}</div>
        <div class="ppc-label">Estimated Google Ads equivalent for your organic traffic</div>
        <div class="ppc-detail">${esc(ppc.clicks || '')} organic clicks × ${esc(ppc.avgCpc || '')} avg. CPC</div>
      </div>
      <p class="narrative" style="margin-top:16px;font-size:14px">${esc(ppc.narrative || '')}</p>
    </section>` : ''}

    ${showAeo ? `
    <section class="aeo">
      <h2>Your AI Search Presence</h2>
      <div class="aeo-head">
        <div>
          <div class="aeo-score" style="color:${scoreColor(overallScore)}">${esc(overallScore)}<span style="font-size:28px;color:var(--muted)">/100</span></div>
          <div class="aeo-score-delta">${esc(aeo.scoreDelta || '')}</div>
        </div>
      </div>
      ${engineTiles ? `<div class="engines">${engineTiles}</div>` : ''}
      ${queryRows ? `
      <table>
        <thead><tr><th>Query</th><th>ChatGPT</th><th>Perplexity</th><th>Gemini</th><th>Claude</th></tr></thead>
        <tbody>${queryRows}</tbody>
      </table>` : ''}
      ${competitors ? `<div style="margin-top:16px">${competitors}</div>` : ''}
      ${aeo.sentiment ? `<span class="sentiment-badge">${esc(aeo.sentiment)} of AI mentions are positive</span>` : ''}
      ${aeo.narrative ? `<p class="narrative" style="margin-top:16px">${esc(aeo.narrative)}</p>` : ''}
      <p class="aeo-footer">Tracked across ChatGPT, Gemini, Perplexity &amp; Claude using Syte's proprietary AEO Snapshot methodology.</p>
      ${rankscaleBtn}
    </section>` : ''}

    ${probe.per_query?.length > 0 ? `
    <section>
      <h2>AI Visibility — Headline Metrics</h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">
        Probed ${probe.engines_used?.length || 0} AI engine${(probe.engines_used?.length || 0) > 1 ? 's' : ''}
        (${(probe.engines_used || []).join(', ')}) across ${probe.queries_count || new Set(probe.per_query.map(r => r.query)).size} queries × ${probe.iterations || 1} iterations = ${probe.total_runs || probe.per_query.length} total responses.
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:20px;">
        ${[
          { label: 'Visibility Score', value: (probe.visibility_score ?? 0) + '%', delta: cmp?.deltas?.visibility, deltaSuffix: 'pp' },
          { label: 'Mentions',        value: fmt(probe.mentions),                  delta: cmp?.deltas?.mentions,   deltaSuffix: '' },
          { label: 'Citations',       value: fmt(probe.citations),                 delta: cmp?.deltas?.citations,  deltaSuffix: '' },
          { label: 'Detection Rate',  value: (probe.detection_rate ?? 0) + '%',    delta: cmp?.deltas?.detection,  deltaSuffix: 'pp' },
          { label: 'Top-3 Rate',      value: (probe.top3_rate ?? 0) + '%',         delta: cmp?.deltas?.top3,       deltaSuffix: 'pp' },
          { label: 'Sentiment',       value: (probe.sentiment_score ?? 0) + '%',   delta: cmp?.deltas?.sentiment,  deltaSuffix: 'pp' }
        ].map(m => `
          <div style="padding:18px;background:var(--surface);border:1px solid var(--border);border-radius:12px;">
            <div style="font-family:'DM Serif Display',serif;font-size:36px;line-height:1;color:var(--accent);">${m.value}</div>
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-top:6px;">${m.label}</div>
            ${m.delta ? `<div style="font-size:12px;margin-top:4px;">${fmtDelta(m.delta, m.deltaSuffix)}</div>` : ''}
          </div>
        `).join('')}
      </div>
      ${cmp?.has_previous ? `<p style="color:var(--muted);font-size:12px;font-style:italic;">Deltas vs ${esc(previousMonthLabel || cmp.previous_month || 'last month')}</p>` : '<p style="color:var(--muted);font-size:12px;font-style:italic;">First snapshot — this is the baseline. MoM deltas appear from next month.</p>'}
      ${micro?.aeoMomNarrative ? `<p class="narrative" style="margin-top:14px;">${esc(micro.aeoMomNarrative)}</p>` : ''}
      ${rankscaleBtn}
    </section>` : ''}

    ${cmp?.has_previous && cmp.deltas ? `
    <section>
      <h2>Month-on-Month</h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:14px;">Two-month comparison across every AEO metric we track.</p>
      <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);text-align:left;">
            <th style="padding:10px;color:var(--muted);font-size:11px;text-transform:uppercase;">Metric</th>
            <th style="padding:10px;text-align:right;color:var(--muted);font-size:11px;text-transform:uppercase;">${esc(previousMonthLabel || cmp.previous_month || 'Previous')}</th>
            <th style="padding:10px;text-align:right;color:var(--muted);font-size:11px;text-transform:uppercase;">${esc(monthLabel)}</th>
            <th style="padding:10px;text-align:right;color:var(--muted);font-size:11px;text-transform:uppercase;">Change</th>
          </tr>
        </thead>
        <tbody>
          ${[
            { label: 'Visibility Score',  prev: cmp.previous?.visibility, curr: cmp.current?.visibility, delta: cmp.deltas.visibility, suffix: '%', deltaSuffix: 'pp' },
            { label: 'Mentions',          prev: cmp.previous?.mentions,   curr: cmp.current?.mentions,   delta: cmp.deltas.mentions,   suffix: '',  deltaSuffix: '' },
            { label: 'Citations',         prev: cmp.previous?.citations,  curr: cmp.current?.citations,  delta: cmp.deltas.citations,  suffix: '',  deltaSuffix: '' },
            { label: 'Detection Rate',    prev: cmp.previous?.detection,  curr: cmp.current?.detection,  delta: cmp.deltas.detection,  suffix: '%', deltaSuffix: 'pp' },
            { label: 'Top-3 Rate',        prev: cmp.previous?.top3,       curr: cmp.current?.top3,       delta: cmp.deltas.top3,       suffix: '%', deltaSuffix: 'pp' },
            { label: 'Sentiment Score',   prev: cmp.previous?.sentiment,  curr: cmp.current?.sentiment,  delta: cmp.deltas.sentiment,  suffix: '%', deltaSuffix: 'pp' }
          ].map(row => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:10px;font-weight:600;">${row.label}</td>
              <td style="padding:10px;text-align:right;color:var(--muted);font-family:'JetBrains Mono',monospace;">${row.prev != null ? row.prev + row.suffix : '—'}</td>
              <td style="padding:10px;text-align:right;font-family:'JetBrains Mono',monospace;">${row.curr != null ? row.curr + row.suffix : '—'}</td>
              <td style="padding:10px;text-align:right;">${fmtDelta(row.delta, row.deltaSuffix)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>` : ''}

    ${ranking && ranking.length > 1 ? `
    <section>
      <h2>Competitive Landscape</h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:14px;">
        ${brandRank === 1
          ? `<strong style="color:var(--green);">${esc(client.name)} leads</strong> all tracked competitors on visibility.`
          : `${esc(client.name)} ranks <strong>#${brandRank}</strong> of ${ranking.length} brands tracked. Closest leader: ${esc(ranking[0].name)} at ${ranking[0].visibility}%.`}
      </p>
      ${micro?.aeoCompetitiveNarrative ? `<p class="narrative" style="margin-bottom:14px;">${esc(micro.aeoCompetitiveNarrative)}</p>` : ''}
      <table class="data-table" style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);text-align:left;">
            <th style="padding:8px 10px;color:var(--muted);font-size:10px;text-transform:uppercase;">Brand</th>
            <th style="padding:8px 10px;text-align:right;color:var(--muted);font-size:10px;text-transform:uppercase;">Visibility</th>
            <th style="padding:8px 10px;text-align:right;color:var(--muted);font-size:10px;text-transform:uppercase;">Top-3 Rate</th>
            <th style="padding:8px 10px;text-align:right;color:var(--muted);font-size:10px;text-transform:uppercase;">Mentions</th>
            <th style="padding:8px 10px;text-align:right;color:var(--muted);font-size:10px;text-transform:uppercase;">Citations</th>
            <th style="padding:8px 10px;text-align:right;color:var(--muted);font-size:10px;text-transform:uppercase;">Avg Pos</th>
          </tr>
        </thead>
        <tbody>
          ${ranking.map((r, i) => `
            <tr style="border-bottom:1px solid var(--border);${r.isBrand ? 'background:rgba(200,240,96,.06);' : ''}">
              <td style="padding:8px 10px;font-weight:${r.isBrand ? '700' : '500'};color:${r.isBrand ? 'var(--accent)' : 'var(--text)'};">
                ${r.isBrand ? `✦ #${i + 1} ` : `#${i + 1} `}${esc(r.name)}
              </td>
              <td style="padding:8px 10px;text-align:right;font-family:'JetBrains Mono',monospace;font-weight:${r.isBrand ? '700' : '400'};">${r.visibility}%</td>
              <td style="padding:8px 10px;text-align:right;font-family:'JetBrains Mono',monospace;">${r.top3_rate}%</td>
              <td style="padding:8px 10px;text-align:right;font-family:'JetBrains Mono',monospace;">${r.mentions}</td>
              <td style="padding:8px 10px;text-align:right;font-family:'JetBrains Mono',monospace;">${r.citations}</td>
              <td style="padding:8px 10px;text-align:right;color:var(--muted);">${r.avg_position != null ? '#' + r.avg_position : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>` : ''}

    ${(probe.keyword_wins?.active?.length || probe.keyword_wins?.emerging?.length) ? `
    <section>
      <h2>Keyword Performance</h2>
      ${probe.keyword_wins?.active?.length ? `
        <h3 style="font-size:16px;margin:14px 0 10px;color:var(--green);">✅ Active Wins <span style="font-size:12px;color:var(--muted);font-weight:400;">— ≥70% visibility</span></h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">
          ${probe.keyword_wins.active.slice(0, 12).map(w => `
            <div style="padding:12px 14px;background:var(--surface);border:1px solid rgba(74,222,128,.3);border-left:3px solid var(--green);border-radius:8px;">
              <div style="font-size:13px;font-weight:600;">${esc(w.query)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:4px;display:flex;justify-content:space-between;">
                <span>${esc(w.engine_label || w.engine)}</span>
                <span style="color:var(--green);font-weight:600;">${w.visibility}%</span>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${probe.keyword_wins?.emerging?.length ? `
        <h3 style="font-size:16px;margin:20px 0 10px;color:var(--orange);">🔬 Emerging Wins <span style="font-size:12px;color:var(--muted);font-weight:400;">— 30-69% visibility, building momentum</span></h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">
          ${probe.keyword_wins.emerging.slice(0, 12).map(w => `
            <div style="padding:12px 14px;background:var(--surface);border:1px solid rgba(251,191,36,.3);border-left:3px solid var(--orange);border-radius:8px;">
              <div style="font-size:13px;font-weight:600;">${esc(w.query)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:4px;display:flex;justify-content:space-between;">
                <span>${esc(w.engine_label || w.engine)}</span>
                <span style="color:var(--orange);font-weight:600;">${w.visibility}%</span>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${probe.keyword_wins?.zero?.length ? `
        <p style="color:var(--muted);font-size:12px;margin-top:16px;">
          <strong style="color:var(--text);">${probe.keyword_wins.zero.length} zero-visibility queries</strong>
          — biggest opportunity. Listed in next month's strategy below.
        </p>
      ` : ''}
    </section>` : ''}

    ${micro?.aeoStrategy?.show && (micro.aeoStrategy?.priorities?.length || micro.aeoStrategy?.zeroOpportunity) ? `
    <section>
      <h2>Next Month's Strategy</h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:14px;">Based on emerging wins and zero-visibility category terms — these are the queries we're attacking next.</p>
      ${(micro.aeoStrategy.priorities || []).map((p, i) => `
        <div style="padding:18px;background:var(--surface);border:1px solid var(--border);border-left:4px solid ${p.tier === 'Quick Win' ? 'var(--green)' : p.tier === 'Grow Share' ? 'var(--orange)' : 'var(--accent)'};border-radius:10px;margin-bottom:12px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px;">
            Priority ${i + 1} — ${esc(p.tier || 'Strategy')}
          </div>
          <div style="font-size:18px;font-weight:600;margin-bottom:8px;">${esc(p.title || '')}</div>
          <p style="font-size:14px;color:var(--muted);margin-bottom:10px;">${esc(p.rationale || '')}</p>
          ${(p.tags || []).length ? `
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${p.tags.map(t => `<span style="padding:3px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:999px;font-size:11px;color:var(--muted);">${esc(t)}</span>`).join('')}
            </div>
          ` : ''}
        </div>
      `).join('')}
      ${micro.aeoStrategy.zeroOpportunity ? `
        <div style="padding:16px 20px;background:linear-gradient(135deg,rgba(200,240,96,.08),rgba(167,139,250,.04));border:1px solid rgba(200,240,96,.25);border-radius:10px;margin-top:14px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);margin-bottom:6px;">The 0% Terms — Biggest Opportunity</div>
          <p style="font-size:14px;">${esc(micro.aeoStrategy.zeroOpportunity)}</p>
        </div>
      ` : ''}
    </section>` : ''}

    ${probe.per_query?.length > 0 ? `
    <section>
      <h2>Query × Engine Visibility Detail</h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:14px;">Per-engine visibility for every probe query — the granular data behind the scores above.</p>
      <table class="data-table" style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);text-align:left;">
            <th style="padding:8px 10px;color:var(--muted);font-size:10px;text-transform:uppercase;">Query</th>
            <th style="padding:8px 10px;color:var(--muted);font-size:10px;text-transform:uppercase;">Engine</th>
            <th style="padding:8px 10px;text-align:center;color:var(--muted);font-size:10px;text-transform:uppercase;">Visibility</th>
            <th style="padding:8px 10px;text-align:center;color:var(--muted);font-size:10px;text-transform:uppercase;">Top-3 Rate</th>
            <th style="padding:8px 10px;text-align:center;color:var(--muted);font-size:10px;text-transform:uppercase;">Avg Pos</th>
            <th style="padding:8px 10px;color:var(--muted);font-size:10px;text-transform:uppercase;">Sentiment</th>
          </tr>
        </thead>
        <tbody>
          ${probe.per_query
            .filter(r => !r.error)
            .slice()
            .sort((a, b) => (b.visibility || 0) - (a.visibility || 0))
            .map(r => {
              const v = r.visibility ?? (r.mentioned ? 100 : 0);
              const visColour = v >= 70 ? 'var(--green)' : v >= 30 ? 'var(--orange)' : 'var(--muted)';
              return `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:6px 10px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.query)}</td>
                <td style="padding:6px 10px;">${esc(r.engine_label || r.engine)}</td>
                <td style="padding:6px 10px;text-align:center;color:${visColour};font-weight:600;">${v}%</td>
                <td style="padding:6px 10px;text-align:center;color:var(--muted);">${r.top3_rate != null ? r.top3_rate + '%' : '—'}</td>
                <td style="padding:6px 10px;text-align:center;color:var(--muted);">${r.avg_position != null ? '#' + r.avg_position : '—'}</td>
                <td style="padding:6px 10px;color:${r.sentiment === 'positive' ? 'var(--accent)' : r.sentiment === 'negative' ? 'var(--red)' : 'var(--muted)'};">${r.hits ? (r.sentiment || '—') : '—'}</td>
              </tr>`;
            }).join('')}
        </tbody>
      </table>
    </section>` : ''}

    ${micro?.whatNext ? `
    <section>
      <h2>What's Next</h2>
      <div class="next">${esc(micro.whatNext)}</div>
    </section>` : ''}

    ${traffic.current ? `
    <section>
      <h2>Organic Performance — Detailed Comparison</h2>
      <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);text-align:left;">
            <th style="padding:10px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em;">Metric</th>
            <th style="padding:10px;text-align:right;color:var(--muted);font-size:11px;text-transform:uppercase;">This Month</th>
            <th style="padding:10px;text-align:right;color:var(--muted);font-size:11px;text-transform:uppercase;">Prev Month</th>
            <th style="padding:10px;text-align:right;color:var(--muted);font-size:11px;text-transform:uppercase;">MoM Change</th>
            <th style="padding:10px;text-align:right;color:var(--muted);font-size:11px;text-transform:uppercase;">Same Month LY</th>
            <th style="padding:10px;text-align:right;color:var(--muted);font-size:11px;text-transform:uppercase;">YoY Change</th>
          </tr>
        </thead>
        <tbody>
          ${['users', 'sessions', 'conversions'].concat(isEcom ? ['revenue'] : []).map(key => {
            const labels = { users: 'Organic Users', sessions: 'Organic Sessions', conversions: isEcom ? 'Transactions' : 'Conversions (Leads)', revenue: 'Revenue' };
            const cur = traffic.current?.[key] || 0;
            const prev = traffic.previous?.[key] || 0;
            const yoy = traffic.yoy?.[key] || 0;
            const momPct = traffic.momChange?.[key];
            const yoyPct = traffic.yoyChange?.[key];
            const fmtN = n => Number(n).toLocaleString();
            const arrow = v => v == null ? '—' : v > 0 ? '<span style="color:var(--green);">▲ ' + Math.abs(v) + '%</span>' : v < 0 ? '<span style="color:var(--red);">▼ ' + Math.abs(v) + '%</span>' : '—';
            return `<tr style="border-bottom:1px solid var(--border);">
              <td style="padding:10px;font-weight:600;">${labels[key] || key}</td>
              <td style="padding:10px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:12px;">${key === 'revenue' ? 'R' : ''}${fmtN(cur)}</td>
              <td style="padding:10px;text-align:right;color:var(--muted);">${key === 'revenue' ? 'R' : ''}${fmtN(prev)}</td>
              <td style="padding:10px;text-align:right;">${arrow(momPct)}</td>
              <td style="padding:10px;text-align:right;color:var(--muted);">${key === 'revenue' ? 'R' : ''}${fmtN(yoy)}</td>
              <td style="padding:10px;text-align:right;">${arrow(yoyPct)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>` : ''}

    ${(rd.keywords || []).length > 0 ? renderKeywordSections(rd) : ''}

    ${(rd.topPages || []).length > 0 ? `
    <section>
      <h2>Top Pages by Organic Clicks</h2>
      <table class="data-table" style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);text-align:left;">
            <th style="padding:8px 10px;color:var(--muted);font-size:10px;text-transform:uppercase;">Page</th>
            <th style="padding:8px 10px;text-align:right;color:var(--muted);font-size:10px;text-transform:uppercase;">Clicks</th>
            <th style="padding:8px 10px;text-align:right;color:var(--muted);font-size:10px;text-transform:uppercase;">Impressions</th>
            <th style="padding:8px 10px;text-align:right;color:var(--muted);font-size:10px;text-transform:uppercase;">Avg Position</th>
          </tr>
        </thead>
        <tbody>
          ${rd.topPages.map(p => {
            let path = p.page;
            try { path = new URL(p.page).pathname; } catch {}
            return `<tr style="border-bottom:1px solid var(--border);">
              <td style="padding:6px 10px;font-family:'JetBrains Mono',monospace;font-size:11px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(path)}</td>
              <td style="padding:6px 10px;text-align:right;">${Number(p.clicks).toLocaleString()}</td>
              <td style="padding:6px 10px;text-align:right;">${Number(p.impressions).toLocaleString()}</td>
              <td style="padding:6px 10px;text-align:right;">${p.position}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>` : ''}

    <footer>
      <div class="logo">SYTE</div>
      <div>hello@syte.co.za &middot; syte.co.za</div>
      <div class="confidential">Confidential — Prepared for ${esc(client.name)} &middot; ${esc(monthLabel)}</div>
    </footer>
  </div>
</body>
</html>`;
}

export function downloadMicrosite(html, filename) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
