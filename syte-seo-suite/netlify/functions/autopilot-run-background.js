// Autopilot run for ONE client — a Netlify background function (the
// "-background" suffix gives it ~15 minutes and returns 202 immediately).
//
// POST { clientId, restart? }  with header X-Suite-Auth (same gate as wp-proxy)
//
// Writes this month's articles for the client (see lib/autopilot.js). If it
// runs short of time it calls itself again and the next run carries on from
// the saved state. Articles are saved as Auto Write articles; nothing is
// pushed to a client's site by this function.

import { runAutopilotStep, newRunState, monthKey, CHECKER_SYSTEM, buildCheckerInput, normalizeCheck } from './lib/autopilot.js';
import { claudeCompleteServer, openaiJson } from './lib/serverAi.js';
import { getServerSupabase } from './lib/serverSupabase.js';
import { fetchGscForClient } from './lib/serverGsc.js';
import { loadClient, loadRunState, saveRunState, existingTopics, saveArticle, saveClientFields } from './lib/autopilotStore.js';
import { scanBrandFromWebsite } from '../../src/lib/brandScan.js';
import { fetchHtmlServer, htmlToTextServer, findAboutUrlServer } from './lib/serverBrandScan.js';
import { prepareServerPush, canPushTo, pushArticleServer, loadArticleOutput, pushedTitles } from './lib/serverPush.js';
import { getPublishingProfile } from '../../src/modules/cms/publishingProfile.js';
import { reportRecipients, sendReport, buildRunSummaryEmail } from './lib/reportEmail.js';
import { previewUrl } from './lib/previewSig.js';

const BUDGET_MS = 14 * 60 * 1000;
const MAX_HOPS = 12;           // self re-invocations per run — a runaway guard
const STALE_MS = 20 * 60 * 1000; // a "running" state older than this is dead

export async function handler(event) {
  // Fail closed: this spends API money, so it never runs without the gate.
  const required = process.env.WP_PROXY_AUTH;
  const given = event.headers['x-suite-auth'] || event.headers['X-Suite-Auth'] || '';
  if (!required || given !== required) {
    console.error('[autopilot] unauthorized call');
    return { statusCode: 401 };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400 }; }
  const { clientId, restart = false, hop = 0 } = body;
  if (!clientId) return { statusCode: 400 };

  const started = Date.now();
  const supabase = getServerSupabase();

  // Review-only mode: run the independent reviewer on supplied articles and
  // save the verdicts to syte_suite_settings 'autopilot-review:<reviewId>'.
  // Used to prove the reviewer rejects bad articles, and to review articles
  // written outside the Autopilot.
  if (body.mode === 'review') {
    const reviewId = String(body.reviewId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    if (!reviewId || !Array.isArray(body.articles)) return { statusCode: 400 };
    const results = [];
    try {
      const client = await loadClient(supabase, clientId);
      for (const a of body.articles.slice(0, 10)) {
        const opp = { topic_title: String(a.topic || ''), primary_keyword: String(a.keyword || '') };
        let check;
        try { check = normalizeCheck(await openaiJson({ system: CHECKER_SYSTEM, user: buildCheckerInput(client, String(a.output || ''), opp) })); }
        catch (e) { check = { verdict: 'fail', problems: [{ severity: 'error', issue: 'Review did not run: ' + e.message }], summary: '' }; }
        results.push({ label: String(a.label || opp.topic_title).slice(0, 120), ...check });
      }
    } catch (e) {
      results.push({ label: 'error', verdict: 'fail', problems: [{ severity: 'error', issue: e.message }], summary: '' });
    }
    await supabase.from('syte_suite_settings').upsert({
      id: 'autopilot-review:' + reviewId,
      data: { client_id: clientId, at: new Date().toISOString(), results },
      updated_at: new Date().toISOString()
    });
    return { statusCode: 202 };
  }
  const pushOnly = body.mode === 'push';
  let state = null;
  try {
    const client = await loadClient(supabase, clientId);
    state = await loadRunState(supabase, clientId);

    const running = state && ['queued', 'researching', 'writing', 'pushing'].includes(state.status);
    const fresh = state && Date.now() - new Date(state.updated_at).getTime() < STALE_MS;
    if (hop === 0 && running && fresh) {
      console.log('[autopilot] run already in progress for', client.name);
      return { statusCode: 202 };
    }
    if (pushOnly) {
      // "Push ready articles" from the panel: only this month's finished run.
      if (!state || state.month !== monthKey() || !state.plan) {
        console.log('[autopilot] nothing to push for', client.name);
        return { statusCode: 202 };
      }
    } else if (!state || state.month !== monthKey() || (hop === 0 && (restart || state.status === 'failed'))) {
      state = newRunState(client);
    } else if (hop === 0 && state.status === 'done') {
      console.log('[autopilot] already done this month for', client.name);
      return { statusCode: 202 };
    }
    state.hops = hop;
    state.error = null;
    await saveRunState(supabase, state);

    // Pushing is per client: publishing_profile.autopilot_push, or an
    // explicit "Push ready articles" click. Drafts only, and only to a
    // connected WordPress / Shopify site.
    const wantPush = pushOnly || getPublishingProfile(client).autopilot_push;
    let pushDeps = {};
    if (wantPush && canPushTo(client)) {
      prepareServerPush();
      pushDeps = {
        pushArticle: a => pushArticleServer(supabase, client, a),
        loadOutput: id => loadArticleOutput(supabase, id),
        pushedTitles: () => pushedTitles(supabase, client.id)
      };
    } else if (wantPush) {
      state.push_note = 'Not pushed: ' + client.name + ' has no working WordPress or Shopify connection. The articles are in Auto Write.';
    }

    const { more } = await runAutopilotStep(client, state, {
      ...pushDeps,
      complete: claudeCompleteServer,
      checkArticle: ({ system, user }) => openaiJson({ system, user }),
      fetchGsc: c => fetchGscForClient(supabase, c),
      existingTopics: (c, m) => existingTopics(supabase, c, m),
      saveArticle: row => saveArticle(supabase, row),
      saveState: s => saveRunState(supabase, s),
      scanBrand: c => scanBrandFromWebsite(c, {
        fetchHtml: fetchHtmlServer, toText: htmlToTextServer, aboutUrlOf: findAboutUrlServer, complete: claudeCompleteServer
      }),
      saveClientFields: (id, fields) => saveClientFields(supabase, id, fields),
      timeLeftMs: () => BUDGET_MS - (Date.now() - started)
    });

    if (!more) await emailRunSummary(supabase, client, state);
    if (more) {
      if (hop + 1 > MAX_HOPS) throw new Error('Stopped after ' + MAX_HOPS + ' continuations');
      const base = process.env.URL || 'https://syte-seo-suite.netlify.app';
      await fetch(base + '/.netlify/functions/autopilot-run-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suite-Auth': required },
        body: JSON.stringify({ clientId, hop: hop + 1, mode: pushOnly ? 'push' : undefined })
      });
    }
  } catch (e) {
    console.error('[autopilot] run failed:', e.message);
    if (state) {
      state.status = 'failed';
      state.error = String(e.message || e).slice(0, 400);
      state.updated_at = new Date().toISOString();
      try { await saveRunState(supabase, state); } catch { /* nothing more to do */ }
      try { await emailRunSummary(supabase, { id: clientId, name: state.client_name || 'Client' }, state); } catch { /* recorded below */ }
    }
  }
  return { statusCode: 202 };
}

// Team email when a run ends (finished or failed). Never fails the run; the
// outcome is kept on the state so the panel can say whether it went out.
async function emailRunSummary(supabase, client, state) {
  try {
    const to = await reportRecipients(supabase);
    if (!to.length) return;
    const siteUrl = (process.env.URL || 'https://syte-seo-suite.netlify.app').replace(/\/+$/, '');
    const canPreview = client.cms_type ? canPushTo(client) : false;
    const previewFor = a => !canPreview ? ''
      : a.push?.queue_id ? previewUrl('q', a.push.queue_id)
      : a.blog_id ? previewUrl('a', a.blog_id) : '';
    await sendReport({ to, ...buildRunSummaryEmail(client, state, siteUrl, previewFor) });
    state.report = { sent_at: new Date().toISOString(), to };
  } catch (e) {
    state.report = { error: String(e.message || e).slice(0, 200) };
  }
  try { await saveRunState(supabase, state); } catch { /* best effort */ }
}
