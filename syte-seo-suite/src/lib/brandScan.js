// Website brand scan for the Content Engine.
// Fetches a client's homepage (and an About page if it can find one),
// extracts the visible text, and asks Claude to distil a concise, factual
// brand brief a copywriter can use to write perfectly on-brand articles.
// The result is appended to the client's Brand Documents field, which is
// injected into the article system prompt (see prompts.js).

import { corsFetchText } from './corsProxy.js';
import { claudeComplete, extractJSON } from './anthropic.js';

// Fetch a page's HTML. Tries the Netlify page-proxy first (renders JS and
// bypasses many WAFs), then falls back to the CORS proxy chain.
async function fetchPageHtml(url) {
  try {
    const res = await fetch('/.netlify/functions/page-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.html && data.html.length > 300) return data.html;
    }
  } catch {}
  try { return await corsFetchText(url); } catch {}
  return '';
}

// Strip a page down to its visible text.
function htmlToText(html) {
  if (!html) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,noscript,svg,template').forEach(n => n.remove());
    const body = doc.querySelector('body') || doc.documentElement;
    return (body.textContent || '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

// Look for an About / company page in the homepage links.
function findAboutUrl(html, baseUrl) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const origin = new URL(baseUrl).origin;
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (/about|our-story|who-we-are|company|meet-the-team/i.test(href)) {
        try {
          const full = new URL(href, baseUrl).href;
          if (full.startsWith(origin)) return full.split('#')[0].split('?')[0];
        } catch {}
      }
    }
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// Brand-scan block format.
//
// The website scan is the ground truth for WHAT THE BUSINESS ACTUALLY IS —
// it is the only field in the client record derived from the client's own
// site rather than typed by a human or inferred from Search Console. It
// therefore has to be readable, not just writable: the Content Engine needs
// to know whether a client has been scanned, when, and against which URL,
// so it can refuse to write from guesswork.
//
// Format (stored inside brand_docs, alongside any uploaded docs):
//
//   === Website Brand Scan (2026/09/20) ===
//   Source: https://example.co.za
//   Scanned: 2026-09-20
//   Voice: ...
//   Audience: ...
//
//   - bullet
//
// `Scanned:` is an explicit ISO date. Older blocks predate it and only carry
// the locale-formatted date in the header, so parsing falls back to that.
// ---------------------------------------------------------------------------

const SCAN_BLOCK_RE = /=== Website Brand Scan[\s\S]*?(?=\n=== |$)/;

// Pull the scan block out of a brand_docs value. Returns null when the client
// has never been scanned.
export function parseScanBlock(brandDocs) {
  const text = (brandDocs || '').trim();
  if (!text) return null;
  const match = text.match(SCAN_BLOCK_RE);
  if (!match) return null;
  const block = match[0].trim();

  const sourceUrl = (block.match(/^Source:\s*(.+)$/m) || [])[1]?.trim() || '';

  // Prefer the explicit ISO line; fall back to the date in the header, which
  // is locale-formatted (en-ZA renders as YYYY/MM/DD).
  let scannedAt = (block.match(/^Scanned:\s*(\d{4}-\d{2}-\d{2})\s*$/m) || [])[1] || '';
  if (!scannedAt) {
    const headerDate = (block.match(/=== Website Brand Scan \(([^)]+)\) ===/) || [])[1] || '';
    const ymd = headerDate.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (ymd) {
      scannedAt = `${ymd[1]}-${String(ymd[2]).padStart(2, '0')}-${String(ymd[3]).padStart(2, '0')}`;
    }
  }

  return { block, sourceUrl, scannedAt };
}

// Compare two URLs by host only — a scan of https://example.co.za still
// covers the client whose record says http://www.example.co.za/.
function sameHost(a, b) {
  const host = (u) => {
    try {
      const withScheme = /^https?:\/\//.test(u) ? u : 'https://' + u;
      return new URL(withScheme).hostname.replace(/^www\./, '').toLowerCase();
    } catch { return ''; }
  };
  const ha = host(a), hb = host(b);
  return !!ha && ha === hb;
}

// Decide whether the client needs a (re)scan before we write for them.
// Stale means: never scanned, scanned against a different website than the
// record now points at, or older than maxAgeDays.
export function isScanStale(client, { maxAgeDays = 90, now = new Date() } = {}) {
  const url = client?.url || '';
  if (!url) return false; // nothing to scan against — caller handles this
  const parsed = parseScanBlock(client?.brand_docs);
  if (!parsed) return true;
  if (parsed.sourceUrl && !sameHost(parsed.sourceUrl, url)) return true;
  if (!parsed.scannedAt) return true;
  const then = new Date(parsed.scannedAt + 'T00:00:00Z');
  if (Number.isNaN(then.getTime())) return true;
  const ageDays = (now.getTime() - then.getTime()) / 86400000;
  return ageDays > maxAgeDays;
}

// Render a brief into the stored block format.
export function formatScanBlock(brief, { now = new Date() } = {}) {
  const iso = now.toISOString().slice(0, 10);
  return [
    `=== Website Brand Scan (${now.toLocaleDateString('en-ZA')}) ===`,
    `Source: ${brief.sourceUrl || ''}`,
    `Scanned: ${iso}`,
    brief.voice ? `Voice: ${brief.voice}` : '',
    brief.audience ? `Audience: ${brief.audience}` : '',
    '',
    brief.brief || ''
  ].filter(Boolean).join('\n');
}

// Merge a fresh scan into brand_docs, replacing any previous scan block so
// re-scanning never stacks duplicates. Uploaded docs are preserved.
export function mergeScanIntoBrandDocs(brandDocs, brief, { now = new Date() } = {}) {
  const existing = (brandDocs || '').trim();
  const withoutOld = existing.replace(SCAN_BLOCK_RE, '').trim();
  return [withoutOld, formatScanBlock(brief, { now })].filter(Boolean).join('\n\n');
}

// Scan the client's website and return a structured brand brief.
// onProgress(message) is called with human-readable status updates.
export async function scanBrandFromWebsite(client, { onProgress } = {}) {
  const url = client?.url;
  if (!url) throw new Error('Add the client Website URL first, then scan.');

  onProgress?.('Fetching homepage…');
  const homeHtml = await fetchPageHtml(url);
  if (!homeHtml) {
    throw new Error('Could not fetch the website (blocked, offline, or JS-only). Paste brand docs manually instead.');
  }

  let text = htmlToText(homeHtml);
  const home = url.replace(/\/$/, '') + '/';

  const aboutUrl = findAboutUrl(homeHtml, url);
  if (aboutUrl && aboutUrl !== home) {
    onProgress?.('Reading About page…');
    const aboutText = htmlToText(await fetchPageHtml(aboutUrl));
    if (aboutText) text += '\n\n[ABOUT PAGE]\n' + aboutText;
  }

  text = text.slice(0, 12000);
  if (text.length < 200) {
    throw new Error('The website returned almost no readable text (likely JS-rendered). Paste brand docs manually instead.');
  }

  onProgress?.('Summarising brand voice with Claude…');
  const system = 'You are a brand strategist. Read the website text and extract a concise, FACTUAL brand brief a copywriter can use to write perfectly on-brand articles. Only use facts present in the text — never invent. Output ONLY valid JSON — no prose, no code fences.';
  const userMessage = `WEBSITE: ${url}
Client name: ${client.name || '(unnamed)'}

RAW WEBSITE TEXT:
"""
${text}
"""

Return ONLY this JSON:
{
  "voice": "one short phrase describing the tone, e.g. 'Warm, expert, jargon-free'",
  "audience": "who the brand serves, 1-2 sentences",
  "brief": "a single string of 6-12 bullet points, each prefixed with '- ', covering: what they do, key products/services (use their REAL names), differentiators, geographic focus, terminology/phrases they use, and anything a writer must get right to sound on-brand"
}`;

  const raw = await claudeComplete({
    system,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: 1500,
    temperature: 0.3
  });

  const parsed = extractJSON(raw);
  if (!parsed?.brief) {
    throw new Error('Scan finished but the brand summary could not be parsed. Try again.');
  }
  return {
    voice: (parsed.voice || '').trim(),
    audience: (parsed.audience || '').trim(),
    brief: (parsed.brief || '').trim(),
    sourceUrl: url,
    aboutUrl: aboutUrl || null
  };
}
