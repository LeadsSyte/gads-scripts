// AI verification scanner. After a team member marks a change as
// implemented, this fetches the live page and asks Claude Haiku whether
// the change is actually present. Updates the implementation record
// with verified/failed + Claude's explanation.
//
// IMPORTANT: WordPress drafts are NOT publicly accessible, so verification
// will always fail for unpublished content. In that case we route through
// the wp-proxy to fetch the draft's content via the REST API instead.
//
// OFF-PAGE TASKS: GSC setup, domain ownership verification, sitemap
// submission, analytics installs etc. are NOT verifiable from page HTML
// or screenshots — the work happens in external admin consoles. These
// are routed through verifyOffPageTask() which runs the appropriate
// targeted check (sitemap XML fetch, robots.txt fetch, GSC API ownership
// check) or returns 'manual_required' so the UI prompts the user to
// confirm rather than showing a misleading "auto-verify failed".

import { corsFetchText } from './corsProxy.js';
import { claudeComplete } from './anthropic.js';
import { updateImplementation } from './supabase.js';
import { listSites } from '../modules/technical/gsc.js';

// Task types whose evidence does NOT live in the page HTML or screenshot.
// For these we run a targeted external check (or fall back to manual).
//
// IMPORTANT: 'robots' is intentionally NOT in this set because it's
// ambiguous. A task can mean either:
//   - meta robots <meta name="robots" content="noindex">    → ON-page
//   - the robots.txt file                                    → OFF-page
// Only 'robots_txt' is unambiguously off-page. For tasks tagged plain
// 'robots', we look at the title/description to decide; see
// isOffPageTask below.
const OFF_PAGE_TYPES = new Set([
  'gsc_setup', 'gsc', 'search_console', 'domain_ownership', 'ownership_verification',
  'sitemap', 'sitemap_submission', 'xml_sitemap',
  'robots_txt',
  'analytics_setup', 'ga_setup', 'gtm_setup', 'tracking_install',
  'indexing_request', 'index_now', 'page_speed', 'core_web_vitals',
  'redirect', 'dns', 'ssl', 'https_setup'
]);

function normalizeType(t) {
  return String(t || '').toLowerCase().replace(/[\s-]/g, '_');
}

export function isOffPageTask(impl) {
  const ct = normalizeType(impl?.change_type);
  if (OFF_PAGE_TYPES.has(ct)) return true;
  const blob = ((impl?.title || '') + ' ' + (impl?.description || '')).toLowerCase();

  // change_type 'robots' is ambiguous (meta robots vs robots.txt). Only
  // route to off-page if the title/description specifically mentions
  // robots.txt OR the page_url is itself /robots.txt. A task to remove
  // noindex from a page or add an indexable meta robots tag is an
  // ON-page task — it lives in the page's HTML <head>, not in
  // robots.txt — and was previously misrouted to the off-page robots.txt
  // check, which then failed because the file was never the issue.
  if (ct === 'robots') {
    return /robots\.txt/.test(blob) || /\/robots\.txt(?:\?|$)/.test(impl?.page_url || '');
  }

  // Heuristic for unlabeled tasks ('other'/'fix'): only flag as off-page
  // if specific off-page keywords are present.
  return /\bsearch console\b|\bgsc\b|\bdomain ownership\b|\bxml sitemap\b|submit\s+(?:the\s+)?sitemap|google analytics|gtag|gtm|tag manager|robots\.txt/i.test(blob);
}

// Try to fetch a resource via page-proxy first (most resilient), then
// fall back to corsFetchText. Returns { text, status } or throws.
//
// For RAW resources (XML sitemaps, robots.txt) pass { raw: true } to skip
// page-proxy. page-proxy's TIER 1 routes through Jina Reader, which is
// designed to extract main content from HTML pages and may not preserve
// XML tag structure — a sitemap could come back without <urlset> after
// Jina has "rendered" it. corsFetchText goes through allorigins which
// returns the response body verbatim.
async function fetchResource(url, { raw = false } = {}) {
  if (!raw) {
    try {
      const res = await fetch('/.netlify/functions/page-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.html) return { text: data.html, status: data.status || 200 };
      }
    } catch {}
  }
  const text = await corsFetchText(url);
  return { text, status: 200 };
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

// Build a candidate set of origins to probe. A task's page_url is often
// the client's homepage, but it can also be a third-party URL (e.g.
// search.google.com for a GSC setup task). Always prefer the client's
// own origin for sitemap/robots probes; fall back to page_url's origin.
function probeOrigins(pageUrl, clientUrl) {
  const seen = new Set();
  const list = [];
  for (const u of [clientUrl, pageUrl]) {
    const o = originOf(u);
    if (o && !/(?:google|googleusercontent|searchconsole)\.com$/i.test(new URL(o).hostname) && !seen.has(o)) {
      seen.add(o);
      list.push(o);
    }
  }
  return list;
}

async function verifySitemap(pageUrl, clientUrl) {
  const tryUrls = [];
  // If page_url is itself a sitemap path, probe it first.
  if (/sitemap.*\.xml/i.test(pageUrl || '')) tryUrls.push(pageUrl);
  for (const origin of probeOrigins(pageUrl, clientUrl)) {
    tryUrls.push(origin + '/sitemap.xml');
    tryUrls.push(origin + '/sitemap_index.xml');
    tryUrls.push(origin + '/wp-sitemap.xml');
  }
  if (tryUrls.length === 0) {
    return { ok: false, manual: true, detail: 'No client domain configured to check for a sitemap.' };
  }
  for (const url of tryUrls) {
    try {
      const { text } = await fetchResource(url, { raw: true });
      // Accept either raw XML tags or any body that looks like a sitemap
      // (xmlns reference, <loc> entries) — covers proxies that may have
      // wrapped or reformatted the response.
      if (text && (/<(urlset|sitemapindex)\b/i.test(text) || /sitemaps\.org\/schemas\/sitemap/i.test(text) || /<loc>https?:/i.test(text))) {
        return { ok: true, detail: 'Sitemap is live and valid XML at ' + url };
      }
    } catch {}
  }
  return { ok: false, detail: 'No valid XML sitemap reachable at any of: ' + tryUrls.join(', ') + '.' };
}

async function verifyRobots(pageUrl, clientUrl) {
  const origins = probeOrigins(pageUrl, clientUrl);
  if (origins.length === 0) return { ok: false, manual: true, detail: 'No client domain configured to check robots.txt.' };
  for (const origin of origins) {
    try {
      const { text } = await fetchResource(origin + '/robots.txt', { raw: true });
      if (text && /(User-agent|Disallow|Sitemap)/i.test(text)) {
        const hasSitemap = /Sitemap:\s*https?:/i.test(text);
        return {
          ok: true,
          detail: 'robots.txt reachable at ' + origin + '/robots.txt' +
            (hasSitemap ? ' and references a Sitemap directive.' : ' (no Sitemap directive found — consider adding one).')
        };
      }
    } catch {}
  }
  return { ok: false, detail: 'robots.txt is not reachable at ' + origins.map(o => o + '/robots.txt').join(' or ') + '.' };
}

async function verifyGscOwnership(client) {
  const property = client?.gsc_property;
  if (!property) {
    return { ok: false, manual: true, detail: 'No GSC property is linked to this client. Open Settings → Connect GSC, then verify in Search Console.' };
  }
  try {
    const data = await listSites();
    const sites = data?.siteEntry || [];
    const match = sites.find(s => s.siteUrl === property);
    if (match) {
      const lvl = match.permissionLevel || '';
      const verified = /owner|full|restricted/i.test(lvl);
      if (verified) {
        return { ok: true, detail: 'GSC reports ownership of ' + property + ' (permission: ' + lvl + ').' };
      }
      return { ok: false, detail: 'GSC sees the property but permission level is "' + lvl + '" — ownership is not verified yet.' };
    }
    return { ok: false, detail: property + ' is not in the list of GSC sites this Google account can access. Add the property and verify ownership in Search Console.' };
  } catch (e) {
    // GSC not connected or token missing — fall back to manual confirmation.
    return { ok: false, manual: true, detail: 'Could not check GSC ownership automatically (' + (e.message || 'GSC not connected') + '). Confirm in Search Console: ownership shows a green tick.' };
  }
}

async function verifyAnalyticsTag(impl) {
  if (!impl?.page_url) return { ok: false, manual: true, detail: 'No page URL to scan for analytics tag.' };
  try {
    const { text } = await fetchResource(impl.page_url);
    const hasGA4   = /gtag\(\s*['"]config['"]\s*,\s*['"]G-[A-Z0-9]+/i.test(text) || /googletagmanager\.com\/gtag\/js\?id=G-/i.test(text);
    const hasUA    = /UA-\d{4,}-\d+/.test(text);
    const hasGTM   = /googletagmanager\.com\/gtm\.js\?id=GTM-/i.test(text) || /GTM-[A-Z0-9]+/.test(text);
    if (hasGA4 || hasGTM || hasUA) {
      const found = [hasGA4 && 'GA4 (gtag)', hasGTM && 'GTM container', hasUA && 'Universal Analytics'].filter(Boolean).join(', ');
      return { ok: true, detail: 'Tracking tag found on ' + impl.page_url + ': ' + found + '.' };
    }
    return { ok: false, detail: 'No GA4, GTM, or Universal Analytics tag detected in the page HTML.' };
  } catch (e) {
    return { ok: false, manual: true, detail: 'Could not fetch the page to scan for an analytics tag (' + e.message + ').' };
  }
}

// Pure check — runs the right targeted off-page verification by task type
// and returns { status, detail } WITHOUT writing to Supabase. Call this
// from contexts that own their own persistence (e.g. tseo_tasks).
export async function checkOffPageTask(impl, client) {
  const ct = normalizeType(impl?.change_type);
  const blob = ((impl?.title || '') + ' ' + (impl?.description || '')).toLowerCase();

  let result;
  if (ct === 'sitemap' || ct === 'sitemap_submission' || ct === 'xml_sitemap' || /\bxml sitemap\b|submit.*sitemap/.test(blob)) {
    result = await verifySitemap(impl.page_url, client?.url);
  } else if (
    ct === 'robots_txt' ||
    (ct === 'robots' && (/robots\.txt/.test(blob) || /\/robots\.txt(?:\?|$)/.test(impl?.page_url || ''))) ||
    /robots\.txt/.test(blob) ||
    /\/robots\.txt(?:\?|$)/.test(impl?.page_url || '')
  ) {
    result = await verifyRobots(impl.page_url, client?.url);
  } else if (ct === 'gsc_setup' || ct === 'gsc' || ct === 'search_console' || ct === 'domain_ownership' || ct === 'ownership_verification' || /search console|domain ownership/.test(blob)) {
    result = await verifyGscOwnership(client);
  } else if (ct === 'analytics_setup' || ct === 'ga_setup' || ct === 'gtm_setup' || ct === 'tracking_install' || /google analytics|gtag|gtm|tag manager/.test(blob)) {
    result = await verifyAnalyticsTag(impl);
  } else {
    result = { ok: false, manual: true, detail: 'This task happens off-page (in an admin console). Confirm it manually and click Mark Verified.' };
  }

  const status = result.ok ? 'verified' : (result.manual ? 'manual_required' : 'failed');
  const detail = result.detail + ' · (Off-page check)';
  return { status, detail };
}

// Main entry point for off-page tasks on implementation records. Persists
// the result to syte_suite_implementations.
export async function verifyOffPageTask(impl, client) {
  const { status, detail } = await checkOffPageTask(impl, client);
  await updateImplementation(impl.id, {
    verification_status: status,
    verification_detail: detail,
    verified_at: new Date().toISOString()
  });
  return { status, detail };
}

// Try to fetch the page content. For WordPress sites with credentials,
// ALWAYS prefer the REST API — it bypasses Wordfence, Cloudflare, and
// works for drafts. Only fall back to public CORS fetch for non-WP sites.
async function fetchPageContent(impl, client) {
  const slug = (impl.page_url || '').split('/').filter(Boolean).pop() || '';

  // For HEAD-tag tasks (robots meta, canonical, schema, og tags) we
  // MUST fetch the full HTML — not the WordPress REST API which only
  // returns the post body content (no <head> markup at all). Skip the
  // wp-api branch entirely for these and go straight to page-proxy
  // with raw=true. Articles + AEO content optimizations still benefit
  // from wp-api (drafts, WAF bypass).
  const ct = normalizeType(impl?.change_type);
  const headTask = ct !== 'article' && ct !== 'aeo_optimization';

  // 1. WordPress REST API (preferred — reliable, authenticated, WAF-proof)
  //    BUT only when the change lives in the post body. For head-tag
  //    changes, skip straight to page-proxy.
  if (!headTask && client?.wp_url && client?.wp_username && client?.wp_app_password) {
    const wpBase = client.wp_url.replace(/\/+$/, '');

    // Strategy A: find by slug (most reliable when URL is correct).
    if (slug) {
      for (const type of ['posts', 'pages']) {
        try {
          const res = await fetch('/.netlify/functions/wp-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wpUrl: wpBase, username: client.wp_username,
              appPassword: client.wp_app_password, method: 'GET',
              path: 'wp/v2/' + type + '?slug=' + encodeURIComponent(slug) + '&status=any'
            })
          });
          if (res.ok) {
            const results = await res.json();
            if (Array.isArray(results) && results.length > 0) {
              const post = results[0];
              const html = (post.title?.rendered || '') + '\n' + (post.content?.rendered || '');
              return { html, source: 'wp-api-slug', wpStatus: post.status, wpId: post.id, wpSlug: post.slug };
            }
          }
        } catch {}
      }
    }

    // Strategy B: search by title (fallback if slug doesn't match).
    const searchTitle = (impl.title || '').replace(/[|–—]/g, ' ').trim().slice(0, 50);
    if (searchTitle) {
      try {
        const res = await fetch('/.netlify/functions/wp-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wpUrl: wpBase, username: client.wp_username,
            appPassword: client.wp_app_password, method: 'GET',
            path: 'wp/v2/posts?search=' + encodeURIComponent(searchTitle) + '&per_page=5&status=any'
          })
        });
        if (res.ok) {
          const posts = await res.json();
          if (Array.isArray(posts) && posts.length > 0) {
            // Prefer slug match, then first result.
            const match = posts.find(p => p.slug === slug) || posts[0];
            const html = (match.title?.rendered || '') + '\n' + (match.content?.rendered || '');
            if (html.length > 100) {
              return { html, source: 'wp-api-search', wpStatus: match.status, wpId: match.id, wpSlug: match.slug };
            }
          }
        }
      } catch {}
    }
  }

  // 2. Server-side page proxy (bypasses CORS + most WAFs with real browser
  //    headers). This is the most reliable option for public pages.
  //
  // Pass raw=true for any change that lives in <head> markup (robots
  // meta, canonical, schema, og/twitter tags, html lang, etc.) so the
  // proxy skips Jina Reader. Jina re-renders pages to extract main
  // content and silently strips/normalises <head> tags, which made
  // verification of "removed noindex" / "added schema" / "fixed
  // canonical" tasks fail even when the user had correctly applied the
  // fix on the live page. Articles use Jina-rendered HTML because
  // we want the body text after JS rendering. (ct + headTask declared
  // at the top of this function.)
  try {
    const res = await fetch('/.netlify/functions/page-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: impl.page_url, raw: headTask })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.html && hasUsefulBody(data.html) && !/<title>.*(Log In|Attention Required).*<\/title>/i.test(data.html)) {
        return { html: data.html, source: 'page-proxy' + (data.status !== 200 ? '-' + data.status : '') };
      }
    }
  } catch {}

  // 3. Public fetch via CORS proxy (fallback).
  try {
    const html = await corsFetchText(impl.page_url);
    if (hasUsefulBody(html) && !/<title>.*Log In.*<\/title>/i.test(html)) {
      return { html, source: 'public' };
    }
  } catch {}

  // 4. Last resort CORS with different proxies.
  try {
    const html = await corsFetchText(impl.page_url);
    if (hasUsefulBody(html)) return { html, source: 'cors-fallback' };
    throw new Error('All sources returned head-only or empty HTML');
  } catch (e) {
    throw new Error('Could not fetch the page via any method: ' + e.message);
  }
}

// Reject responses that are head + CSS only (a class of upstream-proxy
// failures). Without this we sent empty bodies to Claude and got the
// false "page HTML contains only the head section" error from the
// verifier.
function hasUsefulBody(html) {
  if (!html || html.length < 200) return false;
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const inner = bodyMatch ? bodyMatch[1] : html;
  const text = inner
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Threshold of 60 chars cleanly separates head-only stubs (0 body
  // text, or "Loading..."/"Error") from any real page (every meaningful
  // page has at least a heading + some content). Set low enough that
  // we don't reject genuinely small pages.
  return text.length >= 60;
}

// "Sent to Developer" verification — used when we hand technical
// optimizations or content changes to the client's developer instead of
// implementing them ourselves. The team member uploads a screenshot of the
// email they sent; Claude Vision confirms it actually shows a sent email
// that relates to this change, then the record is marked
// 'sent_to_developer'. If the screenshot can't be confirmed, NOTHING is
// persisted — the caller can retry with a better screenshot or use
// markSentToDeveloper() to override manually.
export async function verifySentToDeveloper(impl, { imageBase64, mediaType = 'image/jpeg', sentBy = '' } = {}) {
  if (!imageBase64 || imageBase64.length < 100) {
    return { status: 'rejected', detail: 'Screenshot is empty or too small — upload a screenshot of the email you sent.' };
  }
  try {
    const resp = await claudeComplete({
      system: 'You verify that a screenshot shows an email sent to a website developer about an SEO/content change. Return ONLY valid JSON.',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          {
            type: 'text',
            text: `This screenshot should show an email (Gmail, Outlook, or any mail client — compose window or sent message) sent to a website developer, handing over the following change for implementation:

CHANGE:
- Type: ${impl.change_type || ''}
- Title/topic: ${impl.title || ''}
- Page: ${impl.page_url || ''}

RULES:
- Confirm two things only: (1) the screenshot shows an email (a recipient, subject, or message body is visible), and (2) the email plausibly relates to this change or to SEO/content/technical website work for this client in general.
- Be LENIENT. The email does not need to quote the change word-for-word — a general handover email covering several changes counts. Attachments, forwarded threads, and partial screenshots are all fine.
- Only reject if the image is clearly NOT an email (e.g. a random webpage, a blank image) or is completely unreadable.

Return ONLY JSON:
{
  "is_email": true or false,
  "recipient": "who the email is addressed to, if visible, else empty string",
  "subject": "email subject if visible, else empty string",
  "relates": true or false,
  "evidence": "1-2 sentences describing what the screenshot shows"
}`
          }
        ]
      }],
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      temperature: 0
    });
    let parsed;
    try {
      const m = resp.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    } catch { parsed = null; }
    if (!parsed) {
      return { status: 'rejected', detail: 'Could not read the screenshot verification response. Try again or mark as sent manually.' };
    }
    if (!parsed.is_email) {
      return { status: 'rejected', detail: 'The screenshot does not look like an email: ' + (parsed.evidence || 'no email visible.') + ' Upload a screenshot of the sent email, or mark as sent manually.' };
    }
    const detail = [
      'Email screenshot confirmed' + (parsed.recipient ? ' — sent to ' + parsed.recipient : ''),
      parsed.subject ? 'Subject: "' + parsed.subject + '"' : '',
      parsed.evidence || '',
      sentBy ? 'Sent by ' + sentBy : '',
      '(Sent to developer — awaiting implementation on site)'
    ].filter(Boolean).join(' · ');
    // Keep the email screenshot as proof, using the same [SCREENSHOT]
    // marker the history view already renders (fetched on demand via
    // getImplementationDetail — never in bulk list queries).
    const stored = detail + '\n[SCREENSHOT]data:' + mediaType + ';base64,' + imageBase64 + '[/SCREENSHOT]';
    await updateImplementation(impl.id, {
      verification_status: 'sent_to_developer',
      verification_detail: stored,
      verified_at: new Date().toISOString()
    });
    return { status: 'sent_to_developer', detail: stored };
  } catch (e) {
    return { status: 'rejected', detail: 'Could not check the screenshot (' + (e.message || 'API error') + '). Try again or mark as sent manually.' };
  }
}

// Manual override for the sent-to-developer flow — used when the AI check
// on the screenshot fails but the team member confirms the email was sent.
// If a screenshot was uploaded, keep it as proof even though the AI
// couldn't confirm it.
export async function markSentToDeveloper(impl, sentBy = '', { imageBase64, mediaType = 'image/jpeg' } = {}) {
  const detail = 'Marked as sent to developer' + (sentBy ? ' by ' + sentBy : '') +
    ' (manual confirmation, screenshot check skipped) · (Awaiting implementation on site)';
  const stored = imageBase64
    ? detail + '\n[SCREENSHOT]data:' + mediaType + ';base64,' + imageBase64 + '[/SCREENSHOT]'
    : detail;
  await updateImplementation(impl.id, {
    verification_status: 'sent_to_developer',
    verification_detail: stored,
    verified_at: new Date().toISOString()
  });
  return { status: 'sent_to_developer', detail: stored };
}

// Verify using pasted HTML — used when automated fetching fails (Shopify
// bot blocks, Cloudflare challenges, login walls, etc.). The user pastes
// the live page HTML (view source → copy/paste) and Claude verifies.
export async function verifyImplementationFromHtml(impl, pastedHtml) {
  if (!pastedHtml || pastedHtml.length < 100) {
    const detail = 'Pasted HTML is too short or empty.';
    await updateImplementation(impl.id, {
      verification_status: 'failed',
      verification_detail: detail,
      verified_at: new Date().toISOString()
    });
    return { status: 'failed', detail };
  }
  const pageData = { html: pastedHtml.slice(0, 40000), source: 'pasted-html' };
  return runVerifyWithHtml(impl, pageData);
}

// Shared verification runner — takes the impl and pre-fetched pageData.
async function runVerifyWithHtml(impl, pageData) {
  const draftNote = pageData.wpStatus === 'draft'
    ? '\nNOTE: This is a WordPress DRAFT (not yet published). The content was fetched via the WP REST API. Verify the content exists in the draft, not on the public site.'
    : '';
  const truncated = pageData.html.slice(0, 40000);
  const wpNote = pageData.wpSlug
    ? `\n- WordPress post slug: ${pageData.wpSlug} (ID: ${pageData.wpId})`
    : '';
  const prompt = `You are verifying whether an article or SEO change exists on a website.

CHANGE TO VERIFY:
- Module: ${impl.module}
- Type: ${impl.change_type}
- Title/topic: ${impl.title || ''}
- Additional context: ${impl.description || '(none)'}
- Content source: ${pageData.source}${wpNote}${draftNote}

PAGE CONTENT:
${truncated}

VERIFICATION RULES:
- For articles: the page has the article if the main body contains substantial content about the same TOPIC.
- For AEO optimizations (change_type = aeo_optimization): check for CORE CONTENT THEMES, not exact HTML. If 60%+ of core themes are present, mark as implemented.
- For schema: check for the JSON-LD script tag.
- For meta changes: check the <title> tag or meta description.
- Be LENIENT — different formatting/wording/images are acceptable. The goal is to confirm the work was done.

Return ONLY valid JSON:
{
  "implemented": true or false,
  "confidence": "high" | "medium" | "low",
  "evidence": "1-2 sentences: what you found",
  "suggestion": "if not implemented: what is missing"
}`;
  try {
    const resp = await claudeComplete({
      system: 'You verify SEO implementations. Return ONLY valid JSON.',
      messages: [{ role: 'user', content: prompt }],
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      temperature: 0
    });
    let parsed;
    try {
      const jsonMatch = resp.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch { parsed = null; }
    if (!parsed) {
      const detail = 'Could not parse verification response.';
      await updateImplementation(impl.id, { verification_status: 'failed', verification_detail: detail, verified_at: new Date().toISOString() });
      return { status: 'failed', detail };
    }
    const status = parsed.implemented ? 'verified' : 'failed';
    const detail = [
      parsed.evidence || '',
      parsed.suggestion ? 'Suggestion: ' + parsed.suggestion : '',
      'Confidence: ' + (parsed.confidence || 'unknown'),
      '(Source: ' + pageData.source + ')'
    ].filter(Boolean).join(' · ');
    await updateImplementation(impl.id, { verification_status: status, verification_detail: detail, verified_at: new Date().toISOString() });
    return { status, detail };
  } catch (e) {
    const detail = 'Verification API error: ' + e.message;
    await updateImplementation(impl.id, { verification_status: 'failed', verification_detail: detail, verified_at: new Date().toISOString() });
    return { status: 'failed', detail };
  }
}

// Visual verification — takes a screenshot of the rendered page (including
// JS content) and asks Claude Vision to check if the specific change is
// visible. Works for Shopify/React/Vue sites where server-side HTML doesn't
// contain the JS-rendered content.
export async function verifyImplementationVisually(impl) {
  if (!impl?.page_url) return { status: 'failed', detail: 'No page URL.' };

  // thum.io renders JS and returns a screenshot. Fetch as base64 for Claude Vision.
  const screenshotUrl = 'https://image.thum.io/get/png/width/800/crop/1200/noanimate/' + impl.page_url;
  let imageBase64;
  let mediaType = 'image/png';
  try {
    const res = await fetch(screenshotUrl);
    if (!res.ok) throw new Error('Screenshot service returned ' + res.status);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('jpeg') || ct.includes('jpg')) mediaType = 'image/jpeg';
    else if (ct.includes('webp')) mediaType = 'image/webp';
    else if (ct.includes('gif')) mediaType = 'image/gif';
    const arrayBuf = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    imageBase64 = btoa(binary);
    if (!imageBase64 || imageBase64.length < 100) throw new Error('Screenshot is empty or too small');
  } catch (e) {
    const detail = 'Could not capture page screenshot: ' + e.message;
    await updateImplementation(impl.id, { verification_status: 'failed', verification_detail: detail, verified_at: new Date().toISOString() });
    return { status: 'failed', detail };
  }

  // Ask Claude Vision to check if the content is visible.
  const changeDesc = impl.change_type === 'aeo_optimization'
    ? `AEO optimization titled "${impl.title}". Look for: answer blocks (styled paragraph blocks near the top), FAQ sections (accordion or Q&A lists), key takeaways (bullet point summaries), or similar structured content sections that weren't part of the original page design.`
    : `${impl.change_type}: "${impl.title}". Content: ${(impl.description || '').slice(0, 300)}`;

  try {
    const resp = await claudeComplete({
      system: 'You visually verify SEO changes on live web pages by examining screenshots. Return ONLY valid JSON.',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 }
          },
          {
            type: 'text',
            text: `Look at this screenshot of ${impl.page_url} and determine if the following change is visible on the page:

${changeDesc}

RULES:
- Look for the VISUAL PRESENCE of the content — styled blocks, FAQ sections, bullet lists, answer paragraphs, schema indicators.
- The exact HTML/styling may differ from the original implementation — that's fine. Check if the CONTENT THEMES are present.
- For "Answer Block": look for a prominent text block near the top of the page with a brand definition or summary paragraph, often with a colored background or left border.
- For "FAQ Section": look for a list of questions with expandable answers, an accordion, or Q&A pairs.
- For "Key Takeaways": look for a bulleted or numbered list summarizing key services/features.
- Be LENIENT — different styling is acceptable. The goal is: did they add the content?

Return ONLY JSON:
{
  "visible": true or false,
  "confidence": "high" | "medium" | "low",
  "evidence": "1-2 sentences describing what you see that confirms or denies the change"
}`
          }
        ]
      }],
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      temperature: 0
    });

    let parsed;
    try {
      const m = resp.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    } catch { parsed = null; }

    if (!parsed) {
      await updateImplementation(impl.id, { verification_status: 'failed', verification_detail: 'Could not parse visual verification.', verified_at: new Date().toISOString() });
      return { status: 'failed', detail: 'Could not parse visual verification response.' };
    }

    const status = parsed.visible ? 'verified' : 'failed';
    const detail = (parsed.evidence || '') + ' · Confidence: ' + (parsed.confidence || '?') + ' · (Visual verification via screenshot)';
    await updateImplementation(impl.id, { verification_status: status, verification_detail: detail, verified_at: new Date().toISOString() });
    return { status, detail };
  } catch (e) {
    const detail = 'Visual verification error: ' + e.message;
    await updateImplementation(impl.id, { verification_status: 'failed', verification_detail: detail, verified_at: new Date().toISOString() });
    return { status: 'failed', detail };
  }
}

export async function verifyImplementation(impl, client) {
  // Off-page tasks (GSC ownership, sitemap submission, analytics install,
  // robots.txt) cannot be verified from page HTML or screenshots — they
  // need a different check entirely. Route them before fetching the page.
  if (isOffPageTask(impl)) {
    return verifyOffPageTask(impl, client);
  }

  if (!impl?.page_url) {
    const detail = 'No page URL to scan.';
    await updateImplementation(impl.id, {
      verification_status: 'failed',
      verification_detail: detail,
      verified_at: new Date().toISOString()
    });
    return { status: 'failed', detail };
  }

  let pageData;
  try {
    pageData = await fetchPageContent(impl, client);
  } catch (e) {
    const detail = 'Could not fetch the page: ' + e.message;
    await updateImplementation(impl.id, {
      verification_status: 'failed',
      verification_detail: detail,
      verified_at: new Date().toISOString()
    });
    return { status: 'failed', detail };
  }

  // If the post is a WordPress draft, note that in the verification
  // context so Claude doesn't penalize for "page not publicly visible."
  const draftNote = pageData.wpStatus === 'draft'
    ? '\nNOTE: This is a WordPress DRAFT (not yet published). The content was fetched via the WP REST API. Verify the content exists in the draft, not on the public site.'
    : '';

  const truncated = pageData.html.slice(0, 40000);
  const wpNote = pageData.wpSlug
    ? `\n- WordPress post slug: ${pageData.wpSlug} (ID: ${pageData.wpId})`
    : '';
  const prompt = `You are verifying whether an article or SEO change exists on a website.

CHANGE TO VERIFY:
- Module: ${impl.module}
- Type: ${impl.change_type}
- Title/topic: ${impl.title || ''}
- Additional context: ${impl.description || '(none)'}
- Content source: ${pageData.source}${wpNote}${draftNote}

PAGE CONTENT:
${truncated}

VERIFICATION RULES:
- For articles: the page has the article if the main body contains substantial content about the same TOPIC. The H1 and meta title may differ slightly — that's normal SEO practice. Look for matching key themes, not exact title strings.
- For AEO optimizations (change_type = aeo_optimization): be LENIENT. The team REFORMATS the raw HTML before publishing — they add images, change headings, use icons instead of bullets, reword for brand voice, paraphrase for tone. Do NOT compare exact HTML or exact wording. Check ONLY: does the page now contain the CORE INFORMATION? For answer blocks, the page has a concise overview paragraph near the top covering the same topic — exact wording does not matter. For FAQ sections, the page has questions + answers covering similar topics — paraphrased questions count. For key takeaways / bullet lists, the page has a structured list covering similar topics — different bullet wording counts. For comparison tables, the page has a table with matching column meanings. For schema, check for the JSON-LD script tag with matching @type.

  IMPORTANT — bundled multi-opt push: if the description mentions "Combined AEO push" or lists multiple opts (numbered 1., 2., 3., …), mark implemented when AT LEAST 60% of the listed opts have matching content on the page. Don't require all of them. The user may have paraphrased / merged some sections during paste.

  IMPORTANT — accordions: <details>/<summary> blocks count as fully present even when collapsed. The content is in the page source on initial load; bots see it; that's all that matters for AEO. Don't penalize because the visible page state is collapsed.
- For schema changes: check for the JSON-LD script tag.
- For meta changes: check the <title> tag or meta description.
- For robots / noindex changes (change_type 'robots'): check the <meta name="robots"> tag in <head>. The fix is IMPLEMENTED when the page is indexable — that means: meta robots is "index, follow" or "all", OR there is NO meta robots tag at all (defaults to indexable), OR the X-Robots-Tag header indicates index. The fix is NOT implemented only if a meta robots tag explicitly contains "noindex". WordPress / Yoast / Rank Math may render the tag with various attributes — accept any form as long as "noindex" is absent.
- If content was fetched via wp-api (WordPress REST API), the HTML is the raw post body — check for the article content directly.
- A WordPress draft that contains the article counts as "implemented" (it exists, just not published yet).
- IMPORTANT: be LENIENT. The goal is to confirm the team did the work, not to grade exact copy-paste accuracy. Different formatting, slightly different wording, added images, or rearranged sections are ALL acceptable.

Return ONLY valid JSON (no prose, no code fences):
{
  "implemented": true or false,
  "confidence": "high" | "medium" | "low",
  "evidence": "1-2 sentences: what you found that confirms/denies",
  "suggestion": "if not implemented: what is missing. if implemented: empty string"
}`;

  try {
    const resp = await claudeComplete({
      system: 'You verify SEO implementations. Return ONLY valid JSON.',
      messages: [{ role: 'user', content: prompt }],
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      temperature: 0
    });

    let parsed;
    try {
      const jsonMatch = resp.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch { parsed = null; }

    if (!parsed) {
      const detail = 'Could not parse verification response.';
      await updateImplementation(impl.id, {
        verification_status: 'failed',
        verification_detail: detail,
        verified_at: new Date().toISOString()
      });
      return { status: 'failed', detail };
    }

    const status = parsed.implemented ? 'verified' : 'failed';
    const detail = [
      parsed.evidence || '',
      parsed.suggestion ? 'Suggestion: ' + parsed.suggestion : '',
      'Confidence: ' + (parsed.confidence || 'unknown'),
      pageData.source !== 'public' ? '(Fetched via ' + pageData.source + ')' : ''
    ].filter(Boolean).join(' · ');

    await updateImplementation(impl.id, {
      verification_status: status,
      verification_detail: detail,
      verified_at: new Date().toISOString()
    });
    return { status, detail };
  } catch (e) {
    const detail = 'Verification API error: ' + e.message;
    await updateImplementation(impl.id, {
      verification_status: 'failed',
      verification_detail: detail,
      verified_at: new Date().toISOString()
    });
    return { status: 'failed', detail };
  }
}
