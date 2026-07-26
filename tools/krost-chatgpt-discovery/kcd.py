"""krost-chatgpt-discovery — CLI entry point.

Usage:
  # Synthetic prompts (templates × categories × personas):
  python kcd.py run --config config.yaml

  # GSC-seeded (recommended) — wrap real ranking keywords as ChatGPT prompts:
  python kcd.py run --config config.yaml --gsc-export gsc-performance.csv

  # Re-render the report from cached responses (no API calls):
  python kcd.py report --config config.yaml --output out/report.html
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

import yaml
from openai import AsyncOpenAI

from prompts import generate
from gsc_seed import parse_gsc_export, select_seeds, seeds_to_prompts
from cache import Cache
from runner import Runner, estimate_cost
from analyzer import detect, annotate_with_sentiment, aggregate, Verdict
from report import render as render_report


def load_config(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def build_prompts(cfg: dict, *, gsc_export: str | None, max_prompts: int):
    """Single dispatch for both prompt sources so the runner doesn't need
    to care which one produced its inputs."""
    if gsc_export:
        rows = parse_gsc_export(gsc_export)
        if not rows:
            raise SystemExit("GSC export had no usable rows. Check column names (Query, Clicks, Impressions, Position).")
        seeds = select_seeds(rows, top_n=max_prompts or 200)
        return seeds_to_prompts(seeds, market=cfg["market"])
    return generate(cfg, max_prompts=max_prompts)


async def cmd_run(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    run_cfg = cfg.get("run", {})
    primary = args.model or run_cfg.get("model_primary", "gpt-5")
    fallback = args.fallback_model or run_cfg.get("model_fallback", "gpt-4o")
    sentiment = run_cfg.get("sentiment_model", "gpt-4o-mini")
    iterations = args.iterations or int(run_cfg.get("iterations", 3))
    concurrency = args.concurrency or int(run_cfg.get("concurrency", 10))
    ttl_days = int(run_cfg.get("cache_ttl_days", 7))
    cost_threshold = float(run_cfg.get("cost_confirm_threshold_usd", 5.0))
    max_prompts = args.max_prompts if args.max_prompts is not None else int(run_cfg.get("max_prompts", 0))

    cache_path = args.cache_path or "out/kcd.sqlite"
    out_html   = args.output    or "out/report.html"
    out_csv    = "out/prompts.csv"
    out_jsonl  = "out/responses.jsonl"

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Set OPENAI_API_KEY in the environment.", file=sys.stderr)
        return 2

    prompts = build_prompts(cfg, gsc_export=args.gsc_export, max_prompts=max_prompts)
    if not prompts:
        print("No prompts generated.", file=sys.stderr)
        return 2

    estimated = estimate_cost(prompts, iterations, primary, sentiment)
    print(f"Source:        {'GSC export' if args.gsc_export else 'synthetic templates'}")
    print(f"Prompts:       {len(prompts)}")
    print(f"Iterations:    {iterations}")
    print(f"Total calls:   {len(prompts) * iterations} primary + ~{len(prompts) * iterations} sentiment")
    print(f"Estimated $:   ~${estimated:.2f} (rough — check OpenAI usage page after run)")
    if estimated > cost_threshold and not args.confirm:
        print(f"Estimated cost exceeds confirm threshold (${cost_threshold:.2f}). Re-run with --confirm to proceed.")
        return 3

    cache = Cache(cache_path)
    runner = Runner(api_key=api_key, model=primary, fallback_model=fallback, concurrency=concurrency)

    started = time.time()

    def progress(done: int, total: int):
        if total == 0:
            return
        pct = done / total * 100
        sys.stdout.write(f"\r  probing… {done}/{total} ({pct:.0f}%)")
        sys.stdout.flush()
        if done == total:
            sys.stdout.write("\n")

    print("Running probes (cached prompts skipped)…")
    await runner.run_all(prompts, iterations=iterations, cache=cache,
                         ttl_seconds=ttl_days * 86400, progress=progress)
    print(f"  probe phase: {time.time() - started:.1f}s")

    # Detection pass (synchronous; no API).
    print("Analysing responses…")
    sentiment_inputs = []  # (prompt_key, run_index, text, Verdict)
    for p in prompts:
        responses = cache.get_responses(p.key)
        for r in responses:
            v = detect(
                r["response_text"], r["citations"],
                target_aliases=cfg["target_aliases"],
                target_domain=cfg["target_domain"],
                competitors=cfg["competitors"],
            )
            sentiment_inputs.append((p.key, r["run_index"], r["response_text"], v))

    # Sentiment pass — only on responses that mention the brand.
    print("Classifying sentiment on brand mentions…")
    client = AsyncOpenAI(api_key=api_key)
    await annotate_with_sentiment(
        client,
        verdicts=sentiment_inputs,
        brand=cfg["target_brand"],
        model=sentiment,
        concurrency=5,
    )

    for (pk, ri, _text, v) in sentiment_inputs:
        cache.save_analysis(
            pk, ri,
            target_mentioned=v.target_mentioned,
            target_position=v.target_position,
            target_cited_url=v.target_cited_url,
            competitors_mentioned=v.competitors_mentioned,
            response_type=v.response_type,
            sentiment_toward_target=v.sentiment_toward_target,
        )

    print("Rendering report…")
    summary = aggregate(prompts, cache,
                        target_aliases=cfg["target_aliases"],
                        target_domain=cfg["target_domain"],
                        competitors=cfg["competitors"])
    render_report(
        target_brand=cfg["target_brand"],
        market=cfg["market"],
        summary=summary,
        cache=cache,
        prompts=prompts,
        out_path=out_html,
        csv_path=out_csv,
        jsonl_path=out_jsonl,
    )
    print(f"Done in {time.time() - started:.1f}s")
    print(f"  Report: {out_html}")
    print(f"  CSV:    {out_csv}")
    print(f"  JSONL:  {out_jsonl}")
    print(f"  Cache:  {cache_path}")
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    """Re-render the report from cached responses without re-querying."""
    cfg = load_config(args.config)
    cache_path = args.cache_path or "out/kcd.sqlite"
    out_html   = args.output    or "out/report.html"
    cache = Cache(cache_path)

    # Reconstruct GeneratedPrompt-like rows from the cache so the report
    # has access to category / persona / city. The cache stored these
    # alongside each prompt row.
    from prompts import GeneratedPrompt
    rows = cache.all_prompts()
    prompts = [GeneratedPrompt(
        template_id=r.get("template_id") or "",
        category=r.get("category"),
        persona=r.get("persona"),
        city=r.get("city"),
        text=r["text"],
    ) for r in rows]

    summary = aggregate(prompts, cache,
                        target_aliases=cfg["target_aliases"],
                        target_domain=cfg["target_domain"],
                        competitors=cfg["competitors"])
    render_report(
        target_brand=cfg["target_brand"],
        market=cfg["market"],
        summary=summary,
        cache=cache,
        prompts=prompts,
        out_path=out_html,
        csv_path="out/prompts.csv",
        jsonl_path="out/responses.jsonl",
    )
    print(f"Report written: {out_html}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="kcd", description="Krost ChatGPT discovery.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_run = sub.add_parser("run", help="Probe ChatGPT and write the report.")
    p_run.add_argument("--config", required=True, help="Path to config.yaml")
    p_run.add_argument("--gsc-export", help="Optional path to a GSC performance CSV — uses real ranking keywords as the seed instead of synthetic templates.")
    p_run.add_argument("--max-prompts", type=int, help="Cap the prompt set (helpful for dry runs).")
    p_run.add_argument("--iterations", type=int, help="Override iterations per prompt (default 3).")
    p_run.add_argument("--concurrency", type=int, help="Override async concurrency (default 10).")
    p_run.add_argument("--model", help="Override primary model (default gpt-5).")
    p_run.add_argument("--fallback-model", help="Override fallback model (default gpt-4o).")
    p_run.add_argument("--cache-path", help="SQLite cache path (default out/kcd.sqlite).")
    p_run.add_argument("--output", help="Report output path (default out/report.html).")
    p_run.add_argument("--confirm", action="store_true", help="Confirm spend over the threshold.")

    p_rep = sub.add_parser("report", help="Re-render the report from cache without re-querying.")
    p_rep.add_argument("--config", required=True)
    p_rep.add_argument("--cache-path")
    p_rep.add_argument("--output")

    args = parser.parse_args()
    if args.cmd == "run":
        return asyncio.run(cmd_run(args))
    if args.cmd == "report":
        return cmd_report(args)
    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
