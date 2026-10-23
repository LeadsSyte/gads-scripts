// Oct 2026: verification sent the AI the raw first 40 KB of a page. Modern
// themes fill that with inline CSS and scripts in the <head>, so the checker
// replied "the page HTML is the header/metadata section only" and the team
// verified by eye. pageForCheck keeps what a check needs.

import { pageForCheck } from '../src/lib/verification.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const ok = (v, label) => { if (!v) throw new Error(label); };

const HEAD = '<head><title>Krost Racking</title><meta name="description" content="Racking guide"><meta name="robots" content="index, follow">'
  + '<link rel="canonical" href="https://krost.example/racking/"><meta name="viewport" content="width=device-width">'
  + '<style>' + '.x{color:red}'.repeat(5000) + '</style><script>' + 'var a=1;'.repeat(3000) + '</script>'
  + '<script type="application/ld+json">{"@type":"FAQPage"}</script></head>';
const BODY = '<body><header class="site-header">menu</header><h1>Warehouse Racking</h1><!-- a comment -->'
  + '<img src="a.jpg" alt="Pallet racking"><svg><path d="M0 0"/></svg><p>Body text here.</p><script>track()</script></body>';

t('a page with a heavy <head>: the old cut sent no body, the new one does', () => {
  ok(!(HEAD + BODY).slice(0, 40000).includes('Body text'), 'the old way really did miss the body');
  const out = pageForCheck(HEAD + BODY);
  ok(out.includes('Body text here.') && out.includes('<h1>Warehouse Racking</h1>'), 'page content');
  ok(out.includes('alt="Pallet racking"'), 'image alt text (for alt-text fixes)');
});

t('keeps what fixes are checked against: title, description, robots, canonical, JSON-LD', () => {
  const out = pageForCheck(HEAD + BODY);
  ok(out.includes('<title>Krost Racking</title>'), 'title');
  ok(out.includes('content="Racking guide"'), 'description');
  ok(out.includes('index, follow'), 'robots');
  ok(out.includes('rel="canonical"'), 'canonical');
  ok(out.includes('"@type":"FAQPage"'), 'schema');
  ok(!out.includes('viewport'), 'other meta tags dropped');
});

t('drops what isn\'t content: CSS, scripts, SVG paths, comments; <header> is not mistaken for <head>', () => {
  const out = pageForCheck(HEAD + BODY);
  ok(!/color:red|var a=1|track\(\)|M0 0|a comment/.test(out), 'noise removed');
  ok(out.includes('site-header'), '<header> kept as body content');
});

t('content from the WordPress API (no <head>/<body>) passes through; long pages are capped', () => {
  ok(pageForCheck('<p>Hello <strong>world</strong></p>') === '<p>Hello <strong>world</strong></p>', 'unchanged');
  ok(pageForCheck('<p>' + 'x'.repeat(100000) + '</p>').length === 40000, 'capped at 40,000');
});

console.log(`\npageForCheck: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
