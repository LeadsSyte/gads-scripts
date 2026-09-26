// Tech Autopilot — the monthly Technical SEO scan, run on the server:
//
//   crawl the site → (+ Search Console) → Claude writes the fix list (the
//   same triage the Technical SEO page uses) → an INDEPENDENT reviewer (a
//   different AI) checks every fix against the live page → confirmed fixes
//   go on the task board; false alarms are dropped and reported.
//
// The independent check is Chris's ask: the scanner sometimes flags things
// that aren't problems (a page that is meant to be noindex, a robots.txt that
// already allows crawling), and a fix that isn't needed must not be briefed
// or applied. Every outside call is injected (`deps`) so it's testable.

import { parseHTML } from 'linkedom';
import { crawlSiteForIssues, summarizeCrawlForAI } from '../../../src/modules/technical/crawler.js';
import { triageWithoutRepeats, taskDedupKey, DEFAULT_SUGGESTIONS, MAX_TASKS_PER_CLIENT } from '../../../src/modules/technical/triage.js';
import { completedWorkForClient } from '../../../src/modules/technical/taskHistory.js';

export const TECH_STATE_PREFIX = 'techscan:';

// The crawler parses pages with DOMParser; linkedom provides it under Node.
export function installDomParser() {
  if (globalThis.DOMParser) return;
  globalThis.DOMParser = class { parseFromString(html) { return parseHTML(html).document; } };
}

export function newTechState(client, now = new Date()) {
  return {
    client_id: client.id, client_name: client.name, month: now.toISOString().slice(0, 7),
    status: 'queued', started_at: now.toISOString(), updated_at: now.toISOString(), finished_at: null,
    crawl: null, tasks: null, log: []
  };
}

function log(state, line, now) {
  state.log = [...(state.log || []), (now || new Date()).toISOString().slice(11, 19) + ' ' + line].slice(-40);
}

// ---------------------------------------------------------------------------
// Evidence: what is actually on the live page, extracted in code so the
// reviewer judges facts rather than a 40k-character HTML dump.
// ---------------------------------------------------------------------------
export function pageEvidence(html) {
  installDomParser();
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const txt = n => (n?.textContent || '').replace(/\s+/g, ' ').trim();
  const attr = (sel, a) => doc.querySelector(sel)?.getAttribute(a)?.trim() || '';
  const imgs = [...doc.querySelectorAll('img')];
  const body = txt(doc.querySelector('body'));
  let jsonLdTypes = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent || '{}');
      const items = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j];
      jsonLdTypes.push(...items.map(i => [].concat(i['@type'] || []).join('/')).filter(Boolean));
    } catch { jsonLdTypes.push('(unparseable JSON-LD)'); }
  }
  return {
    title: txt(doc.querySelector('title')),
    meta_description: attr('meta[name="description"]', 'content'),
    meta_robots: attr('meta[name="robots"]', 'content'),
    canonical: attr('link[rel="canonical"]', 'href'),
    h1: [...doc.querySelectorAll('h1')].map(txt).filter(Boolean).slice(0, 5),
    og_title: attr('meta[property="og:title"]', 'content'),
    viewport: attr('meta[name="viewport"]', 'content'),
    images_total: imgs.length,
    images_missing_alt: imgs.filter(i => !(i.getAttribute('alt') || '').trim())
      .map(i => i.getAttribute('src') || i.getAttribute('data-src') || '').filter(Boolean).slice(0, 10),
    json_ld_types: [...new Set(jsonLdTypes)].slice(0, 12),
    word_count: body ? body.split(/\s+/).length : 0
  };
}

const NEEDS_ROBOTS = /robots|noindex|index|crawl|sitemap|canonical/i;
export function needsRobotsTxt(task) {
  return NEEDS_ROBOTS.test((task.fix_type || '') + ' ' + (task.title || '') + ' ' + (task.description || ''));
}

export const TECH_CHECK_SYSTEM = `You are an independent technical SEO reviewer at an agency. Another AI read a site crawl and proposed the fix below. Before anyone briefs or applies it, decide whether it is right, using the EVIDENCE — what is actually on the live page now (and the live robots.txt when given). Do not trust the proposal's description of the page; trust the evidence.

Return JSON only: {"verdict": "confirmed" | "false_alarm" | "fix_wrong" | "needs_human", "reason": "one or two sentences a non-technical account manager understands"}

- "confirmed": the problem really is on the page now AND the proposed fix is correct, complete (no placeholders like [PRODUCT_NAME]) and safe.
- "false_alarm": the problem is not there, or it is deliberate. Examples: the element the task says is missing is present in the evidence; a noindex on a thank-you, cart, checkout, account, login, search or tag/archive page (those SHOULD be noindex); robots.txt already allows the page; a title/description length that is already within normal range.
- "fix_wrong": the problem is real but the proposed fix is wrong or unsafe — it contains placeholders, targets the wrong page or element, would noindex/redirect/canonicalise something that should stay, invents facts about the business, or is malformed code.
- "needs_human": the evidence cannot settle it (e.g. page speed, server config, admin-console work, or the page could not be fetched).

Be strict: a fix that is not clearly needed must not be confirmed.`;

export function buildTechCheckInput(client, task, evidence, robotsTxt) {
  return `BUSINESS: ${client.name} (${client.url || ''})

PROPOSED TASK
Title: ${task.title || ''}
Page: ${task.page_url || ''}
Fix type: ${task.fix_type || ''}
Why (proposer): ${task.description || ''}
Proposed fix:
"""
${String(task.copy_paste_fix || '').slice(0, 4000)}
"""

EVIDENCE — live page now:
${evidence ? JSON.stringify(evidence, null, 2) : '(the page could not be fetched)'}
${robotsTxt !== undefined ? '\nEVIDENCE — live robots.txt:\n"""\n' + String(robotsTxt || '(none / not reachable)').slice(0, 3000) + '\n"""' : ''}`;
}

export function normalizeTechCheck(raw) {
  const allowed = ['confirmed', 'false_alarm', 'fix_wrong', 'needs_human'];
  const verdict = allowed.includes(raw?.verdict) ? raw.verdict : 'needs_human';
  return { verdict, reason: String(raw?.reason || (verdict === 'needs_human' ? 'The reviewer gave no usable answer.' : '')).slice(0, 400) };
}

const CHECK_LABEL = {
  confirmed: '✓ Independent check: confirmed',
  fix_wrong: '⚠ Independent check: the fix itself looks wrong — review before briefing',
  needs_human: '? Independent check: needs a human look'
};

// ---------------------------------------------------------------------------
// The run
// deps:
//   crawl(client)                  → crawlSiteForIssues result
//   gscPages(client)               → rows | null   (optional enrichment)
//   complete(opts)                 Claude (claudeComplete-shaped)
//   checkTask({system, user})      → raw reviewer JSON (independent AI)
//   fetchHtml(url)                 → live HTML ('' if unreachable)
//   fetchText(url)                 → text ('' if unreachable) — robots.txt
//   loadHistory(client)            → { tasks, impls, rejectedKeys:Set }
//   saveTasks(client, tasks)       replaces this client's OPEN tasks
//   saveState(state), now(), timeLeftMs()
// ---------------------------------------------------------------------------
export async function runTechScan(client, state, deps, { limit = DEFAULT_SUGGESTIONS } = {}) {
  const now = () => (deps.now ? deps.now() : new Date());
  const save = async () => { state.updated_at = now().toISOString(); await deps.saveState(state); };
  const PER_CHECK_MS = 60 * 1000;

  // 1–2. Crawl and triage, once per run.
  if (!state.tasks) {
    state.status = 'scanning';
    log(state, 'Crawling the site', now());
    await save();
    let auditData = '';
    try {
      const crawl = await deps.crawl(client);
      auditData = summarizeCrawlForAI(crawl);
      state.crawl = { pages: crawl.totalCrawled, with_issues: crawl.withIssues, unreachable: crawl.withErrors, source: crawl.discoverySource || '' };
      log(state, 'Crawled ' + crawl.totalCrawled + ' pages, ' + crawl.withIssues + ' with issues', now());
    } catch (e) {
      log(state, 'Crawl failed: ' + String(e.message || e).slice(0, 160), now());
    }
    try {
      const gsc = deps.gscPages ? await deps.gscPages(client) : null;
      if (gsc?.length) auditData += '\n\n=== GSC TRAFFIC DATA (last 28 days) ===\n' + JSON.stringify(gsc).slice(0, 20000);
    } catch { /* optional */ }
    if (!auditData.trim()) throw new Error('Could not crawl ' + (client.url || 'the site') + ' — check the website / sitemap URL.');

    state.status = 'triaging';
    log(state, 'Writing the fix list', now());
    await save();
    const history = await deps.loadHistory(client);
    const completedByPage = completedWorkForClient({ tasks: history.tasks, impls: history.impls, clientId: client.id });
    const { tasks: triaged, removed } = await triageWithoutRepeats(auditData, client.url, limit, completedByPage, { complete: deps.complete });
    const cap = Math.min(limit, MAX_TASKS_PER_CLIENT);
    state.repeats_skipped = removed;
    state.tasks = triaged
      .map(t => ({ ...t, client_id: client.id }))
      .filter(t => !history.rejectedKeys?.has(client.id + '|' + taskDedupKey(t)))
      .slice(0, cap)
      .map(t => ({ task: t, check: null }));
    log(state, 'Proposed ' + state.tasks.length + ' fixes' + (removed ? ' (' + removed + ' repeats of done work skipped)' : ''), now());
    await save();
  }

  // 3. Independent check of every proposed fix against the live page.
  state.status = 'checking';
  const htmlCache = new Map();
  let robots;
  for (const entry of state.tasks) {
    if (entry.check) continue;
    if (deps.timeLeftMs && deps.timeLeftMs() < PER_CHECK_MS) {
      log(state, 'Pausing — checks continue in a fresh run', now());
      await save();
      return { state, more: true };
    }
    const t = entry.task;
    try {
      if (!htmlCache.has(t.page_url)) htmlCache.set(t.page_url, t.page_url ? await deps.fetchHtml(t.page_url) : '');
      const html = htmlCache.get(t.page_url);
      let robotsTxt;
      if (needsRobotsTxt(t)) {
        if (robots === undefined) {
          try { robots = await deps.fetchText(new URL('/robots.txt', client.url).href); } catch { robots = ''; }
        }
        robotsTxt = robots;
      }
      const evidence = html && html.length > 200 ? pageEvidence(html) : null;
      entry.check = normalizeTechCheck(await deps.checkTask({ system: TECH_CHECK_SYSTEM, user: buildTechCheckInput(client, t, evidence, robotsTxt) }));
    } catch (e) {
      entry.check = { verdict: 'needs_human', reason: 'The check could not run: ' + String(e.message || e).slice(0, 200) };
    }
    log(state, entry.check.verdict + ': ' + (t.title || ''), now());
    await save();
  }

  // 4. Board: everything except false alarms, each labelled with its check.
  const stamp = now().toISOString();
  const board = state.tasks
    .filter(e => e.check?.verdict !== 'false_alarm')
    .map(e => ({
      ...e.task,
      id: e.task.id || globalThis.crypto.randomUUID(),
      client_name: client.name,
      status: 'open',
      assignee: '',
      data_source: 'Tech Autopilot (crawler, independently checked)',
      created_at: stamp,
      description: (e.task.description || '') + '\n\n' + CHECK_LABEL[e.check.verdict] + ' — ' + e.check.reason
    }));
  for (const e of state.tasks) {
    const b = board.find(x => x.title === e.task.title && x.page_url === e.task.page_url);
    if (b) e.task.id = b.id;
  }
  state.status = 'saving';
  await save();
  await deps.saveTasks(client, board);

  state.status = 'done';
  state.finished_at = now().toISOString();
  log(state, 'Board updated: ' + board.length + ' fixes', now());
  await save();
  return { state, more: false };
}

export function summarizeTechRun(state) {
  const out = { confirmed: 0, false_alarm: 0, fix_wrong: 0, needs_human: 0, pending: 0, total: 0 };
  for (const e of state?.tasks || []) { out.total++; out[e.check?.verdict || 'pending']++; }
  return out;
}

// Real crawler, for the background function.
export function realCrawl(maxPages) {
  return client => { installDomParser(); return crawlSiteForIssues(client, { maxPages }); };
}
