import { STAGING_DOMAINS } from '../constants';

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;
// NOTE: This key is embedded in the client bundle at build time.
// It's visible in the browser's network tab. For an internal agency tool this is acceptable.
// For a public-facing app, add a backend proxy to keep the key server-side.

export function isStagingUrl(url) {
  try {
    const host = new URL(url.startsWith('http') ? url : 'https://' + url).hostname.toLowerCase();
    return STAGING_DOMAINS.some(d => host.endsWith(d));
  } catch {
    return false;
  }
}

export async function callAI(prompt, maxTok = 16000, search = false) {
  const controller = new AbortController();
  const timeoutMs = search ? 90000 : 60000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTok,
      messages: [{ role: 'user', content: prompt }],
    };
    if (search) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!r.ok) {
      const t = await r.text();
      throw new Error('API ' + r.status + ': ' + t.substring(0, 200));
    }

    const d = await r.json();
    if (!d.content || !d.content.length) throw new Error('Empty response');
    if (d.stop_reason === 'max_tokens') throw new Error('Response truncated.');

    let txt = d.content
      .filter(c => c.type === 'text')
      .map(c => c.text || '')
      .join('');
    txt = txt.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON found: ' + txt.substring(0, 200));
    return JSON.parse(m[0]);
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Scan timed out. The site may be slow — try again, or fill in the brief manually.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
