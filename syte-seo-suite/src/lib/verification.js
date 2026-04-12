// AI verification scanner. After a team member marks a change as
// implemented, this fetches the live page and asks Claude Haiku whether
// the change is actually present. Updates the implementation record
// with verified/failed + Claude's explanation.

import { corsFetchText } from './corsProxy.js';
import { claudeComplete } from './anthropic.js';
import { updateImplementation } from './supabase.js';

export async function verifyImplementation(impl) {
  if (!impl?.page_url) {
    await updateImplementation(impl.id, {
      verification_status: 'failed',
      verification_detail: 'No page URL to scan.',
      verified_at: new Date().toISOString()
    });
    return 'failed';
  }

  let html = '';
  try {
    html = await corsFetchText(impl.page_url);
  } catch (e) {
    await updateImplementation(impl.id, {
      verification_status: 'failed',
      verification_detail: 'Could not fetch the page: ' + e.message,
      verified_at: new Date().toISOString()
    });
    return 'failed';
  }

  // Ask Claude Haiku to check if the change is present.
  const truncated = html.slice(0, 40000);
  const prompt = `You are verifying whether a specific SEO change has been implemented on a live website.

CHANGE TO VERIFY:
- Module: ${impl.module}
- Type: ${impl.change_type}
- Title: ${impl.title || ''}
- Description of the change: ${impl.description || ''}

LIVE PAGE HTML (truncated to 40k chars):
${truncated}

Check whether the described change is present in the HTML above.

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
      'Confidence: ' + (parsed.confidence || 'unknown')
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
