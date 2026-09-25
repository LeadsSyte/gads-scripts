// Autopilot — the monthly content run, done on the server so nobody has to
// have the suite open. Mirrors Auto Write step for step, using the same
// shared modules, so the articles match what a person would get:
//
//   research (Search Console) → topic plan → write each article →
//   relevance check (Claude) → independent check (a different AI) → save
//
// Saved articles land in syte_suite_content_blogs with tab 'Auto Write', so
// they show up in Content → Auto Write exactly like hand-run ones and can be
// pushed from there. Pushing from the server is the next stage.
//
// Everything that talks to the outside world is injected (`deps`), so the
// whole run is testable without network calls. Progress is kept in a state
// object the caller persists after every step: a background function can be
// cut off at its time limit and the next invocation carries on where it
// stopped, without redoing finished articles.

import { buildSystemPrompt, TAB_PROMPTS, clampLength } from '../../../src/modules/content/prompts.js';
import {
  summarizeResearch, emptyResearch, generateTopicRecommendations,
  buildArticleResearchContext, researchContextForClient
} from '../../../src/modules/content/topicResearchCore.js';
import { verifyArticleRelevance } from '../../../src/modules/content/articleRelevance.js';
import { parseArticleBody } from '../../../src/modules/cms/parseArticle.js';
import { parseScanBlock } from '../../../src/lib/brandScan.js';

export const STATE_PREFIX = 'autopilot:';
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

// Enough of the research to rebuild each article's ranking context later,
// without storing all 1000+ Search Console rows in the state.
function slimResearch(research, plan) {
  const keywords = new Set(plan.map(o => o.primary_keyword));
  const pageByQuery = {};
  for (const k of keywords) if (research.pageByQuery[k]) pageByQuery[k] = research.pageByQuery[k];
  return { days: research.days, queries: research.queries.slice(0, 300), pageByQuery };
}

export function newRunState(client, now = new Date()) {
  return {
    client_id: client.id,
    client_name: client.name,
    month: monthKey(now),
    status: 'queued',
    started_at: now.toISOString(),
    updated_at: now.toISOString(),
    finished_at: null,
    research_note: '',
    plan: null,
    research: null,
    articles: {},
    log: []
  };
}

function log(state, line, now) {
  state.log = [...(state.log || []), (now || new Date()).toISOString().slice(11, 19) + ' ' + line].slice(-40);
}

// ---------------------------------------------------------------------------
// Independent check — a second AI (not the one that wrote the article) reads
// it as an editor would before it goes on the client's site. Mike's ask: the
// machine should not be the only judge of its own work.
// ---------------------------------------------------------------------------

export const CHECKER_SYSTEM = `You are an independent editor at an SEO agency. Another AI wrote the blog article below for one of the agency's clients. It will be published on the client's own website. Decide whether it is fit to publish.

Return JSON only: {"verdict": "pass" | "fail", "problems": [{"severity": "error" | "warning", "issue": "one sentence"}], "summary": "one sentence"}

Mark an ERROR (and verdict "fail") for any of these:
- The article is not about something this business actually does, sells or serves according to the brand reference.
- It is centred on a place where the business does not operate or has no stated presence (e.g. a suburb or city not in its location / service area).
- It states facts about THIS business that the brand reference does not support: services, products, branches, prices, awards, years in business, certifications, contact details, guarantees.
- It contains leftover writing instructions, placeholders or labels meant for the writer: [brackets], "insert X", "TODO", "AEO Summary Block", "Meta Title:", word counts, notes to the editor.
- It presents a past year as the current year.
- It recommends or links to a competitor.

Mark a WARNING (verdict can still be "pass") for: weak or generic sections, repetition, claims about the industry in general that look shaky, tone that does not fit the audience.

Judge only what is written. Do not rewrite the article.`;

export function buildCheckerInput(client, output, opp) {
  const parsed = parseArticleBody(output || '');
  const scan = parseScanBlock(client.brand_docs);
  const reference = (scan?.block || client.brand_docs || '').trim();
  return `BUSINESS: ${client.name}
WEBSITE: ${client.url || '(none)'}
INDUSTRY: ${client.industry || '(none)'}
LOCATION / SERVICE AREA: ${client.location || '(none)'}
AUDIENCE: ${client.audience || '(none)'}
CURRENT YEAR: ${new Date().getFullYear()}

BRAND REFERENCE (from the business's own website — the only trusted source of facts about it):
${reference ? '"""\n' + reference.slice(0, 5000) + '\n"""' : '(none on file — be strict about any claim about the business itself)'}

REQUESTED TOPIC: ${opp.topic_title}
PRIMARY KEYWORD: ${opp.primary_keyword || ''}

ARTICLE TITLE: ${parsed.articleTitle || '(none)'}
META TITLE: ${parsed.metaTitle || '(none)'}
META DESCRIPTION: ${parsed.metaDesc || '(none)'}

ARTICLE BODY:
"""
${(parsed.body || output || '').slice(0, 24000)}
"""`;
}

export function normalizeCheck(raw) {
  const problems = Array.isArray(raw?.problems) ? raw.problems
    .filter(p => p && p.issue)
    .map(p => ({ severity: p.severity === 'error' ? 'error' : 'warning', issue: String(p.issue).slice(0, 300) })) : [];
  const hasError = problems.some(p => p.severity === 'error');
  // A "pass" with an error listed is a fail; an unreadable verdict is a fail.
  const verdict = raw?.verdict === 'pass' && !hasError ? 'pass' : 'fail';
  return { verdict, problems, summary: String(raw?.summary || '').slice(0, 300) };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

// deps:
//   complete(opts)            Claude, claudeComplete-shaped
//   fetchGsc(client)          → { queries, pageQueries }
//   checkArticle({system,user}) → raw checker JSON (independent AI)
//   existingTopics(client, month) → Set of lowercased topics already written this month
//   saveArticle(row)          → { id }
//   saveState(state)          persists the state
//   now()                     → Date (tests)
//   timeLeftMs()              → ms left before the function is cut off
export async function runAutopilotStep(client, state, deps) {
  const now = () => (deps.now ? deps.now() : new Date());
  // Each article is research-free but takes 1–3 minutes of AI calls; don't
  // start one that can't finish before the platform stops the function.
  const PER_ARTICLE_MS = 4 * 60 * 1000;
  const save = async () => { state.updated_at = now().toISOString(); await deps.saveState(state); };

  // 1. Research + topic plan, once per run.
  if (!state.plan) {
    state.status = 'researching';
    log(state, 'Researching topics', now());
    await save();
    let research;
    try {
      const { queries, pageQueries } = await deps.fetchGsc(client);
      research = summarizeResearch(queries, pageQueries, 90);
      log(state, 'Search Console: ' + research.allQueryCount + ' queries', now());
    } catch (e) {
      research = emptyResearch(90);
      state.research_note = 'Search Console unavailable (' + String(e.message || e).slice(0, 160) + '). Topics come from the client details only.';
      log(state, state.research_note, now());
    }
    const target = Math.max(1, Math.min(client.pages_per_month || 4, 50));
    const result = await generateTopicRecommendations(client, research, { targetArticles: target, complete: deps.complete });
    state.plan = (result.opportunities || []).slice().sort((a, b) => (a.priority || 99) - (b.priority || 99)).slice(0, target);
    state.research = slimResearch(research, state.plan);
    state.status = 'writing';
    log(state, 'Planned ' + state.plan.length + ' articles', now());
    await save();
  }

  // 2. Write + check each article not yet handled.
  const already = await deps.existingTopics(client, state.month);
  for (let idx = 0; idx < state.plan.length; idx++) {
    if (state.articles[idx]) continue;
    const opp = state.plan[idx];
    if (already.has((opp.topic_title || '').trim().toLowerCase())) {
      state.articles[idx] = { status: 'skipped', reason: 'Already written this month' };
      await save();
      continue;
    }
    if (deps.timeLeftMs && deps.timeLeftMs() < PER_ARTICLE_MS) {
      log(state, 'Pausing — continuing in a fresh run', now());
      await save();
      return { state, more: true };
    }

    log(state, 'Writing: ' + opp.topic_title, now());
    await save();
    try {
      const length = clampLength(opp.recommended_length);
      const ctx = researchContextForClient(buildArticleResearchContext(opp, state.research, client), client);
      const output = await deps.complete({
        system: buildSystemPrompt(client, '', ctx),
        messages: [{ role: 'user', content: TAB_PROMPTS['New Article'](opp.topic_title, opp.primary_keyword, length) }],
        max_tokens: 5000,
        temperature: 0.7
      });

      const rel = await verifyArticleRelevance({
        output, client, topic: opp.topic_title, keyword: opp.primary_keyword, complete: deps.complete
      });

      let check;
      try {
        check = normalizeCheck(await deps.checkArticle({ system: CHECKER_SYSTEM, user: buildCheckerInput(client, output, opp) }));
      } catch (e) {
        // A checker that could not run is not a pass.
        check = { verdict: 'fail', problems: [{ severity: 'error', issue: 'Independent check did not run: ' + String(e.message || e).slice(0, 200) }], summary: '' };
      }

      const saved = await deps.saveArticle({
        client_id: client.id,
        client_name: client.name,
        tab: 'Auto Write',
        topic: opp.topic_title,
        keyword: opp.primary_keyword,
        length,
        output,
        opportunity_type: opp.opportunity_type,
        generated_at: now().toISOString()
      });

      const blocked = rel.verdict === 'mismatch' || check.verdict === 'fail';
      state.articles[idx] = {
        status: blocked ? 'blocked' : 'ready',
        blog_id: saved?.id || null,
        words: Math.round((output || '').split(/\s+/).length),
        relevance: { verdict: rel.verdict, detail: (rel.findings || []).filter(f => !f.ok).map(f => f.detail).slice(0, 3) },
        check
      };
      log(state, (blocked ? 'Held back: ' : 'Ready: ') + opp.topic_title, now());
    } catch (e) {
      state.articles[idx] = { status: 'failed', error: String(e.message || e).slice(0, 300) };
      log(state, 'Failed: ' + opp.topic_title + ' — ' + state.articles[idx].error, now());
    }
    await save();
  }

  state.status = 'done';
  state.finished_at = now().toISOString();
  log(state, 'Run complete', now());
  await save();
  return { state, more: false };
}

export function summarizeRun(state) {
  const out = { ready: 0, blocked: 0, failed: 0, skipped: 0, pending: 0 };
  const total = state?.plan?.length || 0;
  for (let i = 0; i < total; i++) {
    const a = state.articles?.[i];
    if (!a) out.pending++;
    else out[a.status] = (out[a.status] || 0) + 1;
  }
  return { ...out, total };
}
