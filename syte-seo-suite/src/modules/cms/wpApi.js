// All WordPress REST API calls go through this helper which routes them
// via the Netlify wp-proxy function. This means the actual HTTP request
// to the WordPress site happens server-side, bypassing Wordfence, Cloudflare,
// CORS, and hosting-level Authorization header stripping.

const PROXY_URL = '/.netlify/functions/wp-proxy';

// Proxy auth: prove to the Netlify function that the request comes from an
// unlocked suite session, without shipping a secret in the JS bundle. We
// send SHA-256(stored suite key); the function compares it against the
// WP_PROXY_AUTH env var. The hash is useless as an API key by itself.
let _authHashPromise = null;
async function proxyAuthHash() {
  if (_authHashPromise) return _authHashPromise;
  _authHashPromise = (async () => {
    try {
      const { getStoredApiKey } = await import('../../lib/auth.js');
      const key = getStoredApiKey();
      if (!key || !globalThis.crypto?.subtle) return '';
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { return ''; }
  })();
  return _authHashPromise;
}

export async function wpRequest(client, { method = 'GET', path, body } = {}) {
  if (!client.wp_url) throw new Error('Client has no WP Site URL set.');

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
    body: JSON.stringify({
      wpUrl: client.wp_url,
      username: client.wp_username || '',
      appPassword: client.wp_app_password || '',
      method,
      path,
      body
    })
  });

  // The proxy returns the WP response status code directly.
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    const msg = typeof data === 'object' ? (data.message || data.error || JSON.stringify(data)) : text;
    throw new Error('WordPress ' + res.status + ': ' + msg);
  }

  return data;
}

// Convenience wrappers matching the WP REST API endpoints we use.

export async function testConnection(client) {
  const user = await wpRequest(client, { path: 'wp/v2/users/me' });
  return user.name || user.slug || 'connected';
}

export async function findBySlug(client, slug) {
  // Try pages first, then posts.
  for (const type of ['pages', 'posts']) {
    const results = await wpRequest(client, {
      path: 'wp/v2/' + type + '?slug=' + encodeURIComponent(slug)
    });
    if (Array.isArray(results) && results.length > 0) {
      return { type, record: results[0] };
    }
  }
  return null;
}

// Find a post the API user can edit (any status — drafts included) whose
// slug matches. Used for duplicate-push protection. `status=any` needs the
// edit context, which our Application Password gives us.
export async function findEditablePostBySlug(client, slug, restBase = 'posts') {
  if (!slug) return null;
  const results = await wpRequest(client, {
    path: 'wp/v2/' + restBase + '?slug=' + encodeURIComponent(slug) + '&status=draft,pending,future,publish&context=edit'
  });
  return Array.isArray(results) && results.length > 0 ? results[0] : null;
}

export async function updateDraftPost(client, postId, { title, content, status = 'draft', featured_media, categories, author }, restBase = 'posts') {
  const body = { title, content, status };
  if (featured_media) body.featured_media = featured_media;
  if (categories) body.categories = categories;
  if (author) body.author = author;
  return wpRequest(client, {
    method: 'POST',
    path: 'wp/v2/' + restBase + '/' + postId,
    body
  });
}

export async function updatePostMeta(client, type, postId, meta) {
  return wpRequest(client, {
    method: 'POST',
    path: 'wp/v2/' + type + '/' + postId,
    body: { meta }
  });
}

export async function createDraftPost(client, { title, content, status = 'draft', meta, featured_media, categories, author }, restBase = 'posts') {
  const body = { title, content, status };
  if (meta) body.meta = meta;
  if (featured_media) body.featured_media = featured_media;
  if (categories) body.categories = categories;
  if (author) body.author = author;
  return wpRequest(client, {
    method: 'POST',
    path: 'wp/v2/' + restBase,
    body
  });
}

// Upload an image to the WordPress media library. Returns the attachment
// object including the ID needed for featured_media.
// imageData: base64 string (without the data:image/png;base64, prefix)
// filename: e.g. "hero-image.png"
export async function uploadMedia(client, imageData, filename) {
  if (!client.wp_url) throw new Error('Client has no WP Site URL set.');

  // We need to send the image as binary through our proxy.
  // The proxy handles JSON, so we send the base64 data and let
  // the proxy decode and forward it.
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': await proxyAuthHash() },
    body: JSON.stringify({
      wpUrl: client.wp_url,
      username: client.wp_username || '',
      appPassword: client.wp_app_password || '',
      method: 'POST',
      path: 'wp/v2/media',
      isMediaUpload: true,
      mediaBase64: imageData,
      mediaFilename: filename || 'syte-hero.png'
    })
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const msg = typeof data === 'object' ? (data.message || data.error || JSON.stringify(data)) : text;
    throw new Error('Media upload ' + res.status + ': ' + msg);
  }
  return data;
}
