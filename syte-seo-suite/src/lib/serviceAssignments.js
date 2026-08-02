// Per-service people assignment.
//
// Historically each client had a single `account_manager` — one owner for the
// whole account. In practice several people often work the same client (one on
// Technical, another on Content, etc.), so each service now carries its own
// assignee column. `account_manager` is kept as the *default owner*: a fallback
// used for any service that has no specific person set.
//
// This module is the single source of truth for the service → column mapping
// and the resolution/aggregation helpers, so ClientsMaster, Approvals,
// AccountManagers and ClientModal all agree on the rules.

export const SERVICE_META = [
  { service: 'technical', flag: 'does_technical', mgr: 'manager_technical', label: 'Tech',    color: 'var(--mod-technical)' },
  { service: 'content',   flag: 'does_content',   mgr: 'manager_content',   label: 'Content', color: 'var(--mod-content)' },
  { service: 'aeo',       flag: 'does_aeo',        mgr: 'manager_aeo',       label: 'AEO',     color: 'var(--mod-aeo)' },
  { service: 'reporting', flag: 'does_reporting',  mgr: 'manager_reporting',  label: 'Reports', color: 'var(--mod-reports)' }
];

// A client is subscribed to a service unless its flag is explicitly false
// (undefined/true both mean "on", matching the toggles everywhere else).
export function serviceEnabled(client, flag) {
  return client?.[flag] !== false;
}

// The person responsible for a specific service on a client, falling back to
// the client's default owner (account_manager) when no service-specific person
// is set. Returns '' when nobody is assigned.
export function serviceAssignee(client, mgrKey) {
  const specific = (client?.[mgrKey] || '').trim();
  if (specific) return specific;
  return (client?.account_manager || '').trim();
}

// Every distinct person involved with a client across its *enabled* services,
// plus the default owner. Used for filtering and "who touches this client".
export function clientAssignees(client) {
  const set = new Set();
  const owner = (client?.account_manager || '').trim();
  if (owner) set.add(owner);
  for (const s of SERVICE_META) {
    if (!serviceEnabled(client, s.flag)) continue;
    const p = (client?.[s.mgr] || '').trim();
    if (p) set.add(p);
  }
  return [...set];
}

// True when `person` is involved with the client (owner or any enabled service).
export function clientHasAssignee(client, person) {
  return clientAssignees(client).includes(person);
}

// Distinct, sorted list of every assignee name across a set of clients —
// for filter dropdowns and autocomplete datalists. Includes both default
// owners and per-service assignees, whether or not the service is enabled,
// so a name typed once stays available as a suggestion.
export function allAssignees(clients) {
  const set = new Set();
  for (const c of clients || []) {
    const owner = (c.account_manager || '').trim();
    if (owner) set.add(owner);
    for (const s of SERVICE_META) {
      const p = (c[s.mgr] || '').trim();
      if (p) set.add(p);
    }
  }
  return [...set].sort();
}
