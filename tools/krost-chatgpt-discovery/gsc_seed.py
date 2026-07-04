"""GSC-seeded prompt source.

The synthetic prompt generator (prompts.py) is useful for coverage but
it's still guessing what people might ask. Far better signal: take the
queries the brand ALREADY ranks for on Google — they're real searches
by real people — and test each against ChatGPT.

Workflow:

  1. Operator exports Search Console performance → CSV (Query, Clicks,
     Impressions, CTR, Position).
  2. We load it, filter to queries with material impressions / clicks
     and position <= some threshold, and take the top N.
  3. Each keyword gets wrapped in a small set of natural-sentence
     templates so it reads like real ChatGPT input (passing the bare
     keyword is the trap the user explicitly called out).
  4. Run + analyse with the same downstream pipeline as the synthetic
     mode.

Output: same GeneratedPrompt objects, so runner / analyzer / report
don't have to know which source produced them. The `template_id` is
prefixed with `gsc-` so reports can group by source if needed.
"""

from __future__ import annotations

import csv
import hashlib
from dataclasses import dataclass
from io import StringIO
from pathlib import Path

from prompts import GeneratedPrompt


# Templates used to wrap each GSC keyword. Each one frames the seed as a
# question a human would actually ask ChatGPT — never the bare keyword.
# Aim for 2-3 framings per keyword so we get coverage of recommendation,
# comparison, and trust intent without exploding into N×N combinations.
GSC_WRAPPERS: list[tuple[str, str]] = [
    ("gsc-recommend",   "Who are the best companies for {kw} in {market}?"),
    ("gsc-shortlist",   "I'm researching {kw} in {market} — which suppliers should I shortlist?"),
    ("gsc-buyers-help", "I'm looking for {kw}. Recommend a few reputable companies and explain how they differ."),
]


@dataclass(frozen=True)
class GscRow:
    query: str
    clicks: int
    impressions: int
    position: float


def parse_gsc_export(path: str | Path | StringIO) -> list[GscRow]:
    """Parse a Search Console performance CSV. GSC's export uses a
    locale-formatted Position column ('1.5' or '1,5'); we accept both.
    Required columns: Query, Clicks, Impressions, Position. CTR is
    ignored (we don't use it)."""
    rows: list[GscRow] = []
    f = path if hasattr(path, "read") else open(path, newline="", encoding="utf-8-sig")
    try:
        reader = csv.DictReader(f)
        # GSC exports vary slightly between regions and the new vs old UI.
        # Match column names case-insensitively and tolerate whitespace.
        cols = {k.lower().strip(): k for k in (reader.fieldnames or [])}
        col_q   = cols.get("query") or cols.get("top queries") or cols.get("search query")
        col_c   = cols.get("clicks")
        col_i   = cols.get("impressions")
        col_p   = cols.get("position") or cols.get("avg position") or cols.get("average position")
        if not (col_q and col_c and col_i and col_p):
            raise ValueError(
                "GSC export must include Query, Clicks, Impressions, Position columns. "
                f"Found: {list(reader.fieldnames or [])}"
            )
        for r in reader:
            try:
                rows.append(GscRow(
                    query=(r[col_q] or "").strip(),
                    clicks=_to_int(r[col_c]),
                    impressions=_to_int(r[col_i]),
                    position=_to_float(r[col_p]),
                ))
            except Exception:
                # Skip malformed rows rather than blow up the run.
                continue
    finally:
        if not hasattr(path, "read"):
            f.close()
    return [r for r in rows if r.query]


def _to_int(v) -> int:
    s = str(v or "").replace(",", "").replace(" ", "").strip()
    return int(float(s)) if s else 0


def _to_float(v) -> float:
    s = str(v or "").replace(",", ".").strip()
    return float(s) if s else 0.0


def select_seeds(rows: list[GscRow], *,
                 min_impressions: int = 50,
                 max_position: float = 30.0,
                 top_n: int = 200) -> list[GscRow]:
    """Filter + rank GSC rows to the queries worth testing.

    Defaults: at least 50 impressions, ranking somewhere on the first
    three pages (pos <= 30), top 200 by impressions. Caller can override
    via CLI flags.

    The point of these defaults is to skip noise (long-tail one-off
    queries) while keeping head terms the brand has any presence on.
    """
    eligible = [r for r in rows
                if r.impressions >= min_impressions and r.position and r.position <= max_position]
    eligible.sort(key=lambda r: r.impressions, reverse=True)
    return eligible[:top_n]


def seeds_to_prompts(seeds: list[GscRow], market: str) -> list[GeneratedPrompt]:
    """Wrap each seed keyword in every GSC_WRAPPERS template, dedupe, and
    return as GeneratedPrompt objects so the runner doesn't care which
    source produced them."""
    seen: set[str] = set()
    out: list[GeneratedPrompt] = []
    for s in seeds:
        for tid, tmpl in GSC_WRAPPERS:
            text = tmpl.format(kw=s.query.strip(), market=market)
            if text in seen:
                continue
            seen.add(text)
            out.append(GeneratedPrompt(
                template_id=tid,
                category=None,
                persona=None,
                city=None,
                text=text,
            ))
    return out


def fingerprint(seeds: list[GscRow]) -> str:
    """A short hash over the seed set — written to the SQLite cache so we
    can tell whether a re-run pulled in new keywords vs a pure re-test."""
    h = hashlib.sha256()
    for s in seeds:
        h.update((s.query + "|").encode("utf-8"))
    return h.hexdigest()[:12]
