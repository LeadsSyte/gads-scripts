// Phantom technical records (Oct 2026): "Mark Done" + "Mark as Implemented"
// logged two records per task; the "Team member / pending" copy is dropped
// when a named twin for the same client + title exists within 2 minutes.

import { dropPhantomImpls, isPhantomCandidate } from '../src/lib/phantomImpls.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };

const row = (id, by, status, at, over = {}) => ({ id, client_id: 'c1', module: 'technical', title: 'Fix meta title on /a', implemented_by: by, verification_status: status, created_at: '2026-10-22T08:' + at + 'Z', ...over });

t('the "Team member / pending" copy next to a named record is dropped; the named one stays', () => {
  eq(dropPhantomImpls([row('p', 'Team member', 'pending', '23:10'), row('n', 'Nebiot', 'verified', '23:40')]).map(r => r.id), ['n']);
});

t('kept: a lone "Team member" record, one outside 2 minutes, another title/client, other modules, non-pending', () => {
  eq(dropPhantomImpls([row('p', 'Team member', 'pending', '23:10')]).map(r => r.id), ['p'], 'lone');
  eq(dropPhantomImpls([row('p', 'Team member', 'pending', '20:00'), row('n', 'Nebiot', 'verified', '23:40')]).map(r => r.id), ['p', 'n'], '3+ minutes apart');
  eq(dropPhantomImpls([row('p', 'Team member', 'pending', '23:10'), row('n', 'Nebiot', 'verified', '23:40', { title: 'Other' })]).length, 2, 'other title');
  eq(dropPhantomImpls([row('p', 'Team member', 'pending', '23:10'), row('n', 'Nebiot', 'verified', '23:40', { client_id: 'c2' })]).length, 2, 'other client');
  eq(isPhantomCandidate(row('a', 'Team member', 'pending', '23:10', { module: 'aeo' })), false, 'AEO never');
  eq(isPhantomCandidate(row('v', 'Team member', 'verified', '23:10')), false, 'verified never');
  eq(dropPhantomImpls([row('p', 'Team member', 'pending', '23:10'), row('q', 'Team member', 'verified', '23:40')]).length, 2, 'twin must be a named person');
});

t('the twin can come from a wider pool (the Monday email looks it up separately)', () => {
  eq(dropPhantomImpls([row('p', 'Team member', 'pending', '23:10')], [row('n', 'Chris B', 'failed', '24:00')]).length, 0);
});

console.log(`\nphantomImpls: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
