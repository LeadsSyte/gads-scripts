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

// micro: parsed microsite JSON from Claude, client: full client record,
// monthLabel: e.g. "April 2026", rankscale: optional share URL.
export function buildMicrositeHtml({ micro, client, monthLabel, rankscale }) {
  const aeo = micro?.aeoSection || {};
  const showAeo = !!aeo.show;
  const ppc = micro?.ppcEquivalent || {};
  const showPpc = !!ppc.show;
  const work = micro?.workDone || {};
  const showWork = !!work.show && (work.items || []).length > 0;

  const highlights = (micro?.highlights || []).map(h => `
    <div class="metric">
      <div class="metric-val">${esc(h.value)}</div>
      <div class="metric-label">${esc(h.label)}</div>
      <div class="metric-delta ${h.positive ? 'pos' : 'neg'}">${esc(h.delta || '')}</div>
    </div>
  `).join('');

  const topPages = (micro?.topPages || []).map(p => `
    <li>
      <span class="page-path">${esc(p.page)}</span>
      <span class="page-users">${esc(p.users)} users</span>
      <span class="page-delta">${esc(p.delta || '')}</span>
    </li>
  `).join('');

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
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0a0a0c;
    --surface: #111316;
    --surface-2: #191b1f;
    --border: #2a2a32;
    --text: #e8e8ed;
    --muted: #8b8b96;
    --accent: #a78bfa;
    --green: #34d399;
    --red: #ff4d4d;
    --orange: #ff9f43;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--text);
    font-family: 'DM Sans', system-ui, sans-serif;
    line-height: 1.55; font-size: 15px;
  }
  h1, h2, h3 { font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; letter-spacing: -0.01em; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 48px 24px; }
  .logo { font-family: 'Instrument Serif', serif; font-size: 22px; letter-spacing: .08em; text-transform: uppercase; }
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
  .metric-val { font-family: 'Instrument Serif', serif; font-size: 36px; line-height: 1; }
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
    font-family: 'Instrument Serif', serif; font-size: 88px; line-height: 1;
  }
  .aeo-score-delta { color: var(--muted); font-size: 14px; }
  .engines { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 20px 0; }
  .engine-tile { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
  .engine-name { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  .engine-score { font-family: 'Instrument Serif', serif; font-size: 28px; margin: 4px 0 8px; }
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
  .ppc-value { font-family: 'Instrument Serif', serif; font-size: 48px; color: var(--green); line-height: 1; }
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

    ${micro?.whatNext ? `
    <section>
      <h2>What's Next</h2>
      <div class="next">${esc(micro.whatNext)}</div>
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
