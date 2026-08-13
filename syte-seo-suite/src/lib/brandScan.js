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
