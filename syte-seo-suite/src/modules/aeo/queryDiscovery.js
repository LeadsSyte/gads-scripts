// AEO Query Discovery — analyzes a client's site and produces a structured
// list of search prompts they SHOULD be ranking for in AI engines like
// ChatGPT, Perplexity, Gemini and Claude.
//
// Mirrors the manual process used by Syte's SEO team:
//   - read positioning, services, location from the site
//   - propose Core money / Local / Brand / Educational / Comparison queries
//   - rank by likely commercial value
//   - flag content gaps
//
// Output JSON shape is consumed by QueryDiscovery.jsx.

import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { corsFetchText } from '../../lib/corsProxy.js';
import { fetchSitemapUrls } from './sitemap.js';

const MAX_PAGES_TO_READ = 8;
const MAX_HTML_PER_PAGE = 12000;
const MAX_TOTAL_HTML = 60000;

// Strip HTML to a readable text snapshot — keeps anchor text, headings,
// meta description, title; drops scripts/styles. Lossy but enough for Claude
// to infer services/positioning.
function htmlToText(html) {
  if (!html) return '';
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  // Preserve meta description before stripping tags
  const desc = s.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const title = s.match(/<title[^>]*>([^<]+)<\/title>/i);
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/\s+/g, ' ').trim();
  const prefix = [
    title ? `TITLE: ${title[1].trim()}` : '',
    desc ? `META: ${desc[1].trim()}` : ''
  ].filter(Boolean).join('\n');
  return prefix ? prefix + '\n' + s : s;
}

// Pick the most representative pages to actually fetch — homepage + key
// service / category pages. We use simple URL heuristics so this works
// even when we can't see the page content yet.
function pickRepresentativePages(urls, baseUrl) {
  const base = (baseUrl || '').replace(/\/$/, '');
  const root = base + '/';
  const set = new Set();
  if (base) set.add(root);

  // Score each URL: shorter paths first, prefer service-ish keywords.
  const PRIORITY_HINTS = [
    'service', 'product', 'about', 'solution', 'buy', 'sell', 'price',
    'pricing', 'rate', 'storage', 'vault', 'invest', 'loan', 'gold',
    'bullion', 'jewell', 'safe', 'deposit', 'collection', 'shop'
  ];
  const SKIP_HINTS = ['blog', 'news', 'article', 'press', 'privacy', 'terms', 'cookie', 'contact', 'faq', 'sitemap'];

  const scored = (urls || []).map(u => {
    let path = '';
    try { path = new URL(u).pathname.toLowerCase(); } catch { path = u.toLowerCase(); }
    const segs = path.split('/').filter(Boolean).length;
    let score = 100 - segs * 10;
    if (PRIORITY_HINTS.some(h => path.includes(h))) score += 30;
    if (SKIP_HINTS.some(h => path.includes(h))) score -= 50;
    return { url: u, score };
  }).sort((a, b) => b.score - a.score);

  for (const r of scored) {
    if (set.size >= MAX_PAGES_TO_READ) break;
    set.add(r.url);
  }
  return Array.from(set);
}

// Crawl up to N representative pages, returning a single concatenated text
// blob with section markers. Skips silently on per-page errors.
async function crawlSite(client, onProgress) {
  const base = (client.url || '').replace(/\/$/, '');
  if (!base) throw new Error('Client has no website URL.');

  onProgress?.({ phase: 'sitemap', message: 'Reading sitemap…' });
  let sitemapUrls = [];
  try {
    sitemapUrls = await fetchSitemapUrls(client.sitemap_url, client.sitemap_raw);
  } catch {}

  // If no sitemap, discover from homepage links.
  if (!sitemapUrls.length) {
    onProgress?.({ phase: 'sitemap', message: 'No sitemap — discovering from homepage links…' });
    try {
      const homeHtml = await corsFetchText(base + '/');
      const doc = new DOMParser().parseFromString(homeHtml, 'text/html');
      const origin = new URL(base).origin;
      const found = new Set([base + '/']);
      for (const a of doc.querySelectorAll('a[href]')) {
        let href = a.getAttribute('href') || '';
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
        try {
          const full = new URL(href, base).href.split('#')[0].split('?')[0];
          if (full.startsWith(origin)) found.add(full);
        } catch {}
      }
      sitemapUrls = Array.from(found);
    } catch {
      sitemapUrls = [base + '/'];
    }
  }

  const targets = pickRepresentativePages(sitemapUrls, base);
  onProgress?.({ phase: 'fetching', message: `Fetching ${targets.length} pages…`, total: targets.length });

  const sections = [];
  let totalLen = 0;
  let done = 0;
  for (const url of targets) {
    done++;
    if (totalLen >= MAX_TOTAL_HTML) break;
    try {
      const html = (await corsFetchText(url)).slice(0, MAX_HTML_PER_PAGE);
      const text = htmlToText(html);
      if (text) {
        let path = url;
        try { path = new URL(url).pathname; } catch {}
        const remaining = MAX_TOTAL_HTML - totalLen;
        const snippet = text.slice(0, Math.min(text.length, remaining));
        sections.push(`--- PAGE: ${path} (${url}) ---\n${snippet}`);
        totalLen += snippet.length;
      }
      onProgress?.({ phase: 'fetching', message: `Fetched ${done}/${targets.length}: ${url}`, index: done, total: targets.length });
    } catch {
      onProgress?.({ phase: 'fetching', message: `Skipped (CORS or 404): ${url}`, index: done, total: targets.length });
    }
  }

  return { text: sections.join('\n\n'), pages: targets, fetched: sections.length };
}

const DISCOVERY_SYSTEM = `You are an expert AEO (Answer Engine Optimization) strategist analysing a business's website to determine which search prompts they SHOULD be appearing for inside ChatGPT, Perplexity, Gemini and Claude.

Your job is to read the site content and produce a structured, prioritised discovery report.

CRITICAL RULES:
- Only propose queries a real customer would actually type / speak — natural language, lower-case, 3-10 words each.
- Mix commercial-intent ("buy X in city") with local intent ("X near me") with educational ("how to X") with comparison ("X vs Y") with brand-authority ("Brand reviews") — these all behave differently in AI engines.
- Localise heavily when a location is known. AI engines lean on geography when recommending businesses.
- Include at least 3 brand-name queries (with and without the location) so we can test brand recognition in the engines.
- Mark each query with a commercialValue rating: "high" (likely buyer), "medium" (researcher), "low" (educational / awareness).
- NEVER invent services the site does not offer. Read the page content carefully.
- The "positioning" string should summarise in one sentence how AI engines probably perceive this business today, based on the actual content.
- The "gaps" array lists topics the site is NOT covering well but should — these inform editorial roadmap.
- Use the exact JSON shape below. No prose outside JSON, no code fences.

OUTPUT JSON SHAPE:
{
  "positioning": "one sentence describing how AI likely categorises this site today",
  "summary": "2-3 sentences on the overall AEO opportunity for this brand",
  "categories": [
    {
      "name": "Core Money Keywords",
      "intent": "commercial — direct purchase / hire intent",
      "queries": [
        { "query": "buy krugerrands johannesburg", "commercialValue": "high", "rationale": "direct buyer intent, geo-specific" }
      ]
    },
    {
      "name": "Local SEO",
      "intent": "geo-modified, near-me, city-specific",
      "queries": [ /* same shape */ ]
    },
    {
      "name": "Brand Authority",
      "intent": "brand-name searches the business should dominate",
      "queries": [ /* same shape */ ]
    },
    {
      "name": "Educational / Content Gaps",
      "intent": "informational — feeds top-of-funnel and answers",
      "queries": [ /* same shape */ ]
    },
    {
      "name": "Comparison / Alternatives",
      "intent": "evaluating options — high conversion potential",
      "queries": [ /* same shape */ ]
    }
  ],
  "topPriority": [
    { "query": "...", "reason": "why this is highest commercial value" }
  ],
  "gaps": [
    { "topic": "...", "reason": "why this is missing or thin and worth building" }
  ]
}

Return AT LEAST 6 queries per category and AT LEAST 8 entries in topPriority. Output ONLY the JSON object.`;

function buildUserPrompt(client, siteText) {
  const lines = [];
  lines.push(`Brand: ${client.name || '(unknown)'}`);
  if (client.url)        lines.push(`Website: ${client.url}`);
  if (client.industry)   lines.push(`Industry: ${client.industry}`);
  if (client.location)   lines.push(`Location / service area: ${client.location}`);
  if (client.audience)   lines.push(`Target audience: ${client.audience}`);
  if (client.context)    lines.push(`Brand context: ${client.context}`);
  if (client.competitors) lines.push(`Known competitors: ${client.competitors}`);
  lines.push('');
  lines.push('=== SITE CONTENT (crawled) ===');
  lines.push(siteText || '(site not reachable — infer conservatively from brand context above)');
  lines.push('');
  lines.push('Produce the discovery JSON. Be specific to what the site actually sells / offers — do not pad with generic queries.');
  return lines.join('\n');
}

// Main entry point. Returns the discovery object plus metadata about the
// crawl so the UI can show what was actually read.
export async function discoverQueries(client, { onProgress } = {}) {
  if (!client) throw new Error('No client supplied.');
  const crawl = await crawlSite(client, onProgress);
  onProgress?.({ phase: 'analysing', message: `Analysing ${crawl.fetched} pages with Claude…` });

  const text = await claudeComplete({
    system: DISCOVERY_SYSTEM,
    messages: [{ role: 'user', content: buildUserPrompt(client, crawl.text) }],
    max_tokens: 6000,
    temperature: 0.5
  });

  onProgress?.({ phase: 'parsing', message: 'Parsing response…' });
  const parsed = extractJSON(text);
  if (!parsed || !Array.isArray(parsed.categories)) {
    throw new Error('Discovery returned unexpected output. Try again.');
  }

  return {
    ...parsed,
    crawl: {
      pagesAttempted: crawl.pages.length,
      pagesRead: crawl.fetched,
      pages: crawl.pages
    },
    generated_at: new Date().toISOString(),
    client_id: client.id,
    client_name: client.name
  };
}

// Flatten a discovery report's queries (with category names) — used when
// the user wants to push selected queries into client.aeo_probe_queries.
export function flattenQueries(discovery) {
  const out = [];
  for (const cat of discovery?.categories || []) {
    for (const q of cat.queries || []) {
      out.push({ ...q, category: cat.name });
    }
  }
  return out;
}
