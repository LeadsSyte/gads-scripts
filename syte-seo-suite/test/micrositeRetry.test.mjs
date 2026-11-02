// Nov 2026: iSurgeon's AEO report failed at the last step ("Microsite JSON
// could not be parsed") after a 50-minute census. The microsite call now
// retries once, strictly, and the error says what the model answered.

import { micrositeJson } from '../src/modules/reports/reportGenerate.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const has = (s, re) => { if (!re.test(String(s))) throw new Error('missing ' + re + ' in ' + String(s).slice(0, 200)); };

const quiet = async fn => { const orig = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = orig; } };

await t('good JSON first time: one call', async () => {
  const calls = [];
  const complete = async args => { calls.push(args); return '{"headline":"Named in 4 of 20"}'; };
  eq(await micrositeJson({ complete, system: 'S', payload: 'P', label: 'AEO' }), { headline: 'Named in 4 of 20' });
  eq(calls.length, 1);
});

await t('prose first time: a strict retry at temperature 0 gets the JSON', async () => {
  const calls = [];
  const complete = async args => { calls.push(args); return calls.length === 1 ? 'I cannot produce a report for a medical practice without more context.' : '{"headline":"Starting point locked in"}'; };
  const micro = await quiet(() => micrositeJson({ complete, system: 'S', payload: 'P', label: 'AEO' }));
  eq(micro.headline, 'Starting point locked in');
  eq(calls.length, 2);
  eq(calls[1].temperature, 0); eq(calls[1].max_tokens > calls[0].max_tokens, true, 'more room on the retry');
  has(calls[1].messages[2].content, /ONLY the JSON object/);
  has(calls[1].messages[1].content, /cannot produce a report/, 'the bad answer is shown back');
});

await t('still no JSON: the error quotes what the model said, so the run state explains itself', async () => {
  const complete = async () => 'Sorry, here is a summary instead: the client was named in some prompts.';
  let err = '';
  try { await quiet(() => micrositeJson({ complete, system: 'S', payload: 'P', label: 'SEO' })); } catch (e) { err = e.message; }
  has(err, /even on a retry/); has(err, /Sorry, here is a summary instead/);
});

await t('truncated JSON is still salvaged on the first try (no retry needed)', async () => {
  const complete = async () => '{"headline":"Named in 4 of 20","subheadline":"Coverage 20%","highlights":[{"label":"Named In","value":"4 of 20"},{"label":"Coverage Ra';
  const micro = await micrositeJson({ complete, system: 'S', payload: 'P', label: 'AEO' });
  eq(micro.headline, 'Named in 4 of 20');
});

console.log(`\nmicrositeRetry: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
