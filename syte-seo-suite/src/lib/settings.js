// Suite-wide settings (per-device). Holds user-provided external API keys
// that aren't shipped with the suite encrypted blob. Kept in localStorage
// so they persist across sessions but stay on the device they were entered.

const KEY = 'syte-suite-settings';

const DEFAULTS = {
  openaiKey: '',
  perplexityKey: '',
  googleAiKey: ''
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const merged = { ...loadSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}

export function engineStatus() {
  const s = loadSettings();
  return {
    chatgpt:    !!s.openaiKey,
    perplexity: !!s.perplexityKey,
    gemini:     !!s.googleAiKey,
    claude:     true // always available via the suite's built-in Anthropic key
  };
}

// Rough cost model for a full AEO sweep across N clients.
// Assumption: each engine costs ~$0.005 per probe-query response, plus one
// Claude-Haiku sentiment call per mention detected (~$0.001).
export function estimateSweepCost(clientCount, avgQueriesPerClient = 6) {
  const { chatgpt, perplexity, gemini, claude } = engineStatus();
  const activeEngines = [chatgpt, perplexity, gemini, claude].filter(Boolean).length;
  const responses = clientCount * avgQueriesPerClient * activeEngines;
  const cost = responses * 0.005 + responses * 0.0005; // sentiment
  return { responses, activeEngines, cost };
}
