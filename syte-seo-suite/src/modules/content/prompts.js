// Content Engine — shared prompt rules (ported from the original tool).

const CORE_RULES = `
# SYTE CONTENT ENGINE — CORE RULES

Follow every rule below. These are non-negotiable structural and editorial standards.

## Structural Requirements
- One H1 only, maximum 60 characters, must contain the primary keyword.
- Meta Title: 50–58 characters, different from the H1, with the brand at the end (e.g. "… | Brand").
- Meta Description: 150–160 characters.
- AEO Summary Block: 40–80 words, placed directly after the H1, written in answer-first format (answer the main user question in the first sentence).
- GEO location reinforcement throughout the article — mention the location naturally in intro, at least one H2, and the conclusion.
- Paragraphs: maximum 2–3 lines each. Short, scannable, mobile-friendly.
- Include comparison tables and step-by-step numbered guides where relevant to the topic.
- Use descriptive internal-link anchor text. NEVER use "click here", "read more", or "learn more" as anchor text.
- Never present hard statistics without citing the source inline.
- Embed E-E-A-T signals: expert author attribution, first-hand experience phrasing, trust markers, credentials.

## Forbidden Phrases (AI clichés)
Do NOT use any of the following or their close variants:
- "In today's world…", "In today's fast-paced world…"
- "Let's dive in", "Let's explore", "Buckle up"
- "In conclusion", "At the end of the day"
- "It is important to note", "It's worth noting"
- "Unlock the power of", "Game-changer", "Revolutionize"
- "Navigate the world of", "Embark on a journey"

## Tone and Voice
- Match the brand voice provided.
- Write like a human subject-matter expert, not a marketing bot.
- Active voice, concrete nouns, concrete verbs.
- Address the reader directly when helpful.

## Output Sections
Always produce, in order:
1. Meta Title
2. Meta Description
3. H1
4. AEO Summary Block (40–80 words)
5. Article body with H2/H3 hierarchy
6. FAQ section (4–6 Q&As written to target PAA)
7. JSON-LD schema block (Article + FAQPage + BreadcrumbList + where relevant HowTo or Product)
`;

const INDUSTRY_RULES = {
  medical: `
## MEDICAL COMPLIANCE
- Include a medical disclaimer at the top and bottom: "This content is for informational purposes only and is not a substitute for professional medical advice, diagnosis, or treatment."
- Use hedging language ("may", "can", "in many cases") rather than absolute claims.
- Never promise outcomes or cures.
- Cite peer-reviewed sources for any clinical claim.
`,
  legal: `
## LEGAL COMPLIANCE
- Include a legal disclaimer at the top and bottom: "This content is for general informational purposes only and does not constitute legal advice. Consult a qualified attorney for advice on your specific situation."
- Avoid giving jurisdiction-specific advice.
- Clearly distinguish general information from attorney guidance.
`,
  financial: `
## FINANCIAL COMPLIANCE
- Include a financial disclaimer at the top and bottom: "This content is for informational purposes only and is not financial, investment, or tax advice. Consult a licensed financial professional before making any decisions."
- Do not make performance guarantees.
- State risk whenever discussing investments.
`,
  gambling: `
## GAMBLING COMPLIANCE
- Include a responsible gambling disclaimer at the top and bottom.
- Reference the NRGP helpline: "National Responsible Gambling Programme — 0800 006 008".
- Include an age restriction notice: "18+ only. Gamble responsibly."
- Never promote gambling as income. Never imply guaranteed wins.
`,
};

function industryBlock(industry) {
  const key = (industry || '').toLowerCase();
  for (const [k, block] of Object.entries(INDUSTRY_RULES)) {
    if (key.includes(k)) return block;
  }
  return '';
}

export function buildSystemPrompt(client) {
  const brand = client?.name || 'the brand';
  const voice = client?.voice || 'professional, helpful, expert';
  const audience = client?.audience || 'general web readers';
  const location = client?.location || '';
  const org = client?.org_name || client?.name || 'the organization';
  const author = client?.author || 'In-house editorial team';
  const creds = client?.author_creds || '';
  const internal = client?.internal_links || '';
  const industry = client?.industry || '';

  return `${CORE_RULES}

## BRAND CONTEXT
- Brand: ${brand}
- Organization: ${org}
- Voice: ${voice}
- Audience: ${audience}
- Location (GEO): ${location}
- Author byline: ${author}${creds ? ` — ${creds}` : ''}
- Brand brief: ${client?.context || '—'}

## INTERNAL LINK INVENTORY
Use any of the following internal links where topically relevant, with descriptive anchor text:
${internal || '(none provided)'}

${industryBlock(industry)}
`.trim();
}

export function buildNewArticleUserPrompt({ topic, primaryKeyword, secondaryKeywords, wordTarget, notes }) {
  return `Write a new SEO article with these parameters:

Topic: ${topic}
Primary keyword: ${primaryKeyword}
Secondary keywords: ${secondaryKeywords || '(none)'}
Target length: ${wordTarget || '1500-2000'} words
Extra notes: ${notes || '(none)'}

Follow every rule in the system prompt. Output the full article.`;
}

export function buildRewritePrompt({ original, goal }) {
  return `Rewrite and expand the following content. Keep the author voice.
Goal: ${goal || 'improve SEO, readability, E-E-A-T, and AEO coverage'}

--- ORIGINAL ---
${original}
--- END ORIGINAL ---

Output the rewritten article in full, following every rule in the system prompt.`;
}

export function buildMetadataPrompt({ pageContent, primaryKeyword }) {
  return `Generate metadata and schema for the following page content.
Primary keyword: ${primaryKeyword || '(infer from content)'}

Output sections:
1. Meta Title (50-58 chars, brand at end)
2. Meta Description (150-160 chars)
3. H1 (max 60 chars)
4. AEO Summary Block (40-80 words)
5. JSON-LD (Article + FAQPage + BreadcrumbList)
6. 4-6 FAQ pairs

--- PAGE CONTENT ---
${pageContent}
--- END PAGE CONTENT ---`;
}

export function buildEditorialPrompt({ content }) {
  return `Act as a senior editor. Review the following content and return:
1. Overall grade (A-F)
2. Specific line-by-line improvements
3. Missing AEO / E-E-A-T elements
4. Tone/voice consistency notes
5. Before/after rewrites for the weakest 3 sentences

--- CONTENT ---
${content}
--- END CONTENT ---`;
}

export const QA_PROMPT = `After writing the article, append a QA SCORECARD section in this exact format:

QA SCORECARD
- Keyword Integration: X/10
- Heading Structure: X/10
- Readability: X/10
- AEO Readiness: X/10
- GEO Authority: X/10
- E-E-A-T Signals: X/10
- Visual Aids & Tables: X/10
- Internal Linking: X/10
- Overall: XX/100

IMPROVEMENTS
1. <suggestion>
2. <suggestion>
3. <suggestion>
`;
