// Technical SEO triage: crawler findings → a prioritised list of tasks, each
// with a finished copy-paste fix. Shared by the Technical SEO page (browser)
// and the server-side Tech Autopilot (netlify/functions/lib/techScan.js), so
// both brief the same fixes. `complete` is the Claude call — the server
// passes its own; the browser uses the default.

import { claudeComplete, extractJSON } from '../../lib/anthropic.js';
import { completedWorkForClient, filterRepeatTasks, completedWorkPrompt } from './taskHistory.js';

// Defaults for the configurable scan depth / suggestion count (overridable
// per-scan from the New Scan screen).
export const DEFAULT_CRAWL_DEPTH = 100;
// The month's hand-off is a shortlist, not an inventory: 10 fixes an
// account manager can actually brief a developer on beats 25 that sit
// untouched. The Settings slider still allows more per scan.
export const DEFAULT_SUGGESTIONS = 10;
// Hard ceiling regardless of what the slider or the model returns.
export const MAX_TASKS_PER_CLIENT = 25;

// Stable dedup key for a task. Same shape used by dedupeTasks and by the
// rejection blocklist so a freshly-triaged task with a new UUID but the
// same logical issue is collapsed/filtered consistently.
export function taskDedupKey(t) {
  return (t.client_id || '') + '|' + (t.page_url || t.url || '') + '|' + (t.action_summary || t.title || '');
}

export function buildTriageSystem(limit = DEFAULT_SUGGESTIONS) {
  return `
You are a senior technical SEO engineer. You receive raw site-audit data (WebCEO audit JSON or Google Search Console data) and must produce a prioritised task list.

CRITICAL RULE: Every task MUST reference a SPECIFIC page URL from the audit data — never wildcards like /products/* or generic paths. If the audit shows 50 product pages missing alt text, create tasks for the TOP ${limit} most important ones by name with the exact URL. Never generalize into one "fix all products" task.

Return ONLY valid JSON in this shape:
{
  "tasks": [
    {
      "title": "short imperative title — include the specific page name",
      "description": "what is wrong on THIS specific page + expected impact",
      "priority": "critical|high|medium|low",
      "page_url": "the EXACT full URL from the audit data (e.g. https://example.com/products/hi-tall-harness-boot, NOT https://example.com/products/*)",
      "fix_type": "meta_title|meta_description|canonical|schema|internal_link|h1|image_alt|redirect|robots|sitemap|sitemap_submission|page_speed|structured_data|gsc_setup|domain_ownership|analytics_setup|gtm_setup|other",
      "copy_paste_fix": "the ACTUAL finished code/text for THIS specific page — no placeholders like [PRODUCT_NAME], use the real page title/content from the audit data",
      "impact": "high|medium|low",
      "effort": "quick|moderate|complex"
    }
  ]
}

RULES:
- Every page_url must be a real, complete URL found in the audit data. NEVER use wildcards (*), generic paths, or invented URLs.
- Every copy_paste_fix must be FINISHED — ready to paste. No [PLACEHOLDER] values. Use the actual page title, product name, or content from the audit data. For alt text, describe what the image shows based on the filename/context.
- If the audit shows the same issue on many pages, pick the MOST IMPORTANT pages (homepage, high-traffic pages, key service/product pages) and create individual tasks for each.
- EXCEPTION — ONE FIX, MANY PAGES: when the same problem on many pages comes from ONE shared cause (a theme/template element, a header or footer, a plugin setting — e.g. every blog post has a second H1 because the post template renders a section heading as <h1>), create ONE task for the shared cause, not one per page. Title it as a site-wide fix, put the most important affected page in page_url, and list the other affected URLs in the description. One developer change fixes them all; separate tasks would brief the same change again and again.
- COVER THE WHOLE SITE. The audit data spans every page we could crawl, not just the homepage. Spread the task list across as many DISTINCT page URLs as the findings support — never hand back a list where most tasks point at the same URL. Cap any single page at 2 tasks while other pages still have unaddressed issues; only stack more on one page when the rest of the site is genuinely clean.
- For image alt text issues: include the specific image URL and the specific page where it's found, with a real descriptive alt text based on the image filename and page context.
- For missing meta titles/descriptions: write the actual title/description for that specific page.
- For missing schema: write the complete JSON-LD for that specific page using real data from the audit.

OFF-PAGE / BACKEND fix_types — use these when the work happens in an external admin console rather than in page HTML:
- gsc_setup / domain_ownership: Google Search Console property creation, ownership verification (TXT record, HTML file, GSC tag).
- sitemap_submission: submitting an XML sitemap inside Search Console (different from creating the sitemap itself, which is fix_type=sitemap).
- analytics_setup / gtm_setup: installing GA4, Universal Analytics, or a GTM container.
For these tasks, copy_paste_fix should describe the exact step-by-step admin actions (e.g. "1. Open search.google.com/search-console 2. Add property fleetwoodonsea.co.za 3. Choose DNS verification 4. Copy TXT record into Cloudflare DNS"). Do NOT write HTML/markup — there's nothing to paste into the page.

PRIORITIZATION (biggest wins first):
- Critical = indexing blocked, canonical loops, redirect chains, robots.txt errors, broken pages returning 4xx/5xx.
- High = missing/duplicate H1, missing meta title on key pages, missing schema on service pages, noindex on pages that should be indexed.
- Medium = weak meta descriptions, missing alt text on important images, thin content pages, slow pages, missing breadcrumb schema.
- Low = minor polish, cosmetic heading issues, optional schema types.
- Sort: critical first, then high + quick effort, then high + moderate, then medium, then low.
- NEVER re-suggest work that is listed as ALREADY COMPLETED in the user message. That work has been briefed and shipped in an earlier month; repeating it wastes the whole hand-off and the account manager has to strip it out by hand. If a page's only remaining issues are already-completed ones, skip that page and spend the slot on a page with genuinely open issues.
- Generate up to ${limit} tasks — the MOST IMPACTFUL issues to fix, ordered biggest-win first. Quality over quantity: only create a task for a real, fixable issue present in the audit data. If there are fewer than ${limit} meaningful issues, return only the real ones — never pad the list. Critical issues come first, then the highest-ROI quick wins.
`.trim();
}

export async function triageAudit(auditData, clientUrl, taskLimit = DEFAULT_SUGGESTIONS, completedWork = '', { complete = claudeComplete } = {}) {
  // auditData is now a pre-summarized string from the crawler (plus optional
  // GSC JSON appended). When it's a string, pass it through verbatim — Claude
  // reads the PAGE / issue / fix lines directly and creates tasks from them.
  const dataText = typeof auditData === 'string'
    ? auditData
    : JSON.stringify(auditData).slice(0, 80000);

  const text = await complete({
    system: buildTriageSystem(taskLimit),
    messages: [{
      role: 'user',
      content: `Client URL: ${clientUrl}
${completedWork ? `
ALREADY COMPLETED — work shipped for this client in earlier months, listed per page.
DO NOT create a task for any of these again, however differently you would word it.
The crawler may still report the underlying issue (a change can be live but not yet
re-crawled, or only partly propagated); that is not a reason to re-brief it.
${completedWork}
` : ''}
Crawler findings (each PAGE block lists specific issues found on that URL with suggested fixes):
${dataText.slice(0, 80000)}

Create one task per MEANINGFUL issue on a SPECIFIC page that is NOT in the already-completed list, up to ${taskLimit} tasks. Use the exact URLs shown. When the crawler suggests a fix, use it as the copy_paste_fix (refine if needed). Prioritize critical issues (noindex, missing titles) first, and spread the list across the different page URLs above rather than stacking it on the homepage.`
    }],
    max_tokens: 16000,
    temperature: 0.3
  });
  const parsed = extractJSON(text);
  return mergeSharedFixes(parsed?.tasks || []);
}

// Backstop for the ONE FIX, MANY PAGES rule: tasks of the same fix type
// whose fix opens with the same instruction (ignoring page-specific names,
// URLs and quoted text) are one change — merge them into a single site-wide
// task that lists every affected page.
function fixSignature(t) {
  const first = String(t.copy_paste_fix || '').split(/(?<=[.!?])\s|\n/)[0] || '';
  return String(t.fix_type || '').toLowerCase() + '|' + first
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/(["'“‘]).*?(["'”’])/g, '')
    .replace(/[^a-z<>/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function mergeSharedFixes(tasks) {
  const groups = new Map();
  let solo = 0;
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const sig = fixSignature(t);
    // Too short a first line to prove two fixes are the same change.
    const key = sig.split('|')[1].length >= 25 ? sig : 'solo|' + (solo++);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const out = [];
  for (const group of groups.values()) {
    if (group.length < 3) { out.push(...group); continue; }
    const [lead] = group;
    const pages = [...new Set(group.map(t => t.page_url).filter(Boolean))];
    out.push({
      ...lead,
      title: 'Site-wide fix (' + pages.length + ' pages): ' + String(lead.title || '').replace(/\s+on (the )?.+$/i, ''),
      description: (lead.description || '') + '\n\nThe same fix applies to ' + pages.length + ' pages — it comes from one shared cause (template/theme), so it is one change:\n' + pages.map(p => '- ' + p).join('\n')
    });
  }
  return out;
}

// Triage that will not hand back work this client has already had.
//
// The exclusion list in the prompt does most of the job, but models restate
// things in new words, so the result is filtered too — and a filtered list is
// a SHORT list, which is how a 10-fix hand-off would quietly become a 4-fix
// one. So when suppression takes a real bite out of the shortlist, triage
// runs once more with the repeats named explicitly, and the two passes are
// merged into one list of genuinely open work.
export async function triageWithoutRepeats(auditData, clientUrl, taskLimit, completedByPage, opts = {}) {
  const completedText = completedWorkPrompt(completedByPage);
  const first = await triageAudit(auditData, clientUrl, taskLimit, completedText, opts);
  const filtered = filterRepeatTasks(first, completedByPage);
  let tasks = filtered.tasks;
  let removed = filtered.removed;

  if (removed > 0 && tasks.length < taskLimit) {
    const keptKeys = new Set(tasks.map(t => taskDedupKey(t)));
    const repeats = first
      .filter(t => !keptKeys.has(taskDedupKey(t)))
      .map(t => '  - ' + (t.page_url || '') + ': ' + (t.title || ''))
      .join('\n');
    try {
      const second = await triageAudit(
        auditData, clientUrl, taskLimit - tasks.length,
        completedText +
        '\n\nAlso already covered — you proposed these moments ago and every one of them\n' +
        'repeats completed work. Find DIFFERENT issues on other pages instead:\n' + repeats,
        opts
      );
      const secondFiltered = filterRepeatTasks(second, completedByPage);
      removed += secondFiltered.removed;
      // Treat the first pass as completed work too, so the top-up can't
      // hand back the same fix in different words.
      const firstAsDone = completedWorkForClient({
        tasks: tasks.map(t => ({ ...t, status: 'done' }))
      });
      const fresh = filterRepeatTasks(secondFiltered.tasks, firstAsDone).tasks;
      tasks = tasks.concat(fresh).slice(0, taskLimit);
    } catch {
      // Top-up is best-effort — a short list of real work still beats a full
      // list padded with repeats.
    }
  }

  return { tasks, removed };
}
