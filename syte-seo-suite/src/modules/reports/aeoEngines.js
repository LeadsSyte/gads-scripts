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
// Uses the Responses API (not Chat Completions) with the web_search_preview
// tool enabled. Without web search, gpt-4o relies on stale training data
// and reliably refuses to recommend specific brands or hallucinates ones
// that don't exist — the result is "ChatGPT 0% on every query" because
// no SA brand name ever appears. Web search makes ChatGPT actually look
// at current pages, so brand mentions track real visibility.
export const chatgpt = {
  id: 'chatgpt',
  label: 'ChatGPT',
  model: 'gpt-4o',
  isConfigured: () => !!loadSettings().openaiKey,
  async ask(query) {
    const { openaiKey } = loadSettings();
    try {
      const res = await fetch('/.netlify/functions/openai-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: openaiKey,
          endpoint: 'responses',
          body: {
            model: 'gpt-4o',
            input: query,
            tools: [{ type: 'web_search_preview' }],
            max_output_tokens: MAX_TOKENS
          }
        })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return { error: 'OpenAI ' + res.status + ' ' + txt.slice(0, 200) };
      }
      const data = await res.json();
      // Responses API returns output[].content[].text + structured URL
      // citations in annotations. We collapse text parts into one string
      // for the brand detector — the citations get appended so the
      // detector also picks up domain mentions that only appear in the
      // citation list (the gold-tier signal).
      const parts = [];
      for (const item of data.output || []) {
        for (const c of item.content || []) {
          if (typeof c.text === 'string') parts.push(c.text);
          for (const a of c.annotations || []) {
            if (a.type === 'url_citation' && a.url) parts.push(a.url);
          }
        }
      }
      const text = parts.join('\n').trim();
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
// Model bumped to gemini-2.5-flash — the older gemini-1.5-flash was
// retired earlier in 2025 and now returns 404 for new calls. That was
// silently zeroing every Gemini row in AEO snapshots (no surfaced
// error, just an empty row that got filtered out at render time).
export const gemini = {
  id: 'gemini',
  label: 'Gemini',
  model: 'gemini-2.5-flash',
  isConfigured: () => !!loadSettings().googleAiKey,
  async ask(query) {
    const { googleAiKey } = loadSettings();
    try {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key='
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
