// Server-side push plumbing for the Autopilot: the browser's push code must
// run under Node against the LIVE proxies, with the server's proxy gate
// value, and log to the queue through the server Supabase client. The
// network is faked — nothing leaves this process.

process.env.URL = 'https://suite.example';
process.env.WP_PROXY_AUTH = 'gate-value';
process.env.OPENAI_API_KEY = 'sk-test-builtin';

const { prepareServerPush, pushArticleServer, canPushTo } = await import('../netlify/functions/lib/serverPush.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}

const CLIENT = {
  id: 'c1', name: 'Allergy Facts', url: 'https://allergy.example', cms_type: 'WordPress',
  wp_url: 'https://allergy.example', wp_username: 'syte', wp_app_password: 'app pass',
  publishing_profile: { hero_mode: 'featured-only' }
};

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : {};
  calls.push({ url: String(url), headers: init.headers || {}, body });
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  if (String(url).endsWith('/openai-proxy')) return json({ data: [{ b64_json: 'aGVsbG8=' }] });
  if (String(url).endsWith('/notify-draft')) return json({ ok: true });
  if (String(url).endsWith('/wp-proxy')) {
    const p = body.path || '';
    if (body.imageData || /wp\/v2\/media/.test(p)) return json({ id: 77, source_url: 'https://allergy.example/hero.png' });
    if (/\?search=/.test(p)) return json([]);
    if (/status=publish/.test(p)) return json([1, 2].map(() => ({ content: { rendered: '<h2 class="wp-block-heading has-black-color">H</h2><p class="wp-block-paragraph">x</p>' } })));
    if (body.method === 'POST' && p === 'wp/v2/posts') return json({ id: 501, slug: '' });
    if (body.method === 'POST') return json({ id: 501 });
    return json({ id: 501, featured_media: 77, content: { rendered: '<p>Hay fever is common.</p><h2>Relief</h2><p>More.</p>' },
      meta: { _yoast_wpseo_title: 'Hay Fever | Allergy Facts', _yoast_wpseo_metadesc: 'About hay fever.' } });
  }
  throw new Error('unexpected fetch ' + url);
};

const rows = [];
const fakeSupabase = {
  from: () => ({
    insert: (row) => ({ select: () => ({ single: async () => { const r = { id: 'q1', ...row }; rows.push(r); return { data: r, error: null }; } }) }),
    update: (patch) => ({ eq: async (_k, id) => { Object.assign(rows.find(r => r.id === id), patch); return { error: null }; } })
  })
};

const ARTICLE = '**Meta Title:** Hay Fever | Allergy Facts\n\n**Meta Description:** About hay fever.\n\n# Hay Fever Relief\n\nHay fever is common.\n\n## Relief\n\nMore.';

await t('only connected WordPress / Shopify clients can be pushed to', () => {
  assertEq(canPushTo(CLIENT), true);
  assertEq(canPushTo({ ...CLIENT, wp_app_password: '' }), false);
  assertEq(canPushTo({ ...CLIENT, cms_type: 'Custom Site' }), false);
});

await t('a draft is created through the live proxy with the server gate value', async () => {
  prepareServerPush();
  const r = await pushArticleServer(fakeSupabase, CLIENT, { title: 'Hay Fever Relief', keyword: 'hay fever', output: ARTICLE });
  assertEq(r.ok, true);
  const wp = calls.filter(c => c.url.endsWith('/wp-proxy'));
  if (!wp.length) throw new Error('wp-proxy never called');
  for (const c of wp) {
    assertEq(c.url, 'https://suite.example/.netlify/functions/wp-proxy', 'absolute proxy URL');
    assertEq(c.headers['X-Suite-Auth'], 'gate-value', 'gate header');
  }
  const create = wp.find(c => c.body.method === 'POST' && c.body.path === 'wp/v2/posts');
  assertEq(create.body.body.status, 'draft', 'draft only');
  if (/Meta Title|# Hay Fever Relief/.test(create.body.body.content)) throw new Error('meta block or H1 left in the body');
  if (!/<h2 class="wp-block-heading has-black-color">Relief<\/h2>/.test(create.body.body.content)) throw new Error('house style not applied: ' + create.body.body.content.slice(0, 200));
});

await t('the hero image uses the built-in OpenAI key', () => {
  const img = calls.find(c => c.url.endsWith('/openai-proxy'));
  if (!img) throw new Error('no image request');
  assertEq(img.body.apiKey, 'sk-test-builtin');
});

await t('the push is logged like a hand push and marked as from the Autopilot', () => {
  assertEq(rows.length, 1);
  assertEq(rows[0].status, 'pushed');
  assertEq(rows[0].module, 'content');
  assertEq(rows[0].payload.source, 'autopilot');
  assertEq(rows[0].payload.wp_id, 501, 'publisher needs the post id');
  if (!calls.some(c => c.url === 'https://suite.example/.netlify/functions/notify-draft')) throw new Error('notify-draft not called');
});

console.log(`\nserverPush: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
