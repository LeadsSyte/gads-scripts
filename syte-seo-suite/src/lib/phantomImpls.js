// Phantom implementation records (found Oct 2026).
//
// A technical task's "Mark Done" logged a record as "Team member" / pending,
// and its "Mark as Implemented" then logged a SECOND record for the same task
// under the person's name (Nebiot, Chris…) that went on to be verified. Every
// fix therefore appeared twice, the extra copy pending forever, so clients
// looked as if work was outstanding. MarkImplementedButton now reuses the
// task's record; the 234 old copies can't be deleted from the browser (no
// delete permission on this table), so readers drop them with this rule:
//
//   a technical record by "Team member", still pending, with a twin for the
//   same client and title, logged by someone else within 2 minutes.
//
// Pure — used by the suite (listImplementations) and the Monday email.

const WINDOW_MS = 2 * 60 * 1000;

export const isPhantomCandidate = r =>
  r?.module === 'technical' && r.implemented_by === 'Team member' && r.verification_status === 'pending';

// rows: the records to show. pool: records to look for twins in (defaults to rows).
export function dropPhantomImpls(rows, pool = rows) {
  const list = rows || [];
  if (!list.some(isPhantomCandidate)) return list;
  const twins = new Map();
  for (const o of pool || []) {
    if (!o || o.implemented_by === 'Team member') continue;
    const k = o.client_id + '\u0000' + o.title;
    if (!twins.has(k)) twins.set(k, []);
    twins.get(k).push(Date.parse(o.created_at) || 0);
  }
  return list.filter(r => {
    if (!isPhantomCandidate(r)) return true;
    const at = Date.parse(r.created_at) || 0;
    return !(twins.get(r.client_id + '\u0000' + r.title) || []).some(t => Math.abs(t - at) < WINDOW_MS);
  });
}
