// Client CMS credentials live in a server-only table (security brief §1.2,
// Deploy B; supabase-schema-client-secrets.sql).
//
// A trigger on syte_suite_clients moves any WordPress app password or Shopify
// token written to a client row into syte_suite_client_secrets (RLS on, no
// policy: the public browser key cannot read it) and leaves SECRET_MARKER in
// the public column. So the browser still sees "a password is set" (every
// existing "is this client connected?" check keeps working) but never the
// value, and every existing save path — the Connections form, the Shopify
// connect flow — keeps working unchanged.
//
// Server code that needs the real values calls withClientSecrets() after
// loading a client. Before the SQL has been run the table does not exist and
// the client is returned unchanged, so this code is safe to deploy first.

export const SECRET_MARKER = 'stored-server-side';
const FIELDS = ['wp_app_password', 'shopify_token'];

// One client row (or null) → the same row with real credentials filled in.
export async function withClientSecrets(supabase, client) {
  if (!client?.id) return client;
  const [merged] = await withClientSecretsMany(supabase, [client]);
  return merged;
}

export async function withClientSecretsMany(supabase, clients) {
  const list = (clients || []).filter(Boolean);
  const needs = list.filter(c => FIELDS.some(f => c[f] === SECRET_MARKER));
  let byId = new Map();
  if (needs.length) {
    try {
      const { data, error } = await supabase.from('syte_suite_client_secrets')
        .select('client_id, wp_app_password, shopify_token').in('client_id', needs.map(c => c.id));
      if (!error) byId = new Map((data || []).map(r => [r.client_id, r]));
    } catch { /* table not created yet: fall through */ }
  }
  return (clients || []).map(c => {
    if (!c) return c;
    const s = byId.get(c.id) || {};
    const out = { ...c };
    for (const f of FIELDS) {
      // Never hand the marker on as if it were a password: no stored value
      // means "not connected", which every caller already handles.
      if (out[f] === SECRET_MARKER) out[f] = s[f] || '';
    }
    return out;
  });
}
