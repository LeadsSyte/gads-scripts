// GSC → buyer-prompt reshaping + engagement (Month-N) tenure logic.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kb = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/keywordBuckets.js')).href);
const rp = await import(pathToFileURL(path.join(__dirname, '../src/modules/reports/reportPrompts.js')).href);

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
function eq(a, b, label) { if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function ok(v, label) { if (!v) throw new Error((label || 'assertion') + ' falsy'); }

t('gscBuyerPrompts: commercial terms pass through, add geo if missing', () => {
  const out = kb.gscBuyerPrompts(['ai consultants ireland', 'business central partner'], { geo: 'Ireland' });
  ok(out.includes('ai consultants ireland'), 'already has geo, unchanged');
  ok(out.includes('business central partner in ireland'), 'geo appended to commercial term');
});

t('gscBuyerPrompts: bare category terms reshape into buyer prompts', () => {
  const out = kb.gscBuyerPrompts(['business central', 'azure document intelligence'], { geo: 'Ireland' });
  ok(out.includes('best business central company in ireland'), 'category → buyer prompt');
  ok(out.includes('best azure document intelligence company in ireland'), 'feature → buyer prompt');
});

t('gscBuyerPrompts: dedupes and respects limit', () => {
  const out = kb.gscBuyerPrompts(['business central', 'business central', 'power bi consultant'], { geo: 'Ireland', limit: 2 });
  eq(out.length, 2, 'capped');
  eq(new Set(out).size, out.length, 'deduped');
});

t('groundedProbeSet: covers category + comparison + qualified + conversational', () => {
  const set = kb.groundedProbeSet(['business central', 'ai consultancy dublin'], { geo: 'Ireland', competitors: ['Codec', 'Storm Technology'] });
  const types = new Set(set.map(p => p.type));
  ok(types.has('category'), 'category');
  ok(types.has('comparison'), 'comparison');
  ok(types.has('qualified'), 'qualified');
  ok(types.has('conversational'), 'conversational');
  ok(set.some(p => /alternatives to codec/i.test(p.query)), 'competitor comparison probe');
  ok(set.some(p => /mid-market/i.test(p.query)), 'qualified mid-market probe');
  ok(set.every(p => p.tier === 1 && p.source === 'gsc' && p.active === true), 'all tier-1 gsc active');
});

t('engagementNote: May start, June report → month 2', () => {
  const e = rp.engagementNote('2026-05-01', 'June 2026');
  eq(e.months, 2, 'two months in');
});

t('engagementNote: same-month start → month 1', () => {
  eq(rp.engagementNote('2026-06-15', 'June 2026').months, 1);
});

t('engagementNote: no start date → null', () => {
  eq(rp.engagementNote(null, 'June 2026'), null);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
