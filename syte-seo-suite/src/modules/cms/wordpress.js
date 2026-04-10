// WordPress push via REST API + Basic auth (Application Password).
// IMPORTANT: any created posts must be status=draft. Never auto-publish.

function basicAuth(user, pass) {
  return 'Basic ' + btoa(`${user}:${pass}`);
}

function apiBase(client) {
  return (client.wp_url || '').replace(/\/$/, '') + '/wp-json/wp/v2';
}

function adminEdit(client, id) {
  return `${(client.wp_url || '').replace(/\/$/, '')}/wp-admin/post.php?post=${id}&action=edit`;
}

function slugFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  } catch {
    return (url || '').split('/').filter(Boolean).pop() || '';
  }
}

export async function testWpConnection(client) {
  const res = await fetch(`${apiBase(client)}/users/me`, {
    headers: { authorization: basicAuth(client.wp_username, client.wp_app_password) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.name || data.username || 'connected';
}

async function findByslug(client, slug, type) {
  const res = await fetch(`${apiBase(client)}/${type}?slug=${encodeURIComponent(slug)}`, {
    headers: { authorization: basicAuth(client.wp_username, client.wp_app_password) },
  });
  if (!res.ok) return null;
  const arr = await res.json();
  return arr[0] || null;
}

async function findPostOrPage(client, slug) {
  return (
    (await findByslug(client, slug, 'pages')) ||
    (await findByslug(client, slug, 'posts'))
  );
}

export async function pushToWordPress(client, item) {
  const auth = basicAuth(client.wp_username, client.wp_app_password);
  const type = item.change_type;

  if (type === 'meta') {
    const slug = slugFromUrl(item.page_url);
    const target = await findPostOrPage(client, slug);
    if (!target) throw new Error(`No WP page/post matching slug "${slug}"`);
    const resource = target.type === 'page' ? 'pages' : 'posts';
    const body = {
      meta: {
        _yoast_wpseo_title: item.payload?.meta_title,
        _yoast_wpseo_metadesc: item.payload?.meta_description,
        _yoast_wpseo_focuskw: item.payload?.focus_keyword,
        rank_math_title: item.payload?.meta_title,
        rank_math_description: item.payload?.meta_description,
        rank_math_focus_keyword: item.payload?.focus_keyword,
      },
    };
    const res = await fetch(`${apiBase(client)}/${resource}/${target.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`WP update failed: ${res.status}`);
    return { admin_url: adminEdit(client, target.id) };
  }

  // schema / content / other — create a DRAFT post for manual insertion
  const content = buildContentBlock(item);
  const res = await fetch(`${apiBase(client)}/posts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify({
      title: `[Syte] ${item.page_title || item.change_type}`,
      status: 'draft', // ALWAYS draft
      content,
    }),
  });
  if (!res.ok) throw new Error(`WP create failed: ${res.status}`);
  const data = await res.json();
  return { admin_url: adminEdit(client, data.id) };
}

function buildContentBlock(item) {
  const p = item.payload || {};
  if (p.jsonld) return `<!-- JSON-LD for ${item.page_url} -->\n<pre>${escape(p.jsonld)}</pre>`;
  if (p.code) return `<!-- Snippet for ${item.page_url} -->\n<pre>${escape(p.code)}</pre>\n<p>${escape(p.notes || '')}</p>`;
  if (p.fix_code) return `<!-- Fix for ${item.page_url} -->\n<pre>${escape(p.fix_code)}</pre>\n<p>${escape(p.fix_notes || '')}</p>`;
  if (p.faq) return `<h2>FAQ</h2>\n<pre>${escape(p.faq)}</pre>`;
  return `<pre>${escape(JSON.stringify(p, null, 2))}</pre>`;
}

function escape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
