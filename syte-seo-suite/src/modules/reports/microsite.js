// Generate a self-contained, downloadable HTML string for the client
// monthly report microsite. No external JS, only Google Fonts via CDN.

import { stripDashes } from './sanitize.js';

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
    sectionTable(buckets.top3,     'Top 3 Rankings',     `All ${buckets.counts.top3} keywords ranking in positions 1-3 on Google. Head terms first, then by impressions.`, 'var(--green)', 200),
    sectionTable(buckets.top10,    'Top 10 Rankings',    `All ${buckets.counts.top10} keywords on page 1 (positions 4-10). Head terms flagged.`, 'var(--accent)', 200),
    sectionTable(buckets.improved, 'Most Improved',      `${buckets.counts.improved} keywords with position gains of 0.5+ vs last month. Sorted by improvement size.`, 'var(--green)', 150),
    sectionTable(buckets.striking, 'Striking Distance',  `${buckets.counts.striking} page-2 keywords (positions 11-20) — the queries closest to breaking into the top 10. Highest-impact next push.`, 'var(--orange)', 100),
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

  // House rule: strip every em/en dash from the final client-facing HTML.
  return stripDashes(`<!DOCTYPE html>
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
      <h2>AI Visibility: Headline Metrics</h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">
        Probed ${probe.engines_used?.length || 0} AI engine${(probe.engines_used?.length || 0) > 1 ? 's' : ''}
        (${(probe.engines_used || []).join(', ')}) across ${probe.scorable_probes || probe.queries_count || new Set(probe.per_query.map(r => r.query)).size} buyer prompts × ${probe.iterations || 1} iterations = ${probe.total_runs || probe.per_query.length} total responses.
      </p>
      ${(probe.mentions || 0) === 0 && (probe.citations || 0) === 0 && !cmp?.has_previous ? `
      <!-- No signal yet → reframe as "Establishing baseline" rather than blasting six big "0%" panels at the client (which reads as a doom report even though it's a brand-new measurement). The detail table below still shows every query that was probed. -->
      <div style="padding:24px;background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:20px;border-left:4px solid var(--accent);">
        <div style="font-family:'DM Serif Display',serif;font-size:24px;line-height:1.2;color:var(--text);margin-bottom:8px;">
          Establishing the AI-visibility baseline
        </div>
        <p style="color:var(--muted);font-size:13px;margin:0;line-height:1.55;">
          This is the first month of AEO measurement. We probed ${probe.queries_count || new Set(probe.per_query.map(r => r.query)).size} category-demand queries across ${probe.engines_used?.length || 0} engines and the brand isn't yet surfacing in answers — that's normal at month one and tells us exactly which queries are open opportunities. Next month's report will compare against this baseline so you can see momentum.
        </p>
      </div>` : `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:20px;">
        ${[
          { label: 'Named In', value: `${probe.prompt_coverage ?? 0} of ${probe.scorable_probes ?? (probe.queries_count || 0)}`, sub: 'buyer prompts', delta: cmp?.deltas?.coverage, deltaSuffix: 'pp' },
          { label: 'Coverage Rate',   value: Math.round((probe.coverage_rate ?? 0) * 100) + '%', delta: cmp?.deltas?.coverage,   deltaSuffix: 'pp' },
          { label: 'Share of Voice',  value: (probe.share_of_voice ?? 0) + '%',    delta: null },
          { label: 'AEO Index',       value: String(probe.composite_index ?? probe.overall_score ?? 0), delta: cmp?.deltas?.composite, deltaSuffix: '' },
          { label: 'Citations',       value: fmt(probe.citations),                 delta: cmp?.deltas?.citations,  deltaSuffix: '' },
          { label: 'Sentiment',       value: (probe.sentiment_score ?? 0) + '%',   delta: cmp?.deltas?.sentiment,  deltaSuffix: 'pp' }
        ].map(m => `
          <div style="padding:18px;background:var(--surface);border:1px solid var(--border);border-radius:12px;">
            <div style="font-family:'DM Serif Display',serif;font-size:36px;line-height:1;color:var(--accent);">${m.value}</div>
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-top:6px;">${m.label}</div>
            ${m.delta ? `<div style="font-size:12px;margin-top:4px;">${fmtDelta(m.delta, m.deltaSuffix)}</div>` : ''}
          </div>
        `).join('')}
      </div>
      ${cmp?.has_previous ? `<p style="color:var(--muted);font-size:12px;font-style:italic;">Deltas vs ${esc(previousMonthLabel || cmp.previous_month || 'last month')}</p>` : '<p style="color:var(--muted);font-size:12px;font-style:italic;">First snapshot — this is the baseline. MoM deltas appear from next month.</p>'}`}
      ${micro?.aeoMomNarrative ? `<p class="narrative" style="margin-top:14px;">${esc(micro.aeoMomNarrative)}</p>` : ''}
      ${(() => {
        // Surface per-engine health when any engine errored across runs —
        // otherwise the report quietly omits failed engines (engineScores
        // = 0%) and the operator can't tell a real "no mentions" from a
        // "ChatGPT 404'd on every iteration" until they cross-check the
        // raw probe.
        const eh = probe.engine_health || {};
        const failing = Object.entries(eh).filter(([, h]) => h.errors > 0);
        if (!failing.length) return '';
        return `<div style="margin-top:14px;padding:12px 14px;border:1px solid color-mix(in srgb,var(--orange) 40%,var(--border));border-left:3px solid var(--orange);background:color-mix(in srgb,var(--orange) 8%,var(--surface-2));border-radius:8px;font-size:12px;">
          <strong style="color:var(--orange);">Engine probe failures:</strong>
          <ul style="margin:6px 0 0 18px;padding:0;">
            ${failing.map(([id, h]) => `
              <li style="margin-bottom:4px;">
                <strong>${esc(h.label || id)}</strong> — ${h.errors}/${h.runs} iterations failed${h.all_failed ? ' <span style="color:var(--red);">(every iteration)</span>' : ''}
                ${h.sample_error ? `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted);margin-top:2px;">${esc(h.sample_error)}</div>` : ''}
              </li>
            `).join('')}
          </ul>
          <div style="color:var(--muted);font-size:11px;margin-top:6px;">
            Visibility for the failing engine(s) reads as 0% in the tables below — those rows reflect probe errors, not real "no mentions" results.
          </div>
        </div>`;
      })()}
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

    ${(() => {
      const named = (probe.per_query || []).filter(r => r.mentioned && ((r.segment_labels || []).length || r.reason));
      if (!named.length) return '';
      named.sort((a, b) => (b.visibility || 0) - (a.visibility || 0));
      const seen = new Set();
      const items = [];
      for (const r of named) {
        for (const label of (r.segment_labels || [])) {
          const key = label.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          items.push({ label, query: r.query, engine: r.engine_label || r.engine, reason: r.reason });
        }
        if (items.length >= 10) break;
      }
      if (!items.length) return '';
      return `
    <section>
      <h2>How AI Engines Describe You</h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:14px;">The exact segments the AI engines place ${esc(client.name)} in when they recommend you. These are the angles you already win, in the engine's own words.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">
        ${items.map(it => `
          <div style="padding:14px 16px;background:var(--surface);border:1px solid rgba(74,222,128,.25);border-left:3px solid var(--green);border-radius:8px;">
            <div style="font-size:14px;font-weight:600;color:var(--text);">${esc(it.label)}</div>
            ${it.reason ? `<div style="font-size:12px;color:var(--muted);margin-top:6px;">${esc(it.reason)}</div>` : ''}
            <div style="font-size:11px;color:var(--muted);margin-top:8px;">${esc(it.engine)} · "${esc(it.query)}"</div>
          </div>
        `).join('')}
      </div>
    </section>`;
    })()}

    ${probe.citation_gaps?.length > 0 ? `
    <section>
      <h2>Citation Gaps: Where to Win Next</h2>
      <p style="color:var(--muted);font-size:13px;margin-bottom:14px;">
        Commercial prompts where ${esc(client.name)} was absent but competitors were cited. These sources are the growth plan, not a shortfall: earning a presence on them is how coverage grows.
      </p>
      ${micro?.citationGapsNarrative ? `<p class="narrative" style="margin-bottom:14px;">${esc(micro.citationGapsNarrative)}</p>` : ''}
      <table class="data-table" style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border);text-align:left;">
            <th style="padding:8px 10px;color:var(--muted);font-size:10px;text-transform:uppercase;">Source</th>
            <th style="padding:8px 10px;text-align:right;color:var(--muted);font-size:10px;text-transform:uppercase;">Hits</th>
            <th style="padding:8px 10px;color:var(--muted);font-size:10px;text-transform:uppercase;">Competitors surfaced</th>
            <th style="padding:8px 10px;color:var(--muted);font-size:10px;text-transform:uppercase;">Suggested action</th>
          </tr>
        </thead>
        <tbody>
          ${probe.citation_gaps.slice(0, 12).map(g => `<tr style="border-bottom:1px solid var(--border);">
            <td style="padding:6px 10px;font-weight:600;">${esc(g.domain)}</td>
            <td style="padding:6px 10px;text-align:right;font-family:'JetBrains Mono',monospace;">${g.hitCount}</td>
            <td style="padding:6px 10px;color:var(--muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc((g.competitors || []).slice(0, 3).join(', '))}</td>
            <td style="padding:6px 10px;color:var(--muted);">${esc(g.suggestedAction || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </section>` : ''}

    ${probe.per_query?.length > 0 ? (() => {
      // Every other table in this report is row-capped; this granular
      // detail table was not, so a saved snapshot with a large probe-query
      // list (queries × engines rows) produced a multi-hundred-row table.
      // Baked into the iframe srcDoc alongside everything else that was
      // enough to lock the tab on render. Cap it like its siblings and note
      // the remainder — the full per-query data lives in the AEO Snapshot.
      const MAX_DETAIL_ROWS = 200;
      const allRows = probe.per_query
        .filter(r => !r.error)
        .slice()
        .sort((a, b) => (b.visibility || 0) - (a.visibility || 0));
      const rows = allRows.slice(0, MAX_DETAIL_ROWS);
      const hidden = allRows.length - rows.length;
      return `
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
            <th style="padding:8px 10px;text-align:center;color:var(--muted);font-size:10px;text-transform:uppercase;">Avg. position when named</th>
            <th style="padding:8px 10px;color:var(--muted);font-size:10px;text-transform:uppercase;">Sentiment</th>
          </tr>
        </thead>
        <tbody>
          ${rows
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
      ${hidden > 0 ? `<p style="color:var(--muted);font-size:12px;margin-top:10px;">+${hidden} more query × engine rows — see the full AEO Snapshot for the complete set.</p>` : ''}
    </section>`;
    })() : ''}

    ${micro?.whatNext ? `
    <section>
      <h2>What's Next</h2>
      <div class="next">${esc(micro.whatNext)}</div>
    </section>` : ''}

    ${(() => {
      // Hide the detailed traffic comparison when both MoM and YoY for
      // organic users are negative — the report shouldn't lead with bad
      // news. The headline metrics + work done + AEO sections already
      // cover the positive story; this table is the deep-dive that gets
      // skipped on a doubly-down month.
      if (!traffic.current) return '';
      const momU = traffic.momChange?.users;
      const yoyU = traffic.yoyChange?.users;
      const bothDown = momU != null && yoyU != null && momU < 0 && yoyU < 0;
      if (bothDown) return '';
      return `
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
    </section>`;
    })()}

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
</html>`);
}

export function downloadMicrosite(html, filename) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Open the microsite in a new window with print-friendly CSS injected
// and trigger window.print(). The browser presents the standard "Save
// as PDF" destination so the user gets a clean PDF without needing a
// server-side renderer (puppeteer / wkhtmltopdf).
//
// The PDF is meant to look exactly like the on-screen HTML — we only
// add @page sizing, force colour preservation (Chrome strips background
// colours by default in print), and tighten page-break behaviour so
// cards / table rows don't split awkwardly across pages.
export function downloadMicrositePdf(html, filename) {
  const PRINT_CSS = `
    @page { size: A4; margin: 0; }
    @media print {
      /* Force every coloured surface to print — without this, Chrome
         drops the dark background and the report comes out white. */
      *, *::before, *::after {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      html, body {
        background: var(--bg) !important;
        color: var(--text) !important;
      }
      /* The microsite already has its own padding via .wrap — we just
         need to make sure the dark background extends to the page edges
         since we set @page margin to 0. */
      .wrap { padding: 18mm 14mm !important; }

      /* Page-break behaviour — keep cards / table rows together where
         possible so the document reads cleanly. */
      section, .card, .metric, .work-card, .ppc-card, .next, .engine-tile,
      .comp-row, footer { break-inside: avoid; page-break-inside: avoid; }
      h1, h2, h3 { break-after: avoid-page; page-break-after: avoid; }
      table { break-inside: auto; }
      tr { break-inside: avoid; break-after: auto; }
      thead { display: table-header-group; }
    }
  `;

  const titleTag = '<title>' + (filename || 'Report').replace(/\.pdf$/i, '') + '</title>';
  let prepared;
  if (html.includes('</head>')) {
    prepared = html.replace('</head>', '<style>' + PRINT_CSS + '</style>\n' + titleTag + '</head>');
  } else {
    prepared = '<style>' + PRINT_CSS + '</style>' + titleTag + html;
  }

  const win = window.open('', '_blank');
  if (!win) {
    // Pop-up blocked — fall back to downloading the HTML so the user can
    // open it in a new tab and Cmd/Ctrl+P themselves.
    downloadMicrosite(html, (filename || 'report').replace(/\.pdf$/i, '') + '.html');
    alert('Pop-up blocked. Saved the HTML version instead — open it and use the browser\'s Print → Save as PDF.');
    return;
  }
  win.document.open();
  win.document.write(prepared);
  win.document.close();

  // Wait for fonts + images to settle before triggering print.
  const triggerPrint = () => {
    try { win.focus(); win.print(); } catch {}
  };
  if (win.document.readyState === 'complete') {
    setTimeout(triggerPrint, 600);
  } else {
    win.addEventListener('load', () => setTimeout(triggerPrint, 600));
  }
}
