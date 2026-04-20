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

  // 2. Public fetch via CORS proxy (non-WP sites, or WP without credentials).
  try {
    const html = await corsFetchText(impl.page_url);
    if (html.length > 500 && !/<title>.*Log In.*<\/title>/i.test(html)) {
      return { html, source: 'public' };
    }
  } catch {}

  // 3. Last resort CORS with different proxies.
  try {
    const html = await corsFetchText(impl.page_url);
    return { html, source: 'cors-fallback' };
  } catch (e) {
    throw new Error('Could not fetch the page via any method: ' + e.message);
  }
}

export async function verifyImplementation(impl, client) {
  if (!impl?.page_url) {
    await updateImplementation(impl.id, {
      verification_status: 'failed',
      verification_detail: 'No page URL to scan.',
      verified_at: new Date().toISOString()
    });
    return 'failed';
  }

  let pageData;
  try {
    pageData = await fetchPageContent(impl, client);
  } catch (e) {
    await updateImplementation(impl.id, {
      verification_status: 'failed',
      verification_detail: 'Could not fetch the page: ' + e.message,
      verified_at: new Date().toISOString()
    });
    return 'failed';
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
      await updateImplementation(impl.id, {
        verification_status: 'failed',
        verification_detail: 'Could not parse verification response.',
        verified_at: new Date().toISOString()
      });
      return 'failed';
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
    return status;
  } catch (e) {
    await updateImplementation(impl.id, {
      verification_status: 'failed',
      verification_detail: 'Verification API error: ' + e.message,
      verified_at: new Date().toISOString()
    });
    return 'failed';
  }
}
