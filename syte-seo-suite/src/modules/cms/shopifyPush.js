// Shopify push logic. CRITICAL: blog articles are always created with published=false.

function cleanStore(s) { return (s || '').replace(/^https?:\/\//, '').replace(/\/$/, ''); }
function apiBase(client) { return 'https://' + cleanStore(client.shopify_store) + '/admin/api/2024-01'; }
function headers(client) {
  return { 'X-Shopify-Access-Token': client.shopify_token, 'Content-Type': 'application/json' };
}

export async function pushMetaToShopify(client, item) {
  const p = item.payload || {};
  const base = apiBase(client);

  const results = [];
  for (const [key, value] of [['title', p.meta_title], ['description', p.meta_description]]) {
    if (!value) continue;
    const res = await fetch(base + '/metafields.json', {
      method: 'POST',
      headers: headers(client),
      body: JSON.stringify({
        metafield: {
          namespace: 'seo',
          key,
          value,
          type: 'single_line_text_field'
        }
      })
    });
    if (!res.ok) throw new Error('Shopify metafield failed: ' + res.status);
    results.push(await res.json());
  }

  return {
    ok: true,
    admin_url: 'https://admin.shopify.com/store/' + cleanStore(client.shopify_store).replace('.myshopify.com', '') + '/settings/metafields',
    results
  };
}

async function getFirstBlogId(client) {
  const res = await fetch(apiBase(client) + '/blogs.json', { headers: headers(client) });
  if (!res.ok) throw new Error('Shopify blogs list failed: ' + res.status);
  const j = await res.json();
  if (!j.blogs || j.blogs.length === 0) throw new Error('No blogs found on this Shopify store.');
  return j.blogs[0].id;
}

export async function pushArticleToShopify(client, item) {
  const blogId = await getFirstBlogId(client);
  const p = item.payload || {};
  const base = apiBase(client);

  const res = await fetch(base + '/blogs/' + blogId + '/articles.json', {
    method: 'POST',
    headers: headers(client),
    body: JSON.stringify({
      article: {
        title: item.page_title || 'Syte draft article',
        body_html: p.html || p.code || '',
        published: false, // HARD CONSTRAINT — never publish
        tags: 'syte-draft'
      }
    })
  });
  if (!res.ok) throw new Error('Shopify article failed: ' + res.status + ' ' + await res.text());
  const j = await res.json();
  const storeHandle = cleanStore(client.shopify_store).replace('.myshopify.com', '');
  return {
    ok: true,
    admin_url: 'https://admin.shopify.com/store/' + storeHandle + '/articles/' + j.article.id,
    article: j.article
  };
}

export async function pushToShopify(client, item) {
  if (item.payload?.meta_title || item.payload?.meta_description) {
    return pushMetaToShopify(client, item);
  }
  return pushArticleToShopify(client, item);
}
