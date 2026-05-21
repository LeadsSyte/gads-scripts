"""Mention + citation detection, sentiment classification, response typing.

Two passes per response:

  1. Pure-string detection — fast, deterministic, no API cost. Detects
     target / competitor mentions, list position, citation URLs, and
     classifies the response shape (list vs narrative vs single-rec
     vs refusal).

  2. Sentiment classification — one cheap LLM call per response that
     mentions the brand. Skipped when the brand isn't present (sentiment
     would be N/A).
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from urllib.parse import urlparse

from openai import AsyncOpenAI, RateLimitError, APIError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)


@dataclass
class Verdict:
    target_mentioned: bool
    target_position: int | None
    target_cited_url: bool
    competitors_mentioned: list[str]
    response_type: str
    sentiment_toward_target: str  # "positive" | "neutral" | "negative" | "n/a"


def _word_boundary_pattern(name: str) -> re.Pattern:
    """Compile a case-insensitive word-boundary regex for `name`. Escaped
    so brand names with regex specials (`Krost (Pty) Ltd`) don't blow up."""
    return re.compile(r"\b" + re.escape(name) + r"\b", re.IGNORECASE)


def _domain(url: str) -> str:
    try:
        host = (urlparse(url).hostname or "").lower()
        return host.removeprefix("www.")
    except Exception:
        return ""


def _list_position(text: str, name_patterns: list[re.Pattern]) -> int | None:
    """If the response is a numbered or bulleted list, find the rank order
    of the FIRST mention of any alias. Returns None when not in a list."""
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
    rank = 0
    in_list = False
    for ln in lines:
        m_num = re.match(r"\s*(\d+)[\.\)]\s+", ln)
        m_bul = re.match(r"\s*[-•*]\s+", ln)
        if m_num or m_bul:
            in_list = True
            rank += 1
            for pat in name_patterns:
                if pat.search(ln):
                    return rank
    return None if not in_list else None


def _classify_response_type(text: str) -> str:
    t = text.strip()
    if not t:
        return "refusal"
    low = t.lower()
    if any(s in low for s in ("i'm sorry", "i can't", "i cannot", "i don't have", "as an ai")):
        # Refusal-shaped only when it dominates the whole answer (short).
        if len(t) < 400:
            return "refusal"
    # Numbered list with at least 3 items.
    nums = re.findall(r"(?m)^\s*\d+[\.\)]\s+", t)
    bullets = re.findall(r"(?m)^\s*[-•*]\s+", t)
    if len(nums) >= 3 or len(bullets) >= 3:
        return "list"
    if len(t) < 300 and (nums or bullets):
        return "single_recommendation"
    if len(t) < 300:
        return "single_recommendation"
    return "narrative"


def detect(response_text: str, citations: list[dict], *,
           target_aliases: list[str], target_domain: str,
           competitors: list[str]) -> Verdict:
    """Pure-string detection — no API call. Sentiment is filled in later."""
    text = response_text or ""

    target_patterns = [_word_boundary_pattern(a) for a in target_aliases if a]
    target_mentioned = any(p.search(text) for p in target_patterns)

    target_position = _list_position(text, target_patterns) if target_mentioned else None

    # Citation match — primary signal: URL list from Responses API.
    target_dom = _domain(target_domain) if target_domain else ""
    cited_urls = [c.get("url") or "" for c in (citations or [])]
    cited_in_links = any(
        target_dom and target_dom in _domain(u) for u in cited_urls
    )
    # Belt and braces: also check for the bare domain in the text body
    # (some responses inline URLs without the annotation).
    cited_in_text = bool(target_dom) and bool(re.search(re.escape(target_dom), text, re.IGNORECASE))
    target_cited_url = cited_in_links or cited_in_text

    competitors_mentioned = [c for c in competitors if _word_boundary_pattern(c).search(text)]

    response_type = _classify_response_type(text)

    return Verdict(
        target_mentioned=target_mentioned,
        target_position=target_position,
        target_cited_url=target_cited_url,
        competitors_mentioned=competitors_mentioned,
        response_type=response_type,
        sentiment_toward_target="n/a",  # filled in by classify_sentiment
    )


_SENTIMENT_SYSTEM = (
    "Classify the sentiment toward the named brand in the assistant text "
    "as exactly one of: positive, neutral, negative. Reply with only that "
    "single lowercase word — no punctuation, no explanation."
)


@retry(
    retry=retry_if_exception_type((RateLimitError, APIError)),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    stop=stop_after_attempt(4),
    reraise=True,
)
async def _classify_sentiment(client: AsyncOpenAI, *, text: str, brand: str, model: str) -> str:
    """One short call to the sentiment model. Defaults to neutral if
    parsing fails — better than blocking the report on a flaky string."""
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SENTIMENT_SYSTEM},
                {"role": "user", "content": f"Brand: {brand}\n\nText:\n{text[:4000]}"},
            ],
            max_tokens=4,
            temperature=0,
        )
        out = (resp.choices[0].message.content or "").strip().lower().split()[0]
        if out in ("positive", "neutral", "negative"):
            return out
    except Exception:
        pass
    return "neutral"


async def annotate_with_sentiment(client: AsyncOpenAI, *,
                                  verdicts: list[tuple[str, int, str, Verdict]],
                                  brand: str, model: str,
                                  concurrency: int = 5) -> None:
    """Mutates each Verdict where target_mentioned is True with the
    classifier's verdict. Verdicts where the brand isn't mentioned stay
    'n/a' — no API call burned."""
    sem = asyncio.Semaphore(concurrency)

    async def _one(text: str, v: Verdict):
        if not v.target_mentioned:
            return
        async with sem:
            v.sentiment_toward_target = await _classify_sentiment(client, text=text, brand=brand, model=model)

    await asyncio.gather(*[_one(text, v) for (_, _, text, v) in verdicts])


def aggregate(prompts: list, cache, *, target_aliases: list[str],
              target_domain: str, competitors: list[str]) -> dict:
    """Roll the cached per-run analyses up into a per-prompt summary the
    report module renders. Each prompt's `mention_rate` = mentioned-runs
    / total-runs, which is what the Wins / Gaps tables sort on."""
    summary = {}
    competitor_counts = {c: 0 for c in competitors}
    for p in prompts:
        analyses = cache.get_analyses(p.key)
        if not analyses:
            continue
        runs = len(analyses)
        mentioned = sum(1 for a in analyses if a["target_mentioned"])
        cited = sum(1 for a in analyses if a["target_cited_url"])
        positions = [a["target_position"] for a in analyses if a["target_position"]]
        comps_set = set()
        for a in analyses:
            for c in a["competitors_mentioned"]:
                comps_set.add(c)
                competitor_counts[c] = competitor_counts.get(c, 0) + 1
        # Dominant sentiment: most-frequent of the runs that mention.
        sents = [a["sentiment_toward_target"] for a in analyses
                 if a["target_mentioned"] and a["sentiment_toward_target"] != "n/a"]
        dominant_sent = max(set(sents), key=sents.count) if sents else "n/a"

        summary[p.key] = {
            "prompt": p,
            "runs": runs,
            "mention_rate": round(mentioned / runs * 100, 1),
            "mentions": mentioned,
            "citations": cited,
            "avg_position": round(sum(positions) / len(positions), 1) if positions else None,
            "competitors_mentioned": sorted(comps_set),
            "is_gap": (mentioned == 0 and len(comps_set) > 0),
            "is_win": mentioned > 0,
            "is_citation_win": cited > 0,
            "sentiment": dominant_sent,
            "category": p.category,
            "persona": p.persona,
            "city": p.city,
            "template_id": p.template_id,
        }
    return {
        "per_prompt": summary,
        "competitor_counts": competitor_counts,
    }
