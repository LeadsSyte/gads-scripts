// Suite settings: the source-of-truth contract the AEO run reads. The
// "only Claude showed up" bug was the settings modal turning an engine dot
// green from the INPUT box before Save persisted it — so runs (which read
// loadSettings) still saw no key. These lock the persisted contract.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.localStorage = { store: {}, getItem(k){return this.store[k] ?? null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} };

// Minimal window so saveSettings can broadcast SETTINGS_EVENT. Open views
// (the report's pre-run engine notice) listen for it to re-check isConfigured()
// the instant a key is saved — otherwise the "1 of 4 engines" banner stays
// stale after the operator pastes a key and the run looks broken.
const dispatched = [];
globalThis.window = { dispatchEvent(e){ dispatched.push(e.type); return true; } };
globalThis.Event = class { constructor(type){ this.type = type; } };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const s = await import(pathToFileURL(path.join(__dirname, '../src/lib/settings.js')).href);

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, l) { if (!v) throw new Error((l || 'assertion') + ' falsy'); }
function eq(a, b, l) { if (a !== b) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

t('a key is only "configured" after it is saved to storage', () => {
  globalThis.localStorage.store = {};
  // Nothing saved yet — engineStatus (what runs read) must be false.
  eq(s.engineStatus().chatgpt, false, 'chatgpt false before save');
  eq(s.engineStatus().gemini, false, 'gemini false before save');
  // Persist the keys.
  s.saveSettings({ openaiKey: 'sk-test', googleAiKey: 'AIzatest' });
  eq(s.engineStatus().chatgpt, true, 'chatgpt true after save');
  eq(s.engineStatus().gemini, true, 'gemini true after save');
  eq(s.loadSettings().openaiKey, 'sk-test', 'openai persisted');
});

t('claude is always available (built-in key)', () => {
  globalThis.localStorage.store = {};
  eq(s.engineStatus().claude, true, 'claude always true');
});

t('saveSettings merges, does not clobber other keys', () => {
  globalThis.localStorage.store = {};
  s.saveSettings({ openaiKey: 'sk-a' });
  s.saveSettings({ googleAiKey: 'AIzab' });
  eq(s.loadSettings().openaiKey, 'sk-a', 'openai preserved across saves');
  eq(s.loadSettings().googleAiKey, 'AIzab', 'gemini added');
});

t('saveSettings broadcasts SETTINGS_EVENT so open views refresh at once', () => {
  globalThis.localStorage.store = {};
  dispatched.length = 0;
  s.saveSettings({ openaiKey: 'sk-live' });
  ok(dispatched.includes(s.SETTINGS_EVENT), 'SETTINGS_EVENT dispatched on save');
});

t('a blank field never wipes a stored key (modal saves all fields at once)', () => {
  globalThis.localStorage.store = {};
  // Both keys are configured and persisted.
  s.saveSettings({ openaiKey: 'sk-a', googleAiKey: 'AIzab' });
  // The modal re-saves the WHOLE form — and if it was opened before hydration
  // landed, a box looks empty and arrives as ''. That must NOT blank the
  // stored key, or the next AEO run drops to Claude-only.
  s.saveSettings({ openaiKey: '', googleAiKey: 'AIzab' });
  eq(s.loadSettings().openaiKey, 'sk-a', 'openai survived a blank re-save');
  eq(s.loadSettings().googleAiKey, 'AIzab', 'gemini survived a blank re-save');
  eq(s.engineStatus().chatgpt, true, 'chatgpt still configured');
  eq(s.engineStatus().gemini, true, 'gemini still configured');
});

t('a corrupted settings blob loads as empty defaults without throwing', () => {
  globalThis.localStorage.store = { 'syte-suite-settings': '{not valid json' };
  const loaded = s.loadSettings();               // must not throw
  eq(loaded.openaiKey, '', 'corrupt blob → empty openaiKey default');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
