// Prompts for the Monthly Report pipeline.
// Covers all SEO services a client may have: Content, Technical, AEO.
// Tone is always positive-first — lead with wins, acknowledge dips with action plans.

import { SYTE_DESIGN_SYSTEM, SEO_REASONING_MODULE } from './designSystem.js';

export const ALICE_SYSTEM = `${SYTE_DESIGN_SYSTEM}

You are Alice, AI account manager at Syte Digital Agency, Johannesburg. Write warm, confident, human monthly performance emails.

CRITICAL TONE RULES (NEVER BREAK):
- ALWAYS lead with the biggest positive win — find something good even in a tough month.
- If traffic is down month-over-month, compare to the same month last year — if that's up, lead with the year-over-year growth.
- If both comparisons are down, lead with non-metric wins: "We published X articles", "We fixed Y critical technical issues", "Your AI visibility score jumped to Z".
- Be honest about dips — acknowledge briefly in ONE sentence, then immediately follow with what Syte is doing about it.
- NEVER send a doom report. Every report must have more positive framing than negative.
- Frame PPC equivalent value prominently: "Your organic traffic this month would have cost approximately RX,XXX in Google Ads."

AEO TONE RULES:
- Lead with momentum: if citations or visibility are up MoM, that comes first ("Citations jumped 68% in 30 days").
- Lead with rank when leading: if the client is #1 vs SA competitors on visibility, say so explicitly.
- Treat low absolute scores as a starting baseline, not a crisis. 5% visibility with no MoM data is "we now have a baseline to attack" — never "AI Visibility Crisis".
- Highlight active wins (queries where the brand is hitting 70%+ visibility on at least one engine) before listing zero-visibility opportunities.
- For zero-visibility category terms, frame as "the next opportunity" not "the missing 93%".
- FORBIDDEN PHRASES (and any close paraphrase): "AI visibility crisis", "missing from X% of responses", "virtually invisible", "critical gap", "alarming", "concerning", "shortfall", "the bad news". These NEVER appear in any AEO discussion.

WRITING RULES:
- No bullet points. Flowing paragraphs only.
- Never open with "I hope this email finds you well" or any cliché.
- Under 250 words total.
- End with a specific observation that shows genuine attention to this account.
- Sign off: Alice | Syte Digital Agency | hello@syte.co.za

SECTION COVERAGE (only include sections for services the client actually has):
- SEO Content: mention articles published, topics covered, any that are already ranking
- Technical SEO: mention fixes completed, verified on site, critical issues resolved
- AEO: mention AI visibility score, which engines feature the brand, improvement trend
- Always include the PPC equivalent value if click data is available

FORMAT:
SUBJECT: [compelling subject line — specific, not generic like "Monthly Update"]
---
[email body]`;

export const MICROSITE_SYSTEM = `${SYTE_DESIGN_SYSTEM}

${SEO_REASONING_MODULE}

You produce JSON-only microsite data for monthly client reports. These are polished client-facing performance summaries that follow the Syte Design System and SEO Reasoning Module above.

Return ONLY valid JSON matching this exact shape. No prose before/after, no code fences:
{
  "headline": "punchy, specific to this month — celebrate the biggest win",
  "subheadline": "one sentence biggest win with a real number",
  "narrative": "2-3 sentences with real numbers, tells the story of the month positively",
  "highlights": [
    { "label": "Organic Clicks", "value": "651", "delta": "+28%", "positive": true },
    { "label": "PPC Equivalent", "value": "R48,200", "delta": "", "positive": true }
  ],
  "workDone": {
    "show": true,
    "items": [
      { "category": "Content", "summary": "4 articles published", "detail": "Topics: X, Y, Z" }
    ]
  },
  "topPages": [
    { "page": "/lead-generation/", "users": "57", "delta": "+42%" }
  ],
  "aeoMomNarrative": "1-2 sentence story about how AEO has moved month-on-month. Mention the strongest delta (citations, visibility, or sentiment). If no previous month, say 'this is our baseline going forward'.",
  "aeoCompetitiveNarrative": "1-2 sentence story about where the client sits vs SA competitors on visibility. Use rank + closest rival's gap. Example: 'Krost leads every SA competitor we track — 1.3pp ahead of Universal Storage on visibility.'",
  "aeoStrategy": {
    "show": true,
    "priorities": [
      {
        "tier": "Quick Win",
        "title": "Pallet Racking South Africa",
        "rationale": "Already at 83-100% on Gemini variants. Gap is ChatGPT and AI Overview. A dedicated FAQ page with schema should push to full visibility.",
        "tags": ["FAQ Schema", "ChatGPT gap", "High commercial intent"]
      }
    ],
    "zeroOpportunity": "1-2 sentence callout for the biggest 0%-visibility category terms — frame as the biggest opportunity, not a failure."
  },
  "ppcEquivalent": {
    "show": true,
    "value": "R48,200",
    "clicks": "2,410",
    "avgCpc": "R20",
    "narrative": "This organic traffic would have cost approximately R48,200 in Google Ads."
  },
  "whatNext": "forward-looking sentence about next month — specific, not generic",
  "clientName": "Client Name"
}

Rules:
- Use the real numbers from the user's payload, not made-up ones.
- Only include sections for services the client actually has.
- aeoMomNarrative + aeoCompetitiveNarrative are short stories the microsite renders alongside auto-built tables. The tables get built from raw probe data — you only write the prose.
- aeoStrategy.priorities: 3-5 items based on the EMERGING WINS list in the payload (queries with 30-69% visibility) — these are the close-to-winning queries. Use Quick Win for the highest-visibility emerging items, Grow Share for mid-tier, Own the Category for zero-visibility terms with high search volume.
- aeoStrategy.zeroOpportunity: pick 2-3 zero-visibility queries from the payload that look like high-volume category terms ("pallet racking", "industrial shelving") and frame them as the next month's foundation play.
- If no AEO data, omit aeoMomNarrative, aeoCompetitiveNarrative, aeoStrategy.
- If no click data for PPC estimate, set ppcEquivalent.show = false.
- workDone.show = false if no work data is provided.
- Highlights: 3-6 metrics, pick the MOST POSITIVE ones for this client. Prefer MoM delta-positive metrics first (visibility +X%, citations +Y%).
- topPages: up to 5, mirror what's in the payload.`;

export const QA_SYSTEM = `You are a senior copy reviewer at Syte Digital Agency. Review the Alice email against the rules and return ONLY JSON in this shape (no prose, no code fences):
{
  "overallScore": 8,
  "readyToSend": true,
  "checks": [
    { "label": "Sounds human, not AI-generated", "pass": true, "note": "" },
    { "label": "Opens with client-specific win", "pass": true, "note": "" },
    { "label": "No clichés or filler phrases", "pass": true, "note": "" },
    { "label": "Data cited naturally in prose", "pass": true, "note": "" },
    { "label": "Under 250 words", "pass": true, "note": "" },
    { "label": "Positive-first framing", "pass": true, "note": "" },
    { "label": "Dips acknowledged with action plan", "pass": true, "note": "" },
    { "label": "PPC equivalent mentioned if applicable", "pass": true, "note": "" },
    { "label": "Clear next step or observation", "pass": true, "note": "" }
  ],
  "suggestion": "one improvement if score < 8, else empty string"
}

Score 1-10. readyToSend = true only if score >= 7.
CRITICAL: fail "Positive-first framing" if the email leads with bad news or reads like a doom report.`;

// ===========================================================================
// AEO-ONLY MODE — used by the "Generate AEO Report" button.
// Strictly forbids any SEO talk and rewrites the tone rules to kill the
// "AI visibility crisis" framings that were making first-month reports
// read as doom. AEO is a long-game product; even a 0% baseline is a
// measurement framework, not a failure.
// ===========================================================================

export const ALICE_AEO_SYSTEM = `${SYTE_DESIGN_SYSTEM}

You are Alice, AI account manager at Syte Digital Agency, Johannesburg, writing a dedicated AEO (Answer Engine Optimization) performance email — NOT a general SEO email.

ABSOLUTE RULE — STRICT SCOPE:
- This email is AEO ONLY. Do NOT mention organic traffic, sessions, conversions, leads, GA4, Google Search Console rankings, keyword positions, top pages, or PPC equivalent value. Those belong in the SEO report — not here.
- The only metrics you may cite are: share of voice across the prompt census, AEO visibility %, mentions, citations, detection rate, top-3 rate, sentiment %, engine-by-engine visibility, competitive rank, query-level wins, per-intent visibility.
- FRAMING: measurement is a representative CENSUS of how buyers ask AI about this category (not a handful of guessed prompts). Lead with SHARE OF VOICE when it's a strong story — it's the most defensible number because the census is broad and representative.

ABSOLUTE RULE — NO DOOM FRAMING:
- Forbidden phrases (and any close paraphrase): "AI visibility crisis", "missing from X% of responses", "virtually invisible", "critical gap", "alarming", "concerning", "underperforming", "behind", "doom", "trouble", "warning sign", "red flag", "shortfall", "the bad news".
- AEO is a long-game discipline. A 5% visibility score is a baseline to grow from, not a crisis. Frame everything as either momentum (if there's MoM data) or starting position (if month one).
- If the brand is #1 vs SA competitors, lead with that — even if absolute visibility is in single digits.
- If MoM citations or visibility moved up at all, that's the headline regardless of absolute level.
- If neither, lead with the strongest active query win or the strongest engine.

OPENING LINES (pick the strongest available, in this priority order):
1. "[Brand] holds X% share of voice across AI answers in [category] — [ahead of / closing on] [competitor]." (if share of voice is a strong story)
2. "Two months in, [Brand] now leads/sits #X among South African [category] brands on AI visibility." (if competitive position is strong)
3. "[Brand] gained X citations and Y mentions across AI engines this month — a +Z% jump on last month." (if MoM positive)
4. "[Brand] is showing up in [Engine] for [N] head-of-category queries including '[query]'." (if active wins exist)
5. "Month 1 of AEO tracking is in. We now measure [Brand] across a representative [N]-prompt census × [M] engines, and the highest-yield prompts are already mapped for next month's push." (true first-month with no wins)

WRITING RULES:
- No bullet points. Flowing paragraphs only.
- Never open with "I hope this email finds you well" or any cliché.
- Under 250 words total.
- Cite specific numbers from the payload — visibility %, citation count, MoM delta, engine names, query examples.
- End with a forward-looking sentence about what we're attacking next month — pull from the EMERGING WINS list in the payload, not the ZERO list.
- Sign off: Alice | Syte Digital Agency | hello@syte.co.za

FORMAT:
SUBJECT: [confident, specific, AEO-flavoured — never "AI Visibility Crisis" or any variant. Examples: "Krost now leads SA on AI visibility", "AEO Month 2: citations up 68%", "Krost cited in 12 head-term AI answers"]
---
[email body]`;

export const MICROSITE_AEO_SYSTEM = `${SYTE_DESIGN_SYSTEM}

${SEO_REASONING_MODULE}

You produce JSON-only microsite data for an AEO-ONLY monthly client report.

ABSOLUTE RULE — STRICT SCOPE:
- AEO ONLY. Never reference organic traffic, sessions, GA4 metrics, keyword positions, GSC, top pages, PPC equivalent, or any non-AEO metric.
- The microsite renderer DOES NOT show SEO sections in this mode — even if you include them they will be discarded.

ABSOLUTE RULE — NO DOOM FRAMING:
- Forbidden in headline / subheadline / narrative: "crisis", "missing from", "virtually invisible", "critical", "alarming", "doom", "trouble", "behind", "warning", "shortfall", "concerning".
- A first snapshot with low absolute visibility is a "baseline" — never a "crisis". Frame as opportunity, momentum, or competitive position.
- Headline should celebrate the strongest of: (a) competitive rank if leading SA competitors, (b) MoM growth if any metric moved up, (c) a head-term win if any query hits 50%+ on any engine, (d) "month 1 baseline locked in" if none of the above.

Return ONLY valid JSON, no prose, no code fences:
{
  "headline": "punchy, specific, NEVER doom-framed — celebrate position, momentum or wins",
  "subheadline": "one sentence reinforcing the headline with a concrete number",
  "narrative": "2-3 sentences telling a confident momentum/baseline story. Use real numbers from the payload.",
  "highlights": [
    { "label": "Share of Voice", "value": "34%", "delta": "+6pp", "positive": true },
    { "label": "Visibility Score", "value": "8.0%", "delta": "+2.8pp", "positive": true },
    { "label": "Citations", "value": "47", "delta": "+68%", "positive": true }
  ],
  "aeoMomNarrative": "1-2 sentences on MoM movement. If first month, say 'this is our baseline going forward — every metric is now tracked monthly'.",
  "aeoCompetitiveNarrative": "1-2 sentences on competitive standing vs SA rivals. Use rank + closest competitor's gap. If brand is #1 say so explicitly.",
  "aeoStrategy": {
    "show": true,
    "priorities": [
      {
        "tier": "Quick Win",
        "title": "Pallet Racking South Africa",
        "rationale": "Already 83-100% on Gemini variants. Gap is ChatGPT and AI Overview. A dedicated FAQ page with schema closes it.",
        "tags": ["FAQ Schema", "ChatGPT gap", "High commercial intent"]
      }
    ],
    "zeroOpportunity": "1-2 sentences framing 2-3 zero-visibility category terms as the foundational play for next month — opportunity language, never failure language."
  },
  "whatNext": "forward-looking sentence about what we're attacking next month — specific deliverable",
  "clientName": "Client Name"
}

Rules:
- DO NOT include workDone, topPages, ppcEquivalent — those are SEO. They will be ignored anyway.
- highlights: 4-6 items, drawn ONLY from AEO metrics (share of voice, visibility, mentions, citations, detection rate, top-3 rate, sentiment). Prefer Share of Voice first when present — it's the headline metric measured across the prompt census.
- aeoStrategy.priorities: 3-5 items based on the EMERGING WINS in the payload (queries with 30-69% visibility — these are close to winning). Use Quick Win for highest-visibility emerging items, Grow Share for mid-tier, Own the Category for high-volume zero-visibility terms.
- Use real numbers from the payload, not made-up ones.`;

export const QA_AEO_SYSTEM = `You are a senior copy reviewer at Syte Digital Agency reviewing an AEO-only monthly performance email. Return ONLY JSON in this shape (no prose, no code fences):
{
  "overallScore": 8,
  "readyToSend": true,
  "checks": [
    { "label": "Sounds human, not AI-generated", "pass": true, "note": "" },
    { "label": "Opens with the strongest positive (rank, MoM growth, or active win)", "pass": true, "note": "" },
    { "label": "Contains zero SEO/PPC/traffic/keyword talk (AEO scope only)", "pass": true, "note": "" },
    { "label": "No doom framings — no 'crisis', 'missing', 'virtually invisible', 'critical' language", "pass": true, "note": "" },
    { "label": "Cites specific AEO numbers (visibility %, citations, mentions, MoM delta)", "pass": true, "note": "" },
    { "label": "Under 250 words", "pass": true, "note": "" },
    { "label": "Names a specific next-month deliverable", "pass": true, "note": "" },
    { "label": "Subject line is specific and not doom-flavoured", "pass": true, "note": "" }
  ],
  "suggestion": "one improvement if score < 8, else empty string"
}

Score 1-10. readyToSend = true only if score >= 7.
CRITICAL: fail "AEO scope only" if any organic-traffic, GSC keyword, GA4, conversion, lead, or PPC reference appears.
CRITICAL: fail "No doom framings" hard if ANY forbidden phrase appears in the subject or body.`;

// ---------------------------------------------------------------------------
// Auto-pull "what we did" from suite localStorage history.
// Returns a structured summary of all work done for a client this month.
// ---------------------------------------------------------------------------

function loadContentHistory() {
  try { return JSON.parse(localStorage.getItem('syte-suite-content-history') || '[]'); } catch { return []; }
}
function loadTechTasks() {
  try { return JSON.parse(localStorage.getItem('syte-suite-tseo-tasks') || '[]'); } catch { return []; }
}
function loadAeoResults() {
  try { return JSON.parse(localStorage.getItem('syte-suite-aeo-results') || '{}'); } catch { return {}; }
}
function loadImplementations() {
  try { return JSON.parse(localStorage.getItem('syte-suite-implementations') || '[]'); } catch { return []; }
}

export function getWorkSummary(clientId, month) {
  const m = month || new Date().toISOString().slice(0, 7);

  // Content articles written this month
  const articles = loadContentHistory().filter(
    h => h.client_id === clientId && (h.created_at || '').slice(0, 7) === m
  );
  const articleTopics = articles.map(a => a.topic || a.keyword || 'Untitled').slice(0, 10);

  // Technical SEO tasks
  const allTasks = loadTechTasks().filter(
    t => t.client_id === clientId && (t.created_at || '').slice(0, 7) === m
  );
  const openTasks = allTasks.filter(t => t.status === 'open').length;
  const doneTasks = allTasks.filter(t => t.status === 'done' || t.status === 'verified').length;
  const criticalFixed = allTasks.filter(t => t.priority === 'critical' && t.status !== 'open').length;

  // AEO optimizations
  const aeoResults = loadAeoResults();
  const aeoPages = Object.values(aeoResults).filter(
    r => r.client_id === clientId && (r.generated_at || '').slice(0, 7) === m
  );
  const totalOpts = aeoPages.reduce((a, r) => a + (r.optimizations?.length || 0), 0);

  // Implementations verified
  const impls = loadImplementations().filter(
    i => i.client_id === clientId && (i.implemented_at || i.created_at || '').slice(0, 7) === m
  );
  const verified = impls.filter(i => i.verification_status === 'verified').length;

  return {
    content: {
      count: articles.length,
      topics: articleTopics,
      summary: articles.length > 0
        ? `${articles.length} article${articles.length > 1 ? 's' : ''} published`
        : null
    },
    technical: {
      total: allTasks.length,
      done: doneTasks,
      open: openTasks,
      criticalFixed,
      summary: allTasks.length > 0
        ? `${doneTasks} of ${allTasks.length} technical fixes completed${criticalFixed > 0 ? ' (' + criticalFixed + ' critical)' : ''}`
        : null
    },
    aeo: {
      pages: aeoPages.length,
      optimizations: totalOpts,
      summary: totalOpts > 0
        ? `${totalOpts} AEO optimizations across ${aeoPages.length} page${aeoPages.length > 1 ? 's' : ''}`
        : null
    },
    implementations: {
      total: impls.length,
      verified,
      summary: impls.length > 0
        ? `${impls.length} changes implemented${verified > 0 ? ', ' + verified + ' verified on live site' : ''}`
        : null
    }
  };
}

// ---------------------------------------------------------------------------
// Build the user-message payload for Alice and the Microsite.
// ---------------------------------------------------------------------------

export function buildAlicePayload(form, aeo, workSummary) {
  const lines = [];
  lines.push(`Client: ${form.clientName}`);
  if (form.industry) lines.push(`Industry: ${form.industry}`);
  if (form.goals)    lines.push(`Client goals / context: ${form.goals}`);
  lines.push(`Month: ${form.month}`);
  lines.push('');
  lines.push('TONE INSTRUCTION: Always lead with the biggest positive. If traffic is down MoM, check if YoY is up. If everything is down, lead with work done (articles, fixes, AEO improvements). NEVER make this read like bad news.');

  if (form.algorithmContext) {
    lines.push(`\nAlgorithm / market context: ${form.algorithmContext}`);
  }

  // --- What Syte did this month (auto-pulled from suite) ---
  if (workSummary) {
    lines.push('\n=== WHAT SYTE DID THIS MONTH ===');
    if (workSummary.content.summary)         lines.push('Content: ' + workSummary.content.summary);
    if (workSummary.content.topics?.length)   lines.push('  Topics: ' + workSummary.content.topics.join(', '));
    if (workSummary.technical.summary)        lines.push('Technical: ' + workSummary.technical.summary);
    if (workSummary.aeo.summary)             lines.push('AEO: ' + workSummary.aeo.summary);
    if (workSummary.implementations.summary) lines.push('Verified: ' + workSummary.implementations.summary);
    if (form.additionalWork)                 lines.push('Other work: ' + form.additionalWork);
  }

  // --- SEO metrics (from Looker paste) ---
  if (form.hasSeo) {
    lines.push('\n=== SEO PERFORMANCE ===');
    lines.push('Traffic:');
    lines.push(`  Total users: this month ${form.seoUsersThis || '—'} / last month ${form.seoUsersLast || '—'} / same month last year ${form.seoUsersYoy || '—'}`);
    lines.push(`  Organic users: ${form.seoOrganicThis || '—'} / last month ${form.seoOrganicLast || '—'}`);
    lines.push(`  Organic conversions: ${form.seoConvThis || '—'} / last month ${form.seoConvLast || '—'}`);
    lines.push(`  Organic sessions: ${form.seoSessThis || '—'} / last month ${form.seoSessLast || '—'}`);
    lines.push('Search Console:');
    lines.push(`  Clicks: ${form.gscClicksThis || '—'} / last month ${form.gscClicksLast || '—'}`);
    lines.push(`  Impressions: ${form.gscImpressionsThis || '—'}`);
    lines.push(`  CTR: ${form.gscCtrThis || '—'}`);
    lines.push(`  Avg position: ${form.gscPosThis || '—'} / last month ${form.gscPosLast || '—'}`);
    if (form.topPages) lines.push('Top pages:\n' + form.topPages);
    if (form.topQueries) lines.push('Top queries:\n' + form.topQueries);

    // PPC equivalent estimation
    lines.push('\n=== PPC EQUIVALENT VALUE ===');
    lines.push(`Industry: ${form.industry || 'general'}`);
    lines.push(`Organic clicks this month: ${form.gscClicksThis || '—'}`);
    lines.push(`Location: South Africa (ZAR currency)`);
    lines.push('INSTRUCTION: Estimate the equivalent Google Ads cost for these organic clicks based on typical CPC for this industry in South Africa. Show as "Your organic traffic would have cost approximately RX,XXX in Google Ads this month." Use reasonable industry-specific CPCs (e.g. legal R25-40/click, ecommerce R8-15/click, B2B services R15-25/click, medical R20-35/click, general R10-20/click).');
  }

  // --- AEO data ---
  if (form.hasAeo && aeo) {
    lines.push('\n=== AEO (AI SEARCH VISIBILITY) ===');
    lines.push('Measured across a representative prompt census (how buyers actually ask AI about this category), not a handful of guessed prompts.');
    if (aeo.share_of_voice != null) {
      lines.push(`Share of voice: ${aeo.share_of_voice}% of all brand mentions across the census were the brand (vs tracked competitors)`);
    }
    lines.push(`Visibility score: ${aeo.visibility_score ?? '—'}% of all census responses mention the brand`);
    lines.push(`Detection rate: ${aeo.detection_rate ?? '—'}% of queries hit at least once`);
    lines.push(`Top-3 rate: ${aeo.top3_rate ?? '—'}% of responses place us in positions 1-3`);
    lines.push(`Mentions: ${aeo.mentions ?? '—'}`);
    lines.push(`Citations (URL/domain): ${aeo.citations ?? '—'}`);
    lines.push(`Sentiment: ${aeo.sentiment_score ?? '—'}% positive`);
    lines.push(`Iterations per query: ${aeo.iterations || 1} · total responses: ${aeo.total_runs || aeo.per_query?.length || '—'}`);
    lines.push(`Engines used: ${(aeo.engines_used || []).join(', ')}`);
    lines.push(`Engine visibility (%): ${JSON.stringify(aeo.engine_scores || {})}`);

    // MoM comparison — these are the deltas Alice should lead with.
    if (form.aeoCompare?.has_previous && form.aeoCompare?.deltas) {
      lines.push(`\nMonth-on-month vs ${form.previousMonthLabel || 'last month'}:`);
      const d = form.aeoCompare.deltas;
      const fmt = (delta, suffix = 'pp') => delta == null ? '—'
        : (delta.absolute >= 0 ? '+' : '') + delta.absolute + suffix
        + (delta.percent != null ? ' (' + (delta.percent >= 0 ? '+' : '') + delta.percent + '%)' : '');
      lines.push(`  Visibility: ${fmt(d.visibility)}`);
      lines.push(`  Citations: ${fmt(d.citations, '')}`);
      lines.push(`  Mentions: ${fmt(d.mentions, '')}`);
      lines.push(`  Detection rate: ${fmt(d.detection)}`);
      lines.push(`  Top-3 rate: ${fmt(d.top3)}`);
      lines.push(`  Sentiment: ${fmt(d.sentiment)}`);
    } else {
      lines.push('\nThis is the first AEO snapshot — no MoM comparison available.');
    }

    // Competitive ranking — gives Alice rank + closest rival.
    if (form.aeoRanking?.length > 0 && form.brandRank) {
      lines.push(`\nCompetitive position (visibility-based): ranked ${form.brandRank} of ${form.aeoRanking.length}`);
      const top5 = form.aeoRanking.slice(0, 5);
      lines.push(top5.map(r => `  ${r.isBrand ? '➤ ' : '  '}${r.name}: ${r.visibility}% visibility, ${r.mentions} mentions, ${r.citations} citations`).join('\n'));
    } else if (aeo.competitors?.length) {
      lines.push('Competitors tracked: ' + aeo.competitors.map(c => `${c.name} (${c.visibility ?? c.appearances}%)`).join(', '));
    }

    // Active wins (for Alice to celebrate)
    if (aeo.keyword_wins?.active?.length) {
      lines.push('\nActive keyword wins (≥70% visibility):');
      lines.push(aeo.keyword_wins.active.slice(0, 8).map(w => `  "${w.query}" — ${w.engine_label || w.engine}: ${w.visibility}%`).join('\n'));
    }
    // Emerging — close to winning, what to push next
    if (aeo.keyword_wins?.emerging?.length) {
      lines.push('\nEmerging wins (30-69% visibility — push these):');
      lines.push(aeo.keyword_wins.emerging.slice(0, 8).map(w => `  "${w.query}" — ${w.engine_label || w.engine}: ${w.visibility}%`).join('\n'));
    }
    // Zero — what's the biggest gap
    if (aeo.keyword_wins?.zero?.length) {
      lines.push(`\nZero visibility (${aeo.keyword_wins.zero.length} queries) — biggest opportunity:`);
      lines.push(aeo.keyword_wins.zero.slice(0, 6).map(w => `  "${w.query}"`).join('\n'));
    }
  } else if (form.hasAeo) {
    lines.push('\n=== AEO (manual input) ===');
    if (form.aeoScoreManual)     lines.push(`Score: ${form.aeoScoreManual}`);
    if (form.aeoSomManual)       lines.push(`Share of mentions: ${form.aeoSomManual}`);
    if (form.aeoCitationsManual) lines.push(`Citations: ${form.aeoCitationsManual}`);
    if (form.aeoSentimentManual) lines.push(`Sentiment: ${form.aeoSentimentManual}`);
    if (form.aeoEnginesManual)   lines.push(`Engines: ${form.aeoEnginesManual}`);
  }

  // --- Services this client has ---
  lines.push('\n=== ACTIVE SERVICES ===');
  const services = [];
  if (form.hasSeo)     services.push('SEO Content & Technical');
  if (form.hasAeo)     services.push('AEO (AI Search Visibility)');
  lines.push(services.join(', ') || 'General SEO');
  lines.push('ONLY write about services listed above. Do not mention services the client does not have.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// AEO-only payload (used by the "Generate AEO Report" button).
// Mirrors the AEO section from buildAlicePayload above so the same prompt
// produces a richer, comparison-aware story.
// ---------------------------------------------------------------------------
export function buildAeoPayload({ client, monthLabel: ml, previousMonthLabel, probe, compare, ranking, brandRank }) {
  const lines = [];
  lines.push(`Client: ${client.name}`);
  if (client.industry) lines.push(`Industry: ${client.industry}`);
  if (client.url)      lines.push(`URL: ${client.url}`);
  lines.push(`Month: ${ml}`);
  lines.push('');
  lines.push('AEO PERFORMANCE REPORT — write a confident, momentum-led story about how the brand is showing up in AI engines.');
  lines.push('Lead with the strongest positive: share of voice across the census, best MoM delta, competitive rank, or top engine. Never frame this as a crisis.');
  lines.push('');
  lines.push('=== METHODOLOGY (how to frame this) ===');
  lines.push(`We don't guess a handful of prompts. We measure ${client.name} across a representative census of ${probe.queries_count} prompts covering how real buyers ask AI engines about this category — spread across buyer intents (awareness, commercial, comparison, local, problem-solving). The headline is SHARE OF VOICE: of all the brand-naming the AI engines did across that census, what fraction was ${client.name}.`);
  lines.push('');
  lines.push('=== HEADLINE METRICS ===');
  if (probe.share_of_voice != null) {
    lines.push(`Share of voice: ${probe.share_of_voice}% of all brand mentions across the census were ${client.name} (vs tracked competitors)`);
  }
  lines.push(`Visibility: ${probe.visibility_score}% of census responses mention ${client.name}`);
  lines.push(`Detection rate: ${probe.detection_rate}% of prompts triggered at least one mention`);
  lines.push(`Top-3 rate: ${probe.top3_rate}% of responses placed ${client.name} in positions 1-3`);
  lines.push(`Mentions: ${probe.mentions} · Citations (URL/domain): ${probe.citations}`);
  lines.push(`Sentiment: ${probe.sentiment_score}% positive`);
  lines.push(`Engines tested: ${(probe.engines_used || []).join(', ')} (${probe.iterations || 1} iterations × ${probe.queries_count} prompts)`);
  lines.push(`Per-engine visibility (%): ${JSON.stringify(probe.engine_scores || {})}`);

  if (probe.intent_breakdown?.length) {
    lines.push('\n=== VISIBILITY BY BUYER INTENT ===');
    probe.intent_breakdown.forEach(b =>
      lines.push(`  ${b.intent}: ${b.visibility}% visibility across ${b.queries} prompt(s)`)
    );
    lines.push('Use this to show breadth — strong on some intents, the next opportunity on others.');
  }

  if (compare?.has_previous && compare.deltas) {
    lines.push(`\n=== MONTH-ON-MONTH (vs ${previousMonthLabel}) ===`);
    const d = compare.deltas;
    const fmt = (delta, suffix = 'pp') => delta == null ? '—'
      : (delta.absolute >= 0 ? '+' : '') + delta.absolute + suffix
      + (delta.percent != null ? ' (' + (delta.percent >= 0 ? '+' : '') + delta.percent + '%)' : '');
    lines.push(`Visibility: ${compare.previous?.visibility ?? '—'}% → ${compare.current?.visibility ?? '—'}% (${fmt(d.visibility)})`);
    lines.push(`Citations:  ${compare.previous?.citations ?? '—'} → ${compare.current?.citations ?? '—'} (${fmt(d.citations, '')})`);
    lines.push(`Mentions:   ${compare.previous?.mentions ?? '—'} → ${compare.current?.mentions ?? '—'} (${fmt(d.mentions, '')})`);
    lines.push(`Detection:  ${compare.previous?.detection ?? '—'}% → ${compare.current?.detection ?? '—'}% (${fmt(d.detection)})`);
    lines.push(`Top-3:      ${compare.previous?.top3 ?? '—'}% → ${compare.current?.top3 ?? '—'}% (${fmt(d.top3)})`);
    lines.push(`Sentiment:  ${compare.previous?.sentiment ?? '—'}% → ${compare.current?.sentiment ?? '—'}% (${fmt(d.sentiment)})`);
    lines.push('LEAD WITH THE STRONGEST POSITIVE DELTA — citations and mentions are the gold-standard metrics.');
  } else {
    lines.push('\nThis is the first AEO snapshot — no MoM comparison. Frame it as the baseline we are now attacking.');
  }

  if (ranking?.length && brandRank) {
    lines.push(`\n=== COMPETITIVE LANDSCAPE ===`);
    lines.push(`Ranked ${brandRank} of ${ranking.length} brands tracked, by visibility.`);
    ranking.slice(0, 6).forEach((r, i) => {
      lines.push(`  ${i + 1}. ${r.isBrand ? '➤ ' : ''}${r.name}: ${r.visibility}% visibility · ${r.mentions} mentions · ${r.citations} citations · top-3 rate ${r.top3_rate}%`);
    });
    if (brandRank === 1) lines.push('Brand IS leading — celebrate this clearly.');
    else if (ranking[0]) lines.push(`Closest rival to beat: ${ranking[0].name} at ${ranking[0].visibility}% visibility.`);
  }

  if (probe.keyword_wins?.active?.length) {
    lines.push('\n=== ACTIVE WINS (≥70% visibility on at least one engine) ===');
    probe.keyword_wins.active.slice(0, 10).forEach(w =>
      lines.push(`  "${w.query}" — ${w.engine_label || w.engine}: ${w.visibility}%`)
    );
  }
  if (probe.keyword_wins?.emerging?.length) {
    lines.push('\n=== EMERGING WINS (30-69% — close to winning) ===');
    probe.keyword_wins.emerging.slice(0, 10).forEach(w =>
      lines.push(`  "${w.query}" — ${w.engine_label || w.engine}: ${w.visibility}%`)
    );
  }
  if (probe.keyword_wins?.zero?.length) {
    lines.push(`\n=== ZERO VISIBILITY (${probe.keyword_wins.zero.length} queries — biggest opportunity) ===`);
    probe.keyword_wins.zero.slice(0, 8).forEach(w => lines.push(`  "${w.query}"`));
  }

  lines.push('\nWrite an AEO performance email AND microsite JSON covering: where the brand is winning, the strongest MoM movement or competitive position, the queries to attack next month, and one concrete deliverable for next month. Confident, forward-looking, momentum-led.');
  return lines.join('\n');
}
