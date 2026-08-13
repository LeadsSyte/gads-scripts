# krost-chatgpt-discovery

CLI tool that asks ChatGPT (with web search) which brands it recommends
for South African storage / racking categories, and surfaces:

- **Wins** — prompts where ChatGPT mentions the target brand
- **Gaps** — prompts where competitors win and the target is invisible
- **Citation wins** — prompts where the target's domain is cited as a source URL (gold tier)
- **Competitor share of voice** — mention counts across the field
- **Topic clusters** — win rate per category

## Two prompt sources

### Synthetic (default)

Generates 300–500 sentence-shaped prompts from templates × categories ×
personas × cities. Useful for first-time discovery.

```bash
python kcd.py run --config config.yaml --confirm
```

### GSC-seeded (recommended)

Uses real ranking keywords from a Search Console export as the seed
list — every prompt is one of the brand's actual ranking queries
wrapped in a natural sentence template. Way better signal than
synthetic guessing.

1. In Search Console: Performance → Queries → Export → CSV.
2. Run with the export path:

```bash
python kcd.py run --config config.yaml --gsc-export gsc-performance.csv --confirm
```

## Setup

```bash
cd tools/krost-chatgpt-discovery
pip install -r requirements.txt
cp config.example.yaml config.yaml   # edit your target + competitors
export OPENAI_API_KEY=sk-...
python kcd.py run --config config.yaml --confirm
```

## CLI

```text
python kcd.py run --config <path> [--gsc-export <csv>] [--max-prompts N]
                  [--iterations N] [--concurrency N]
                  [--model gpt-5] [--fallback-model gpt-4o]
                  [--cache-path out/kcd.sqlite] [--output out/report.html]
                  [--confirm]

python kcd.py report --config <path> [--cache-path] [--output]
```

`report` re-renders the HTML from the SQLite cache — no API calls.
Useful when you've changed the report template or want to regenerate
after editing.

## Cost guard

Estimated spend is printed before the run. If it exceeds
`run.cost_confirm_threshold_usd` (default $5), you must pass `--confirm`
to proceed.

Approx per-call cost: gpt-5 ~3¢, gpt-4o ~2¢, gpt-4o-mini ~0.2¢. A
default run of 400 prompts × 3 iterations × (primary + sentiment)
lands around $20–30.

## Output

```text
out/
├── kcd.sqlite          # cached prompts + responses + analyses (re-runnable)
├── report.html         # the dark-theme report (single file)
├── prompts.csv         # one row per prompt with verdict columns
└── responses.jsonl     # one line per prompt with full response payloads
```

## Cache + re-runs

The SQLite cache lives at `out/kcd.sqlite`. Within
`run.cache_ttl_days` (default 7), already-probed (prompt, run_index,
model) tuples are skipped — re-running after editing templates only
queries the OpenAI API for *new* prompts.

To force a full re-run, delete the SQLite file or shorten the TTL.

## Why web search matters

ChatGPT's training data has stale, broad coverage of niche South
African brands. Without `tools=[{"type":"web_search_preview"}]`,
gpt-4o reliably refuses to recommend specific brands or hallucinates
ones that don't exist. The Responses API with web search returns
structured `annotations` carrying real URL citations — those citations
are how the analyzer determines the citation-win tier.

## Files

- `prompts.py`     — synthetic template × category × persona generator
- `gsc_seed.py`    — GSC CSV → ranking-keyword-seeded prompts
- `runner.py`      — async OpenAI Responses API runner with web_search
- `cache.py`       — SQLite layer (prompts / responses / analyses)
- `analyzer.py`    — mention + citation detection + sentiment
- `report.py`      — single-file HTML report
- `kcd.py`         — CLI entry point
