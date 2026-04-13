// Netlify Function: Website Scanner
// Fetches a URL, extracts text content, sends to Claude for business analysis
// Requires ANTHROPIC_API_KEY environment variable

import * as cheerio from 'cheerio';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_CONTENT_LENGTH = 12000; // chars of extracted text to send to Claude
const FETCH_TIMEOUT = 20000;

// Domains to skip for link crawling (CDNs, trackers, etc.)
const SKIP_DOMAINS = [
  'google.com', 'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com',
  'youtube.com', 'pinterest.com', 'tiktok.com', 'whatsapp.com',
  'googleapis.com', 'gstatic.com', 'cloudflare.com', 'cdn.', 'analytics.',
  'doubleclick.net', 'googletagmanager.com', 'hotjar.com',
];

async function fetchPage(url, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SyteCampaignBot/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return html;
  } finally {
    clearTimeout(timer);
  }
}

function extractText(html, baseUrl) {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, noscript, iframe, svg, nav, footer').remove();

  // Extract meta info
  const title = $('title').text().trim();
  const metaDesc = $('meta[name="description"]').attr('content') || '';

  // Extract main content areas first, fallback to body
  let textParts = [];
  const mainSelectors = ['main', 'article', '[role="main"]', '#content', '.content', '#main', '.main'];
  let foundMain = false;

  for (const sel of mainSelectors) {
    if ($(sel).length) {
      $(sel).each((_, el) => {
        textParts.push($(el).text());
      });
      foundMain = true;
      break;
    }
  }

  if (!foundMain) {
    textParts.push($('body').text());
  }

  // Also grab headings separately for structure
  const headings = [];
  $('h1, h2, h3').each((_, el) => {
    const t = $(el).text().trim();
    if (t && t.length < 200) headings.push(t);
  });

  // Extract internal links for service page discovery
  const internalLinks = [];
  try {
    const base = new URL(baseUrl);
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const linkUrl = new URL(href, baseUrl);
        if (linkUrl.hostname === base.hostname && !SKIP_DOMAINS.some(d => linkUrl.hostname.includes(d))) {
          const text = $(el).text().trim();
          if (text && text.length < 100 && linkUrl.pathname !== '/') {
            internalLinks.push({ url: linkUrl.href, text, path: linkUrl.pathname });
          }
        }
      } catch {}
    });
  } catch {}

  // Extract trust signals from structured data
  let structuredData = {};
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html());
      if (json['@type'] === 'LocalBusiness' || json['@type'] === 'Organization') {
        structuredData = json;
      }
      if (json.aggregateRating) {
        structuredData.aggregateRating = json.aggregateRating;
      }
    } catch {}
  });

  // Clean up text
  let fullText = [
    title ? `Page Title: ${title}` : '',
    metaDesc ? `Meta Description: ${metaDesc}` : '',
    headings.length ? `Key Headings: ${headings.slice(0, 15).join(' | ')}` : '',
    ...textParts,
  ]
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();

  // Truncate
  if (fullText.length > MAX_CONTENT_LENGTH) {
    fullText = fullText.substring(0, MAX_CONTENT_LENGTH) + '…';
  }

  // Deduplicate links
  const uniqueLinks = [];
  const seenPaths = new Set();
  for (const link of internalLinks) {
    if (!seenPaths.has(link.path)) {
      seenPaths.add(link.path);
      uniqueLinks.push(link);
    }
  }

  return {
    text: fullText,
    headings: headings.slice(0, 20),
    links: uniqueLinks.slice(0, 30),
    structuredData,
    title,
    metaDesc,
  };
}

async function analyzeWithClaude(extracted, url, transcript) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const linkContext = extracted.links.length
    ? `\nInternal links found:\n${extracted.links.slice(0, 20).map(l => `  - ${l.text} → ${l.path}`).join('\n')}`
    : '';

  const sdContext = extracted.structuredData && Object.keys(extracted.structuredData).length
    ? `\nStructured Data (JSON-LD): ${JSON.stringify(extracted.structuredData).substring(0, 500)}`
    : '';

  const transcriptContext = transcript
    ? `\n\nClient meeting transcript (use to enrich and verify website findings):\n${transcript.substring(0, 4000)}`
    : '';

  const prompt = `You are a Google Ads strategist. Analyze this website content and extract structured campaign information.

Website URL: ${url}
${extracted.text}
${linkContext}${sdContext}${transcriptContext}

RESPOND WITH ONLY VALID JSON (no markdown, no code fences):
{
  "businessName": "exact business name from the website",
  "businessType": "leadGen|ecommerce|hybrid",
  "industry": "specific industry/niche",
  "description": "2-3 sentence business overview based on what the site actually says",
  "targetCustomer": "ideal customer description based on site content",
  "detectedServices": [
    {"name": "Service Name", "description": "brief description", "advertisable": true}
  ],
  "usps": ["specific USP from site", "another USP"],
  "toneOfVoice": "description of the brand's communication style based on actual copy",
  "toneExamples": ["exact phrase from site that captures voice"],
  "trustSignals": {
    "rating": "star rating if found e.g. 4.8",
    "reviewCount": "e.g. 200+ if found",
    "reviewPlatform": "e.g. Google",
    "yearsInBusiness": "e.g. 12 if found",
    "clientCount": "e.g. 500+ if found",
    "certifications": ["any certifications found"],
    "guarantees": ["any guarantees mentioned"]
  },
  "primaryCTA": "the main CTA on the website e.g. Get a Free Quote",
  "painPoints": ["customer problem addressed on site"],
  "pricingInfo": "any pricing mentioned e.g. From R2500",
  "suggestedLandingPage": "best URL for ad traffic based on site structure",
  "confidence": "high|medium|low",
  "confidenceNote": "why this confidence level"
}

RULES:
- For detectedServices: List EVERY distinct service or product mentioned. Set advertisable:false only for internal/admin services.
- For businessType: "leadGen" if forms/calls/bookings, "ecommerce" if online purchases with cart/checkout, "hybrid" if both.
- For trustSignals: Only include what is ACTUALLY on the site — use empty string if not found.
- For toneOfVoice: Describe based on actual copy style, not assumptions.
- For toneExamples: Quote actual phrases from the site.
- confidence: "high" if site has clear services/products, "medium" if vague, "low" if site is sparse/staging.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  if (!data.content || !data.content.length) {
    throw new Error('Empty response from Claude');
  }

  let text = data.content
    .filter(c => c.type === 'text')
    .map(c => c.text || '')
    .join('');

  // Strip markdown code fences if present
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in Claude response');

  return JSON.parse(match[0]);
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { url, transcript } = JSON.parse(event.body);

    if (!url) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'url is required' }),
      };
    }

    // Normalize URL
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

    // Fetch and extract
    const html = await fetchPage(normalizedUrl);
    const extracted = extractText(html, normalizedUrl);

    // Analyze with Claude
    const result = await analyzeWithClaude(extracted, normalizedUrl, transcript);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error('scan-website error:', err);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: err.message || 'Scan failed' }),
    };
  }
}
