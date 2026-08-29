// Connection health check — "is this client ready for automated
// publishing?" Run from the Connector after credentials are entered, and
// before a client joins a batch. Non-destructive except for one test
// draft, which is deleted afterwards.
//
// Result shape: { ready: boolean, checks: [{ name, ok, detail }] }

import { wpRequest, createDraftPost } from './wpApi.js';
import { shopifyRequest, listBlogs } from './shopifyApi.js';
import { getPublishingProfile } from './publishingProfile.js';

export async function runHealthCheck(client) {
  if (client.cms_type === 'WordPress') return wpHealthCheck(client);
  if (client.cms_type === 'Shopify') return shopifyHealthCheck(client);
  return { ready: false, checks: [{ name: 'CMS type', ok: false, detail: 'No automatable CMS connected (WordPress or Shopify).' }] };
}

async function wpHealthCheck(client) {
  const checks = [];
  const profile = getPublishingProfile(client);
  const restBase = profile.post_type_rest_base || 'posts';
  let user = null;

  // 1. Auth
  try {
    user = await wpRequest(client, { path: 'wp/v2/users/me?context=edit' });
    checks.push({ name: 'Authentication', ok: true, detail: 'Connected as ' + (user.name || user.slug) });
  } catch (e) {
    checks.push({ name: 'Authentication', ok: false, detail: e.message });
    return { ready: false, checks };
  }

  // 2. Post type exists
  try {
    await wpRequest(client, { path: 'wp/v2/' + restBase + '?per_page=1' });
    checks.push({ name: 'Post type "' + restBase + '"', ok: true, detail: 'Reachable' });
  } catch (e) {
    checks.push({ name: 'Post type "' + restBase + '"', ok: false, detail: e.message });
  }

  // 3. Create + delete a test draft (proves write permission end to end)
  let testId = null;
  try {
    const created = await createDraftPost(client, {
      title: '[Syte connection test — safe to delete]',
      content: '<p>Automated connection test. This draft deletes itself.</p>',
      status: 'draft'
    }, restBase);
    testId = created.id;
    checks.push({ name: 'Create draft', ok: true, detail: 'Draft #' + testId + ' created' });
  } catch (e) {
    checks.push({ name: 'Create draft', ok: false, detail: e.message });
  }

  // 4. SEO meta registration (the silent killer — Yoast/RankMath fields
  //    need the PHP snippet before REST accepts them)
  if (testId) {
    try {
      const probe = 'syte-suite-check';
      await wpRequest(client, {
        method: 'POST',
        path: 'wp/v2/' + restBase + '/' + testId,
        body: { meta: { rank_math_title: probe, _yoast_wpseo_title: probe } }
      });
      // Read it back — WordPress returns 200 for meta keys it does not
      // recognise and writes nothing, so a successful call proves nothing.
      const after = await wpRequest(client, { path: 'wp/v2/' + restBase + '/' + testId + '?context=edit' });
      const stored = after?.meta || {};
      const stuck = stored._yoast_wpseo_title === probe || stored.rank_math_title === probe;
      checks.push(stuck
        ? { name: 'SEO meta fields', ok: true, detail: 'Writable and confirmed stored' }
        : { name: 'SEO meta fields', ok: false, detail: 'WordPress accepted the write but stored nothing — the SEO meta keys need registering for REST (PHP snippet). Drafts still work, they just arrive without SEO title/description.' });
    } catch (e) {
      checks.push({ name: 'SEO meta fields', ok: false, detail: 'Not writable — install the PHP snippet (drafts still work, but without SEO fields): ' + e.message.slice(0, 120) });
    }
    // 5. Clean up
    try {
      await wpRequest(client, { method: 'DELETE', path: 'wp/v2/' + restBase + '/' + testId + '?force=true' });
      checks.push({ name: 'Cleanup', ok: true, detail: 'Test draft deleted' });
    } catch (e) {
      checks.push({ name: 'Cleanup', ok: false, detail: 'Delete the test draft manually (#' + testId + '): ' + e.message.slice(0, 100) });
    }
  }

  // Ready = auth + create work. SEO meta failing is a warning, not a blocker.
  const ready = checks.find(c => c.name === 'Authentication')?.ok === true
    && checks.find(c => c.name === 'Create draft')?.ok === true;
  return { ready, checks };
}

async function shopifyHealthCheck(client) {
  const checks = [];

  // 1. Auth
  try {
    const j = await shopifyRequest(client, { path: 'shop.json' });
    checks.push({ name: 'Authentication', ok: true, detail: 'Connected to ' + (j.shop?.name || 'store') });
  } catch (e) {
    checks.push({ name: 'Authentication', ok: false, detail: e.message });
    return { ready: false, checks };
  }

  // 2. Blogs
  let blogId = null;
  try {
    const blogs = await listBlogs(client);
    if (blogs.length === 0) {
      checks.push({ name: 'Blogs', ok: false, detail: 'Store has no blogs — create one in the Shopify admin first.' });
    } else {
      blogId = blogs[0].id;
      checks.push({ name: 'Blogs', ok: true, detail: blogs.length + ' blog(s): ' + blogs.map(b => b.title).join(', ') });
    }
  } catch (e) {
    checks.push({ name: 'Blogs', ok: false, detail: e.message });
  }

  // 3. Create + delete a hidden test article (proves write_content scope)
  if (blogId) {
    let testId = null;
    try {
      const j = await shopifyRequest(client, {
        method: 'POST',
        path: 'blogs/' + blogId + '/articles.json',
        body: { article: { title: '[Syte connection test — safe to delete]', body_html: '<p>Automated test.</p>', published: false } }
      });
      testId = j.article?.id;
      checks.push({ name: 'Create draft article', ok: true, detail: 'Article #' + testId + ' created (hidden)' });
    } catch (e) {
      checks.push({ name: 'Create draft article', ok: false, detail: e.message + ' — the token likely lacks the write_content scope.' });
    }
    if (testId) {
      try {
        await shopifyRequest(client, { method: 'DELETE', path: 'blogs/' + blogId + '/articles/' + testId + '.json' });
        checks.push({ name: 'Cleanup', ok: true, detail: 'Test article deleted' });
      } catch (e) {
        checks.push({ name: 'Cleanup', ok: false, detail: 'Delete the test article manually (#' + testId + ')' });
      }
    }
  }

  const ready = checks.find(c => c.name === 'Authentication')?.ok === true
    && checks.find(c => c.name === 'Create draft article')?.ok === true;
  return { ready, checks };
}
