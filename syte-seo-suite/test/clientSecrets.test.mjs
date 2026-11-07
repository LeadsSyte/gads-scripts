// CMS credentials live server-side (security brief §1.2): the client row holds
// a marker, the real value comes from syte_suite_client_secrets.

import { withClientSecrets, withClientSecretsMany, SECRET_MARKER } from '../netlify/functions/lib/clientSecrets.js';
import { resolveWordPress, resolveShopify } from '../netlify/functions/lib/cmsCreds.js';
import { hasWordPress } from '../netlify/functions/lib/wpClient.js';

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log('PASS', name); pass++; } catch (e) { console.log('FAIL', name, '->', e.message); fail++; } }
const eq = (a, b, l) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };

// Minimal supabase stand-in: from(t).select(..).in(col, ids) → { data, error }.
const fakeDb = (secrets, { missing = false } = {}) => {
  let calls = 0;
  return {
    calls: () => calls,
    from: table => ({ select: () => ({ in: async (_col, ids) => {
      calls++;
      if (missing) return { data: null, error: { message: 'relation "syte_suite_client_secrets" does not exist' } };
      if (table !== 'syte_suite_client_secrets') throw new Error('wrong table ' + table);
      return { data: secrets.filter(s => ids.includes(s.client_id)), error: null };
    } }) })
  };
};

const WP = { id: 'c1', name: 'Krost', cms_type: 'WordPress', wp_url: 'https://krost.example', wp_username: 'syte', wp_app_password: SECRET_MARKER };
const SHOP = { id: 'c2', name: 'BAM', cms_type: 'Shopify', shopify_store: 'bam.myshopify.com', shopify_token: SECRET_MARKER };
const SECRETS = [{ client_id: 'c1', wp_app_password: 'abcd efgh', shopify_token: null }, { client_id: 'c2', wp_app_password: null, shopify_token: 'shpat_x' }];

await t('the marker is replaced by the stored value', async () => {
  const db = fakeDb(SECRETS);
  eq((await withClientSecrets(db, WP)).wp_app_password, 'abcd efgh');
  eq((await withClientSecrets(db, SHOP)).shopify_token, 'shpat_x');
  const many = await withClientSecretsMany(db, [WP, SHOP, null]);
  eq([many[0].wp_app_password, many[1].shopify_token, many[2]], ['abcd efgh', 'shpat_x', null]);
  eq(WP.wp_app_password, SECRET_MARKER, 'the original row is not mutated');
});

await t('a marker with no stored value becomes empty (not connected), never the marker itself', async () => {
  const c = await withClientSecrets(fakeDb([]), WP);
  eq(c.wp_app_password, '');
  eq(hasWordPress(c), false, 'treated as not connected');
});

await t('before the SQL is run: old rows with real values pass through untouched, without a query', async () => {
  const db = fakeDb([], { missing: true });
  const old = { ...WP, wp_app_password: 'real-old-value' };
  eq((await withClientSecrets(db, old)).wp_app_password, 'real-old-value');
  eq(db.calls(), 0, 'no lookup when nothing is marked');
  eq((await withClientSecrets(db, WP)).wp_app_password, '', 'table missing + marker → not connected, no crash');
});

await t('the CMS proxies resolve the real credentials by client id', async () => {
  const db = fakeDb(SECRETS);
  const lookup = async () => ['41.76.1.10'];
  const deps = { loadClient: async id => withClientSecrets(db, { c1: WP, c2: SHOP }[id]), lookup };
  eq((await resolveWordPress({ clientId: 'c1' }, { kind: 'api_key' }, deps)).appPassword, 'abcd efgh');
  eq((await resolveShopify({ clientId: 'c2' }, { kind: 'api_key' }, deps)).token, 'shpat_x');
});

console.log(`\nclientSecrets: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
