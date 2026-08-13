// Regression test for the lenient JSON extractor used by every Claude
// call that expects structured output. Pins the recovery strategies
// so the "Microsite JSON could not be parsed" report failure can't
// come back from a regression.
//
// We import via a fresh module URL so vitest cache doesn't interfere
// when running through run-all.mjs.

import { extractJSON } from '../src/lib/anthropic.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); pass++; }
  catch (e) { console.error('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error((msg || '') + ` expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}
function truthy(v, msg) { if (!v) throw new Error((msg || 'expected truthy') + ' got ' + v); }

t('happy path: clean JSON', () => {
  eq(extractJSON('{"a":1,"b":"x"}'), { a: 1, b: 'x' });
});

t('handles ```json fence', () => {
  eq(extractJSON('Here you go:\n```json\n{"a":1}\n```\nDone.'), { a: 1 });
});

t('handles bare ``` fence', () => {
  eq(extractJSON('```\n{"a":1}\n```'), { a: 1 });
});

t('strips prose preamble before {', () => {
  eq(extractJSON('Sure thing! {"a":1}'), { a: 1 });
});

t('strips prose postamble after }', () => {
  eq(extractJSON('{"a":1} hope that helps'), { a: 1 });
});

t('repairs trailing commas', () => {
  eq(extractJSON('{"a":1,"b":2,}'), { a: 1, b: 2 });
});

t('repairs trailing comma in array', () => {
  eq(extractJSON('{"items":[1,2,3,]}'), { items: [1, 2, 3] });
});

t('normalises smart quotes', () => {
  // Smart double quotes around the key/value.
  const raw = '{“a”:“x”}';
  const out = extractJSON(raw);
  eq(out, { a: 'x' });
});

t('recovers from truncated mid-field output (max_tokens hit)', () => {
  // Output cut off mid-field — the Microsite failure mode.
  const raw = '{"headline":"hello","items":[{"name":"a"},{"name":"b"},{"name":"c';
  const out = extractJSON(raw);
  truthy(out, 'should produce SOMETHING');
  truthy(Array.isArray(out.items), 'items should be an array');
  // The recovered object keeps the headline + the complete items.
  eq(out.headline, 'hello');
  // Last item was incomplete and got dropped during balance.
  truthy(out.items.length >= 2, 'at least 2 complete items');
});

t('returns null for total junk (no { at all)', () => {
  eq(extractJSON('I cannot help with that'), null);
});

t('returns null for null/undefined/empty input', () => {
  eq(extractJSON(null), null);
  eq(extractJSON(undefined), null);
  eq(extractJSON(''), null);
});

t('handles nested objects + arrays', () => {
  const raw = '{"a":{"b":[1,{"c":"d"}]}}';
  eq(extractJSON(raw), { a: { b: [1, { c: 'd' }] } });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
