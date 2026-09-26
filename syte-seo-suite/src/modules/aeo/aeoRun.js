// The AEO optimisation run, shared by the AEO Engine page (browser) and the
// server-side AEO Autopilot (netlify/functions/lib/aeoScan.js): pick pages
// (traffic first, never-optimised before revisits), generate each page's
// optimisations, drop repeats of work already delivered, and keep the best
// site-wide shortlist. The Claude call and the page fetch are injected.

import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { corsFetchText } from '../../lib/corsProxy.js';
import { buildAeoSystem, MAX_OPTS_PER_PAGE } from './aeoTypes.js';
import { selectTopOptimizations } from './aeoSelect.js';
import { filterRepeatOptimizations } from './aeoHistory.js';

export const BATCH_SIZE = 3;

// Identity of a page for coverage tracking — ignores the trailing-slash and
// www differences that would otherwise make the same page look never-visited.
export function pageKey(url) {
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return u.hostname.replace(/^www\./, '') + path.toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

// `perPage` is the cap for THIS page — deliberately small, because the run
// ranks every page's output into one site-wide shortlist afterwards.
// `total` is that shortlist size, passed into the prompt so Claude knows
// it is competing for slots rather than filling a quota.
export async function generateForPage(pageUrl, client, perPage = MAX_OPTS_PER_PAGE, total = undefined, alreadyDone = [],
  { complete = claudeComplete, fetchHtml = corsFetchText } = {}) {
  // Try to fetch the actual page HTML for analysis.
  let pageHtml = '';
  let pageTitle = '';
  try {
    pageHtml = String(await fetchHtml(pageUrl) || '').slice(0, 60000);
    // Extract the <title> tag for context.
    const titleMatch = pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) pageTitle = titleMatch[1].trim();
  } catch {
    // CORS blocked — that's fine, Claude will work from the URL alone.
  }

  // Extract the page slug for topic inference when HTML isn't available.
  let slug = '';
  try { slug = new URL(pageUrl).pathname.split('/').filter(Boolean).pop() || ''; } catch {}
  const inferredTopic = pageTitle || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Everything this page has already been given in an earlier run, been
  // marked implemented, or had rejected. Naming it in the prompt is what
  // makes the model spend the page's slots on gaps it has not filled yet;
  // filterRepeatOptimizations afterwards is the guarantee.
  const doneList = (alreadyDone || []).filter(Boolean);
  const alreadyDoneBlock = doneList.length
    ? 'ALREADY DELIVERED FOR THIS PAGE — DO NOT SUGGEST ANY OF THESE AGAIN, in any wording:\n' +
      doneList.map(d => '- ' + d).join('\n') +
      '\n\nThese were handed to the client in earlier months. Suggest only work that is genuinely NEW for this page. ' +
      'If the page has no remaining gaps worth a slot, return an empty optimizations array — that is a correct answer, ' +
      'and far better than restating work already done.\n\n'
    : '';

  const text = await complete({
    system: buildAeoSystem(perPage, total),
    messages: [{
      role: 'user',
      content: `${alreadyDoneBlock}Generate AEO optimizations for this page — at most ${perPage}, and only the ones this page genuinely lacks. Focus on CONTENT optimizations first (answer blocks, FAQs, key takeaways, snippet paragraphs), then schema.

Page URL: ${pageUrl}
Page topic: ${inferredTopic}
Client: ${client?.name || ''}
Industry: ${client?.industry || ''}
Location: ${client?.location || ''}
Organization: ${client?.org_name || client?.name || ''}
Author: ${client?.author || ''} ${client?.author_creds ? '(' + client.author_creds + ')' : ''}
${client?.context ? 'Business context: ' + client.context : ''}

${pageHtml ? 'Page HTML (truncated — TWO uses: (1) analyse what content optimizations are MISSING; (2) READ the CSS classes, heading patterns, container structure, and component conventions so your output matches this page\'s design system. The optimization will be pasted into THIS page — make it look native, not bolted-on. Reuse the page\'s class names verbatim wherever they fit. See DESIGN-MATCHING in the system prompt.):\n' + pageHtml : 'Page HTML not available (CORS blocked) — generate optimizations based on the URL, topic, and client context. Focus on content that would make this page citable by AI engines. Use simple semantic HTML without inline styles since we cannot match the page\'s design system.'}`
    }],
    max_tokens: 6000,
    temperature: 0.4
  });
  const parsed = extractJSON(text);
  return parsed?.optimizations || [];
}

// Merge the site's pages with traffic rows ({path, sessions, engagement})
// and rank by traffic. Traffic pages missing from the sitemap are added.
export function prioritizePages(siteUrls, trafficRows, baseUrl) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const byPath = new Map((trafficRows || []).map(r => [r.path, r]));
  const prioritized = (siteUrls || []).map(url => {
    let path;
    try { path = new URL(url).pathname; } catch { path = url; }
    const t = byPath.get(path) || byPath.get(path + '/') || byPath.get(path.replace(/\/$/, ''));
    return {
      url, path,
      sessions: t?.sessions || 0,
      engagement: t?.engagement || '',
      priority: (t?.sessions || 0) > 100 ? 'high' : (t?.sessions || 0) > 20 ? 'medium' : 'low'
    };
  }).sort((a, b) => b.sessions - a.sessions);
  for (const row of trafficRows || []) {
    if (!prioritized.some(p => p.path === row.path || p.path === row.path + '/')) {
      prioritized.push({
        url: base + row.path, path: row.path, sessions: row.sessions, engagement: row.engagement || '',
        priority: row.sessions > 100 ? 'high' : row.sessions > 20 ? 'medium' : 'low'
      });
    }
  }
  return prioritized;
}

// Pages already optimised for this client → when (for rotation).
export function coveredPagesFrom(results, clientId) {
  const map = new Map();
  const rows = results && typeof results === 'object' && !Array.isArray(results) ? Object.values(results) : (results || []);
  for (const row of rows) {
    if (!row || row.client_id !== clientId || !row.url) continue;
    if (!Array.isArray(row.optimizations) || row.optimizations.length === 0) continue;
    const key = pageKey(row.url);
    const at = row.generated_at || '';
    if (!map.has(key) || at > map.get(key)) map.set(key, at);
  }
  return map;
}

// Rotate through the site instead of re-optimizing the same head pages
// every run. Ranking by traffic alone is deterministic, so the homepage
// and its neighbours won the shortlist month after month and the rest
// of the site was never reached. Pages we have never optimized go
// first (still traffic-ranked among themselves); already-covered pages
// come after, oldest-first, so a re-run refreshes the stalest work
// rather than repeating last month's.
export function rotateQueue(prioritized, covered) {
  const fresh = [];
  const revisits = [];
  for (const p of prioritized) {
    const doneAt = covered.get(pageKey(p.url));
    if (doneAt) revisits.push({ ...p, lastOptimized: doneAt });
    else fresh.push(p);
  }
  revisits.sort((a, b) => (a.lastOptimized < b.lastOptimized ? -1 : 1));
  return [...fresh, ...revisits];
}

// Generate pages in batches until the shortlist can be filled. Resumable:
// pass back `progress` ({ next, drafts, attempted }) from a paused run.
// generate(target) → optimizations[]; shouldPause() → true to stop between
// batches (the server's time limit). Returns the updated progress, the
// dedupe/shortlist results, and whether it paused.
export async function runShortlist({ queue, clientId, itemTarget, maxPages, pageCeiling, priorByPage, generate,
  onBatch, afterBatch, shouldPause, progress = null, batchSize = BATCH_SIZE }) {
  const p = progress || { next: 0, drafts: [], attempted: [] };
  let deduped = filterRepeatOptimizations(p.drafts, priorByPage);
  let usable = selectTopOptimizations(deduped.rows, { limit: itemTarget }).kept;
  // Always generate the pages the rotation selected — the ranker needs
  // real choice — then keep going past them only while repeat suppression
  // has left the shortlist short.
  while (p.next < pageCeiling && (p.next < maxPages || usable < itemTarget)) {
    if (shouldPause && shouldPause()) {
      return { progress: p, paused: true, deduped, shortlist: selectTopOptimizations(deduped.rows, { limit: itemTarget }) };
    }
    const batch = queue.slice(p.next, Math.min(p.next + batchSize, pageCeiling));
    if (!batch.length) break;
    onBatch?.(p.next, batch, usable);
    const out = await Promise.all(batch.map(t => generate(t).catch(e => ({ error: e.message }))));
    batch.forEach((t, j) => {
      p.attempted.push(t);
      p.drafts.push({
        url: t.url, path: t.path, client_id: clientId, sessions: t.sessions, priority: t.priority,
        optimizations: Array.isArray(out[j]) ? out[j] : [],
        error: out[j]?.error || null
      });
    });
    p.next += batch.length;
    // Re-filter and re-rank the whole accumulation each round: both are
    // pure and cheap, and `usable` has to be what would actually ship —
    // the ranker's per-page and schema caps trim the raw count.
    deduped = filterRepeatOptimizations(p.drafts, priorByPage);
    usable = selectTopOptimizations(deduped.rows, { limit: itemTarget }).kept;
    // Lets the server persist each batch, so a run cut off by the time limit
    // resumes without regenerating pages it already paid for.
    if (afterBatch) await afterBatch(p);
  }
  return { progress: p, paused: false, deduped, shortlist: selectTopOptimizations(deduped.rows, { limit: itemTarget }) };
}
