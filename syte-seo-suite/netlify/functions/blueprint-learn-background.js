// Learns a client's article blueprint from the posts published on their own
// blog (lib/articleBlueprint.js) and saves it on the client
// (publishing_profile.article_blueprint). POST { clientId, force? } with
// suite credentials. Background function: Netlify answers 202; progress is
// in syte_suite_settings 'blueprint:<clientId>' (running → done | skipped |
// not_enough | failed). Read-only on the client's site.

import { authorize, fromEvent } from './lib/requireAuth.js';
import { getServerSupabase } from './lib/serverSupabase.js';
import { loadClient, saveClientFields } from './lib/autopilotStore.js';
import { claudeCompleteServer } from './lib/serverAi.js';
import { wpClient, hasWordPress } from './lib/wpClient.js';
import { shopifyClient, hasShopify } from './lib/shopifyClient.js';
import { learnBlueprint, blueprintIsEdited } from './lib/articleBlueprint.js';
import { getPublishingProfile } from '../../src/modules/cms/publishingProfile.js';

async function publishedPosts(client, profile) {
  if (hasWordPress(client)) {
    const wp = wpClient(client);
    const restBase = profile.post_type_rest_base || 'posts';
    const rows = await wp('wp/v2/' + restBase + '?status=publish&per_page=12&orderby=date&order=desc&_fields=id,title,link,date,content');
    return (Array.isArray(rows) ? rows : []).map(p => ({ title: p.title?.rendered || '', url: p.link || '', html: p.content?.rendered || '', date: p.date }));
  }
  if (hasShopify(client)) {
    const sh = shopifyClient(client);
    let blogId = profile.shopify_blog_id;
    let handle = '';
    const blogs = (await sh('blogs.json')).blogs || [];
    const blog = blogs.find(b => String(b.id) === String(blogId)) || blogs[0];
    if (!blog) throw new Error('No blogs found on this Shopify store.');
    blogId = blog.id; handle = blog.handle;
    const arts = (await sh('blogs/' + blogId + '/articles.json?published_status=published&limit=12&fields=id,title,handle,body_html,published_at')).articles || [];
    const domain = String(client.url || '').replace(/\/+$/, '') || 'https://' + String(client.shopify_store || '').replace(/^https?:\/\//, '');
    return arts.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
      .map(a => ({ title: a.title || '', url: a.handle ? domain + '/blogs/' + handle + '/' + a.handle : '', html: a.body_html || '', date: a.published_at }));
  }
  throw new Error('This client has no working WordPress or Shopify connection to read articles from.');
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };
  const auth = await authorize(fromEvent(event));
  if (!auth.ok) return { statusCode: auth.status };
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
  const clientId = String(body.clientId || '').replace(/[^a-zA-Z0-9-]/g, '');
  if (!clientId) return { statusCode: 400 };

  const supabase = getServerSupabase();
  const save = data => supabase.from('syte_suite_settings').upsert({ id: 'blueprint:' + clientId, data: { client_id: clientId, ...data }, updated_at: new Date().toISOString() });
  try {
    const client = await loadClient(supabase, clientId);
    const profile = getPublishingProfile(client);
    if (blueprintIsEdited(profile) && !body.force) {
      await save({ client_name: client.name, status: 'skipped', reason: 'The blueprint was edited by the team; not replaced.', finished_at: new Date().toISOString() });
      return { statusCode: 202 };
    }
    await save({ client_name: client.name, status: 'running', started_at: new Date().toISOString() });
    const posts = await publishedPosts(client, profile);
    const { data: own } = await supabase.from('syte_suite_cms_queue').select('page_title').eq('client_id', clientId);
    const out = await learnBlueprint({ client, posts, ownTitles: (own || []).map(r => r.page_title) }, { complete: claudeCompleteServer });
    if (out.result !== 'learned') {
      await save({ client_name: client.name, status: 'not_enough', reason: out.reason, posts_found: posts.length, finished_at: new Date().toISOString() });
      return { statusCode: 202 };
    }
    // Re-read the profile so a change saved meanwhile is not lost.
    const fresh = await loadClient(supabase, clientId);
    const raw = fresh.publishing_profile && typeof fresh.publishing_profile === 'object' ? fresh.publishing_profile : {};
    await saveClientFields(supabase, clientId, { publishing_profile: { ...raw, article_blueprint: out.blueprint } });
    await save({ client_name: client.name, status: 'done', blueprint: out.blueprint, finished_at: new Date().toISOString() });
  } catch (e) {
    console.error('[blueprint-learn]', clientId, e);
    await save({ status: 'failed', error: String(e?.message || e).slice(0, 300), finished_at: new Date().toISOString() });
  }
  return { statusCode: 202 };
}
