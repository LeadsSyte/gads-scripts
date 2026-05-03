// Direct-from-browser callers for the four AI engines used by the AEO
// Snapshot module. Each engine exports `isConfigured()` and `ask(query)`.
// `ask()` always resolves — on error it returns `{ error }` instead of
// throwing, so one broken engine never stops a full sweep.
//
// Built-in Claude uses the suite's sessionStorage key. The three others use
// user-provided keys from localStorage (lib/settings.js).

import { loadSettings } from '../../lib/settings.js';
import { getStoredApiKey } from '../../lib/auth.js';

const MAX_TOKENS = 500;

// ------- ChatGPT / OpenAI --------------------------------------------------
export const chatgpt = {
  id: 'chatgpt',
  label: 'ChatGPT',
  model: 'gpt-4o',
  isConfigured: () => !!loadSettings().openaiKey,
  async ask(query) {
    const { openaiKey } = loadSettings();
    // Route through our openai-proxy Netlify function — api.openai.com
    // does not return CORS headers for browser-origin requests, so a
    // direct fetch fails with "Failed to fetch" before we ever see a
    // response. This was silently zeroing out ChatGPT's contribution
    // to AEO probes (only Claude rows showed up in the report).
    try {
      const res = await fetch('/.netlify/functions/openai-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: openaiKey,
          endpoint: 'chat/completions',
          body: {
            model: 'gpt-4o',
            max_tokens: MAX_TOKENS,
            messages: [
              { role: 'system', content: 'You are a helpful assistant. Answer naturally.' },
              { role: 'user', content: query }
            ]
          }
        })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return { error: 'OpenAI ' + res.status + ' ' + txt.slice(0, 200) };
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      return { text };
    } catch (e) { return { error: e.message }; }
  }
};

// ------- Perplexity --------------------------------------------------------
export const perplexity = {
  id: 'perplexity',
  label: 'Perplexity',
  model: 'sonar',
  isConfigured: () => !!loadSettings().perplexityKey,
  async ask(query) {
    const { perplexityKey } = loadSettings();
    try {
      const res = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + perplexityKey
        },
        body: JSON.stringify({
          model: 'sonar',
          max_tokens: MAX_TOKENS,
          messages: [
            { role: 'system', content: 'Be precise and concise.' },
            { role: 'user', content: query }
          ]
        })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return { error: 'Perplexity ' + res.status + ' ' + txt.slice(0, 200) };
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      return { text };
    } catch (e) { return { error: e.message }; }
  }
};

// ------- Gemini ------------------------------------------------------------
export const gemini = {
  id: 'gemini',
  label: 'Gemini',
  model: 'gemini-1.5-flash',
  isConfigured: () => !!loadSettings().googleAiKey,
  async ask(query) {
    const { googleAiKey } = loadSettings();
    try {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key='
        + encodeURIComponent(googleAiKey);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: query }] }]
        })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return { error: 'Gemini ' + res.status + ' ' + txt.slice(0, 200) };
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      return { text };
    } catch (e) { return { error: e.message }; }
  }
};

// ------- Claude (built-in) -------------------------------------------------
export const claude = {
  id: 'claude',
  label: 'Claude',
  model: 'claude-haiku-4-5-20251001',
  isConfigured: () => !!getStoredApiKey(),
  async ask(query) {
    const key = getStoredApiKey();
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'x-api-key': key
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: query }]
        })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return { error: 'Claude ' + res.status + ' ' + txt.slice(0, 200) };
      }
      const data = await res.json();
      const text = (data.content || []).map(b => b.text || '').join('');
      return { text };
    } catch (e) { return { error: e.message }; }
  }
};

export const ALL_ENGINES = [chatgpt, perplexity, gemini, claude];

export function activeEngines() {
  return ALL_ENGINES.filter(e => e.isConfigured());
}
