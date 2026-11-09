// Adds a hero image to this month's pushed drafts that have none
// (lib/heroBackfill.js). POST { clientId, since? } with suite credentials.
// Background function: Netlify answers 202; the result is written to
// syte_suite_settings 'herobackfill:<clientId>'.

import { authorize, fromEvent } from './lib/requireAuth.js';
import { getServerSupabase } from './lib/serverSupabase.js';
import { loadClient } from './lib/autopilotStore.js';
import { wpClient } from './lib/wpClient.js';
import { shopifyClient } from './lib/shopifyClient.js';
import { backfillHeroImages, generateGoogleImage } from './lib/heroBackfill.js';
import { getPublishingProfile } from '../../src/modules/cms/publishingProfile.js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };
  const auth = await authorize(fromEvent(event));
  if (!auth.ok) return { statusCode: auth.status };
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
  const clientId = String(body.clientId || '').replace(/[^a-zA-Z0-9-]/g, '');
  if (!clientId) return { statusCode: 400 };
  const startedAt = Date.now();
  const since = /^\d{4}-\d{2}-\d{2}/.test(String(body.since || '')) ? body.since : new Date().toISOString().slice(0, 8) + '01';
  const supabase = getServerSupabase();
  const stateId = 'herobackfill:' + clientId;
  const save = data => supabase.from('syte_suite_settings').upsert({ id: stateId, data, updated_at: new Date().toISOString() });

  try {
    const client = await loadClient(supabase, clientId);
    await save({ client_id: clientId, client_name: client.name, status: 'running', started_at: new Date().toISOString() });
    const { data: rows, error } = await supabase.from('syte_suite_cms_queue').select('id, status, page_title, payload')
      .eq('client_id', clientId).gte('created_at', since).order('created_at');
    if (error) throw new Error(error.message);

    const wp = client.cms_type === 'WordPress' ? wpClient(client) : null;
    const wpBase = client.wp_url ? client.wp_url.replace(/\/+$/, '') + '/wp-json/' : '';
    const wpAuth = client.wp_username ? 'Basic ' + Buffer.from(client.wp_username + ':' + client.wp_app_password).toString('base64') : '';
    const sh = client.cms_type === 'Shopify' ? shopifyClient(client) : null;

    const results = await backfillHeroImages({ client, profile: getPublishingProfile(client), rows }, {
      timeLeftMs: () => 14 * 60 * 1000 - (Date.now() - startedAt),
      generate: prompt => generateGoogleImage(prompt, { key: String(process.env.GOOGLE_AI_KEY || '').trim() }),
      saveRow: async (id, payload) => { const { error: e } = await supabase.from('syte_suite_cms_queue').update({ payload }).eq('id', id); if (e) throw new Error(e.message); },
      wp: {
        getPost: (restBase, id) => wp(restBase === 'posts' ? 'wp/v2/posts/' + id + '?context=edit&_fields=id,status,featured_media' : 'wp/v2/' + restBase + '/' + id + '?context=edit&_fields=id,status,featured_media'),
        uploadMedia: async (b64, mime, filename, alt) => {
          const r = await fetch(wpBase + 'wp/v2/media', { method: 'POST', headers: { Authorization: wpAuth, 'Content-Type': mime, 'Content-Disposition': 'attachment; filename="' + filename + '"' }, body: Buffer.from(b64, 'base64'), signal: AbortSignal.timeout(60000) });
          const t = await r.text();
          if (!r.ok) throw new Error('WordPress media ' + r.status + ': ' + t.slice(0, 160));
          const m = JSON.parse(t);
          if (alt) await wp('wp/v2/media/' + m.id, { alt_text: alt }).catch(() => {});
          return m;
        },
        setFeatured: (restBase, id, mediaId) => wp('wp/v2/' + restBase + '/' + id, { featured_media: mediaId })
      },
      shopify: {
        getArticle: async (blogId, id) => (await sh('blogs/' + blogId + '/articles/' + id + '.json')).article || null,
        setImage: (blogId, id, b64, alt) => sh('blogs/' + blogId + '/articles/' + id + '.json', { method: 'PUT', body: { article: { id: Number(id), image: { attachment: b64, alt } } } })
      }
    });

    const count = k => results.filter(r => r.result === k).length;
    await save({ client_id: clientId, client_name: client.name, status: 'done', started_at: new Date(startedAt).toISOString(), finished_at: new Date().toISOString(), added: count('added'), skipped: count('skipped'), failed: count('failed'), results });
  } catch (e) {
    console.error('[hero-backfill]', e);
    await save({ client_id: clientId, status: 'failed', error: String(e?.message || e).slice(0, 300), finished_at: new Date().toISOString() });
  }
  return { statusCode: 202 };
}
