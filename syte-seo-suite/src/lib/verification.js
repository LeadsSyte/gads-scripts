// AI verification scanner. After a team member marks a change as
// implemented, this fetches the live page and asks Claude Haiku whether
// the change is actually present. Updates the implementation record
// with verified/failed + Claude's explanation.
//
// IMPORTANT: WordPress drafts are NOT publicly accessible, so verification
// will always fail for unpublished content. In that case we route through
// the wp-proxy to fetch the draft's content via the REST API instead.

import { corsFetchText } from './corsProxy.js';
import { claudeComplete } from './anthropic.js';
import { updateImplementation } from './supabase.js';

// Try to fetch the page content. For WordPress sites with credentials,
// ALWAYS prefer the REST API — it bypasses Wordfence, Cloudflare, and
// works for drafts. Only fall back to public CORS fetch for non-WP sites.
async function fetchPageContent(impl, client) {
  const slug = (impl.page_url || '').split('/').filter(Boolean).pop() || '';

  // 1. WordPress REST API (preferred — reliable, authenticated, WAF-proof).
  if (client?.wp_url && client?.wp_username && client?.wp_app_password) {
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
  try {
    const res = await fetch('/.netlify/functions/page-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: impl.page_url })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.html && data.html.length > 500 && !/<title>.*(Log In|Attention Required).*<\/title>/i.test(data.html)) {
        return { html: data.html, source: 'page-proxy' + (data.status !== 200 ? '-' + data.status : '') };
      }
    }
  } catch {}

  // 3. Public fetch via CORS proxy (fallback).
  try {
    const html = await corsFetchText(impl.page_url);
    if (html.length > 500 && !/<title>.*Log In.*<\/title>/i.test(html)) {
      return { html, source: 'public' };
    }
  } catch {}

  // 4. Last resort CORS with different proxies.
  try {
    const html = await corsFetchText(impl.page_url);
    return { html, source: 'cors-fallback' };
  } catch (e) {
    throw new Error('Could not fetch the page via any method: ' + e.message);
  }
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
      model: 'claude-sonnet-4-20250514',
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
- For AEO optimizations (change_type = aeo_optimization): the team REFORMATS the raw HTML before publishing — they add images, change headings, use icons instead of bullets, reword slightly for brand voice. Do NOT compare exact HTML. Instead check: does the page now contain the CORE INFORMATION from the optimization? For answer blocks, check if the page has a concise overview paragraph near the top. For FAQ sections, check if similar questions + answers exist anywhere on the page. For key takeaways / bullet lists, check if the page has a structured list covering the same topics. For schema, check for JSON-LD script tags. If 60%+ of the core content themes are present on the page, mark it as implemented.
- For schema changes: check for the JSON-LD script tag.
- For meta changes: check the <title> tag or meta description.
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
