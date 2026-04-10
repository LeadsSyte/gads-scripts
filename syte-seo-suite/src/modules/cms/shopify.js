// Shopify push — metafields for meta updates, blogs/articles for content.
// Articles are always created with published=false.

const API_VERSION = '2024-01';

function headers(client) {
  return {
    'content-type': 'application/json',
    'X-Shopify-Access-Token': client.shopify_token,
  };
}

function adminBase(client) {
  return `https://${client.shopify_store}/admin`;
}

export async function testShopifyConnection(client) {
  const res = await fetch(`${adminBase(client)}/api/${API_VERSION}/shop.json`, {
    headers: headers(client),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.shop?.name || 'connected';
}

async function firstBlogId(client) {
  const res = await fetch(`${adminBase(client)}/api/${API_VERSION}/blogs.json`, {
    headers: headers(client),
  });
  if (!res.ok) throw new Error('Failed to list blogs');
  const data = await res.json();
  return data.blogs?.[0]?.id;
}

export async function pushToShopify(client, item) {
  const type = item.change_type;

  if (type === 'meta') {
    const body = {
      metafield: {
        namespace: 'seo',
        key: 'title',
        type: 'single_line_text_field',
        value: item.payload?.meta_title || '',
      },
    };
    await fetch(`${adminBase(client)}/api/${API_VERSION}/metafields.json`, {
      method: 'POST',
      headers: headers(client),
      body: JSON.stringify(body),
    });
    await fetch(`${adminBase(client)}/api/${API_VERSION}/metafields.json`, {
      method: 'POST',
      headers: headers(client),
      body: JSON.stringify({
        metafield: {
          namespace: 'seo',
          key: 'description',
          type: 'multi_line_text_field',
          value: item.payload?.meta_description || '',
        },
      }),
    });
    return { admin_url: `${adminBase(client)}` };
  }

  // content / schema: create UNPUBLISHED article
  const blogId = await firstBlogId(client);
  if (!blogId) throw new Error('No Shopify blog found');
  const bodyHtml = buildHtml(item);
  const res = await fetch(
    `${adminBase(client)}/api/${API_VERSION}/blogs/${blogId}/articles.json`,
    {
      method: 'POST',
      headers: headers(client),
      body: JSON.stringify({
        article: {
          title: `[Syte] ${item.page_title || item.change_type}`,
          author: 'Syte SEO Suite',
          body_html: bodyHtml,
          published: false, // ALWAYS unpublished
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Shopify create failed: ${res.status}`);
  const data = await res.json();
  return { admin_url: `${adminBase(client)}/articles/${data.article?.id || ''}` };
}

function buildHtml(item) {
  const p = item.payload || {};
  if (p.jsonld) return `<pre>${escape(p.jsonld)}</pre>`;
  if (p.code) return `<pre>${escape(p.code)}</pre><p>${escape(p.notes || '')}</p>`;
  if (p.fix_code) return `<pre>${escape(p.fix_code)}</pre><p>${escape(p.fix_notes || '')}</p>`;
  if (p.faq) return `<h2>FAQ</h2><pre>${escape(p.faq)}</pre>`;
  return `<pre>${escape(JSON.stringify(p, null, 2))}</pre>`;
}

function escape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
