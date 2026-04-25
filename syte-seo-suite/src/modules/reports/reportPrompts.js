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
      { "category": "Content", "summary": "4 articles published", "detail": "Topics: X, Y, Z" },
      { "category": "Technical", "summary": "12 fixes implemented", "detail": "3 critical, 5 high priority" },
      { "category": "AEO", "summary": "8 optimizations deployed", "detail": "Schema, answer blocks, FAQ" }
    ]
  },
  "topPages": [
    { "page": "/lead-generation/", "users": "57", "delta": "+42%" }
  ],
  "aeoSection": {
    "show": true,
    "score": "72",
    "scoreDelta": "+8 pts",
    "byEngine": { "chatgpt": 80, "perplexity": 65, "gemini": 70, "claude": 75 },
    "topQueries": [
      { "query": "best digital marketing agency JHB", "chatgpt": true, "perplexity": false, "gemini": true, "claude": true }
    ],
    "competitors": [
      { "name": "Competitor A", "score": 85 },
      { "name": "Client", "score": 72 }
    ],
    "narrative": "2 sentence AEO story — positive framing",
    "sentiment": "84% positive"
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
- If no AEO data is provided, set aeoSection.show = false.
- If no click data for PPC estimate, set ppcEquivalent.show = false.
- workDone.show = false if no work data is provided.
- Highlights: 3-6 metrics, pick the MOST POSITIVE ones for this client.
- Always frame deltas positively where possible — if MoM is down but YoY is up, show YoY.
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
    lines.push(`Overall score: ${aeo.overall_score}/100`);
    if (aeo.previous_score != null) lines.push(`Previous month: ${aeo.previous_score}/100`);
    lines.push(`Engines used: ${(aeo.engines_used || []).join(', ')}`);
    lines.push(`Engine scores: ${JSON.stringify(aeo.engine_scores || {})}`);
    lines.push(`Sentiment: ${aeo.sentiment}`);
    if (aeo.competitors?.length) {
      lines.push('Competitors tracked: ' + aeo.competitors.map(c => `${c.name} (${c.appearances})`).join(', '));
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
