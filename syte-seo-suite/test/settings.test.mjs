// settings.js contract tests. The settings module is the source of truth
// for which AI engines + image providers the suite has API keys for —
// engineStatus drives the AEO engine list and the GenerateImageButton
// dropdown options. A regression here silently disables features.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/lib/settings.js'), 'utf8');

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};

const tmp = path.join(os.tmpdir(), 'settings-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, SRC);
const mod = await import(tmp);
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
async function t(name, fn) {
  store.clear();
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

await t('loadSettings: returns DEFAULTS shape when nothing stored', () => {
  const s = mod.loadSettings();
  eq(s.openaiKey, '');
  eq(s.perplexityKey, '');
  eq(s.googleAiKey, '');
});

await t('loadSettings: tolerates corrupt JSON without throwing', () => {
  store.set('syte-suite-settings', 'not-json{');
  const s = mod.loadSettings();
  eq(s.openaiKey, '');
});

await t('saveSettings: merges patch into existing settings', () => {
  mod.saveSettings({ openaiKey: 'sk-abc' });
  mod.saveSettings({ googleAiKey: 'g-xyz' });
  const s = mod.loadSettings();
  eq(s.openaiKey, 'sk-abc', 'first patch preserved');
  eq(s.googleAiKey, 'g-xyz', 'second patch applied');
});

await t('saveSettings: returns the merged result', () => {
  const out = mod.saveSettings({ perplexityKey: 'pp' });
  eq(out.perplexityKey, 'pp');
});

await t('engineStatus: claude is always true even without any keys', () => {
  const s = mod.engineStatus();
  eq(s.claude, true, 'claude is the suite key — always true');
  eq(s.chatgpt, false);
  eq(s.gemini, false);
  eq(s.perplexity, false);
});

await t('engineStatus: chatgpt true when openaiKey set', () => {
  mod.saveSettings({ openaiKey: 'k' });
  eq(mod.engineStatus().chatgpt, true);
});

await t('engineStatus: gemini true when googleAiKey set', () => {
  mod.saveSettings({ googleAiKey: 'k' });
  eq(mod.engineStatus().gemini, true);
});

await t('engineStatus: perplexity true when perplexityKey set', () => {
  mod.saveSettings({ perplexityKey: 'k' });
  eq(mod.engineStatus().perplexity, true);
});

await t('estimateSweepCost: 1 client × 6 queries × claude only = 6 responses', () => {
  const r = mod.estimateSweepCost(1);
  eq(r.activeEngines, 1);
  eq(r.responses, 6);
});

await t('estimateSweepCost: 5 clients × 8 queries × all 4 engines = 160 responses', () => {
  mod.saveSettings({ openaiKey: 'k', googleAiKey: 'k', perplexityKey: 'k' });
  const r = mod.estimateSweepCost(5, 8);
  eq(r.activeEngines, 4);
  eq(r.responses, 160);
});

await t('estimateSweepCost: cost is positive when activeEngines > 0', () => {
  const r = mod.estimateSweepCost(2);
  if (!(r.cost > 0)) throw new Error('cost should be > 0');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
