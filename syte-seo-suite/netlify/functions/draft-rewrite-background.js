// Rewrites a draft that was sent back with "request changes" and updates the
// same draft on the client's site (lib/draftRewrite.js). POST { queueId }
// with suite credentials; started by POST /api/v1/queue/:id/reject.
// Background function: Netlify answers 202; the outcome is on the queue row
// (payload.rewrite_status: running → done | held | failed).

import { authorize, fromEvent } from './lib/requireAuth.js';
import { getServerSupabase } from './lib/serverSupabase.js';
import { loadClient } from './lib/autopilotStore.js';
import { claudeCompleteServer, openaiJson } from './lib/serverAi.js';
import { prepareServerPush, serverQueueDeps } from './lib/serverPush.js';
import { rewriteDraft, sameRowQueueDeps } from './lib/draftRewrite.js';
import { pushItemInline } from '../../src/modules/cms/pushAction.js';
import { getPublishingProfile } from '../../src/modules/cms/publishingProfile.js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };
  const auth = await authorize(fromEvent(event));
  if (!auth.ok) return { statusCode: auth.status };
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
  const queueId = String(body.queueId || '').replace(/[^a-zA-Z0-9-]/g, '');
  if (!queueId) return { statusCode: 400 };

  const supabase = getServerSupabase();
  const saveRow = async (id, patch) => {
    const { error } = await supabase.from('syte_suite_cms_queue').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  };
  try {
    const { data: row, error } = await supabase.from('syte_suite_cms_queue').select('*').eq('id', queueId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { statusCode: 202 };
    const client = await loadClient(supabase, row.client_id);
    prepareServerPush();
    const out = await rewriteDraft({ row, client, profile: getPublishingProfile(client) }, {
      complete: claudeCompleteServer,
      checkArticle: ({ system, user }) => openaiJson({ system, user }),
      saveRow,
      push: (c, item, r) => pushItemInline(c, item, sameRowQueueDeps(serverQueueDeps(supabase), r))
    });
    console.log('[draft-rewrite]', queueId, out.result, out.reason || '');
    if (out.result === 'blocked') {
      await saveRow(queueId, { payload: { ...(row.payload || {}), rewrite_status: 'not_started', rewrite_note: out.reason } }).catch(() => {});
    }
  } catch (e) {
    console.error('[draft-rewrite]', queueId, e);
  }
  return { statusCode: 202 };
}
