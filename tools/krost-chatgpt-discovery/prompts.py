"""Prompt generator for krost-chatgpt-discovery.

Templates intentionally read like sentences a human would type or speak
to ChatGPT, NOT keyword strings. The point is to surface the prompts
that produce real recommendations — appending "south africa" to a
keyword (the trap most discovery tools fall into) reliably gets you
generic SEO answers, not brand recommendations.
"""

from __future__ import annotations

import hashlib
import itertools
import random
from dataclasses import dataclass


# Template families, paired with the variables each one needs. Some run
# once per (category, persona, city); others rotate competitors and only
# fire on the brand-aware family.
TEMPLATES: list[tuple[str, str]] = [
    # need / use_case style
    ("category-need", "I need {category} for {use_case}, who should I look at?"),
    ("category-best-city", "What's the best {category} supplier in {city}?"),
    ("category-recommend-country", "Recommend a company that does {category} in {market}."),
    ("persona-quotes", "I'm a {persona} and need to {goal}. What companies should I get quotes from?"),
    ("category-compare-suppliers", "Compare {category} suppliers in {market}."),
    ("category-top5", "Who are the top 5 {category} companies in {market}?"),
    ("warehouse-fitout", "I'm fitting out a {size}m² warehouse in {city}, what {category} should I install and who supplies it?"),
    ("budget-and-suppliers", "What's a reasonable budget for {category} in {market} and which suppliers are reliable?"),

    # competitor head-to-head
    ("competitor-vs-competitor", "Help me choose between {competitor_a} and {competitor_b} for {use_case}."),
    ("brand-aware", "Have you heard of {target_brand}? Are they reputable?"),
    ("competitor-similar", "What companies similar to {competitor_a} exist in {market}?"),

    # open-ended industry
    ("industry-overview", "Tell me about the {category} industry in {market}."),

    # problem-led
    ("problem-pallets", "My warehouse pallets keep falling, what system do I need and who installs it?"),
    ("problem-store-display", "I'm opening a small retail store in {city} and need shelving and display fixtures — who supplies and installs?"),
    ("problem-3pl", "We're scaling a 3PL operation in {market} and need racking that handles selective + drive-in. Who should we evaluate?"),
    ("problem-mezzanine", "We've outgrown our warehouse footprint in {city} — looking at adding a mezzanine. Who designs and installs these?"),
]


# Use-case fragments paired with categories so the "I need X for Y" template
# reads naturally instead of producing "I need pallet racking for warehouse
# manager".
USE_CASES_BY_CATEGORY: dict[str, list[str]] = {
    "pallet racking": [
        "a 5,000-pallet distribution centre",
        "a high-bay warehouse with selective and drive-in zones",
        "a cold-storage facility",
    ],
    "warehouse shelving": [
        "a small parts warehouse",
        "a spares depot for an automotive workshop",
        "a multi-tenant 3PL site",
    ],
    "mezzanine flooring": [
        "doubling usable space in a 2,500m² warehouse",
        "adding office floor inside an existing factory",
        "a pick-and-pack ecommerce fulfilment area",
    ],
    "industrial racking": [
        "long-load steel storage",
        "a factory storing bulk consumables",
        "an FMCG distribution centre",
    ],
    "gondola shelving": [
        "a new supermarket fit-out",
        "a pharmacy chain refresh",
        "a hardware retailer expansion",
    ],
    "shuttle racking": [
        "high-density frozen storage",
        "a beverage distribution warehouse",
        "an automotive parts storage facility",
    ],
    "racking installation": [
        "a greenfield warehouse build",
        "retrofitting an existing distribution centre",
        "a tenanted unit where we need fast turnaround",
    ],
    "storage solutions": [
        "a growing ecommerce business",
        "a manufacturing plant with overflow stock",
        "a multi-warehouse retail operation",
    ],
}


# Goals paired with personas so persona-led prompts read naturally.
GOALS_BY_PERSONA: dict[str, list[str]] = {
    "warehouse manager": [
        "increase pallet positions in our existing footprint",
        "add a mezzanine to handle the next year's growth",
        "rip out old shelving and replace with selective racking",
    ],
    "logistics director": [
        "consolidate three sites into one larger DC with new racking",
        "tender a full racking + installation contract",
        "evaluate suppliers for a 6-month rollout",
    ],
    "retail store owner": [
        "fit out a new store with shelving and display gondolas",
        "refresh a tired-looking branch",
        "find a supplier who can deliver and install in two weeks",
    ],
    "ecommerce founder fitting out a warehouse": [
        "set up shelving and pallet racking from scratch",
        "find someone who'll spec it for me — I don't know what I need",
        "build a pick-and-pack mezzanine on a tight budget",
    ],
    "construction contractor": [
        "subcontract the racking package on a warehouse build",
        "find a supplier who can work to our project programme",
        "get pricing for a tender on a logistics park",
    ],
    "procurement manager at a 3PL": [
        "tender racking for a new 8,000m² site",
        "evaluate three suppliers and shortlist for a beauty parade",
        "negotiate a frame agreement across multiple sites",
    ],
}


WAREHOUSE_SIZES = ["1,500", "3,000", "5,000", "8,000", "12,000"]


@dataclass(frozen=True)
class GeneratedPrompt:
    """One concrete prompt ready to send to ChatGPT.

    `key` is a stable hash so we can cache responses without re-running the
    same prompt within the TTL window.
    """
    template_id: str
    category: str | None
    persona: str | None
    city: str | None
    text: str

    @property
    def key(self) -> str:
        return hashlib.sha256(self.text.encode("utf-8")).hexdigest()[:16]


def _expand_one(template_id: str, template: str, ctx: dict, brand: str, market: str,
                competitor_pairs: list[tuple[str, str]]) -> list[GeneratedPrompt]:
    """Render one template into one or more concrete prompts depending on
    which placeholders it has. Returns [] if a required placeholder isn't
    in ctx (the caller filters)."""
    if "{competitor_a}" in template and "{competitor_b}" in template:
        # Pair-wise competitor compare — emits one prompt per competitor pair.
        out = []
        for a, b in competitor_pairs:
            text = template.format(competitor_a=a, competitor_b=b, use_case=ctx.get("use_case", "warehouse use"))
            out.append(GeneratedPrompt(template_id, ctx.get("category"), ctx.get("persona"), ctx.get("city"), text))
        return out

    if "{competitor_a}" in template:
        # Single-competitor template (e.g. "similar to X exist in market").
        out = []
        for a, _ in competitor_pairs:
            text = template.format(competitor_a=a, market=market)
            out.append(GeneratedPrompt(template_id, ctx.get("category"), ctx.get("persona"), ctx.get("city"), text))
        return out

    if "{target_brand}" in template:
        text = template.format(target_brand=brand)
        return [GeneratedPrompt(template_id, None, None, None, text)]

    # Common substitution path.
    fmt = {
        "category": ctx.get("category"),
        "persona": ctx.get("persona"),
        "city": ctx.get("city"),
        "market": market,
        "use_case": ctx.get("use_case"),
        "goal": ctx.get("goal"),
        "size": ctx.get("size"),
    }
    # Drop None entries so we don't render literal "None" into the prompt.
    if any(v is None and ("{" + k + "}") in template for k, v in fmt.items()):
        return []
    text = template.format(**{k: v for k, v in fmt.items() if v is not None})
    return [GeneratedPrompt(template_id, ctx.get("category"), ctx.get("persona"), ctx.get("city"), text)]


def generate(config: dict, *, max_prompts: int = 0, seed: int = 1337) -> list[GeneratedPrompt]:
    """Generate the candidate prompt set from config.

    Aim: 300-500 prompts on a typical config. We deduplicate by text
    (different templates can render to the same sentence).

    `max_prompts > 0` randomly samples down to that count after dedupe —
    handy for dry-runs and CI.
    """
    rng = random.Random(seed)

    brand = config["target_brand"]
    market = config["market"]
    categories: list[str] = config["categories"]
    personas: list[str] = config["personas"]
    cities: list[str] = config.get("cities", [])
    competitors: list[str] = config["competitors"]

    # Build competitor pairs: each competitor paired with the brand once,
    # plus a handful of cross pairs so we cover head-to-head variation
    # without exploding into N² prompts.
    rng_pairs = list(itertools.islice(_competitor_pairs(competitors, rng), 12))
    brand_vs_competitor = [(brand, c) for c in competitors] + [(c, brand) for c in competitors]

    # Cartesian rendering — each context slice rotates through templates.
    out: list[GeneratedPrompt] = []
    for category in categories:
        use_cases = USE_CASES_BY_CATEGORY.get(category, ["a typical warehouse"])
        for persona in personas:
            goals = GOALS_BY_PERSONA.get(persona, ["evaluate options"])
            for city in cities + [None]:
                for template_id, template in TEMPLATES:
                    if template_id in ("warehouse-fitout",):
                        for size in WAREHOUSE_SIZES[:2]:  # cap variants
                            ctx = {
                                "category": category, "persona": persona, "city": city or rng.choice(cities),
                                "use_case": rng.choice(use_cases), "goal": rng.choice(goals), "size": size,
                            }
                            out.extend(_expand_one(template_id, template, ctx, brand, market, brand_vs_competitor + rng_pairs))
                    else:
                        ctx = {
                            "category": category, "persona": persona, "city": city,
                            "use_case": rng.choice(use_cases), "goal": rng.choice(goals),
                        }
                        out.extend(_expand_one(template_id, template, ctx, brand, market, brand_vs_competitor + rng_pairs))

    # Dedupe by text. Stable order: first-seen wins, so the report has a
    # reproducible listing for the same config.
    seen: set[str] = set()
    unique: list[GeneratedPrompt] = []
    for p in out:
        if p.text in seen:
            continue
        seen.add(p.text)
        unique.append(p)

    if max_prompts and len(unique) > max_prompts:
        rng.shuffle(unique)
        unique = unique[:max_prompts]
        # Stable sort by template_id then text so the report layout doesn't
        # bounce between runs of the same sample.
        unique.sort(key=lambda p: (p.template_id, p.text))

    return unique


def _competitor_pairs(competitors: list[str], rng: random.Random):
    """Yield random distinct competitor pairs without ever pairing one
    with itself. Used to cover competitor-vs-competitor framings beyond
    just brand-vs-X."""
    pairs_seen: set[tuple[str, str]] = set()
    while True:
        a, b = rng.sample(competitors, 2)
        key = tuple(sorted([a, b]))
        if key in pairs_seen:
            continue
        pairs_seen.add(key)
        yield (a, b)
