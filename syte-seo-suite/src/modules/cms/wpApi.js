// All WordPress REST API calls go through this helper which routes them
// via the Netlify wp-proxy function. This means the actual HTTP request
// to the WordPress site happens server-side, bypassing Wordfence, Cloudflare,
// CORS, and hosting-level Authorization header stripping.

const PROXY_URL = '/.netlify/functions/wp-proxy';

export async function wpRequest(client, { method = 'GET', path, body } = {}) {
  if (!client.wp_url) throw new Error('Client has no WP Site URL set.');

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export async function updatePostMeta(client, type, postId, meta) {
  return wpRequest(client, {
    method: 'POST',
    path: 'wp/v2/' + type + '/' + postId,
    body: { meta }
  });
}

export async function createDraftPost(client, { title, content, status = 'draft' }) {
  return wpRequest(client, {
    method: 'POST',
    path: 'wp/v2/posts',
    body: { title, content, status }
  });
}
