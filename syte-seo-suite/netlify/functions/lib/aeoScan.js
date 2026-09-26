// AEO Autopilot — the monthly AEO optimisation run, on the server:
//
//   find the site's pages → rank by Search Console clicks, never-optimised
//   first → generate each page's optimisations (same prompt and rules as the
//   AEO Engine page, src/modules/aeo/aeoRun.js) → keep the best site-wide
//   shortlist → an INDEPENDENT reviewer (a different AI) checks every item
//   against the live page → save to the AEO Engine; false alarms dropped.
//
// Nothing is changed on the client's site. Every outside call is injected.

import { parseHTML } from 'linkedom';
import { prioritizePages, coveredPagesFrom, rotateQueue, runShortlist, generateForPage } from '../../../src/modules/aeo/aeoRun.js';
import { aeoItemTarget, pagesForTarget } from '../../../src/modules/aeo/aeoSelect.js';
import { priorWorkForClient, priorLabelsForPage, nextPriorKeys } from '../../../src/modules/aeo/aeoHistory.js';
import { MAX_OPTS_PER_PAGE } from '../../../src/modules/aeo/aeoTypes.js';
import { parseScanBlock } from '../../../src/lib/brandScan.js';

export const AEO_STATE_PREFIX = 'aeoscan:';

export function newAeoState(client, now = new Date()) {
  return {
    client_id: client.id, client_name: client.name, month: now.toISOString().slice(0, 7),
    status: 'queued', started_at: now.toISOString(), updated_at: now.toISOString(), finished_at: null,
    plan: null, progress: null, rows: null, log: []
  };
}

function log(state, line, now) {
  state.log = [...(state.log || []), (now || new Date()).toISOString().slice(11, 19) + ' ' + line].slice(-40);
}

// What the page already has — so the reviewer can tell "missing" from
// "already there" (an FAQ section, FAQ schema, a summary box…).
export function aeoPageEvidence(html) {
  const { document: doc } = parseHTML(String(html || '<html></html>'));
  const txt = n => (n?.textContent || '').replace(/\s+/g, ' ').trim();
  const clone = doc.querySelector('main') || doc.querySelector('article') || doc.querySelector('body');
  for (const n of clone ? clone.querySelectorAll('script,style,noscript,nav,footer,header,form') : []) n.remove?.();
  const text = txt(clone);
  const jsonLd = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent || '{}');
      const items = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j];
      jsonLd.push(...items.map(i => [].concat(i['@type'] || []).join('/')).filter(Boolean));
    } catch { jsonLd.push('(unparseable JSON-LD)'); }
  }
  return {
    title: txt(doc.querySelector('title')),
    headings: [...doc.querySelectorAll('h1,h2,h3')].map(h => h.tagName.toLowerCase() + ': ' + txt(h)).filter(h => h.length > 4).slice(0, 40),
    has_faq_heading: [...doc.querySelectorAll('h2,h3,h4')].some(h => /faq|frequently asked|questions/i.test(txt(h))),
    json_ld_types: [...new Set(jsonLd)].slice(0, 15),
    word_count: text ? text.split(/\s+/).length : 0,
    text_excerpt: text.slice(0, 5000)
  };
}

export const AEO_CHECK_SYSTEM = `You are an independent reviewer at an SEO agency. Another AI suggested the AEO optimisation below for one page of a client's website — something to add so AI search engines (ChatGPT, Gemini, Perplexity) can quote the page. Before it is handed over or published, decide if it is right, using the EVIDENCE (what is on the live page now) and the BRAND REFERENCE (the client's own website).

Return JSON only: {"verdict": "confirmed" | "false_alarm" | "fix_wrong" | "needs_human", "reason": "one or two sentences an account manager understands"}

- "confirmed": the page genuinely lacks this, it fits the page's topic, every fact in it is supported by the page or the brand reference, and the code/markup is complete (no placeholders like [NAME] or example.com) and valid.
- "false_alarm": the page already has it (e.g. an FAQ section or FAQPage schema already exists, the answer is already given near the top), or it adds nothing for this page.
- "fix_wrong": it would mislead or break something — it states facts about THIS business the evidence doesn't support (prices, years, awards, services, locations, stats presented as the business's own), answers questions the page isn't about, contains placeholders, or the schema is invalid / doesn't match the visible content (Google penalises schema that describes content not on the page).
- "needs_human": the evidence can't settle it (e.g. the page couldn't be fetched).

Be strict: an optimisation that isn't clearly needed and correct must not be confirmed.`;

export function buildAeoCheckInput(client, pageUrl, opt, evidence, today = new Date()) {
  const scan = parseScanBlock(client.brand_docs);
  const reference = (scan?.block || client.brand_docs || '').trim();
  // The reviewer's training ends before "now": without today's date it
  // flagged the current month as a future date.
  return `TODAY: ${today.toISOString().slice(0, 10)} (dates up to today are not in the future)
BUSINESS: ${client.name} (${client.url || ''}) · ${client.industry || ''} · ${client.location || ''}

BRAND REFERENCE:
${reference ? '"""\n' + reference.slice(0, 3500) + '\n"""' : '(none on file)'}

PAGE: ${pageUrl}

SUGGESTED OPTIMISATION
Type: ${opt.type || ''} · ${opt.name || ''}
Why: ${opt.description || ''}
Where: ${opt.where || ''}
Content / code:
"""
${String(opt.implementation || opt.code || '').slice(0, 6000)}
"""

EVIDENCE — live page now:
${evidence ? JSON.stringify(evidence, null, 2) : '(the page could not be fetched)'}`;
}

export function normalizeAeoCheck(raw) {
  const allowed = ['confirmed', 'false_alarm', 'fix_wrong', 'needs_human'];
  const verdict = allowed.includes(raw?.verdict) ? raw.verdict : 'needs_human';
  return { verdict, reason: String(raw?.reason || (verdict === 'needs_human' ? 'The reviewer gave no usable answer.' : '')).slice(0, 400) };
}

// deps:
//   discover(client)         → { urls, source }
//   trafficRows(client)      → [{ path, sessions }] (Search Console clicks) | []
//   loadPrior(client)        → { results: rows[], impls: [], rejectionsByPage: Map }
//   complete(opts)           Claude
//   fetchHtml(url)           → live HTML ('' when unreachable)
//   checkOpt({system, user}) → raw reviewer JSON (independent AI)
//   saveRow(row, existing)   upsert into syte_suite_aeo_results
//   saveState, now, timeLeftMs
export async function runAeoScan(client, state, deps) {
  const now = () => (deps.now ? deps.now() : new Date());
  const save = async () => { state.updated_at = now().toISOString(); await deps.saveState(state); };
  const minLeft = ms => deps.timeLeftMs && deps.timeLeftMs() < ms;
  const prior = await deps.loadPrior(client);
  const priorByPage = priorWorkForClient({ results: prior.results, impls: prior.impls, rejectionsByPage: prior.rejectionsByPage, clientId: client.id });

  // 1. Choose pages, once per run.
  if (!state.plan) {
    state.status = 'discovering';
    log(state, 'Finding the site\'s pages', now());
    await save();
    const discovery = await deps.discover(client);
    if (!discovery.urls?.length) throw new Error('No pages found for ' + (client.url || client.name) + ' — check the website / sitemap URL.');
    let traffic = [];
    try { traffic = (await deps.trafficRows(client)) || []; } catch { /* optional */ }
    const queue = rotateQueue(prioritizePages(discovery.urls, traffic, client.url), coveredPagesFrom(prior.results, client.id));
    const itemTarget = aeoItemTarget(client);
    const maxPages = Math.min(pagesForTarget(itemTarget, queue.length), client.pages_per_month || 15);
    const pageCeiling = Math.min(queue.length, maxPages * 3, 24);
    state.plan = { itemTarget, maxPages, pageCeiling, found: discovery.urls.length, source: discovery.source || '', queue: queue.slice(0, pageCeiling) };
    log(state, discovery.urls.length + ' pages found; optimising up to ' + maxPages + ' for the best ' + itemTarget + ' items', now());
    await save();
  }

  // 2. Generate (resumable between batches).
  if (!state.rows) {
    state.status = 'generating';
    await save();
    const { plan } = state;
    const r = await runShortlist({
      queue: plan.queue, clientId: client.id, itemTarget: plan.itemTarget, maxPages: plan.maxPages, pageCeiling: plan.pageCeiling,
      priorByPage, progress: state.progress,
      generate: t => generateForPage(t.url, client, MAX_OPTS_PER_PAGE, plan.itemTarget, priorLabelsForPage(priorByPage, t.url),
        { complete: deps.complete, fetchHtml: deps.fetchHtml }),
      onBatch: (i, batch) => log(state, 'Optimising pages ' + (i + 1) + '–' + (i + batch.length), now()),
      afterBatch: async p => { state.progress = p; await save(); },
      shouldPause: () => minLeft(4 * 60 * 1000)
    });
    state.progress = r.progress;
    if (r.paused) { log(state, 'Pausing — continuing in a fresh run', now()); await save(); return { state, more: true }; }
    state.repeats_skipped = r.deduped.removed;
    state.rows = r.shortlist.rows
      .filter(row => (row.optimizations || []).length)
      .map(row => ({ ...row, optimizations: row.optimizations.map(o => ({ ...o, check: null })) }));
    state.progress = null; // drafts no longer needed; keeps the state small
    log(state, r.shortlist.kept + ' optimisations shortlisted across ' + state.rows.length + ' pages', now());
    await save();
  }

  // 3. Independent check of every shortlisted item against its live page.
  state.status = 'checking';
  const evidenceCache = new Map();
  for (const row of state.rows) {
    for (const opt of row.optimizations) {
      if (opt.check) continue;
      if (minLeft(60 * 1000)) { log(state, 'Pausing — checks continue in a fresh run', now()); await save(); return { state, more: true }; }
      try {
        if (!evidenceCache.has(row.url)) {
          const html = await deps.fetchHtml(row.url);
          evidenceCache.set(row.url, html && html.length > 200 ? aeoPageEvidence(html) : null);
        }
        opt.check = normalizeAeoCheck(await deps.checkOpt({ system: AEO_CHECK_SYSTEM, user: buildAeoCheckInput(client, row.url, opt, evidenceCache.get(row.url)) }));
      } catch (e) {
        opt.check = { verdict: 'needs_human', reason: 'The check could not run: ' + String(e.message || e).slice(0, 200) };
      }
      log(state, opt.check.verdict + ': ' + (opt.name || opt.type), now());
      await save();
    }
  }

  // 4. Save to the AEO Engine — false alarms dropped, the rest carry their check.
  state.status = 'saving';
  await save();
  const stamp = now().toISOString();
  for (const row of state.rows) {
    const kept = row.optimizations.filter(o => o.check?.verdict !== 'false_alarm');
    if (!kept.length) continue;
    const existing = (prior.results || []).find(r => r.client_id === client.id && r.url === row.url) || null;
    await deps.saveRow({
      client_id: client.id, url: row.url, path: row.path, sessions: row.sessions || 0, priority: row.priority,
      optimizations: kept, error: null, generated_at: stamp, prior_keys: nextPriorKeys(existing, kept)
    }, existing);
  }
  state.status = 'done';
  state.finished_at = now().toISOString();
  log(state, 'Saved to the AEO Engine', now());
  await save();
  return { state, more: false };
}

export function summarizeAeoRun(state) {
  const out = { confirmed: 0, false_alarm: 0, fix_wrong: 0, needs_human: 0, pending: 0, total: 0, pages: (state?.rows || []).length };
  for (const row of state?.rows || []) for (const o of row.optimizations || []) { out.total++; out[o.check?.verdict || 'pending']++; }
  return out;
}
