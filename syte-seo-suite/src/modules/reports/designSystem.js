// Syte Design System + SEO Reasoning Module — loaded into report generation prompts.

export const SYTE_DESIGN_SYSTEM = `
SYTE DESIGN SYSTEM — SHARED MODULE

Brand Foundations:
- Agency: Syte Digital Agency (syte.co.za)
- Wordmark: SYTE — uppercase, font-weight 800, letter-spacing tight
- Tagline: "Performance-Driven Digital Marketing"
- Contact: hello@syte.co.za | syte.co.za
- Confidentiality footer (ALWAYS include): "Confidential — prepared for [Client Name]"

Colour Palette (CSS variables):
  --syte-bg: #0c0c0e (page background, near-black, NEVER pure #000)
  --syte-surface: #15151a (cards, panels)
  --syte-surface-2: #1d1d24 (elevated surfaces, hover)
  --syte-border: #2a2a33 (hairline dividers)
  --syte-text: #f5f5f7 (primary text, NEVER pure #fff)
  --syte-text-dim: #9a9aa6 (secondary text)
  --syte-text-faint: #5a5a66 (tertiary text)
  --syte-accent: #c8f060 (primary lime — scores, CTAs, highlights)
  --syte-accent-blue: #4F8EF7 (alternate blue — data viz, links)
  --syte-success: #4ade80
  --syte-warning: #fbbf24
  --syte-danger: #f87171

Rules: No pure black. No pure white. No gradient on accent. One accent per screen.

Typography (Google Fonts — include in HTML):
  Display: 'DM Serif Display', serif — hero numbers, scores, big stats only
  UI/body: 'Syne', sans-serif — everything else
  Mono: 'JetBrains Mono', monospace — data tables, metrics

Hierarchy:
  Hero stat: DM Serif Display, clamp(56px, 9vw, 120px), weight 400
  H1: Syne, clamp(32px, 4vw, 48px), weight 700
  H2: Syne, clamp(24px, 3vw, 32px), weight 600
  H3: Syne, 18px, weight 600
  Body: Syne, 15-16px, weight 400
  Caption: Syne, 12px, weight 500, uppercase, letter-spacing 0.08em

Layout: max-width 1200px, padding 24px mobile / 48px desktop, centered.
Cards: background var(--syte-surface), border 1px solid var(--syte-border), border-radius 16px, padding 24px.
Score chip: inline-flex, padding 6px 14px, border-radius 999px, bg rgba(200,240,96,0.1), border rgba(200,240,96,0.3), color accent, uppercase, letter-spacing 0.06em.

Score colours: 80-100 → success, 60-79 → warning, 0-59 → danger.

RULES:
- Single self-contained HTML file. No build step, no bundlers.
- No external JS except Google Fonts CSS.
- Mobile responsive (test at 375px).
- Interactive where valuable: tabs, accordions, animated counters. Never animation for its own sake.
- Print-safe: @media print rules collapse interactivity.

ANTI-PATTERNS:
- Never "we will help you grow your business." Write "we'll fix the 14 broken canonical tags and recover ~8% of organic traffic."
- No stock corporate language (synergies, leverage, best-in-class).
- No finding without a recommendation.
- No recommendation without projected impact.
- No padding. If a section has nothing meaningful, cut it.
`.trim();

export const SEO_REASONING_MODULE = `
SEO SUITE — REASONING MODULE

What an SEO Report Is:
An evidence-led audit deliverable. The client finishes reading knowing:
1. Where they stand — scored, benchmarked, no ambiguity
2. What's broken — specific issues, not vague concerns
3. What it costs them — commercial impact in rands or traffic
4. What we'd do about it — prioritised action plan with projected uplift

Scoring Framework (4 pillars, each 0-100):
  Technical SEO (30%): Crawlability, indexation, CWV, schema, canonicals, redirects, robots, sitemaps
  On-Page (25%): Titles, metas, H1, internal linking, content depth, keyword targeting
  Off-Page/Authority (25%): Backlinks, DR, referring domains, brand mentions
  Local/AEO (20%): GBP, local citations, FAQ schema, AI Overview presence

Composite = weighted average, hero number on cover.

Findings Schema (every finding MUST conform):
{
  "pillar": "Technical SEO",
  "issue": "14 pages with conflicting canonical tags",
  "severity": "high",
  "evidence": "Pages /products/[id] all canonical to /products, splitting equity",
  "impact": "~8% of organic product traffic at risk; R47k/month affected",
  "recommendation": "Update canonicals to self-reference; submit updated sitemap",
  "effort": "low",
  "projected_uplift": "+8% organic product traffic over 60 days"
}

Rules:
- evidence MUST reference a specific URL, count, or measurement. No "appears to be."
- impact MUST be quantified — traffic %, rand value, ranking positions, or conversions.
- recommendation MUST be actionable in a single sprint.
- projected_uplift REQUIRED. If you can't project uplift, omit the finding.

Severity Calibration:
  Critical: Active revenue loss or de-indexation risk (danger dot + border)
  High: Material organic visibility impact within 30 days (warning dot)
  Medium: Optimisation opportunity, 30-90 day impact (accent dot)
  Low: Hygiene fix, marginal lift (dim dot)
  Cap: 5 critical, 8 high, 12 medium per report.

Report Structure (this order, no exceptions):
1. Cover — composite score (DM Serif Display hero size), client domain, date, 4 pillar chips
2. Executive Summary — 3 bullets: what works, what's broken, opportunity in rands/%
3. Pillar sections — one per pillar: score chip, 1-para diagnostic, findings sorted by severity
4. Competitor benchmark — top 3 SA competitors, same rubric, comparison bars
5. Priority action plan — top 5 recommendations, ordered by uplift/effort ratio
6. Projected impact — 90-day forecast: traffic, rankings, revenue
7. Engagement options — how Syte delivers (retainer/performance/project)
8. Footer — Syte wordmark + confidentiality + contact

Tone:
- Diagnostic, not alarmist. "14 pages have conflicting canonicals" not "Your site is in serious trouble."
- Quantified. Every claim has a number.
- Forward-looking. Findings always lead to recommendations.
- Plain language. "Pages compete for the same keyword" not "keyword cannibalisation is suboptimal."
- Confident projections with timeframes. "+8% over 60 days" — confident but bounded.
- South African English.

Quality Checks:
□ All 4 pillar scores present
□ Every finding has evidence, impact, recommendation, uplift
□ No [Client] or [X%] placeholders remain
□ Competitor benchmark has 3 real SA competitors
□ Priority plan has exactly 5 items
□ 90-day projection includes traffic AND revenue
□ Footer has Syte wordmark + confidentiality
□ HTML validates, renders without external JS
`.trim();
