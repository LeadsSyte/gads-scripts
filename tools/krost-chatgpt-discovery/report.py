"""Single-file dark-theme HTML report.

Self-contained — no external JS frameworks, no CDN dependencies beyond
Google Fonts (Syte aesthetic: DM Serif Display + DM Sans, accent
#c8f060 on #0c0c0e). One small inline JS block powers the raw-data
table filter; everything else is static HTML.
"""

from __future__ import annotations

import html
import json
from collections import defaultdict
from pathlib import Path


def _esc(s) -> str:
    if s is None:
        return ""
    return html.escape(str(s))


def render(*, target_brand: str, market: str, summary: dict,
           cache, prompts: list, out_path: str | Path,
           csv_path: str | Path | None = None,
           jsonl_path: str | Path | None = None) -> None:
    """Write the HTML report to `out_path`. Optionally also write
    prompts.csv + responses.jsonl for manual review."""
    per_prompt: dict = summary["per_prompt"]
    competitor_counts: dict[str, int] = summary["competitor_counts"]

    # Hydrate each prompt summary with its per-run analyses + first response
    # excerpt so the raw table can show context without re-querying.
    rows = []
    for key, s in per_prompt.items():
        p = s["prompt"]
        responses = cache.get_responses(p.key)
        first_text = responses[0]["response_text"] if responses else ""
        rows.append({
            **s,
            "key": key,
            "text": p.text,
            "first_response": first_text[:600],
            "n_responses": len(responses),
        })

    wins = sorted([r for r in rows if r["is_win"]], key=lambda r: -r["mention_rate"])
    gaps = sorted([r for r in rows if r["is_gap"]],
                  key=lambda r: (-len(r["competitors_mentioned"]), -r["runs"]))
    citation_wins = sorted([r for r in rows if r["is_citation_win"]],
                           key=lambda r: -r["citations"])
    by_category: dict[str, list] = defaultdict(list)
    for r in rows:
        by_category[r["category"] or "(other)"].append(r)
    category_stats = []
    for cat, rs in by_category.items():
        total = len(rs)
        wins_in = sum(1 for r in rs if r["is_win"])
        category_stats.append({
            "category": cat,
            "total": total,
            "wins": wins_in,
            "win_rate": round(wins_in / total * 100, 1) if total else 0.0,
        })
    category_stats.sort(key=lambda c: -c["win_rate"])

    competitor_share = sorted(
        [(name, count) for name, count in competitor_counts.items() if count > 0],
        key=lambda x: -x[1],
    )

    # ---------- HTML ----------
    css = _CSS
    js = _JS

    bars_html = _competitor_bars(competitor_share, target_brand=target_brand,
                                 target_count=sum(1 for r in rows if r["is_win"]))

    cat_html = "".join(
        f"""<tr>
            <td>{_esc(c['category'])}</td>
            <td class="num">{c['total']}</td>
            <td class="num">{c['wins']}</td>
            <td class="num"><span class="winrate" style="--p:{c['win_rate']}">{c['win_rate']}%</span></td>
        </tr>""" for c in category_stats
    )

    wins_html = _row_table(wins, mode="wins")
    gaps_html = _row_table(gaps, mode="gaps")
    citation_html = _row_table(citation_wins, mode="citations")
    raw_html = _raw_table(rows)

    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{_esc(target_brand)} — ChatGPT Discovery</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>{css}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">SYTE</div>
    <h1>{_esc(target_brand)} — ChatGPT discovery</h1>
    <p class="sub">Where ChatGPT recommends {_esc(target_brand)} vs the field, across {len(rows)} probe prompts in {_esc(market)}.</p>
    <div class="topstats">
      <div class="stat"><div class="num">{sum(1 for r in rows if r['is_win'])}</div><div class="lab">Wins</div></div>
      <div class="stat"><div class="num">{sum(1 for r in rows if r['is_gap'])}</div><div class="lab">Gaps</div></div>
      <div class="stat"><div class="num">{sum(1 for r in rows if r['is_citation_win'])}</div><div class="lab">Citation wins</div></div>
      <div class="stat"><div class="num">{len(rows)}</div><div class="lab">Total prompts</div></div>
    </div>
  </header>

  <section>
    <h2>Wins</h2>
    <p class="muted">Prompts where ChatGPT mentioned {_esc(target_brand)} at least once across the runs. Sorted by mention rate.</p>
    {wins_html}
  </section>

  <section>
    <h2>Gap prompts</h2>
    <p class="muted">Competitors got recommended; you didn't. Highest-value content targets — sorted by competitor count then run depth.</p>
    {gaps_html}
  </section>

  <section>
    <h2>Citation wins</h2>
    <p class="muted">Prompts where ChatGPT actually cited <span class="mono">{_esc(target_brand)}</span>'s domain as a source URL. Gold-tier signal.</p>
    {citation_html if citation_wins else '<p class="muted small">No citation wins yet — this is the highest-value gap to close.</p>'}
  </section>

  <section>
    <h2>Competitor share of voice</h2>
    <p class="muted">Mention counts across every prompt run.</p>
    {bars_html}
  </section>

  <section>
    <h2>Topic clusters</h2>
    <p class="muted">Win rate per category.</p>
    <table class="data">
      <thead><tr><th>Category</th><th class="num">Prompts</th><th class="num">Wins</th><th class="num">Win rate</th></tr></thead>
      <tbody>{cat_html}</tbody>
    </table>
  </section>

  <section>
    <h2>Raw data</h2>
    <p class="muted">Every prompt + verdict. Filter live.</p>
    <input id="filter" type="text" placeholder="Filter by prompt, competitor, category…" />
    {raw_html}
  </section>

  <footer>
    <p class="muted small">Generated by krost-chatgpt-discovery — Syte Digital Agency</p>
  </footer>
</div>
<script>{js}</script>
</body>
</html>"""

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")

    if csv_path:
        _write_csv(csv_path, rows)
    if jsonl_path:
        _write_jsonl(jsonl_path, rows, cache)


def _row_table(rows, *, mode: str) -> str:
    if not rows:
        return '<p class="muted small">Nothing here yet.</p>'
    head = """<table class="data">
      <thead><tr>
        <th>Prompt</th>
        <th>Category</th>
        <th class="num">Runs</th>
        <th class="num">Mention rate</th>
        <th class="num">Citations</th>
        <th>Competitors mentioned</th>
        <th>Sentiment</th>
      </tr></thead><tbody>"""
    body = []
    for r in rows:
        body.append(
            f"""<tr>
              <td class="prompt">{_esc(r['text'])}</td>
              <td>{_esc(r['category']) or '<span class="muted small">—</span>'}</td>
              <td class="num">{r['runs']}</td>
              <td class="num"><span class="winrate" style="--p:{r['mention_rate']}">{r['mention_rate']}%</span></td>
              <td class="num">{r['citations']}</td>
              <td>{_esc(', '.join(r['competitors_mentioned']))}</td>
              <td><span class="sent {r['sentiment']}">{_esc(r['sentiment'])}</span></td>
            </tr>"""
        )
    return head + "".join(body) + "</tbody></table>"


def _competitor_bars(items: list[tuple[str, int]], *, target_brand: str, target_count: int) -> str:
    """Render competitor mention counts as a horizontal bar chart. The
    target brand gets included so the operator sees their own share
    relative to the field."""
    all_items = [(target_brand + " (you)", target_count)] + items
    if not all_items or all(c == 0 for _, c in all_items):
        return '<p class="muted small">No mentions detected yet.</p>'
    max_c = max(c for _, c in all_items) or 1
    rows = []
    for name, count in all_items:
        pct = round(count / max_c * 100, 1)
        is_target = name.endswith(" (you)")
        rows.append(
            f"""<div class="bar-row">
              <span class="bar-name {'me' if is_target else ''}">{_esc(name)}</span>
              <div class="bar-track"><div class="bar-fill {'me' if is_target else ''}" style="width:{pct}%"></div></div>
              <span class="bar-count">{count}</span>
            </div>"""
        )
    return '<div class="bars">' + "".join(rows) + "</div>"


def _raw_table(rows) -> str:
    head = """<table class="data raw">
      <thead><tr>
        <th>Prompt</th>
        <th>Category</th>
        <th>Persona</th>
        <th class="num">Runs</th>
        <th class="num">Mention rate</th>
        <th class="num">Cited</th>
        <th>Competitors</th>
        <th>Excerpt</th>
      </tr></thead><tbody>"""
    body = []
    for r in rows:
        searchable = " ".join([
            r["text"], r.get("category") or "", r.get("persona") or "",
            ", ".join(r["competitors_mentioned"]),
            r.get("first_response") or "",
        ]).lower()
        body.append(
            f"""<tr data-search="{_esc(searchable)}">
              <td class="prompt">{_esc(r['text'])}</td>
              <td>{_esc(r['category']) or ''}</td>
              <td>{_esc(r['persona']) or ''}</td>
              <td class="num">{r['runs']}</td>
              <td class="num"><span class="winrate" style="--p:{r['mention_rate']}">{r['mention_rate']}%</span></td>
              <td class="num">{r['citations']}</td>
              <td>{_esc(', '.join(r['competitors_mentioned']))}</td>
              <td class="excerpt">{_esc((r['first_response'] or '')[:240])}{'…' if r.get('first_response') and len(r['first_response']) > 240 else ''}</td>
            </tr>"""
        )
    return head + "".join(body) + "</tbody></table>"


def _write_csv(path, rows) -> None:
    import csv
    p = Path(path); p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "prompt_text", "template_id", "category", "persona", "city",
            "runs", "mention_rate_pct", "mentions", "citations",
            "is_win", "is_gap", "is_citation_win",
            "competitors_mentioned", "sentiment",
        ])
        for r in rows:
            w.writerow([
                r["text"], r["template_id"], r.get("category"), r.get("persona"), r.get("city"),
                r["runs"], r["mention_rate"], r["mentions"], r["citations"],
                int(r["is_win"]), int(r["is_gap"]), int(r["is_citation_win"]),
                "; ".join(r["competitors_mentioned"]), r["sentiment"],
            ])


def _write_jsonl(path, rows, cache) -> None:
    p = Path(path); p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        for r in rows:
            responses = cache.get_responses(r["key"])
            f.write(json.dumps({
                "prompt_key": r["key"],
                "prompt_text": r["text"],
                "category": r.get("category"),
                "persona": r.get("persona"),
                "verdict": {
                    "runs": r["runs"],
                    "mention_rate_pct": r["mention_rate"],
                    "mentions": r["mentions"],
                    "citations": r["citations"],
                    "is_win": r["is_win"],
                    "is_gap": r["is_gap"],
                    "is_citation_win": r["is_citation_win"],
                    "competitors_mentioned": r["competitors_mentioned"],
                    "sentiment": r["sentiment"],
                },
                "responses": responses,
            }, ensure_ascii=False) + "\n")


# Inline assets — kept at the bottom so the render fn reads top-down.

_CSS = """
:root {
  --bg: #0c0c0e; --surface: #15151a; --surface-2: #1d1d24;
  --border: #2a2a33; --text: #f5f5f7; --muted: #9a9aa6;
  --accent: #c8f060; --green: #4ade80; --red: #f87171; --orange: #fbbf24;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg); color: var(--text); font-family: 'DM Sans', system-ui, sans-serif; line-height: 1.55; font-size: 15px; }
h1, h2 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; letter-spacing: -0.01em; }
.wrap { max-width: 1280px; margin: 0 auto; padding: 48px 28px; }
header { padding-bottom: 28px; border-bottom: 1px solid var(--border); margin-bottom: 36px; }
.brand { font-size: 14px; font-weight: 800; letter-spacing: 0.18em; color: var(--accent); }
header h1 { font-size: 42px; margin: 12px 0 6px; }
.sub { color: var(--muted); font-size: 16px; max-width: 720px; }
.topstats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 22px; }
.stat { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
.stat .num { font-family: 'DM Serif Display', serif; font-size: 32px; line-height: 1; color: var(--accent); }
.stat .lab { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; margin-top: 6px; }
section { margin-top: 40px; padding-bottom: 28px; border-bottom: 1px solid var(--border); }
section h2 { font-size: 26px; margin-bottom: 6px; }
.muted { color: var(--muted); }
.muted.small { font-size: 12px; }
.mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
table.data { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
table.data th, table.data td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
table.data th { color: var(--muted); font-weight: 500; text-transform: uppercase; font-size: 10px; letter-spacing: .06em; }
table.data td.num, table.data th.num { text-align: right; font-family: 'JetBrains Mono', ui-monospace, monospace; }
.prompt { max-width: 480px; }
.excerpt { color: var(--muted); font-size: 12px; max-width: 360px; }
.winrate { display: inline-block; min-width: 56px; text-align: right; padding: 2px 10px; border-radius: 999px; background: linear-gradient(90deg, color-mix(in srgb, var(--accent) calc(var(--p) * 1%), var(--surface-2)), var(--surface-2)); color: #0a0a0c; font-weight: 600; }
.sent { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.sent.positive { background: rgba(74,222,128,.15); color: var(--green); }
.sent.neutral  { background: rgba(154,154,166,.15); color: var(--muted); }
.sent.negative { background: rgba(248,113,113,.15); color: var(--red); }
.sent.n\\/a    { background: rgba(154,154,166,.08); color: var(--muted); opacity: .6; }
.bars { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.bar-row { display: grid; grid-template-columns: 240px 1fr 60px; align-items: center; gap: 12px; }
.bar-name { font-size: 13px; }
.bar-name.me { color: var(--accent); font-weight: 700; }
.bar-track { height: 10px; background: var(--surface-2); border-radius: 5px; overflow: hidden; }
.bar-fill { height: 100%; background: var(--muted); }
.bar-fill.me { background: var(--accent); }
.bar-count { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; color: var(--muted); text-align: right; }
input#filter { width: 100%; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: inherit; font-size: 14px; margin-top: 12px; }
input#filter:focus { outline: 1px solid var(--accent); }
footer { padding: 28px 0 12px; }
"""

_JS = """
(function() {
  const input = document.getElementById('filter');
  if (!input) return;
  const rows = document.querySelectorAll('table.raw tbody tr');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    rows.forEach(r => {
      const hay = r.getAttribute('data-search') || '';
      r.style.display = (!q || hay.includes(q)) ? '' : 'none';
    });
  });
})();
"""
