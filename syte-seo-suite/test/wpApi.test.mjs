// wpApi.js contract tests. Every WP call routes through the Netlify
// wp-proxy function with a JSON envelope; this pins:
//   • requests POST to /.netlify/functions/wp-proxy
//   • envelope carries wp_url, username, appPassword, method, path, body
//   • client.wp_url missing → throws BEFORE network (with actionable msg)
//   • non-2xx surfaces "WordPress {status}: {message}" with the WP-shaped
//     {message} field if present, falling back to raw body
//   • findBySlug tries pages first, then posts; returns null when neither hit
//   • createDraftPost includes meta + featured_media only when provided
//   • uploadMedia uses isMediaUpload + mediaBase64 + mediaFilename envelope

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, '../src/modules/cms/wpApi.js'), 'utf8');

const tmp = path.join(os.tmpdir(), 'wpApi-' + Date.now() + '.mjs');
fs.writeFileSync(tmp, SRC); // No imports to patch — pure module.
const mod = await import(tmp);
fs.unlinkSync(tmp);

let fetchCalls = [];
let fetchHandler = () => { throw new Error('fetch not configured'); };
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  return fetchHandler(String(url), init);
};
function res(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body)
  };
}

let pass = 0, fail = 0;
async function t(name, fn) {
  fetchCalls = [];
  fetchHandler = () => { throw new Error('fetch not configured for ' + name); };
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, '->', e.message); fail++; }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function match(s, re, label) {
  if (!re.test(s || '')) throw new Error((label || '') + ' "' + s + '" did not match ' + re);
}
async function expectThrow(fn, regex, label) {
  try { await fn(); }
  catch (e) {
    if (regex && !regex.test(e.message)) throw new Error((label || '') + ' wrong error: ' + e.message);
    return e;
  }
  throw new Error((label || '') + ' expected throw, did not throw');
}

const CLIENT = {
  wp_url: 'https://blog.test',
  wp_username: 'admin',
  wp_app_password: 'pw'
};

// ============================================================================
// wpRequest — the envelope contract
// ============================================================================
await t('wpRequest: throws when client.wp_url missing (no fetch)', async () => {
  await expectThrow(
    () => mod.wpRequest({}, { path: 'wp/v2/users/me' }),
    /no WP Site URL/i
  );
  eq(fetchCalls.length, 0);
});

await t('wpRequest: routes through /.netlify/functions/wp-proxy with JSON envelope', async () => {
  fetchHandler = () => res(200, { name: 'admin' });
  await mod.wpRequest(CLIENT, { method: 'GET', path: 'wp/v2/users/me' });
  eq(fetchCalls.length, 1);
  const call = fetchCalls[0];
  eq(call.url, '/.netlify/functions/wp-proxy');
  eq(call.init.method, 'POST');
  const env = JSON.parse(call.init.body);
  eq(env.wpUrl, 'https://blog.test');
  eq(env.username, 'admin');
  eq(env.appPassword, 'pw');
  eq(env.method, 'GET');
  eq(env.path, 'wp/v2/users/me');
});

await t('wpRequest: passes body through unchanged', async () => {
  fetchHandler = () => res(200, { id: 1 });
  await mod.wpRequest(CLIENT, { method: 'POST', path: 'wp/v2/posts', body: { title: 'Hi' } });
  const env = JSON.parse(fetchCalls[0].init.body);
  eq(env.body.title, 'Hi');
});

await t('wpRequest: returns parsed JSON when proxy responds with JSON', async () => {
  fetchHandler = () => res(200, { id: 42, slug: 'hello-world' });
  const out = await mod.wpRequest(CLIENT, { path: 'wp/v2/posts/42' });
  eq(out.id, 42);
  eq(out.slug, 'hello-world');
});

await t('wpRequest: returns raw text when response is not JSON', async () => {
  fetchHandler = () => res(200, 'plain text');
  const out = await mod.wpRequest(CLIENT, { path: 'wp/v2/health' });
  eq(out, 'plain text');
});

await t('wpRequest: 401 surfaces "WordPress 401: <wp message>"', async () => {
  fetchHandler = () => res(401, { code: 'rest_forbidden', message: 'Sorry, you are not allowed.' });
  await expectThrow(
    () => mod.wpRequest(CLIENT, { path: 'wp/v2/users/me' }),
    /WordPress 401: Sorry, you are not allowed/
  );
});

await t('wpRequest: 500 with raw body surfaces it in the error', async () => {
  fetchHandler = () => res(500, '<html>Server error</html>');
  await expectThrow(
    () => mod.wpRequest(CLIENT, { path: 'wp/v2/anything' }),
    /WordPress 500: <html>Server error/
  );
});

// ============================================================================
// testConnection
// ============================================================================
await t('testConnection: returns user.name when present', async () => {
  fetchHandler = () => res(200, { name: 'Mike Harf', slug: 'mike' });
  const out = await mod.testConnection(CLIENT);
  eq(out, 'Mike Harf');
});

await t('testConnection: falls back to slug when no name', async () => {
  fetchHandler = () => res(200, { slug: 'mike' });
  const out = await mod.testConnection(CLIENT);
  eq(out, 'mike');
});

await t('testConnection: bare "connected" when neither name nor slug', async () => {
  fetchHandler = () => res(200, {});
  const out = await mod.testConnection(CLIENT);
  eq(out, 'connected');
});

// ============================================================================
// findBySlug — pages first, then posts
// ============================================================================
await t('findBySlug: returns first match from pages when present', async () => {
  fetchHandler = (url, init) => {
    const env = JSON.parse(init.body);
    if (env.path.startsWith('wp/v2/pages')) return res(200, [{ id: 5, slug: 'about' }]);
    return res(200, []);
  };
  const out = await mod.findBySlug(CLIENT, 'about');
  eq(out.type, 'pages');
  eq(out.record.id, 5);
});

await t('findBySlug: falls through to posts when pages empty', async () => {
  fetchHandler = (url, init) => {
    const env = JSON.parse(init.body);
    if (env.path.startsWith('wp/v2/pages')) return res(200, []);
    if (env.path.startsWith('wp/v2/posts')) return res(200, [{ id: 9, slug: 'hello' }]);
    return res(200, []);
  };
  const out = await mod.findBySlug(CLIENT, 'hello');
  eq(out.type, 'posts');
  eq(out.record.id, 9);
});

await t('findBySlug: returns null when neither pages nor posts match', async () => {
  fetchHandler = () => res(200, []);
  const out = await mod.findBySlug(CLIENT, 'nope');
  eq(out, null);
});

await t('findBySlug: URL-encodes the slug into the path', async () => {
  fetchHandler = (url, init) => {
    const env = JSON.parse(init.body);
    // Slugs with special chars must be encoded.
    match(env.path, /slug=hello%20world/);
    return res(200, []);
  };
  await mod.findBySlug(CLIENT, 'hello world');
});

// ============================================================================
// createDraftPost
// ============================================================================
await t('createDraftPost: minimal call → just title + content + status=draft', async () => {
  fetchHandler = () => res(201, { id: 7 });
  await mod.createDraftPost(CLIENT, { title: 'T', content: 'C' });
  const env = JSON.parse(fetchCalls[0].init.body);
  eq(env.method, 'POST');
  eq(env.path, 'wp/v2/posts');
  eq(env.body.title, 'T');
  eq(env.body.content, 'C');
  eq(env.body.status, 'draft');
  // meta and featured_media must NOT be set unless provided.
  eq('meta' in env.body, false);
  eq('featured_media' in env.body, false);
});

await t('createDraftPost: meta + featured_media included when supplied', async () => {
  fetchHandler = () => res(201, { id: 7 });
  await mod.createDraftPost(CLIENT, {
    title: 'T', content: 'C', status: 'publish',
    meta: { _yoast_wpseo_title: 'X' }, featured_media: 99
  });
  const env = JSON.parse(fetchCalls[0].init.body);
  eq(env.body.status, 'publish');
  eq(env.body.meta._yoast_wpseo_title, 'X');
  eq(env.body.featured_media, 99);
});

// ============================================================================
// updatePostMeta
// ============================================================================
await t('updatePostMeta: POSTs to wp/v2/{type}/{id} with meta in body', async () => {
  fetchHandler = () => res(200, { id: 42 });
  await mod.updatePostMeta(CLIENT, 'pages', 42, { rank_math_title: 'Y' });
  const env = JSON.parse(fetchCalls[0].init.body);
  eq(env.method, 'POST');
  eq(env.path, 'wp/v2/pages/42');
  eq(env.body.meta.rank_math_title, 'Y');
});

// ============================================================================
// uploadMedia — special envelope for binary
// ============================================================================
await t('uploadMedia: throws when wp_url missing', async () => {
  await expectThrow(() => mod.uploadMedia({}, 'AAA', 'x.png'), /no WP Site URL/i);
  eq(fetchCalls.length, 0);
});

await t('uploadMedia: posts to wp-proxy with isMediaUpload + mediaBase64 + mediaFilename', async () => {
  fetchHandler = () => res(201, { id: 100, source_url: 'https://blog.test/wp-content/uploads/x.png' });
  const out = await mod.uploadMedia(CLIENT, 'AAAA-base64', 'hero.png');
  const env = JSON.parse(fetchCalls[0].init.body);
  eq(env.path, 'wp/v2/media');
  eq(env.method, 'POST');
  eq(env.isMediaUpload, true);
  eq(env.mediaBase64, 'AAAA-base64');
  eq(env.mediaFilename, 'hero.png');
  eq(out.id, 100);
});

await t('uploadMedia: defaults filename to syte-hero.png when omitted', async () => {
  fetchHandler = () => res(201, { id: 1 });
  await mod.uploadMedia(CLIENT, 'AAA');
  const env = JSON.parse(fetchCalls[0].init.body);
  eq(env.mediaFilename, 'syte-hero.png');
});

await t('uploadMedia: 4xx surfaces "Media upload {status}: {message}"', async () => {
  fetchHandler = () => res(413, { message: 'File too large' });
  await expectThrow(
    () => mod.uploadMedia(CLIENT, 'AAA', 'huge.png'),
    /Media upload 413: File too large/
  );
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
