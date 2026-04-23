// In-house technical SEO crawler. Replaces the WebCEO API dependency.
// Fetches the client's sitemap (or homepage), crawls each URL, parses
// the HTML, and detects specific issues per page — the same kind of
// detail WebCEO shows in its Site Audit.
//
// Output shape per page: { url, title, issues: [{ type, severity, detail, fix }] }

import { corsFetchText } from '../../lib/corsProxy.js';
import { fetchSitemapUrls } from '../aeo/sitemap.js';

const CRAWL_BATCH = 5;

// ---------- HTML analysis rules ----------

function textOf(node) {
  return node ? (node.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

function slugifyTitle(url) {
  try {
    const p = new URL(url).pathname;
    const last = p.split('/').filter(Boolean).pop() || 'home';
    return last.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  } catch { return 'Page'; }
}

function analyzeDocument(url, doc) {
  const issues = [];
  const pageSlug = slugifyTitle(url);

  // --- Meta Title ---
  const titleEl = doc.querySelector('title');
  const title = textOf(titleEl);
  if (!title) {
    issues.push({
      type: 'meta_title', severity: 'high',
      detail: 'Missing <title> tag entirely',
      fix: `<title>${pageSlug} | Brand Name</title>`
    });
  } else if (title.length < 30) {
    issues.push({
      type: 'meta_title', severity: 'medium',
      detail: `Title too short (${title.length} chars): "${title}"`,
      fix: null
    });
  } else if (title.length > 65) {
    issues.push({
      type: 'meta_title', severity: 'medium',
      detail: `Title too long (${title.length} chars, will be truncated in SERPs): "${title}"`,
      fix: null
    });
  }

  // --- Meta Description ---
  const descEl = doc.querySelector('meta[name="description"], meta[name="Description"]');
  const desc = descEl?.getAttribute('content')?.trim() || '';
  if (!desc) {
    issues.push({
      type: 'meta_description', severity: 'high',
      detail: 'Missing meta description',
      fix: `<meta name="description" content="[Write a 140-160 character description of this page's ${pageSlug} content that includes the primary keyword and a call to action.]">`
    });
  } else if (desc.length < 70) {
    issues.push({
      type: 'meta_description', severity: 'medium',
      detail: `Meta description too short (${desc.length} chars): "${desc}"`,
      fix: null
    });
  } else if (desc.length > 160) {
    issues.push({
      type: 'meta_description', severity: 'low',
      detail: `Meta description too long (${desc.length} chars, will be truncated): "${desc.slice(0, 100)}…"`,
      fix: null
    });
  }

  // --- H1 tags ---
  const h1s = Array.from(doc.querySelectorAll('h1')).map(textOf).filter(Boolean);
  if (h1s.length === 0) {
    issues.push({
      type: 'h1', severity: 'high',
      detail: 'Missing <h1> heading',
      fix: `<h1>${title || pageSlug}</h1>`
    });
  } else if (h1s.length > 1) {
    issues.push({
      type: 'h1', severity: 'medium',
      detail: `Multiple H1 tags (${h1s.length}): "${h1s.slice(0, 3).join('", "')}"`,
      fix: null
    });
  }

  // --- Canonical ---
  const canonicalEl = doc.querySelector('link[rel="canonical"]');
  const canonical = canonicalEl?.getAttribute('href')?.trim() || '';
  if (!canonical) {
    issues.push({
      type: 'canonical', severity: 'medium',
      detail: 'Missing canonical URL — risk of duplicate content indexing',
      fix: `<link rel="canonical" href="${url}" />`
    });
  } else {
    // Check if canonical matches page URL (very rough)
    try {
      const canonicalPath = new URL(canonical).pathname;
      const pagePath = new URL(url).pathname;
      if (canonicalPath !== pagePath && canonical !== url) {
        // Canonical points elsewhere — might be intentional
      }
    } catch {}
  }

  // --- Meta Robots ---
  const robots = doc.querySelector('meta[name="robots"]')?.getAttribute('content') || '';
  if (/noindex/i.test(robots)) {
    issues.push({
      type: 'robots', severity: 'critical',
      detail: `Page is set to noindex ("${robots}") — will NOT appear in search`,
      fix: `<meta name="robots" content="index, follow">`
    });
  }

  // --- Images missing alt text ---
  const imgs = Array.from(doc.querySelectorAll('img'));
  const missingAlt = imgs.filter(img => {
    const alt = img.getAttribute('alt');
    return alt === null || alt.trim() === '';
  });
  if (missingAlt.length > 0) {
    // Report the first few with their src
    missingAlt.slice(0, 3).forEach(img => {
      let src = img.getAttribute('src') || img.getAttribute('data-src') || '(no src)';
      // Resolve relative URLs
      try { src = new URL(src, url).href; } catch {}
      const guessedAlt = src.split('/').pop()?.replace(/\.(jpg|jpeg|png|webp|gif|svg)$/i, '').replace(/[-_]/g, ' ') || 'image';
      issues.push({
        type: 'image_alt', severity: 'medium',
        detail: `Image missing alt text: ${src}`,
        fix: `alt="${guessedAlt.replace(/\b\w/g, c => c.toUpperCase())} - ${pageSlug}"`
      });
    });
    if (missingAlt.length > 3) {
      issues.push({
        type: 'image_alt', severity: 'low',
        detail: `+${missingAlt.length - 3} more images on this page are missing alt text`,
        fix: null
      });
    }
  }

  // --- Open Graph ---
  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
  const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
  const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
  if (!ogTitle && !ogDesc && !ogImage) {
    issues.push({
      type: 'open_graph', severity: 'low',
      detail: 'Missing Open Graph tags — social shares will use fallback content',
      fix: `<meta property="og:title" content="${title || pageSlug}">
<meta property="og:description" content="${desc || '[Write a compelling social share description]'}">
<meta property="og:image" content="[URL to a 1200x630 hero image]">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">`
    });
  }

  // --- Structured data (JSON-LD) ---
  const jsonLd = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  if (jsonLd.length === 0) {
    // Infer schema type from URL path
    let schemaType = 'WebPage';
    if (/\/blog\/|\/news\/|\/article/i.test(url)) schemaType = 'Article';
    else if (/\/product/i.test(url)) schemaType = 'Product';
    else if (/\/about/i.test(url)) schemaType = 'AboutPage';
    else if (/\/contact/i.test(url)) schemaType = 'ContactPage';
    issues.push({
      type: 'structured_data', severity: 'medium',
      detail: 'No JSON-LD structured data — missed rich result opportunities',
      fix: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "${schemaType}",
  "name": "${title || pageSlug}",
  "description": "${desc || '[Page description]'}",
  "url": "${url}"
}
</script>`
    });
  }

  // --- Word count (thin content detection) ---
  const body = doc.querySelector('body');
  const bodyText = body ? textOf(body) : '';
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  if (wordCount < 300 && bodyText.length > 0) {
    issues.push({
      type: 'thin_content', severity: 'medium',
      detail: `Thin content: only ${wordCount} words on this page`,
      fix: null
    });
  }

  // --- Viewport / mobile ---
  const viewport = doc.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
  if (!viewport) {
    issues.push({
      type: 'viewport', severity: 'medium',
      detail: 'Missing viewport meta tag — poor mobile rendering',
      fix: `<meta name="viewport" content="width=device-width, initial-scale=1">`
    });
  }

  return {
    url,
    title,
    wordCount,
    issueCount: issues.length,
    issues
  };
}

async function analyzeUrl(url) {
  try {
    // Try the server-side page proxy first (bypasses CORS + WAFs).
    let html = '';
    try {
      const res = await fetch('/.netlify/functions/page-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.html && data.html.length > 200) html = data.html;
      }
    } catch {}
    // Fallback to CORS proxy.
    if (!html) html = await corsFetchText(url);
    if (!html || html.length < 200) {
      return { url, error: 'Empty or very short response — page may not be accessible' };
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return analyzeDocument(url, doc);
  } catch (e) {
    return { url, error: e.message };
  }
}

// Discover real pages by crawling the homepage and extracting internal links.
async function discoverLinksFromHomepage(baseUrl) {
  const links = new Set();
  links.add(baseUrl.replace(/\/$/, '') + '/');
  try {
    const html = await corsFetchText(baseUrl);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const origin = new URL(baseUrl).origin;
    for (const a of doc.querySelectorAll('a[href]')) {
      let href = a.getAttribute('href') || '';
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
      try {
        const full = new URL(href, baseUrl).href;
        if (full.startsWith(origin) && !full.includes('#')) {
          links.add(full.split('?')[0]);
        }
      } catch {}
    }
  } catch {}
  return Array.from(links);
}

// Main crawler entry point.
export async function crawlSiteForIssues(client, { maxPages = 50, onProgress } = {}) {
  // 1. Get URL list from sitemap, with homepage fallback.
  let urls = [];
  try {
    urls = await fetchSitemapUrls(client.sitemap_url, client.sitemap_raw);
  } catch {}
  if (!urls.length && client.url) {
    // No sitemap — discover real pages from the homepage links instead of
    // guessing generic paths that may not exist (e.g. Shopify uses /pages/).
    try {
      urls = await discoverLinksFromHomepage(client.url);
    } catch {}
    if (!urls.length) {
      urls = [client.url.replace(/\/$/, '') + '/'];
    }
  }
  if (!urls.length) {
    throw new Error('No URLs to crawl — client needs a sitemap URL or website URL');
  }

  const targets = urls.slice(0, maxPages);
  const findings = [];

  for (let i = 0; i < targets.length; i += CRAWL_BATCH) {
    const batch = targets.slice(i, i + CRAWL_BATCH);
    onProgress?.(i, targets.length);
    const results = await Promise.all(batch.map(u => analyzeUrl(u)));
    findings.push(...results);
  }
  onProgress?.(targets.length, targets.length);

  return {
    totalCrawled: findings.length,
    withIssues: findings.filter(f => f.issueCount > 0).length,
    withErrors: findings.filter(f => f.error).length,
    pages: findings,
    urlsAttempted: targets.length
  };
}

// Build a compact summary for Claude — one line per issue per page,
// so Claude can easily see "URL X has issue Y with fix Z".
export function summarizeCrawlForAI(crawlResult) {
  const lines = [];
  lines.push(`Crawled ${crawlResult.totalCrawled} pages · ${crawlResult.withIssues} with issues · ${crawlResult.withErrors} unreachable`);
  lines.push('');
  for (const page of crawlResult.pages) {
    if (page.error) {
      lines.push(`[ERROR] ${page.url}: ${page.error}`);
      continue;
    }
    if (page.issueCount === 0) continue;
    lines.push(`PAGE: ${page.url}`);
    if (page.title) lines.push(`  Title: "${page.title}"`);
    for (const issue of page.issues) {
      lines.push(`  [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.detail}`);
      if (issue.fix) {
        lines.push(`    Suggested fix: ${issue.fix.slice(0, 300)}${issue.fix.length > 300 ? '…' : ''}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
