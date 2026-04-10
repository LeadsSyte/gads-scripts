// WordPress push logic for CMS Push module.
// CRITICAL: every created post is saved as status=draft. NEVER publish.

function trimUrl(u) { return (u || '').replace(/\/$/, ''); }
function slugFromUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  } catch { return ''; }
}

function authHeader(client) {
  return 'Basic ' + btoa(client.wp_username + ':' + client.wp_app_password);
}

async function findResource(client, slug) {
  const base = trimUrl(client.wp_url);
  const auth = authHeader(client);
  for (const type of ['pages', 'posts']) {
    const res = await fetch(base + '/wp-json/wp/v2/' + type + '?slug=' + encodeURIComponent(slug), {
      headers: { Authorization: auth }
    });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) return { type, record: list[0] };
    }
  }
  return null;
}

export async function pushMetaToWordPress(client, item) {
  const base = trimUrl(client.wp_url);
  const auth = authHeader(client);
  const slug = slugFromUrl(item.page_url);
  const found = await findResource(client, slug);
  if (!found) throw new Error('Page/post not found for slug: ' + slug);

  const { type, record } = found;
  const p = item.payload || {};

  // Yoast + Rank Math meta keys (set both so it works on either plugin).
  const meta = {
    _yoast_wpseo_title:     p.meta_title || '',
    _yoast_wpseo_metadesc:  p.meta_description || '',
    _yoast_wpseo_focuskw:   p.primary_keyword || '',
    rank_math_title:        p.meta_title || '',
    rank_math_description:  p.meta_description || '',
    rank_math_focus_keyword: p.primary_keyword || ''
  };

  const res = await fetch(base + '/wp-json/wp/v2/' + type + '/' + record.id, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ meta })
  });
  if (!res.ok) throw new Error('WP meta update failed: ' + res.status + ' ' + await res.text());
  const updated = await res.json();
  return {
    ok: true,
    admin_url: base + '/wp-admin/post.php?post=' + record.id + '&action=edit',
    link: updated.link
  };
}

export async function pushContentToWordPress(client, item) {
  const base = trimUrl(client.wp_url);
  const auth = authHeader(client);
  const p = item.payload || {};

  const body = {
    title: item.page_title || 'Syte AEO draft',
    status: 'draft', // HARD CONSTRAINT — never publish
    content: p.html || p.code || p.fix || JSON.stringify(p)
  };

  const res = await fetch(base + '/wp-json/wp/v2/posts', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('WP draft create failed: ' + res.status + ' ' + await res.text());
  const created = await res.json();
  return {
    ok: true,
    admin_url: base + '/wp-admin/post.php?post=' + created.id + '&action=edit',
    link: created.link
  };
}

export async function pushToWordPress(client, item) {
  if (['meta', 'meta_title', 'meta_description'].includes(item.change_type)) {
    return pushMetaToWordPress(client, item);
  }
  if (item.payload && (item.payload.meta_title || item.payload.meta_description) &&
      !item.payload.html && !item.payload.code) {
    return pushMetaToWordPress(client, item);
  }
  return pushContentToWordPress(client, item);
}
