// Direct-from-browser callers for the four AI engines used by the AEO engine.
// Each engine exports `isConfigured()` and `ask(query, { search })`.
// `ask()` always resolves — on error it returns `{ error }` instead of
// throwing, so one broken engine never stops a full sweep.
//
// v2: ask() now returns the FULL raw response object as `raw` (so citation
// fields can be parsed structurally), the model + searchMode actually used,
// and supports dual-mode probing (Requirement 5):
//   - ChatGPT + Claude support search_off (parametric) and search_on (web
//     search tool enabled). Reported as separate columns.
//   - Perplexity + Gemini are retrieval-native — they run search_on only, and
//     that is hard-coded here regardless of the requested mode.
//
// Built-in Claude uses the suite's stored key. The three others use
// user-provided keys from localStorage (lib/settings.js).

import { loadSettings } from '../../lib/settings.js';
import { getStoredApiKey } from '../../lib/auth.js';

const MAX_TOKENS = 500;

// ------- ChatGPT / OpenAI --------------------------------------------------
// search_off → gpt-4o (parametric). search_on → gpt-4o-search-preview, which
// grounds answers in live web results and returns url_citation annotations.
export const chatgpt = {
  id: 'chatgpt',
  label: 'ChatGPT',
  model: 'gpt-4o',
  retrievalNative: false,
  supportsSearchOff: true,
  isConfigured: () => !!loadSettings().openaiKey,
  async ask(query, { search = true } = {}) {
    const { openaiKey } = loadSettings();
    const model = search ? 'gpt-4o-search-preview' : 'gpt-4o';
    const searchMode = search ? 'search_on' : 'search_off';
    const body = {
      model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Answer naturally.' },
        { role: 'user', content: query }
      ]
    };
    if (search) body.web_search_options = {};
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + openaiKey },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return { error: 'OpenAI ' + res.status + ' ' + txt.slice(0, 200), status: res.status, model, searchMode };
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      return { text, raw: data, model, searchMode };
    } catch (e) { return { error: e.message, model, searchMode }; }
  }
};

// ------- Perplexity --------------------------------------------------------
// Retrieval-native — always search_on.
export const perplexity = {
  id: 'perplexity',
  label: 'Perplexity',
  model: 'sonar',
  retrievalNative: true,
  supportsSearchOff: false,
  isConfigured: () => !!loadSettings().perplexityKey,
  async ask(query) {
    const { perplexityKey } = loadSettings();
    try {
      const res = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + perplexityKey },
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
        return { error: 'Perplexity ' + res.status + ' ' + txt.slice(0, 200), status: res.status, model: 'sonar', searchMode: 'search_on' };
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      return { text, raw: data, model: 'sonar', searchMode: 'search_on' };
    } catch (e) { return { error: e.message, model: 'sonar', searchMode: 'search_on' }; }
  }
};

// ------- Gemini ------------------------------------------------------------
// Retrieval-native — always search_on. We request Google Search grounding so
// groundingMetadata (citation URIs) is populated when available.
export const gemini = {
  id: 'gemini',
  label: 'Gemini',
  model: 'gemini-1.5-flash',
  retrievalNative: true,
  supportsSearchOff: false,
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
          contents: [{ parts: [{ text: query }] }],
          tools: [{ google_search_retrieval: {} }]
        })
      });
      if (!res.ok) {
        // Grounding tool may be rejected on some keys/quotas — retry once
        // without the tool so the probe still returns a parametric answer.
        const txt = await res.text().catch(() => '');
        const retry = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: query }] }] })
        }).catch(() => null);
        if (!retry || !retry.ok) {
          return { error: 'Gemini ' + res.status + ' ' + txt.slice(0, 200), status: res.status, model: 'gemini-1.5-flash', searchMode: 'search_on' };
        }
        const rdata = await retry.json();
        const rtext = rdata.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
        return { text: rtext, raw: rdata, model: 'gemini-1.5-flash', searchMode: 'search_on' };
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      return { text, raw: data, model: 'gemini-1.5-flash', searchMode: 'search_on' };
    } catch (e) { return { error: e.message, model: 'gemini-1.5-flash', searchMode: 'search_on' }; }
  }
};

// ------- Claude (built-in) -------------------------------------------------
// search_off → parametric. search_on → web_search tool enabled.
export const claude = {
  id: 'claude',
  label: 'Claude',
  model: 'claude-haiku-4-5-20251001',
  retrievalNative: false,
  supportsSearchOff: true,
  isConfigured: () => !!getStoredApiKey(),
  async ask(query, { search = false } = {}) {
    const key = getStoredApiKey();
    const searchMode = search ? 'search_on' : 'search_off';
    const body = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: query }]
    };
    if (search) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'x-api-key': key
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return { error: 'Claude ' + res.status + ' ' + txt.slice(0, 200), status: res.status, model: body.model, searchMode };
      }
      const data = await res.json();
      const text = (data.content || []).map(b => b.text || '').join('');
      return { text, raw: data, model: body.model, searchMode };
    } catch (e) { return { error: e.message, model: 'claude-haiku-4-5-20251001', searchMode }; }
  }
};

export const ALL_ENGINES = [chatgpt, perplexity, gemini, claude];

export function activeEngines() {
  return ALL_ENGINES.filter(e => e.isConfigured());
}

// Resolve which run modes a given probe should run on a given engine
// (Requirement 5). Retrieval-native engines are hard-coded to search_on.
export function resolveRunModes(probeRunMode, engine) {
  if (engine.retrievalNative || !engine.supportsSearchOff) return ['search_on'];
  if (probeRunMode === 'search_off') return ['search_off'];
  if (probeRunMode === 'search_on') return ['search_on'];
  return ['search_off', 'search_on']; // 'both'
}
