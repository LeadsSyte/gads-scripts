// House style: pushed articles take the markup the client's team uses in
// their own posts. Real case: Allergy Facts headings are black because the
// team sets has-black-color per heading; our plain <h2> rendered the theme's
// default blue.

import { learnHouseStyle, applyHouseStyle } from '../src/modules/cms/houseStyle.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

const ALLERGY_POSTS = [1, 2, 3].map(n => `
  <p class="wp-block-paragraph">Intro ${n}</p>
  <h2 class="wp-block-heading has-black-color has-text-color has-link-color wp-elements-${n}">Heading</h2>
  <p class="wp-block-paragraph">Body</p>
  <h3 class="wp-block-heading">Sub</h3>
  <figure class="wp-block-table"><table class="has-fixed-layout"><tr><td>x</td></tr></table></figure>`);

await t('learns the team\'s classes, dropping per-block ones', () => {
  const s = learnHouseStyle(ALLERGY_POSTS);
  assertEq(s.h2, 'wp-block-heading has-black-color has-text-color', 'wp-elements-N and has-link-color dropped');
  assertEq(s.p, 'wp-block-paragraph');
  assertEq(s.h3, 'wp-block-heading');
  assertEq(s.table, 'has-fixed-layout');
});

await t('applies them to our plain tags only', () => {
  const s = learnHouseStyle(ALLERGY_POSTS);
  const out = applyHouseStyle('<h2>What Is Asthma?</h2><p>Text</p><p class="lead">Keep</p><pre>code</pre><h2 id="x">Y</h2>', s);
  assertEq(out, '<h2 class="wp-block-heading has-black-color has-text-color">What Is Asthma?</h2>'
    + '<p class="wp-block-paragraph">Text</p><p class="lead">Keep</p><pre>code</pre>'
    + '<h2 class="wp-block-heading has-black-color has-text-color" id="x">Y</h2>');
});

await t('no consistent style means nothing is changed', () => {
  assertEq(JSON.stringify(learnHouseStyle(['<h2>A</h2><p>b</p>', '<h2>C</h2>'])), '{}', 'classless posts');
  const mixed = learnHouseStyle(['<h2 class="a">x</h2>', '<h2 class="b">x</h2>', '<h2>c</h2>', '<h2>d</h2>']);
  assertEq(mixed.h2, undefined, 'no majority');
  assertEq(applyHouseStyle('<h2>A</h2>', {}), '<h2>A</h2>');
  assertEq(learnHouseStyle(['<h2 class="one-off">x</h2>']).h2, undefined, 'a single example is not a house style');
});

await t('class values are sanitised before being written', () => {
  assertEq(applyHouseStyle('<p>x</p>', { p: 'ok"><script>' }), '<p class="okscript">x</p>');
});

console.log(`\nhouseStyle: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
