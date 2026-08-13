// Suite-wide settings. Holds user-provided external API keys that aren't
// shipped with the suite's encrypted blob. localStorage is the local source
// of truth (so isConfigured() / loadSettings() stay synchronous), but the
// keys are ALSO synced to a shared Supabase row so they follow the operator
// to any device. Previously localStorage-only, which meant a fresh browser or
// cleared cache silently lost the keys and the AEO probe dropped to
// Claude-only (Claude has a built-in key; the others don't).

import { loadRemoteSettings, saveRemoteSettings } from './supabase.js';

const KEY = 'syte-suite-settings';

// Dispatched after a remote hydrate changes the local cache, so open UI
// (engine status dots, the report's pre-run engine notice) can refresh.
export const SETTINGS_EVENT = 'syte-suite-settings-changed';

const DEFAULTS = {
  openaiKey: '',
  googleAiKey: ''
};

// Engines whose API keys are BUILT IN to this deployment (held server-side in
// Netlify env vars, used by the openai-proxy / gemini-proxy functions). The
// browser can't see the secret keys, so this public build-time flag tells the
// UI which engines are available to everyone without a personal key. Set
// `VITE_BUILTIN_ENGINES=chatgpt,gemini` in Netlify alongside OPENAI_API_KEY /
// GOOGLE_AI_KEY. A user-entered key still overrides the built-in one.
export function builtinEngines() {
  let raw = '';
  try { raw = (import.meta.env && import.meta.env.VITE_BUILTIN_ENGINES) || ''; } catch { raw = ''; }
  return new Set(String(raw).toLowerCase().split(',').map(s => s.trim()).filter(Boolean));
}
export function hasBuiltinEngine(id) {
  return builtinEngines().has(String(id).toLowerCase());
}

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  // Never let a blank field overwrite a stored key. The settings modal saves
  // ALL fields at once (openaiKey / googleAiKey), sending ''
  // for any box that looks empty — e.g. it was opened before remote hydration
  // landed, or the value is masked. Without this filter one such save wipes
  // good keys out of localStorage, and the next AEO run drops to Claude-only
  // until a re-hydrate. saveRemoteSettings already guards the shared row this
  // way; this mirrors it locally so the two never disagree. The accepted
  // trade-off (same as remote): an intentional clear won't propagate.
  const clean = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (typeof v === 'string' ? v.trim() : v) clean[k] = v;
  }
  const merged = { ...loadSettings(), ...clean };
  localStorage.setItem(KEY, JSON.stringify(merged));
  // Notify any open view (report pre-run engine notice, engine status dots)
  // that reads isConfigured() inline so it re-evaluates immediately. Without
  // this, an operator who pastes an OpenAI/Gemini key and hits Save sees the
  // Reports banner stay stuck on "AEO will query 1 of 4 engines — Running:
  // Claude" until an unrelated re-render happens, and reasonably concludes the
  // key "didn't load". Remote hydration already fires this event; a local save
  // must too. Best-effort so non-browser callers (tests) don't throw.
  try { window.dispatchEvent(new Event(SETTINGS_EVENT)); } catch {}
  // Write-through to the shared Supabase row so the keys are available on
  // every device. Best-effort: localStorage already holds them locally.
  saveRemoteSettings(clean).catch(() => {});
  return merged;
}

// Pull the shared settings row into the local cache. Called once at app
// start. A non-empty remote value wins (that's how a device that never had
// keys entered locally picks them up); a blank remote value never wipes a
// good local key. Returns true if the local cache changed.
export async function hydrateSettingsFromRemote() {
  let remote;
  try { remote = await loadRemoteSettings(); } catch { remote = null; }
  if (!remote || typeof remote !== 'object') return false;
  const local = loadSettings();
  const merged = { ...local };
  let changed = false;
  for (const k of Object.keys(DEFAULTS)) {
    if (remote[k] && remote[k] !== local[k]) { merged[k] = remote[k]; changed = true; }
  }
  if (changed) {
    localStorage.setItem(KEY, JSON.stringify(merged));
    try { window.dispatchEvent(new Event(SETTINGS_EVENT)); } catch {}
  }
  return changed;
}

export function engineStatus() {
  const s = loadSettings();
  return {
    // A personal key OR the deployment's built-in (env-var) key makes an
    // engine available. Claude is always built in via the suite's Anthropic key.
    chatgpt: !!s.openaiKey || hasBuiltinEngine('chatgpt'),
    gemini:  !!s.googleAiKey || hasBuiltinEngine('gemini'),
    claude:  true
  };
}

// Rough cost model for a full AEO sweep across N clients.
// Assumption: each engine costs ~$0.005 per probe-query response, plus one
// Claude-Haiku sentiment call per mention detected (~$0.001).
export function estimateSweepCost(clientCount, avgQueriesPerClient = 6) {
  const { chatgpt, gemini, claude } = engineStatus();
  const activeEngines = [chatgpt, gemini, claude].filter(Boolean).length;
  const responses = clientCount * avgQueriesPerClient * activeEngines;
  const cost = responses * 0.005 + responses * 0.0005; // sentiment
  return { responses, activeEngines, cost };
}
