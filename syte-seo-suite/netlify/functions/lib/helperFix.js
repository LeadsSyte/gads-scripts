// Fixes made through the Syte SEO Helper plugin (wordpress-plugin/) — the
// ones that live in a site's theme, not in a post: heading levels,
// redirects, canonical / robots tags, structured data, titles and
// descriptions of pages with no editor (home page, archives), and AEO
// sections on page-builder pages.
//
// Each fix is a RULE the plugin applies as the page is served. A rule is
// first saved switched off with a preview token, so the change can be seen on
// the real page (…?syte_preview=<token>) by whoever has the link and nobody
// else. The plan is only offered if that preview shows the intended effect.
// Apply switches the rule on; Undo deletes it. Nothing in the theme or the
// content is edited.
//
// `wp` is the WordPress client (wpClient.js). fetchPage is injected for tests.

import crypto from 'node:crypto';
import { planFix, applyPlan, undoResults, checkLive, parseFixValues } from './techFix.js';
import { planAeoFix, applyAeoFix, undoAeoFix, planInsertion, fixKey } from './aeoFix.js';

export const HELPER_FIX_TYPES = ['h1', 'image_alt', 'structured_data', 'schema', 'canonical', 'robots', 'redirect', 'meta_title', 'meta_description'];

// null when the plugin isn't installed (or the login isn't an administrator).
export async function helperStatus(wp) {
  try { const s = await wp('syte/v1/status'); return s?.plugin === 'syte-seo-helper' ? s : null; } catch { return null; }
}

const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;|&#160;/g, ' ');
const plain = html => decode(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const norm = s => plain(s).toLowerCase();
const pathOf = url => { try { const p = new URL(url).pathname.replace(/\/+$/, ''); return (p || '') + '/'; } catch { return null; } };
const hostOf = url => { try { return new URL(url).host.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const withParam = (url, k, v) => url + (url.includes('?') ? '&' : '?') + k + '=' + encodeURIComponent(v);
const ruleId = (prefix, id) => (prefix + '-' + String(id)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);

// ── What a page's HTML says (the same things the plugin changes) ──
const stripNonContent = html => String(html || '').replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<textarea\b[\s\S]*?<\/textarea>|<!--[\s\S]*?-->/gi, ' ');
export function readPage(html) {
  const h = String(html || '');
  const body = stripNonContent(h);
  const attr = (tag, name) => (tag.match(new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']*)["\']', 'i')) || [])[1] || '';
  const tagWith = (re) => (h.match(re) || [])[0] || '';
  return {
    h1: [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => plain(m[1])),
    headings: [...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => ({ level: Number(m[1]), text: plain(m[2]) })),
    title: plain((h.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]),
    description: decode(attr(tagWith(/<meta\b[^>]*\bname=["']description["'][^>]*>/i), 'content')),
    canonical: decode(attr(tagWith(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i), 'href')),
    robots: attr(tagWith(/<meta\b[^>]*\bname=["']robots["'][^>]*>/i), 'content').toLowerCase()
  };
}

// ── A task from the scan → a rule, or the reason it needs a person ──
export function ruleFromTask(task) {
  const fix = String(task?.copy_paste_fix || '');
  const path = pathOf(task?.page_url);
  if (!path) return { manual: 'The page address is not a valid URL.' };
  const type = task.fix_type;
  const options = /\boption\s+[ab]\b|\n\s*OR,?\s/i.test(fix);

  if (type === 'structured_data' || type === 'schema') {
    const blocks = [...fix.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1].trim());
    if (!blocks.length) return { manual: 'The fix has no JSON-LD block to add.' };
    const parsed = [];
    for (const b of blocks) {
      try { parsed.push(JSON.parse(b)); } catch { return { manual: 'The structured data in the fix is not valid JSON.' }; }
    }
    if (/\+?27\s?0{6,}|000[- ]?000[- ]?0000|example\.com|\[[A-Z][A-Z _-]{2,}\]|lorem ipsum/i.test(blocks.join(' '))) {
      return { manual: 'The structured data still has placeholder values (a phone number or address to fill in) — complete it first.' };
    }
    const types = parsed.flatMap(p => [].concat(p['@graph'] ? p['@graph'].map(g => g['@type']) : p['@type'])).filter(Boolean);
    return { rule: { type: 'schema', path, json: parsed.length === 1 ? parsed[0] : parsed }, label: 'Structured data · ' + (types.join(', ') || 'schema'), to: 'Adds ' + (types.join(', ') || 'structured data') + ' to the page\'s code (not visible to visitors).' };
  }

  if (type === 'canonical') {
    if (options) return { manual: 'The fix offers more than one option — a person needs to choose.' };
    const href = (fix.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || fix.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i) || [])[1];
    if (!href) return { manual: 'The fix doesn\'t state the canonical address plainly.' };
    if (hostOf(href) !== hostOf(task.page_url)) return { manual: 'The canonical points to a different website — a person should confirm that.' };
    return { rule: { type: 'canonical', path, url: href }, label: 'Canonical link', to: href };
  }

  if (type === 'robots') {
    if (options || /robots\.txt|search console/i.test(fix)) return { manual: 'This needs a decision or a change outside the page (robots.txt / Search Console).' };
    const content = (fix.match(/<meta[^>]*name=["']robots["'][^>]*content=["']([^"']+)["']/i) || [])[1];
    if (!content) return { manual: 'The fix doesn\'t state the robots setting plainly.' };
    const value = /noindex/i.test(content) ? 'noindex' : 'index';
    return { rule: { type: 'robots', path, value }, label: 'Robots tag', to: value === 'noindex' ? 'noindex, follow (keep this page out of Google)' : 'index, follow (let Google list this page)' };
  }

  if (type === 'redirect') {
    if (options) return { manual: 'The fix offers more than one option — a person needs to choose.' };
    const m = fix.match(/Redirect\s+30[12]\s+(\/\S*)\s+(https?:\/\/\S+)/i) || fix.match(/Source:\s*(\/\S*)\s*(?:→|->|to)\s*Target:\s*(https?:\/\/[^\s)]+)/i);
    if (!m) return { manual: 'The fix doesn\'t state "from" and "to" plainly enough to set the redirect up automatically.' };
    const from = pathOf('https://x' + m[1]);
    const to = m[2].replace(/[.,;]+$/, '');
    if (from === '/') return { manual: 'The home page can\'t be redirected from here.' };
    return { rule: { type: 'redirect', path: from, to, code: 301 }, label: 'Redirect', to: from + ' → ' + to + ' (301)', from: from };
  }

  if (type === 'h1') {
    const keep = fix.match(/keep\s+(?:exactly\s+)?one\s+(?:instance\s+)?(?:of)?:?\s*<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (keep) return { rule: { type: 'heading', mode: 'keep_one', path, text: plain(keep[1]), to: 2 }, label: 'Main heading (H1)', to: 'One H1: "' + plain(keep[1]) + '". Other H1s become H2.' };
    const demote = fix.match(/<h1[^>]*>([\s\S]*?)<\/h1>\s*(?:to|→|->|with|into)\s*:?\s*<h([2-6])\b/i);
    // A fix the scan filed as one site-wide task (one template, many pages)
    // applies everywhere — the plugin only acts on pages with more than one H1.
    const siteWide = /site-?wide|template|every (blog )?post|all (blog )?posts/i.test((task.title || '') + ' ' + (task.description || ''));
    if (demote) return { rule: { type: 'heading', mode: 'demote', path: siteWide ? '*' : path, text: plain(demote[1]), to: Number(demote[2]) }, label: 'Heading level', to: '"' + plain(demote[1]) + '" becomes an H' + demote[2] + ' (same words, same place).' };
    const only = [...fix.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => plain(m[1]));
    if (only.length === 1 && only[0]) return { rule: { type: 'heading', mode: 'promote', path, text: only[0], to: 1 }, label: 'Main heading (H1)', to: 'The heading "' + only[0] + '" becomes the page\'s H1.', needsExisting: only[0] };
    return { manual: 'The heading fix isn\'t in a form the suite can apply — it needs a person.' };
  }

  if (type === 'image_alt') {
    // Theme and builder images (a tracking pixel, a hero banner, related-post
    // thumbnails) are not in the media library; the plugin sets the alt text
    // on the page instead. One site-wide task covers every page.
    const v = parseFixValues(task);
    if (!v?.images?.length) return { manual: 'The fix doesn\'t name the image files and their new alt text plainly enough.' };
    const siteWide = /site-?wide|every page|all (\d+ )?(crawled )?pages|across \d+\+? pages|template|header|footer/i.test((task.title || '') + ' ' + (task.description || ''));
    return { rule: { type: 'image_alt', path: siteWide ? '*' : path, images: v.images.map(i => ({ src: i.src, alt: i.alt })) }, label: 'Image alt text · ' + v.images.length + ' image' + (v.images.length === 1 ? '' : 's'), to: v.images.map(i => '"' + i.alt + '"').join('; ') };
  }

  if (type === 'meta_title' || type === 'meta_description') {
    const v = parseFixValues(task);
    if (!v?.value) return { manual: 'The fix doesn\'t state the new value plainly enough to apply automatically.' };
    return { rule: { type: type === 'meta_title' ? 'title' : 'description', path, value: v.value }, label: type === 'meta_title' ? 'SEO title' : 'Meta description', to: v.value };
  }

  return { manual: 'This kind of fix needs a developer (or a Grok Bot) — it isn\'t something the helper plugin can change.' };
}

// ── Does the page show what the rule is meant to do? ──
// before: the page as it is now (null when only checking the result).
export function verifyRule(rule, before, after) {
  const a = readPage(after?.html), b = before ? readPage(before.html) : null;
  const fail = detail => ({ ok: false, detail });
  switch (rule.type) {
    case 'heading': {
      if (a.h1.length !== 1) return fail('The page would have ' + a.h1.length + ' main headings (H1), not exactly one' + (rule.mode === 'promote' ? ' — no heading with that wording was found to promote.' : '.'));
      if (b && b.h1.length === 1 && rule.path !== '*') return fail('The page already has exactly one main heading.');
      return { ok: true, from: b ? b.h1.length + ' main heading' + (b.h1.length === 1 ? '' : 's') + (b.h1.length ? ': ' + b.h1.map(t => '"' + t + '"').join(', ') : '') : '', now: 'One main heading: "' + a.h1[0] + '"' };
    }
    case 'schema':
      return String(after?.html || '').includes('data-syte="' + rule.id + '"') ? { ok: true, from: '', now: 'Structured data present in the page code' } : fail('The structured data did not appear in the page.');
    case 'canonical':
      return a.canonical.replace(/\/+$/, '') === String(rule.url).replace(/\/+$/, '') ? { ok: true, from: b?.canonical || '', now: a.canonical } : fail('The canonical link on the page is "' + (a.canonical || 'missing') + '".');
    case 'robots': {
      const ok = rule.value === 'noindex' ? /noindex/.test(a.robots) : (!/noindex/.test(a.robots) && /index/.test(a.robots));
      return ok ? { ok: true, from: b?.robots || '', now: a.robots } : fail('The robots tag on the page is "' + (a.robots || 'missing') + '".');
    }
    case 'title':
      return norm(a.title) === norm(rule.value) ? { ok: true, from: b?.title || '', now: a.title } : fail('The page title is "' + a.title + '".');
    case 'description':
      return norm(a.description) === norm(rule.value) ? { ok: true, from: b?.description || '', now: a.description } : fail('The meta description did not change.');
    case 'redirect':
      return [301, 302].includes(after?.status) && String(after?.location || '').replace(/\/+$/, '') === String(rule.to).replace(/\/+$/, '')
        ? { ok: true, from: b ? 'Opens normally (' + b.status + ')' : '', now: 'Redirects to ' + after.location }
        : fail('The page did not redirect (status ' + (after?.status || 'none') + ').');
    case 'insert_html':
      return String(after?.html || '').includes('<!-- syte:' + rule.id + ' -->') ? { ok: true, from: '', now: 'Section present on the page' } : fail('The section did not appear on the page.');
    case 'image_alt': {
      const tags = [...stripNonContent(after?.html).matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
      const stemOf = src => { try { return decodeURIComponent(new URL(src, 'https://x').pathname.split('/').pop()).replace(/\.[a-z0-9]+$/i, '').replace(/-\d+x\d+$/, '').replace(/-scaled$/, '').toLowerCase(); } catch { return ''; } };
      const altOf = tag => decode((tag.match(/\salt\s*=\s*["']([^"']*)["']/i) || [])[1] || '');
      const srcOf = tag => (tag.match(/\b(?:data-)?src\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
      const found = [], wrong = [];
      for (const img of rule.images || []) {
        const want = stemOf(img.src);
        const hits = tags.filter(t => stemOf(srcOf(t)) === want);
        if (!hits.length) continue;
        found.push(img);
        if (!hits.every(t => altOf(t) === img.alt)) wrong.push(img);
      }
      if (!found.length) return fail('None of those images is on this page.');
      if (wrong.length) return fail('The alt text did not take on ' + wrong.map(i => i.src.split('/').pop()).join(', ') + '.');
      return { ok: true, from: '', now: found.length + ' image' + (found.length === 1 ? '' : 's') + ' with the new alt text' };
    }
    default:
      return fail('Unknown rule type.');
  }
}

// One page load, redirects not followed (so a redirect can be seen).
export async function fetchPageRaw(url) {
  try {
    const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SyteSEOSuite/1.0)', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(25000) });
    const html = r.status >= 300 && r.status < 400 ? '' : (await r.text()).slice(0, 3000000);
    return { status: r.status, location: r.headers.get('location') || '', html };
  } catch { return { status: 0, location: '', html: '' }; }
}

const fresh = url => withParam(url, 'syte_check', Date.now().toString(36));
const deleteRule = (wp, id) => wp('syte/v1/rules/' + id, null, 'DELETE').catch(() => {});
const pageUrlFor = (task, rule) => { try { const u = new URL(task.page_url); return rule.type === 'redirect' ? u.origin + rule.path : task.page_url; } catch { return task.page_url; } };

// Save the rule switched off, look at the preview, and only then offer it.
async function previewRule(wp, id, rule, url, fetchPage) {
  const token = crypto.randomBytes(16).toString('hex');
  const saved = await wp('syte/v1/rules/' + id, { ...rule, enabled: false, preview: token });
  const previewUrl = withParam(url, 'syte_preview', token);
  const [before, after] = await Promise.all([fetchPage(fresh(url)), fetchPage(previewUrl)]);
  const v = verifyRule(saved, before, after);
  if (!v.ok) { await deleteRule(wp, id); return { ok: false, reason: v.detail }; }
  return { ok: true, saved, previewUrl, v };
}

// Dry run for a scan task — same plan shape as techFix.planFix, plus preview_url.
export async function planHelperFix(task, wp, { fetchPage = fetchPageRaw } = {}) {
  const made = ruleFromTask(task);
  if (made.manual) return { applicable: false, reason: made.manual };
  const id = ruleId('tech', task.id);
  const url = pageUrlFor(task, made.rule);
  const p = await previewRule(wp, id, made.rule, url, fetchPage);
  if (!p.ok) return { applicable: false, reason: p.reason + ' Left for a person.' };
  return {
    applicable: true, helper: true, preview_url: made.rule.type === 'schema' ? '' : p.previewUrl,
    note: made.rule.path === '*' ? 'Applies on every page of the site.' : '',
    changes: [{ kind: 'helper_rule', label: made.label + (made.rule.path === '*' ? ' · every page' : ' · ' + made.rule.path), target: { rule: id }, from: p.v.from || '', to: made.to, now: p.v.now, rule: { ...p.saved, preview: '' }, url }]
  };
}

async function applyHelper(plan, wp) {
  const results = [];
  for (const c of plan.changes || []) {
    try {
      const saved = await wp('syte/v1/rules/' + c.target.rule, { ...c.rule, enabled: true, preview: '' });
      results.push({ ...c, ok: saved?.enabled === true });
    } catch (e) { results.push({ ...c, ok: false, error: String(e.message || e).slice(0, 200) }); }
  }
  return results;
}

async function undoHelper(results, wp) {
  const out = [];
  for (const c of (results || []).filter(r => r.ok)) {
    try {
      await wp('syte/v1/rules/' + c.target.rule, null, 'DELETE');
      const still = await wp('syte/v1/rules/' + c.target.rule).then(() => true).catch(() => false);
      out.push({ ...c, undone: !still });
    } catch (e) { out.push({ ...c, undone: false, error: String(e.message || e).slice(0, 200) }); }
  }
  return out;
}

async function helperLive(results, fetchPage) {
  const checks = [];
  for (const c of results.filter(r => r.ok)) checks.push(verifyRule(c.rule, null, await fetchPage(fresh(c.url))));
  return checks.length && checks.every(v => v.ok)
    ? { status: 'verified', detail: 'The change is live on the page.' }
    : { status: 'pending', detail: (checks.find(v => !v.ok)?.detail || 'Not visible yet') + ' The rule is switched on; a page cache may still be serving the old page.' };
}

const isHelperPlan = plan => !!plan?.helper;
const isHelperResults = results => Array.isArray(results) && results[0]?.kind === 'helper_rule';

// WordPress operations for techFixRun: the post's own fields first (techFix.js);
// what those can't do goes through the helper plugin when the site has it.
export function wpTechOps({ fetchPage = fetchPageRaw } = {}) {
  let status;
  const helper = async wp => (status === undefined ? (status = await helperStatus(wp)) : status);
  return {
    plan: async (task, wp) => {
      const native = await planFix(task, wp);
      if (native.applicable) return native;
      if (!HELPER_FIX_TYPES.includes(task.fix_type)) return native;
      if (!(await helper(wp))) {
        return { applicable: false, reason: native.reason + ' (With the Syte SEO Helper plugin installed on this site, the suite could make this change itself.)' };
      }
      return planHelperFix(task, wp, { fetchPage });
    },
    apply: (plan, wp) => (isHelperPlan(plan) ? applyHelper(plan, wp) : applyPlan(plan, wp)),
    undo: (results, wp) => (isHelperResults(results) ? undoHelper(results, wp) : undoResults(results, wp)),
    live: async ({ entry, results, fetchHtml }) => (isHelperResults(results) ? helperLive(results, fetchPage) : checkLive(await fetchHtml(entry.task.page_url), results))
  };
}

// ── AEO sections on pages whose content isn't the post content ──
export async function planHelperAeo({ url, opt, optKey }, wp, { fetchPage = fetchPageRaw } = {}) {
  const ins = planInsertion(opt);
  if (!ins.ok) return { applicable: false, reason: ins.reason };
  const path = pathOf(url);
  if (!path) return { applicable: false, reason: 'The page address is not a valid URL.' };
  const key = fixKey(url, optKey);
  const id = ruleId('aeo', key);
  const rule = { type: 'insert_html', path, position: ins.position === 'top' ? 'after_h1' : 'end_of_main', html: ins.html };
  const p = await previewRule(wp, id, rule, url, fetchPage);
  if (!p.ok) return { applicable: false, reason: p.reason };
  return {
    applicable: true, helper: true, target: { rule: id }, position: ins.position, html: ins.html, key,
    rawHash: '', renderedPreview: '', preview_url: p.previewUrl, rule: { ...p.saved, preview: '' }
  };
}

export function wpAeoOps({ fetchPage = fetchPageRaw } = {}) {
  let status;
  const helper = async wp => (status === undefined ? (status = await helperStatus(wp)) : status);
  return {
    plan: async (args, wp, fetchLive) => {
      const native = await planAeoFix(args, wp, fetchLive);
      if (native.applicable) return native;
      // Only the "can't reach this page's content" cases — never placeholders, duplicates or rewrites.
      if (!/page builder|Could not match this URL/i.test(native.reason || '')) return native;
      if (!(await helper(wp))) {
        return { applicable: false, reason: native.reason + ' (With the Syte SEO Helper plugin installed on this site, the suite could add it itself.)' };
      }
      return planHelperAeo(args, wp, { fetchPage });
    },
    apply: async (plan, wp) => {
      if (!plan.helper) return applyAeoFix(plan, wp);
      const saved = await wp('syte/v1/rules/' + plan.target.rule, { ...plan.rule, enabled: true, preview: '' });
      return { ok: saved?.enabled === true };
    },
    undo: async (plan, wp) => {
      if (!plan.helper) return undoAeoFix(plan, wp);
      await wp('syte/v1/rules/' + plan.target.rule, null, 'DELETE');
      return { ok: !(await wp('syte/v1/rules/' + plan.target.rule).then(() => true).catch(() => false)) };
    }
  };
}
