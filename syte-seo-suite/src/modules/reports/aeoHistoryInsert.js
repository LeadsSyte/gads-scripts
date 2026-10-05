// Insert an AEO snapshot into syte_suite_aeo_history, tolerating columns the
// database doesn't have yet. A snapshot carries more fields than an older
// schema may define (see supabase-schema-aeo-history-columns.sql); rather
// than lose the whole month from AEO History, drop each column PostgREST
// reports as missing and retry. Shared by the browser and the server.

const MISSING_COLUMN = /Could not find the '([^']+)' column/;

// insert(row) -> Promise<{ data, error }>. Returns { data, dropped }.
export async function insertDroppingUnknownColumns(insert, row) {
  let current = { ...row };
  const dropped = [];
  for (;;) {
    const { data, error } = await insert(current);
    if (!error) return { data, dropped };
    const col = String(error.message || '').match(MISSING_COLUMN)?.[1];
    if (!col || !(col in current) || col === 'client_id' || col === 'month') throw error;
    dropped.push(col);
    const { [col]: _omit, ...rest } = current;
    current = rest;
  }
}
