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
// History: gemini-1.5-flash was retired mid-2025 (404 for new calls),
// gemini-2.5-flash is current but its shared / free tier 503s under
// load with "high demand" messaging. That zeroed ~30/45 iterations on
// recent snapshots.
//
// Strategy: each ask() tries a chain of model IDs, with exponential
// backoff per model. We start with the cheap fast model the suite is
// configured for, then fall back to alternates. Anything 4xx that isn't
// a quota issue is treated as permanent and bails immediately so we
// don't burn the snapshot waiting on a misconfigured key.
//
// `model` exported below is the primary; fallbacks are tried in order.
const GEMINI_PRIMARY = 'gemini-2.5-flash';
const GEMINI_FALLBACKS = ['gemini-2.0-flash', 'gemini-flash-latest'];
const RETRYABLE_GEMINI_STATUS = new Set([429, 500, 502, 503, 504]);
const GEMINI_RETRY_DELAYS_MS = [1000, 2000, 4000];

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function geminiCall(model, body, apiKey) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + model + ':generateContent?key=' + encodeURIComponent(apiKey);
  let lastErr = null;
  for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
        return { ok: true, text, model };
      }
      const txt = await res.text().catch(() => '');
      // Auth / bad-request / not-found: permanent — caller should try next model
      // (404 typically means "this model id is retired", which is exactly what
      // the fallback chain is for).
      if (!RETRYABLE_GEMINI_STATUS.has(res.status)) {
        return { ok: false, permanent: true, status: res.status, error: 'Gemini ' + res.status + ' ' + txt.slice(0, 200) };
      }
      lastErr = 'Gemini ' + res.status + ' ' + txt.slice(0, 200);
    } catch (e) {
      lastErr = e.message;
    }
    if (attempt < GEMINI_RETRY_DELAYS_MS.length) {
      await wait(GEMINI_RETRY_DELAYS_MS[attempt]);
    }
  }
  return { ok: false, permanent: false, error: lastErr || 'Gemini retries exhausted' };
}

export const gemini = {
  id: 'gemini',
  label: 'Gemini',
  model: GEMINI_PRIMARY,
  isConfigured: () => !!loadSettings().googleAiKey,
  async ask(query) {
    const { googleAiKey } = loadSettings();
    const body = JSON.stringify({ contents: [{ parts: [{ text: query }] }] });
    const chain = [GEMINI_PRIMARY, ...GEMINI_FALLBACKS];
    let lastErr = null;
    for (const model of chain) {
      const r = await geminiCall(model, body, googleAiKey);
      if (r.ok) return { text: r.text };
      lastErr = r.error;
      // 4xx auth/billing errors will be permanent on every model — bail.
      // (401, 403 etc.) 404 means *this* model is retired/unavailable; the
      // next model in the chain might still work, so don't bail on 404.
      if (r.permanent && r.status !== 404) {
        return { error: r.error };
      }
    }
    return { error: lastErr || 'Gemini failed across all fallback models' };
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
