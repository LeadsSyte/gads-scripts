// Topic research for the Content Engine. Pulls real Search Console data for
// the selected client, scores each query as an opportunity, sends the top
// signals to Claude with the client brand context, and returns a prioritized
// list of content opportunities with ranking-aware angles.

import { topQueriesByImpression, topPagesWithQueries } from '../technical/gsc.js';
import { claudeComplete, extractJSON } from '../../lib/anthropic.js';

// ---------------------------------------------------------------------------
// Opportunity scoring — heuristics only, used to prefilter + rank signals
// before handing them to Claude for the qualitative layer.
// ---------------------------------------------------------------------------

// Estimate potential CTR if we moved a query from its current position to
// position 3. Rough average CTR curve from public GSC data.
const CTR_AT = {
  1: 0.28, 2: 0.16, 3: 0.11, 4: 0.08, 5: 0.06,
  6: 0.05, 7: 0.04, 8: 0.03, 9: 0.025, 10: 0.02
};
function expectedCtr(position) {
  const p = Math.round(position);
  if (p <= 0) return 0.28;
  if (p <= 10) return CTR_AT[p] || 0.02;
  if (p <= 20) return 0.012;
  if (p <= 30) return 0.007;
  return 0.003;
}

export function scoreOpportunity(row) {
  const pos = row.position || 100;
  const impressions = row.impressions || 0;
  const currentClicks = row.clicks || 0;

  // Potential clicks if moved to top 3.
  const bestCtr = expectedCtr(3);
  const potentialClicks = impressions * bestCtr;
  const gain = Math.max(0, potentialClicks - currentClicks);

  // Position multiplier — sweet spot is 5-20 (high potential, moveable).
  let positionMultiplier = 1;
  if (pos >= 5 && pos <= 20) positionMultiplier = 1.5;
  else if (pos >= 21 && pos <= 30) positionMultiplier = 1.1;
  else if (pos >= 4 && pos <= 5) positionMultiplier = 1.2;
  else if (pos <= 3) positionMultiplier = 0.4; // already ranking well
  else positionMultiplier = 0.6; // too far out

  const raw = gain * positionMultiplier;
  // Normalize to 0-100 using log scale so big-impression queries don't dominate.
  return Math.min(100, Math.round(Math.log10(raw + 1) * 20));
}

// Classify each row into an opportunity type so Claude gets structured hints.
export function classifyOpportunity(row, siteAvgCtr = 0.035) {
  const pos = row.position || 100;
  const ctr = row.ctr || 0;
  if (pos <= 3)                         return 'ranking-defend';   // doubling down
  if (pos >= 4 && pos <= 20)            return 'low-hanging-fruit';
  if (pos >= 21 && pos <= 50)           return 'content-gap';
  if (ctr < siteAvgCtr * 0.6 && pos <= 10) return 'meta-rewrite';
  return 'long-tail';
}

// ---------------------------------------------------------------------------
// Data collection pipeline — pulls from GSC and prepares the payload sent
// to Claude.
// ---------------------------------------------------------------------------

export async function collectResearchData(client, { days = 90 } = {}) {
  if (!client?.gsc_property) {
    throw new Error('This client has no Search Console property set. Open Edit Client → Google Connections to pick one.');
  }

  // Resolve which Google account this client's GSC lives on (same convention as
  // the monthly report). Required under server auth — the proxy attaches that
  // account's token; without it proxyGoogleFetch throws "no Google account bound".
  const gscEmail = client.gsc_account_email || client.google_account_email || null;

  const [queries, pageQueries] = await Promise.all([
    topQueriesByImpression(client.gsc_property, days, gscEmail),
    topPagesWithQueries(client.gsc_property, days, gscEmail)
  ]);

  const totalImpressions = queries.reduce((a, b) => a + b.impressions, 0);
  const totalClicks = queries.reduce((a, b) => a + b.clicks, 0);
  const siteAvgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0.035;

  // Score and filter query-level data.
  const scored = queries
    .filter(q => q.impressions >= 5)
    .map(q => ({
      ...q,
      score: scoreOpportunity(q),
      type: classifyOpportunity(q, siteAvgCtr)
    }))
    .sort((a, b) => b.score - a.score);

  // Top 50 opportunities, further segmented.
  const topOpportunities = scored.slice(0, 50);

  // Pair queries back to their best-ranking pages so Claude can suggest
  // whether to refresh existing content or write new.
  const pageByQuery = {};
  for (const row of pageQueries) {
    if (!pageByQuery[row.query] || pageByQuery[row.query].impressions < row.impressions) {
      pageByQuery[row.query] = row;
    }
  }

  return {
    days,
    totalImpressions,
    totalClicks,
    siteAvgCtr,
    queries: scored,
    topOpportunities,
    pageByQuery,
    allQueryCount: queries.length
  };
}

// ---------------------------------------------------------------------------
// Claude prompt — turns the structured GSC data into a prioritized topic
// plan with angles, rationale, and ranking-aware instructions.
// ---------------------------------------------------------------------------

const RESEARCH_SYSTEM = `You are a senior SEO content strategist reviewing real Search Console data for a specific brand. You must return a prioritized list of content opportunities as JSON only — no prose, no code fences.

Shape (return ONLY this JSON):
{
  "opportunities": [
    {
      "topic_title": "compelling article angle — not just a keyword",
      "primary_keyword": "exact keyword from GSC data",
      "supporting_keywords": ["2-5 related queries from the data"],
      "current_position": 12.3,
      "current_impressions": 1240,
      "current_clicks": 18,
      "target_page": "/existing-page/ or NEW",
      "opportunity_score": 82,
      "opportunity_type": "low-hanging-fruit | content-gap | ranking-defend | meta-rewrite",
      "rationale": "1-2 sentences explaining why this is valuable and what the gap is",
      "suggested_angle": "how the article should be framed to beat current top results",
      "recommended_length": 1400,
      "priority": 1
    }
  ],
  "summary": "one paragraph overview of the content plan for this month"
}

Rules:
- Prioritize queries ranked positions 5-20 with high impressions (easy wins).
- For queries already in the top 3, only suggest if they need refreshing.
- Identify content gaps where multiple related queries share a theme.
- Use REAL numbers from the provided data — don't invent positions or impressions.
- "recommended_length" MUST be between 1000 and 2000 words. Never suggest a length above 2000. Pick a value inside this band based on topic depth (simpler topics ~1100-1300, comprehensive guides ~1600-1900).
- Consider the brand's industry, location, and audience when framing angles.
- Return THE EXACT NUMBER of opportunities requested by the user (see TARGET_ARTICLES below). Quality over quantity — but hit the target count. If there aren't enough strong GSC signals, use your SEO expertise to suggest topical gaps based on the brand's industry.
- Priority field: 1 = highest urgency, N = lowest.

YEAR-AWARENESS (HARD RULE — never violate):
- If a topic title includes a year (e.g. "2024 Pricing Guide", "Best X 2025"), the year MUST be the CURRENT_YEAR provided in the user message. Never propose a topic with a year in the past — that's an SEO own-goal.
- ACTIVELY SCAN the GSC data for queries / pages that contain past-year markers ("2024", "2023", "last year", etc.). These are PRIME refresh candidates: an article that ranked well in its year is now decaying; rewriting it for the current year typically reclaims position quickly. Surface these as "ranking-defend" or "low-hanging-fruit" opportunities with opportunity_type set accordingly and a rationale explaining "Updating last year's piece to CURRENT_YEAR".
- For evergreen titles (no year), still write them as if the publication date is the current year — pricing, statistics, examples should be current.`;

export async function generateTopicRecommendations(client, research, { targetArticles } = {}) {
  const target = targetArticles || client.pages_per_month || 4;
  const summary = {
    client: client.name,
    industry: client.industry || '',
    location: client.location || '',
    audience: client.audience || '',
    voice: client.voice || '',
    context: client.context || '',
    competitors: client.competitors || '',
    timeframe_days: research.days,
    total_impressions: research.totalImpressions,
    total_clicks: research.totalClicks,
    site_avg_ctr_pct: (research.siteAvgCtr * 100).toFixed(2)
  };

  const opportunities = research.topOpportunities.slice(0, 40).map(q => {
    const page = research.pageByQuery[q.query];
    return {
      query: q.query,
      impressions: q.impressions,
      clicks: q.clicks,
      ctr: (q.ctr * 100).toFixed(2) + '%',
      position: Number(q.position.toFixed(1)),
      opportunity_type: q.type,
      heuristic_score: q.score,
      best_ranking_page: page?.page || null
    };
  });

  // Manual direction from the client record. When present, it MUST take
  // priority over pure data-driven prioritization — e.g. if the account
  // manager has said "focus on ecommerce case studies this month", Claude
  // should bias topic selection in that direction even if the GSC numbers
  // suggest other opportunities first.
  const manualDirection = (client.internal_notes || '').trim();
  const directionBlock = manualDirection
    ? `\n\nMANUAL DIRECTION FROM ACCOUNT MANAGER (takes priority over pure data-driven ranking):\n"""\n${manualDirection}\n"""\n\nWhen this direction is present, you MUST:\n- Prioritize opportunities that align with it, even if their heuristic score is lower.\n- Explicitly reference the direction in the "summary" field.\n- Use it to shape the "suggested_angle" for every opportunity.\nIf the direction conflicts with a high-score opportunity, bias toward the direction unless that would ignore a major quick-win (pos 5-15, >1000 impressions).`
    : '';

  const currentYear = new Date().getFullYear();
  const userMessage = `TARGET_ARTICLES: ${target}
CURRENT_YEAR: ${currentYear}
Return exactly ${target} content opportunities. Any topic with a year MUST use ${currentYear}, not an older year. Look for past-year markers in the GSC data and prioritize those as refresh opportunities.

BRAND CONTEXT:
${JSON.stringify(summary, null, 2)}

SEARCH CONSOLE DATA (top 40 scored opportunities from last ${research.days} days):
${JSON.stringify(opportunities, null, 2)}${directionBlock}

Analyze the data and return the JSON structure described in the system prompt. Remember: return exactly ${target} opportunities.`;

  const text = await claudeComplete({
    system: RESEARCH_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: 6000,
    temperature: 0.4
  });

  const parsed = extractJSON(text);
  if (!parsed?.opportunities) {
    throw new Error('Claude returned unexpected output. Try again.');
  }

  // Belt-and-braces year scrub: if Claude still suggested a past-year
  // article title (e.g. "Best X 2024" while it's 2026), rewrite it to
  // the current year client-side so we never publish a stale-dated
  // suggestion. Touches topic_title and suggested_angle only.
  const yearRe = /\b(19|20)\d{2}\b/g;
  for (const opp of parsed.opportunities) {
    if (opp.topic_title && yearRe.test(opp.topic_title)) {
      opp.topic_title = opp.topic_title.replace(yearRe, (y) =>
        Number(y) < currentYear ? String(currentYear) : y
      );
    }
    yearRe.lastIndex = 0;
    if (opp.suggested_angle && yearRe.test(opp.suggested_angle)) {
      opp.suggested_angle = opp.suggested_angle.replace(yearRe, (y) =>
        Number(y) < currentYear ? String(currentYear) : y
      );
    }
    yearRe.lastIndex = 0;
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Pass-through helper: given a specific opportunity the user wants to write,
// pull together the ranking context that the article-generation prompt
// should use.
// ---------------------------------------------------------------------------

export function buildArticleResearchContext(opportunity, research) {
  const page = research.pageByQuery[opportunity.primary_keyword];
  const relatedQueries = research.queries
    .filter(q => q.query !== opportunity.primary_keyword &&
      q.query.toLowerCase().includes((opportunity.primary_keyword || '').toLowerCase().split(' ')[0]))
    .slice(0, 10);

  return {
    primary_keyword: opportunity.primary_keyword,
    current_position: opportunity.current_position,
    current_impressions: opportunity.current_impressions,
    current_clicks: opportunity.current_clicks,
    target_page: opportunity.target_page,
    best_existing_page: page?.page || null,
    best_existing_position: page?.position || null,
    related_queries: relatedQueries.map(q => ({
      query: q.query, position: Number(q.position.toFixed(1)), impressions: q.impressions
    })),
    opportunity_type: opportunity.opportunity_type,
    suggested_angle: opportunity.suggested_angle,
    rationale: opportunity.rationale
  };
}
