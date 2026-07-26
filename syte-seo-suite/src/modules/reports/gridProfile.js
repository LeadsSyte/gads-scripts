// Runtime bridge between a live client and the pure gold-grid generator.
//
// goldGrid.js is deliberately pure (no browser imports) so it stays node-
// testable. This module does the browser-coupled work: read the client's
// website through the page-proxy, ask the LLM to extract a structured profile
// (service lines, target industries, headline category terms), and hand that
// profile to buildGoldGrid. Everything degrades gracefully — if the LLM or the
// site is unavailable we fall back to the heuristic derivation, which still
// produces a valid (if thinner) grid from GSC + competitors alone.

import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { extractSitePhrases } from './aeoDiscovery.js';
import { buildGoldGrid, deriveGridProfile } from './goldGrid.js';

async function fetchSiteHtml(url) {
  if (!url) return '';
  try {
    const r = await fetch('/.netlify/functions/page-proxy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!r.ok) return '';
    const d = await r.json();
    return d.html || '';
  } catch { return ''; }
}

// Strip HTML to visible-ish text and cap it so the extraction prompt stays cheap.
function htmlToText(html, cap = 6000) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap);
}

const PROFILE_SYSTEM =
  'You extract a B2B company\'s go-to-market profile from its website text. ' +
  'Return ONLY strict JSON, no prose. Be specific and use the company\'s own ' +
  'vocabulary. Do not invent services or industries that are not supported by ' +
  'the text. Prefer concrete offerings ("Dynamics 365", "Power BI") over vague ' +
  'ones ("digital solutions").';

function profilePrompt({ name, geo, siteText, gscQueries }) {
  return [
    `Company: ${name || 'unknown'}`,
    geo ? `Primary market: ${geo}` : '',
    gscQueries?.length ? `Top search terms they rank for: ${gscQueries.slice(0, 25).join('; ')}` : '',
    '',
    'Website text:',
    siteText || '(unavailable)',
    '',
    'Return JSON with exactly these keys:',
    '{',
    '  "services": [up to 14 specific service lines / product offerings, most important first],',
    '  "headlineServices": [up to 6 category nouns a buyer would search, e.g. "Microsoft partners", "AI consultancies"],',
    '  "gridQualifierServices": [the 4 flagship services to pair with buyer segments],',
    '  "industries": [up to 8 target industries/sectors they serve, e.g. "insurance companies", "credit unions"]',
    '}'
  ].filter(Boolean).join('\n');
}

// Ask the LLM for a structured profile. Returns null on any failure so the
// caller falls back to the heuristic.
export async function extractClientProfile(client, { gscQueries = [] } = {}) {
  try {
    const html = await fetchSiteHtml(client?.url);
    const siteText = htmlToText(html);
    // Nothing to read and no search terms — let the heuristic handle it.
    if (!siteText && !gscQueries.length) return null;
    const raw = await claudeComplete({
      system: PROFILE_SYSTEM,
      messages: [{ role: 'user', content: profilePrompt({ name: client?.name, geo: client?.geo || client?.location || client?.market, siteText, gscQueries }) }],
      max_tokens: 1024,
      temperature: 0.2
    });
    const parsed = extractJSON(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const arr = (v) => Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean) : [];
    const prof = {
      services: arr(parsed.services),
      headlineServices: arr(parsed.headlineServices),
      gridQualifierServices: arr(parsed.gridQualifierServices),
      industries: arr(parsed.industries)
    };
    // Require at least one usable service line, else treat as a miss.
    return prof.services.length ? prof : null;
  } catch {
    return null;
  }
}

// Build a gold-grid probe set for any client. Uses the LLM profile when it can,
// heuristic derivation otherwise. Returns probe-candidate objects ready for
// addProbes(). `sitePhrases`/`gscQueries` seed the heuristic fallback.
export async function buildGoldProbesForClient(client, { gscQueries = [], maxProbes = 0 } = {}) {
  const llmProfile = await extractClientProfile(client, { gscQueries });
  let sitePhrases = [];
  if (!llmProfile) {
    // Fallback needs raw site phrases; fetch once more only if the LLM missed.
    const html = await fetchSiteHtml(client?.url);
    sitePhrases = extractSitePhrases(html);
  }
  const profile = deriveGridProfile(client, { sitePhrases, gscQueries, llmProfile });
  return { profile, probes: buildGoldGrid(profile, { maxProbes }) };
}
