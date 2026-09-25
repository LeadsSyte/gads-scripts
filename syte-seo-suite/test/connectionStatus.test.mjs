// CMS → Connections: which clients the suite can push to. Chris asked for one
// overview of connected vs not; this is the logic behind it.

import { connectionState, buildConnectionRows, summarizeConnections } from '../src/modules/cms/connectionStatus.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

const WP_OK = { id: 'a', name: 'Allergy Facts', cms_type: 'WordPress', wp_url: 'https://a.co', wp_username: 'u', wp_app_password: 'p' };
const WP_HALF = { id: 'b', name: 'Bility', cms_type: 'WordPress', wp_url: 'https://b.co' };
const SHOP_OK = { id: 'c', name: 'BAM DIY', cms_type: 'Shopify', shopify_store: 'bam.myshopify.com', shopify_token: 't' };
const SHOP_NO_APP = { id: 'd', name: 'Picot', cms_type: 'Shopify', shopify_store: 'p.myshopify.com' };
const NONE = { id: 'e', name: 'Freddy Hirsch' };
const SKIPPED = { ...WP_HALF, id: 'f', name: 'VPN Client', publishing_profile: { cms_skip_reason: 'needs a VPN' } };
const CUSTOM = { id: 'g', name: 'Custom Co', cms_type: 'Custom Site' };

await t('states per CMS type', () => {
  assertEq(connectionState(WP_OK).state, 'connected');
  assertEq(connectionState(WP_HALF).state, 'incomplete');
  assertEq(connectionState({ ...WP_HALF, wp_url: '' }).state, 'not_connected');
  assertEq(connectionState(SHOP_OK).state, 'connected');
  assertEq(connectionState(SHOP_NO_APP).state, 'incomplete');
  assertEq(connectionState(NONE).state, 'not_connected');
  assertEq(connectionState(CUSTOM).state, 'custom', 'ZIP export is not a site connection');
});

await t('a skip reason wins over whatever is saved, and is shown', () => {
  const s = connectionState(SKIPPED);
  assertEq(s.state, 'skipped'); assertEq(s.detail, 'needs a VPN');
  assertEq(connectionState({ ...WP_OK, publishing_profile: JSON.stringify({ cms_skip_reason: 'white label' }) }).state, 'skipped', 'string JSONB');
});

await t('push counts, last push and failures per client', () => {
  const queue = [
    { client_id: 'a', status: 'pushed', created_at: '2026-09-01T00:00:00Z' },
    { client_id: 'a', status: 'published', created_at: '2026-09-02T00:00:00Z', pushed_at: '2026-09-03T00:00:00Z' },
    { client_id: 'a', status: 'failed', created_at: '2026-08-01T00:00:00Z' },
    { client_id: 'zz', status: 'pushed', created_at: '2026-09-09T00:00:00Z' } // deleted client — ignored
  ];
  const rows = buildConnectionRows([WP_OK, NONE], queue);
  const a = rows.find(r => r.id === 'a');
  assertEq(a.pushes, 3); assertEq(a.published, 1); assertEq(a.failed, 1);
  assertEq(a.last, '2026-09-03T00:00:00Z', 'pushed_at preferred over created_at');
  assertEq(rows.find(r => r.id === 'e').pushes, 0);
  assertEq(rows.length, 2);
});

await t('what needs attention sorts first, skipped last', () => {
  const rows = buildConnectionRows([SKIPPED, WP_OK, NONE, WP_HALF, CUSTOM], []);
  assertEq(rows.map(r => r.state).join(','), 'incomplete,not_connected,connected,custom,skipped');
});

await t('summary counts', () => {
  const s = summarizeConnections(buildConnectionRows([WP_OK, SHOP_OK, NONE, SKIPPED], []));
  assertEq(s.connected, 2); assertEq(s.not_connected, 1); assertEq(s.skipped, 1); assertEq(s.incomplete, 0);
});

console.log(`\nconnectionStatus: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
