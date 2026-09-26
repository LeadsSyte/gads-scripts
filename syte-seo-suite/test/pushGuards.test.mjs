// Pushes that would damage a client's site are refused.
// 1. Technical SEO / AEO fixes change an existing page; the push could only
//    create a separate draft post, and a meta task sent empty SEO fields.
// 2. The SEO-meta push never writes an empty value over a live page's fields.

process.env.URL = 'https://suite.example';
process.env.WP_PROXY_AUTH = 'gate-value';

const { prepareServerPush, serverQueueDeps } = await import('../netlify/functions/lib/serverPush.js');
const { pushItemInline, unsupportedPushReason } = await import('../src/modules/cms/pushAction.js');
const { pushMetaToWordPress } = await import('../src/modules/cms/wordpressPush.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}

const CLIENT = { id: 'c1', name: 'X', cms_type: 'WordPress', wp_url: 'https://x.example', wp_username: 'u', wp_app_password: 'p' };
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : {};
  calls.push({ url: String(url), body });
  if (/\?slug=/.test(body.path || '')) return new Response(JSON.stringify([{ id: 9, slug: 'about' }]), { status: 200 });
  return new Response(JSON.stringify({ id: 9 }), { status: 200 });
};
prepareServerPush();
const rows = [];
const deps = { ...serverQueueDeps({ from: () => ({ insert: r => ({ select: () => ({ single: async () => { rows.push(r); return { data: { id: 'q', ...r }, error: null }; } }) }), update: () => ({ eq: async () => ({ error: null }) }) }) }), notify: async () => {} };

await t('a technical meta_title task is refused before anything is sent or logged', async () => {
  calls.length = 0;
  let err = '';
  try {
    await pushItemInline(CLIENT, { module: 'technical', page_url: 'https://x.example/about/', page_title: 'Fix title', change_type: 'meta_title', payload: { fix: '<title>Better</title>' } }, deps);
  } catch (e) { err = e.message; }
  if (!/can't be applied to a page automatically/.test(err)) throw new Error('not refused: ' + err);
  if (calls.length) throw new Error('network was called');
  if (rows.length) throw new Error('a queue row was written');
});

await t('AEO items are refused too; content articles are not', () => {
  if (!unsupportedPushReason({ module: 'aeo', change_type: 'schema' })) throw new Error('aeo allowed');
  if (unsupportedPushReason({ module: 'content', change_type: 'article' })) throw new Error('content refused');
});

await t('the SEO-meta push only writes fields it has, and refuses when it has none', async () => {
  calls.length = 0;
  await pushMetaToWordPress(CLIENT, { page_url: 'https://x.example/about/', payload: { meta_title: 'New Title' } });
  const write = calls.find(c => c.body.method === 'POST');
  const meta = write.body.body.meta;
  if (meta._yoast_wpseo_title !== 'New Title' || meta.rank_math_title !== 'New Title') throw new Error('title not written');
  if ('_yoast_wpseo_metadesc' in meta || 'rank_math_description' in meta || '_yoast_wpseo_focuskw' in meta) throw new Error('empty fields sent: ' + JSON.stringify(meta));
  let err = '';
  try { await pushMetaToWordPress(CLIENT, { page_url: 'https://x.example/about/', payload: {} }); } catch (e) { err = e.message; }
  if (!/Nothing to update/.test(err)) throw new Error('empty meta push not refused');
});

console.log(`\npushGuards: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
