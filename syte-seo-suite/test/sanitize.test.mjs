// AC6: generated copy contains zero em or en dashes after sanitizing.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const s = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/sanitize.js')).href);
const ms = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/microsite.js')).href);

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }
function eq(a, b, label) { if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

const EM = '—', EN = '–';

t('stripDashes: replaces em + en dashes, leaves ascii hyphen', () => {
  const out = s.stripDashes(`Coverage jumped ${EM} up 40% ${EN} strong month. Top-3 wins.`);
  ok(!s.hasBannedDash(out), 'no banned dashes remain');
  ok(out.includes('Top-3'), 'ascii hyphen preserved');
});

t('stripDashes: a dash alone in a table cell becomes a hyphen, not a comma', () => {
  const out = s.stripDashes(`<td>${EM}</td><td>#16</td><td> ${EM} </td>`);
  ok(out.includes('<td>-</td>'), 'cell placeholder → hyphen: ' + out);
  ok(!out.includes(','), 'no stray commas in cells: ' + out);
  ok(!s.hasBannedDash(out), 'no banned dashes remain');
});

t('sanitizeEmail: subject + body cleaned', () => {
  const e = s.sanitizeEmail({ subject: `Big win ${EM} coverage up`, body: `Two things ${EN} more prompts, more citations.` });
  ok(!s.hasBannedDash(e.subject) && !s.hasBannedDash(e.body), 'clean');
});

t('sanitizeDeep: nested microsite JSON strings cleaned', () => {
  const obj = { headline: `Named in 8 of 20 ${EM} strong`, highlights: [{ label: `Coverage ${EN} MoM`, value: '40%' }], n: 5 };
  const out = s.sanitizeDeep(obj);
  ok(!s.hasBannedDash(out.headline), 'headline clean');
  ok(!s.hasBannedDash(out.highlights[0].label), 'nested clean');
  eq(out.n, 5, 'non-strings untouched');
});

t('AC6: buildMicrositeHtml output contains zero em/en dashes', () => {
  const html = ms.buildMicrositeHtml({
    micro: {
      headline: `Named in 8 of 20 buyer prompts ${EM} coverage climbing`,
      subheadline: `Share of voice 34% ${EN} ahead of rivals`,
      narrative: 'Solid month.',
      highlights: [{ label: 'Coverage', value: '40%', delta: '+8pp', positive: true }]
    },
    client: { name: 'Acme' },
    monthLabel: 'July 2026',
    aeoProbe: {
      prompt_coverage: 8, scorable_probes: 20, coverage_rate: 0.4, composite_index: 52,
      share_of_voice: 34, visibility_score: 12, mentions: 9, citations: 4,
      engines_used: ['chatgpt'], iterations: 3, total_runs: 60, queries_count: 20,
      per_query: [{ query: 'best widgets', engine: 'chatgpt', visibility: 40, avg_position: 2, top3_rate: 20, sentiment: 'positive', hits: 1 }],
      citation_gaps: [{ domain: 'directory.test', hitCount: 3, competitors: ['BetaCorp'], exampleQueries: ['best widgets'], suggestedAction: 'Earn a presence on directory.test.' }]
    }
  });
  ok(!s.hasBannedDash(html), 'microsite HTML has zero em/en dashes');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
