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

// Try to fetch the page HTML. First try direct/CORS proxy (for published
// pages). If the URL is on a WordPress site with credentials, fall back
// to fetching the post content via the WP REST API through our proxy.
async function fetchPageContent(impl, client) {
  // 1. Try public fetch first (works for published pages).
  try {
    const html = await corsFetchText(impl.page_url);
    // If we got a meaningful page (not a login redirect or 404 body).
    if (html.length > 500 && !/<title>.*Log In.*<\/title>/i.test(html)) {
      return { html, source: 'public' };
    }
  } catch {}

  // 2. If client has WP credentials, try fetching the post via REST API.
  if (client?.wp_url && client?.wp_username && client?.wp_app_password) {
    try {
      // Try to find the post by searching for the title.
      const searchTitle = (impl.title || '').slice(0, 50);
      const res = await fetch('/.netlify/functions/wp-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wpUrl: client.wp_url.replace(/\/+$/, ''),
          username: client.wp_username,
          appPassword: client.wp_app_password,
          method: 'GET',
          path: 'wp/v2/posts?search=' + encodeURIComponent(searchTitle) + '&per_page=5&status=any'
        })
      });
      if (res.ok) {
        const posts = await res.json();
        if (Array.isArray(posts) && posts.length > 0) {
          // Pick the best match — prefer exact URL match, then first result.
          const slug = impl.page_url.split('/').filter(Boolean).pop() || '';
          const match = posts.find(p => p.slug === slug || p.link === impl.page_url) || posts[0];
          const content = (match.content?.rendered || '') + (match.title?.rendered || '');
          if (content.length > 100) {
            return { html: content, source: 'wp-api', wpStatus: match.status, wpId: match.id };
          }
        }
      }
    } catch {}
  }

  // 3. Last resort — try the CORS proxy again with a longer timeout.
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
  const prompt = `You are verifying whether a specific SEO change has been implemented on a live website.

CHANGE TO VERIFY:
- Module: ${impl.module}
- Type: ${impl.change_type}
- Title: ${impl.title || ''}
- Description of the change: ${impl.description || ''}
- Content source: ${pageData.source}${draftNote}

PAGE HTML (truncated to 40k chars):
${truncated}

Check whether the described change is present in the HTML above.
For articles: verify the title, key headings, and content themes match — don't require exact word-for-word match since WordPress may reformat the HTML.

Return ONLY valid JSON (no prose, no code fences):
{
  "implemented": true or false,
  "confidence": "high" | "medium" | "low",
  "evidence": "1-2 sentences: what you found (or didn't find) in the HTML that confirms/denies the implementation",
  "suggestion": "if not implemented: what specifically is missing. if implemented: empty string"
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
