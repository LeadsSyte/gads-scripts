// Server-side CMS push for the Autopilot. Reuses the browser's push code
// unchanged (pushItemInline → wordpressPush / shopifyPush → verifyDraft) so
// an Autopilot draft is built exactly like one pushed by hand: same HTML
// clean-up, publishing profile, hero image, SEO meta and read-back check.
// Drafts only — publishing still waits for approval (publish-approved.js).
//
// What differs from the browser is the plumbing, set up by prepareServerPush:
//   - the proxies (wp-proxy, shopify-proxy, openai-proxy) are called on the
//     live site by absolute URL (src/lib/fnUrl.js);
//   - the proxy gate value comes from WP_PROXY_AUTH instead of hashing the
//     unlocked suite key (src/modules/cms/proxyAuth.js);
//   - loadSettings() (image keys) reads an in-memory localStorage holding the
//     deployment's built-in OpenAI key, so drafts get a hero image;
//   - the queue rows are written with the server Supabase client.

import { pushItemInline } from '../../../src/modules/cms/pushAction.js';
import { connectionState } from '../../../src/modules/cms/connectionStatus.js';

export function prepareServerPush() {
  globalThis.__SYTE_FN_BASE = process.env.URL || 'https://syte-seo-suite.netlify.app';
  globalThis.__SYTE_PROXY_AUTH = process.env.WP_PROXY_AUTH || '';
  if (!globalThis.localStorage) {
    const store = new Map();
    globalThis.localStorage = {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    };
  }
  globalThis.localStorage.setItem('syte-suite-settings', JSON.stringify({
    openaiKey: String(process.env.OPENAI_API_KEY || '').trim(),
    googleAiKey: String(process.env.GOOGLE_AI_KEY || '').trim()
  }));
}

export function canPushTo(client) {
  return connectionState(client).state === 'connected';
}

// Titles already in the CMS queue for this client (anything but a failed
// push), so a re-run never sends the same article twice.
export async function pushedTitles(supabase, clientId) {
  const { data } = await supabase.from('syte_suite_cms_queue')
    .select('page_title, status').eq('client_id', clientId);
  return new Set((data || []).filter(r => r.status !== 'failed')
    .map(r => String(r.page_title || '').trim().toLowerCase()));
}

export async function loadArticleOutput(supabase, blogId) {
  const { data } = await supabase.from('syte_suite_content_blogs').select('output').eq('id', blogId).maybeSingle();
  return data?.output || '';
}

export function serverQueueDeps(supabase) {
  return {
    queue: async (row) => {
      const { data, error } = await supabase.from('syte_suite_cms_queue').insert(row).select().single();
      if (error) throw new Error('Could not log the push: ' + error.message);
      return data;
    },
    update: async (id, patch) => {
      const { error } = await supabase.from('syte_suite_cms_queue').update(patch).eq('id', id);
      if (error) throw new Error('Could not update the push log: ' + error.message);
    },
    // notify-draft decides per client whether any email goes out
    // (publishing_profile.notifications_enabled, off by default).
    notify: async (queueId) => {
      await fetch(globalThis.__SYTE_FN_BASE + '/.netlify/functions/notify-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId }),
        signal: AbortSignal.timeout(15000)
      });
    }
  };
}

// Push one written article as a draft. Same item shape as Auto Write's
// "Push month to CMS", so history, approval and publishing treat it alike.
export async function pushArticleServer(supabase, client, { title, keyword, output }) {
  return pushItemInline(client, {
    module: 'content',
    page_url: client.url || '',
    page_title: title || keyword || 'Article',
    change_type: 'article',
    payload: { html: output, meta_title: title, primary_keyword: keyword, source: 'autopilot' }
  }, serverQueueDeps(supabase));
}
