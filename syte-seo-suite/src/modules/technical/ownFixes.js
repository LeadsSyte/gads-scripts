// "Own Fixes": optimisations the team writes themselves, turned into items
// the suite can apply (Chris, 29 Oct 2026 call: "I'll generate the
// optimisations and give it to the tool, and it just runs them").
//
// The AI reads the pasted text and returns items in the exact shapes the
// apply code already understands:
//   fixes      → tasks on the Technical SEO board (Preview → Apply on the site)
//                parsed by techFix.parseFixValues / helperFix.ruleFromTask
//   additions  → optimisations on the AEO Engine page (Preview in the page → Add)
//                parsed by aeoFix.planInsertion
// normaliseOwnFixes checks every item against those parsers BEFORE anything
// is saved, so a vague item is sent back for a clearer value instead of
// becoming a task that can only be done by hand. Pure; tested in
// test/ownFixes.test.mjs.

import { parseFixValues, AUTO_FIX_TYPES } from '../../../netlify/functions/lib/techFix.js';
import { planInsertion } from '../../../netlify/functions/lib/aeoFix.js';

export const OWN_FIX_TYPES = ['meta_title', 'meta_description', 'image_alt', 'h1', 'schema', 'canonical', 'robots', 'redirect'];
export const OWN_SOURCE = 'Own fixes';

export const OWN_FIXES_SYSTEM = `You turn an SEO specialist's notes into items a tool can apply to a website by itself. Return ONLY JSON, no prose, no code fences:
{
  "items": [
    { "kind": "fix", "fix_type": "meta_title" | "meta_description" | "image_alt" | "h1" | "schema" | "canonical" | "robots" | "redirect",
      "page_url": "https://full.address/of/the/page/", "title": "short description of the change", "copy_paste_fix": "EXACT shape below" },
    { "kind": "addition", "page_url": "https://full.address/of/the/page/", "name": "short name, e.g. FAQ section", "type": "content" | "schema",
      "where": "after the H1" | "end of the content", "implementation": "finished HTML to add" }
  ],
  "notes": ["one short sentence for anything in the notes you could NOT turn into an item, and why"]
}

A "fix" CHANGES something the page already has. copy_paste_fix must be finished and in EXACTLY this shape:
- meta_title:        <title>The new title</title>                     (10–120 characters)
- meta_description:  <meta name="description" content="The new description">   (40–320 characters)
- image_alt:         one <img src="…" alt="…"> per image, using the image's real file name or address
- h1:                "Keep exactly one: <h1>The heading to keep</h1>"  (page has several H1s)
                     or "Change <h1>Text</h1> to <h2>Text</h2>"        (demote one heading)
                     or "<h1>Text</h1>"                                (make this heading the H1)
- schema:            <script type="application/ld+json">{ valid JSON-LD }</script>
- canonical:         <link rel="canonical" href="https://…">
- robots:            <meta name="robots" content="index, follow">  or  content="noindex, follow"
- redirect:          Redirect 301 /old-path https://site/new-path/

An "addition" ADDS a new section to a page's content: an answer paragraph, FAQ, key takeaways, a comparison table, or a schema block. implementation is finished HTML (h2/h3/p/ul/table; schema as a <script type="application/ld+json"> block). "where": "after the H1" for answers/summaries, "end of the content" for FAQs and the rest.

Rules:
- Use the page addresses given in the notes. If only a path is given, keep it as a path starting with "/". Never invent pages.
- Never use placeholders like [PRODUCT] or "lorem ipsum"; if the notes don't say what the new value is, put the item in "notes" instead.
- Rewording existing paragraphs, moving sections, or design changes cannot be applied by the tool: put them in "notes".
- One item per change. Keep titles short.`;

const safeUrl = u => { try { return new URL(u); } catch { return null; } };
const hostOf = u => String(safeUrl(u)?.hostname || '').replace(/^www\./, '').toLowerCase();

// The client's website origin, from whichever field holds it.
export function clientOrigin(client) {
  for (const raw of [client?.url, client?.wp_url, client?.website]) {
    const u = safeUrl(/^https?:\/\//i.test(raw || '') ? raw : raw ? 'https://' + raw : '');
    if (u) return u.origin;
  }
  return '';
}

// Resolve a page address against the client's site; '' when it isn't theirs.
export function resolvePageUrl(given, client) {
  const origin = clientOrigin(client);
  const s = String(given || '').trim();
  if (!s) return '';
  if (s.startsWith('/')) return origin ? origin + s : '';
  const u = safeUrl(/^https?:\/\//i.test(s) ? s : 'https://' + s);
  if (!u) return '';
  if (origin && hostOf(u.href) !== hostOf(origin)) return '';
  return u.href;
}

// Why a fix's copy_paste_fix would be left for a person, or '' when it applies.
export function fixShapeProblem(fix_type, text) {
  const fix = String(text || '');
  if (AUTO_FIX_TYPES.includes(fix_type)) {
    return parseFixValues({ fix_type, copy_paste_fix: fix }) ? '' : 'The new value isn\'t stated plainly — use the exact shape (e.g. <title>…</title>, <meta name="description" content="…">, <img src="…" alt="…">).';
  }
  switch (fix_type) {
    case 'h1':
      return (/keep\s+(?:exactly\s+)?one\s*(?:instance\s+)?(?:of)?:?\s*<h1[^>]*>[\s\S]*?<\/h1>/i.test(fix)
        || /<h1[^>]*>[\s\S]*?<\/h1>\s*(?:to|→|->|with|into)\s*:?\s*<h[2-6]\b/i.test(fix)
        || (/<h1[^>]*>[\s\S]*?<\/h1>/i.test(fix) && (fix.match(/<h[1-6]\b/gi) || []).length === 1))
        ? '' : 'Say which heading: "Keep exactly one: <h1>…</h1>", "Change <h1>…</h1> to <h2>…</h2>", or "<h1>…</h1>" to promote.';
    case 'schema': {
      const m = fix.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
      if (!m) return 'Schema must be a <script type="application/ld+json"> block.';
      try { JSON.parse(m[1]); return ''; } catch { return 'The schema isn\'t valid JSON.'; }
    }
    case 'canonical':
      return /<link[^>]*rel=["']canonical["'][^>]*href=["']https?:\/\/[^"']+["']/i.test(fix) || /<link[^>]*href=["']https?:\/\/[^"']+["'][^>]*rel=["']canonical["']/i.test(fix) ? '' : 'Canonical must be <link rel="canonical" href="https://…">.';
    case 'robots':
      return /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']+["']/i.test(fix) ? '' : 'Robots must be <meta name="robots" content="index, follow"> (or noindex).';
    case 'redirect':
      return /Redirect\s+30[12]\s+\/\S*\s+https?:\/\/\S+/i.test(fix) ? '' : 'Redirect must be "Redirect 301 /old-path https://site/new-path/".';
    default:
      return 'Not a kind of fix the suite can apply (' + fix_type + ').';
  }
}

export const ownOptKey = o => (o.type || '') + '::' + (o.name || o.title || '');

// parsed: the AI's JSON. → { fixes: [task rows], additions: [{ url, opt }], rejected: [{ item, reason }], notes: [] }
export function normaliseOwnFixes(parsed, client, { now = new Date(), uuid = () => globalThis.crypto.randomUUID() } = {}) {
  const out = { fixes: [], additions: [], rejected: [], notes: (parsed?.notes || []).map(String).filter(Boolean).slice(0, 20) };
  const seenAdd = new Set();
  for (const item of parsed?.items || []) {
    if (!item || typeof item !== 'object') continue;
    const page_url = resolvePageUrl(item.page_url, client);
    if (!page_url) { out.rejected.push({ item, reason: item.page_url ? 'The page "' + item.page_url + '" is not on ' + (clientOrigin(client) || 'this client\'s site') + '.' : 'No page address.' }); continue; }
    if (item.kind === 'fix') {
      const fix_type = String(item.fix_type || '').toLowerCase().replace(/[\s-]/g, '_').replace(/^structured_data$/, 'schema');
      if (!OWN_FIX_TYPES.includes(fix_type)) { out.rejected.push({ item, reason: 'Not a kind of fix the suite can apply (' + (item.fix_type || 'none') + ').' }); continue; }
      const problem = fixShapeProblem(fix_type, item.copy_paste_fix);
      if (problem) { out.rejected.push({ item, reason: problem }); continue; }
      out.fixes.push({
        id: uuid(), client_id: client.id, client_name: client.name,
        title: String(item.title || fix_type.replace(/_/g, ' ') + ' on ' + new URL(page_url).pathname).slice(0, 160),
        description: 'Written by the team (Own Fixes).', priority: 'high', impact: 'high', effort: 'low',
        page_url, fix_type, copy_paste_fix: String(item.copy_paste_fix).trim(),
        status: 'open', assignee: '', data_source: OWN_SOURCE, created_at: now.toISOString()
      });
    } else if (item.kind === 'addition') {
      const type = String(item.type || 'content').toLowerCase() === 'schema' ? 'schema' : 'content';
      const opt = { type, name: String(item.name || (type === 'schema' ? 'Schema block' : 'Section')).slice(0, 120), where: String(item.where || ''), implementation: String(item.implementation || ''), description: 'Written by the team (Own Fixes).', own: true };
      const ins = planInsertion(opt);
      if (!ins.ok) { out.rejected.push({ item, reason: ins.reason }); continue; }
      const key = page_url + '|' + ownOptKey(opt);
      if (seenAdd.has(key)) continue;
      seenAdd.add(key);
      out.additions.push({ url: page_url, opt });
    } else {
      out.rejected.push({ item, reason: 'Not a fix or an addition.' });
    }
  }
  return out;
}

// Group additions by page for saving.
export function additionsByPage(additions) {
  const byUrl = new Map();
  for (const a of additions) { if (!byUrl.has(a.url)) byUrl.set(a.url, []); byUrl.get(a.url).push(a.opt); }
  return [...byUrl.entries()].map(([url, opts]) => ({ url, opts }));
}
