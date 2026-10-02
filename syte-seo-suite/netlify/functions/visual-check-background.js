// The visual check of an article that has just gone live (background
// function — a screenshot takes ~30 s). POST { queueId } with X-Suite-Auth.
// Called by publish-approved for each post it publishes.
//
// POST { testUrl, referenceUrl? } runs the same check on any address and
// writes the result to syte_suite_settings 'visualcheck-test' — to prove the
// server can take and judge a screenshot without changing or emailing anything.
//
// Takes a screenshot of the live page and of another published post on the
// same site, has an AI compare them (lib/visualCheck.js), saves the result on
// the Push History row (payload.visual_check) and — only when something looks
// wrong — emails the report address. The post stays live either way.

import { getServerSupabase } from './lib/serverSupabase.js';
import { claudeCompleteServer } from './lib/serverAi.js';
import { visualCheck, visualCheckAvailable } from './lib/visualCheck.js';
import { wpClient, hasWordPress } from './lib/wpClient.js';
import { shopifyClient, hasShopify } from './lib/shopifyClient.js';
import { reportRecipients, sendReport, buildVisualProblemEmail } from './lib/reportEmail.js';

// Another published post on the same site, to compare the new one with.
export async function referencePostUrl(client, row, { wp, sh } = {}) {
  const p = row.payload || {};
  try {
    if (hasWordPress(client)) {
      const posts = await (wp || wpClient(client))('wp/v2/' + (p.rest_base || 'posts') + '?status=publish&per_page=4&_fields=id,link');
      return (Array.isArray(posts) ? posts : []).find(x => x.id !== p.wp_id && x.link && x.link !== p.live_url)?.link || '';
    }
    if (hasShopify(client) && p.shopify_blog_id && p.live_url) {
      const j = await (sh || shopifyClient(client))('blogs/' + p.shopify_blog_id + '/articles.json?published_status=published&limit=4&fields=id,handle');
      const other = (j.articles || []).find(a => a.id !== p.shopify_article_id && a.handle);
      return other ? p.live_url.replace(/[^/]+\/?$/, other.handle) : '';
    }
  } catch { /* no reference: the page is judged on its own */ }
  return '';
}

export async function handler(event) {
  const required = process.env.WP_PROXY_AUTH;
  const given = event.headers['x-suite-auth'] || event.headers['X-Suite-Auth'] || '';
  if (!required || given !== required) return { statusCode: 401 };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
  const supabase = getServerSupabase();
  if (body.testUrl) {
    const started = Date.now();
    let result;
    try {
      if (!/^https:\/\/[^\s]+$/.test(String(body.testUrl))) throw new Error('testUrl must be an https address');
      result = await visualCheck({ url: String(body.testUrl), referenceUrl: String(body.referenceUrl || ''), what: 'Nothing was changed; this is a test of the check. Judge the page as it is.' }, { complete: claudeCompleteServer });
    } catch (e) { result = { status: 'unchecked', problems: [], summary: String(e.message || e).slice(0, 200) }; }
    await supabase.from('syte_suite_settings').upsert({
      id: 'visualcheck-test', updated_at: new Date().toISOString(),
      data: { url: body.testUrl, result, seconds: Math.round((Date.now() - started) / 1000), key_set: visualCheckAvailable(), at: new Date().toISOString() }
    });
    return { statusCode: 202 };
  }
  if (!body.queueId) return { statusCode: 400 };
  if (!visualCheckAvailable()) return { statusCode: 202 };
  try {
    const { data: row } = await supabase.from('syte_suite_cms_queue').select('*').eq('id', body.queueId).maybeSingle();
    const url = row?.payload?.live_url;
    if (!row || row.status !== 'published' || !url) return { statusCode: 202 };
    const { data: client } = await supabase.from('syte_suite_clients').select('*').eq('id', row.client_id).maybeSingle();
    if (!client) return { statusCode: 202 };

    const result = await visualCheck({
      url, referenceUrl: await referencePostUrl(client, row),
      what: 'A new blog article titled "' + (row.page_title || '') + '" was published on this page.'
    }, { complete: claudeCompleteServer });

    // Re-read before writing: the row may have changed in the last minute.
    const { data: fresh } = await supabase.from('syte_suite_cms_queue').select('payload').eq('id', row.id).maybeSingle();
    await supabase.from('syte_suite_cms_queue').update({ payload: { ...(fresh?.payload || row.payload || {}), visual_check: result } }).eq('id', row.id);

    if (result.status === 'problems') {
      const to = await reportRecipients(supabase);
      if (to.length) {
        const siteUrl = (process.env.URL || 'https://syte-seo-suite.netlify.app').replace(/\/+$/, '');
        await sendReport({ to, ...buildVisualProblemEmail({ client: client.name, title: row.page_title, url, result }, siteUrl) });
      }
    }
  } catch (e) {
    console.error('[visual-check] failed:', e.message);
  }
  return { statusCode: 202 };
}
