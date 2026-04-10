// Prompts for the 3-call Monthly Report pipeline.

export const ALICE_SYSTEM = `You are Alice, AI account manager at Syte Digital Agency, Johannesburg. Write warm, confident, human monthly performance emails.

RULES:
- No bullet points. Flowing paragraphs only.
- Never open with "I hope this email finds you well" or any cliché.
- Lead with the ONE win most relevant to THIS client's stated goals.
- Be honest about dips — acknowledge briefly, explain what's being done.
- Under 200 words total.
- End with a specific observation that shows genuine attention to this account. Not generic. Reference something real.
- Sign off: Alice | Syte Digital Agency | hello@syte.co.za

FORMAT:
SUBJECT: [line]
---
[email body]`;

export const MICROSITE_SYSTEM = `You produce JSON-only microsite data for monthly client reports.

Return ONLY valid JSON matching this exact shape. No prose before/after, no code fences:
{
  "headline": "punchy, specific to this month — not generic",
  "subheadline": "one sentence biggest win",
  "narrative": "2-3 sentences with real numbers, tells the story",
  "highlights": [
    { "label": "Clicks", "value": "651", "delta": "+28%", "positive": true }
  ],
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
    "narrative": "2 sentence AEO story",
    "sentiment": "84% positive"
  },
  "whatNext": "forward-looking sentence about next month",
  "clientName": "Client Name"
}

Rules:
- Use the real numbers from the user's payload, not made-up ones.
- If no AEO data is provided, set aeoSection.show = false.
- Highlights: 3-5 metrics, pick the most relevant for this client.
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
    { "label": "Under 200 words", "pass": true, "note": "" },
    { "label": "Honest about any dips", "pass": true, "note": "" },
    { "label": "Clear next step or observation", "pass": true, "note": "" }
  ],
  "suggestion": "one improvement if score < 8, else empty string"
}

Score 1-10. readyToSend = true only if score >= 7.`;

// Build the user-message payload for Alice. Passes everything she might need
// as a single natural-language block.
export function buildAlicePayload(form, aeo) {
  const lines = [];
  lines.push(`Client: ${form.clientName}`);
  if (form.goals)   lines.push(`Client goals / context: ${form.goals}`);
  if (form.tone)    lines.push(`Tone: ${form.tone}`);
  if (form.month)   lines.push(`Month: ${form.month}`);
  if (form.includeAlgorithm && form.algorithmContext) {
    lines.push(`Algorithm / context updates: ${form.algorithmContext}`);
  }

  if (form.hasSeo) {
    lines.push('');
    lines.push('SEO — Traffic:');
    lines.push(`  Total users: this month ${form.seoUsersThis || '—'} / last month ${form.seoUsersLast || '—'} / same month last year ${form.seoUsersYoy || '—'}`);
    lines.push(`  Organic users: ${form.seoOrganicThis || '—'} / ${form.seoOrganicLast || '—'}`);
    lines.push(`  Organic conversions: ${form.seoConvThis || '—'} / ${form.seoConvLast || '—'}`);
    lines.push(`  Organic sessions: ${form.seoSessThis || '—'} / ${form.seoSessLast || '—'}`);
    lines.push('SEO — Search Console:');
    lines.push(`  Clicks: ${form.gscClicksThis || '—'} / ${form.gscClicksLast || '—'}`);
    lines.push(`  Impressions: ${form.gscImpressionsThis || '—'}`);
    lines.push(`  CTR: ${form.gscCtrThis || '—'}`);
    lines.push(`  Avg position: ${form.gscPosThis || '—'} / ${form.gscPosLast || '—'}`);
    if (form.topPages) lines.push('Top pages:\n' + form.topPages);
    if (form.topQueries) lines.push('Top queries:\n' + form.topQueries);
  }

  if (form.hasAeo && aeo) {
    lines.push('');
    lines.push('AEO Snapshot:');
    lines.push(`  Overall score: ${aeo.overall_score}/100`);
    lines.push(`  Engines used: ${(aeo.engines_used || []).join(', ')}`);
    lines.push(`  Engine scores: ${JSON.stringify(aeo.engine_scores || {})}`);
    lines.push(`  Sentiment: ${aeo.sentiment}`);
    if (aeo.competitors?.length) {
      lines.push('  Competitors tracked: ' + aeo.competitors.map(c => `${c.name} (${c.appearances})`).join(', '));
    }
  } else if (form.hasAeo) {
    lines.push('');
    lines.push('AEO (manual):');
    if (form.aeoScoreManual)     lines.push(`  Score: ${form.aeoScoreManual}`);
    if (form.aeoSomManual)       lines.push(`  Share of mentions: ${form.aeoSomManual}`);
    if (form.aeoCitationsManual) lines.push(`  Citations: ${form.aeoCitationsManual}`);
    if (form.aeoSentimentManual) lines.push(`  Sentiment: ${form.aeoSentimentManual}`);
    if (form.aeoEnginesManual)   lines.push(`  Engines: ${form.aeoEnginesManual}`);
  }

  return lines.join('\n');
}
