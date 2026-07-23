"""Async runner — calls OpenAI's Responses API with the web_search tool
enabled and writes responses to the cache.

Why the Responses API and not Chat Completions:
  - The web_search tool is exposed natively on Responses (`tools=[{"type":
    "web_search_preview"}]`). Chat Completions can't enable it.
  - Responses returns structured `output[].content[].annotations` with
    URL citations attached, which is exactly what the analyzer needs to
    detect citation wins. Chat Completions only gives you free-text.

Cost guard: we estimate before running and require --confirm if estimated
spend exceeds the threshold in config.run.cost_confirm_threshold_usd.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any

from openai import AsyncOpenAI, RateLimitError, APIError, NotFoundError, BadRequestError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)


# Approximate per-call cost for the cost guard. These are deliberately
# conservative — better to over-warn than to surprise the operator with a
# bigger bill. Update when OpenAI changes pricing.
COST_PER_CALL_USD = {
    "gpt-5":           0.030,
    "gpt-4o":          0.020,
    "gpt-4o-mini":     0.002,
}


@dataclass
class RunResult:
    prompt_key: str
    run_index: int
    model: str
    response_text: str | None
    citations: list[dict]
    raw: dict | None
    error: str | None


def estimate_cost(prompts, iterations: int, model: str, sentiment_model: str) -> float:
    """Rough cost ≈ prompts × iterations × (per-call + sentiment-call)."""
    per_pair = COST_PER_CALL_USD.get(model, 0.02) + COST_PER_CALL_USD.get(sentiment_model, 0.002)
    return len(prompts) * iterations * per_pair


@retry(
    retry=retry_if_exception_type((RateLimitError, APIError)),
    wait=wait_exponential(multiplier=2, min=2, max=60),
    stop=stop_after_attempt(5),
    reraise=True,
)
async def _ask_with_search(client: AsyncOpenAI, *, model: str, prompt: str) -> dict:
    """Single Responses API call with web_search tool. Returns the raw
    `model_dump()` so the cache keeps everything for forensics."""
    resp = await client.responses.create(
        model=model,
        input=prompt,
        tools=[{"type": "web_search_preview"}],
    )
    return resp.model_dump()


def _extract_text_and_citations(raw: dict) -> tuple[str, list[dict]]:
    """Pull the assistant text + structured URL citations out of a
    Responses-API payload. The shape is `output: [{type, content: [{type,
    text, annotations: [{type:'url_citation', url, title, start_index,
    end_index}]}]}]`. We're defensive because OpenAI tweaks shapes."""
    text_parts: list[str] = []
    citations: list[dict] = []
    for item in raw.get("output", []) or []:
        for c in item.get("content", []) or []:
            if c.get("type") in ("output_text", "text"):
                t = c.get("text") or ""
                if t:
                    text_parts.append(t)
                for a in c.get("annotations", []) or []:
                    if a.get("type") == "url_citation":
                        citations.append({
                            "url": a.get("url"),
                            "title": a.get("title"),
                            "start": a.get("start_index"),
                            "end": a.get("end_index"),
                        })
    return ("\n".join(text_parts).strip(), citations)


class Runner:
    def __init__(self, *, api_key: str | None = None, model: str = "gpt-5",
                 fallback_model: str = "gpt-4o", concurrency: int = 10):
        self.client = AsyncOpenAI(api_key=api_key or os.environ.get("OPENAI_API_KEY"))
        self.model = model
        self.fallback_model = fallback_model
        self.sem = asyncio.Semaphore(concurrency)
        # Once the primary 404s for "model not available", flip to fallback
        # for the rest of the run instead of N more 404 round trips.
        self._effective_model = model

    async def run_one(self, prompt, *, run_index: int) -> RunResult:
        async with self.sem:
            model_to_use = self._effective_model
            try:
                raw = await _ask_with_search(self.client, model=model_to_use, prompt=prompt.text)
            except (NotFoundError, BadRequestError) as e:
                # Primary model not available — flip to fallback once,
                # then retry this prompt.
                if model_to_use != self.fallback_model:
                    self._effective_model = self.fallback_model
                    try:
                        raw = await _ask_with_search(self.client, model=self.fallback_model, prompt=prompt.text)
                        model_to_use = self.fallback_model
                    except Exception as e2:
                        return RunResult(prompt.key, run_index, self.fallback_model, None, [], None, str(e2))
                else:
                    return RunResult(prompt.key, run_index, model_to_use, None, [], None, str(e))
            except Exception as e:
                return RunResult(prompt.key, run_index, model_to_use, None, [], None, str(e))

            text, citations = _extract_text_and_citations(raw)
            return RunResult(prompt.key, run_index, model_to_use, text, citations, raw, None)

    async def run_all(self, prompts, *, iterations: int, cache, ttl_seconds: int,
                      progress=None) -> None:
        """Run iterations × prompts with concurrency, skipping (prompt, run_index)
        pairs already cached fresh. Progress callback gets (done, total) ticks."""
        # Persist prompt rows up-front so the cache has them even if a run errors.
        for p in prompts:
            cache.upsert_prompt(p)

        tasks: list[tuple[Any, int]] = []
        for p in prompts:
            already = cache.fresh_response_count(p.key, self._effective_model, ttl_seconds)
            for i in range(iterations):
                if i < already:
                    continue
                tasks.append((p, i))

        total = len(tasks)
        done = 0
        if progress:
            progress(done, total)

        async def _wrap(p, i):
            res = await self.run_one(p, run_index=i)
            cache.save_response(
                res.prompt_key, res.run_index, res.model,
                response_text=res.response_text,
                citations=res.citations,
                raw=res.raw,
                error=res.error,
            )
            return res

        coros = [_wrap(p, i) for (p, i) in tasks]
        for fut in asyncio.as_completed(coros):
            await fut
            done += 1
            if progress:
                progress(done, total)
