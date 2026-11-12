// Learn how a client writes from the articles already published on their
// own blog, and keep it as a short written "blueprint" on the client
// (publishing_profile.article_blueprint). The writer follows it for
// structure, tone and formatting (buildSystemPrompt in content/prompts.js);
// the client's rules and the brand reference always win over it.
//
// Why: most clients have no written content rules, and only Chris knows
// each house style. The published posts already show it, so the suite reads
// them instead of asking him to write rules from a blank page. He can edit
// the result on CMS → Publishing Profile; an edited blueprint is never
// overwritten by a re-learn unless forced.
//
// Pure apart from the injected deps; tested in test/articleBlueprint.test.mjs.

export const MIN_SAMPLES = 2;
export const MAX_SAMPLES = 6;
export const MIN_CHARS = 1500;
export const SAMPLE_CHARS = 6000;
export const MAX_BLUEPRINT_CHARS = 3500;

// Post HTML → plain text that still shows the structure (headings, lists,
// tables, images, links) the blueprint is about.
export function htmlToOutline(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<h1[^>]*>/gi, '\n\n# ').replace(/<h2[^>]*>/gi, '\n\n## ').replace(/<h3[^>]*>/gi, '\n\n### ').replace(/<h[4-6][^>]*>/gi, '\n\n#### ')
    .replace(/<li[^>]*>/gi, '\n- ').replace(/<tr[^>]*>/gi, '\n[table row] ').replace(/<blockquote[^>]*>/gi, '\n> ')
    .replace(/<img[^>]*>/gi, ' [image] ').replace(/<iframe[^>]*>/gi, ' [embed] ')
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi, (m, href) => ' [link:' + (/^https?:\/\//i.test(href) ? href.replace(/^https?:\/\/([^/]+).*$/i, '$1') : 'internal') + '] ')
    .replace(/<(strong|b)\b[^>]*>/gi, '**').replace(/<\/(strong|b)>/gi, '**')
    .replace(/<\/(p|div|h[1-6]|ul|ol|table|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8211;|&ndash;/g, '–').replace(/&quot;/g, '"').replace(/&#\d+;|&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const norm = s => String(s || '').toLowerCase().replace(/&[#a-z0-9]+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

// posts: [{ title, url, html, date }] newest first. ownTitles: titles the
// suite itself pushed for this client — never learn from our own output.
export function pickSamplePosts(posts, ownTitles = []) {
  const own = new Set([...ownTitles].map(norm).filter(Boolean));
  const out = [];
  for (const p of posts || []) {
    if (own.has(norm(p.title))) continue;
    const text = htmlToOutline(p.html);
    if (text.length < MIN_CHARS) continue;
    out.push({ title: String(p.title || '').replace(/<[^>]+>/g, '').trim(), url: p.url || '', words: text.split(/\s+/).length, text: text.slice(0, SAMPLE_CHARS) });
    if (out.length >= MAX_SAMPLES) break;
  }
  return out;
}

export const BLUEPRINT_SYSTEM = `You study how one business writes its blog, from articles already published on its own website, and describe the pattern so another writer can match it. You describe form only: structure, formatting, tone. You never describe what the business sells or state facts about it.`;

export function buildBlueprintPrompt(client, samples) {
  return `BUSINESS: ${client.name || ''}${client.industry ? ' (' + client.industry + ')' : ''}

Below are ${samples.length} articles published on this business's own blog, newest first. Headings are marked #, ##, ###; "[image]", "[link:…]", "[table row]" and "- " mark images, links, tables and list items.

Write the house blueprint for this blog: what a new article must look and sound like to sit naturally beside these. Include only patterns that appear in at least two of the articles. Be specific and brief (numbers, examples of heading wording, typical paragraph length), not generic advice.

Use exactly these headings, one to three short lines under each, plain text, at most 350 words in total:
STRUCTURE (the usual order of sections, and how many main sections)
OPENING (how articles begin)
HEADINGS (style, length, questions or statements, capitalisation)
PARAGRAPHS AND LISTS (length, use of bullets, tables, bold)
TONE AND VOICE (person, formality, spelling variant such as South African/British English)
LENGTH (typical word count)
RECURRING ELEMENTS (FAQ, call-to-action box, author line, internal links, anything that repeats)
CLOSING (how articles end)
AVOID (things these articles clearly never do)

Do not mention the article topics, do not state facts about the business, and do not add advice of your own. If the articles are too inconsistent to describe a pattern under a heading, write "No consistent pattern." under it.

${samples.map((s, i) => `=== ARTICLE ${i + 1}: ${s.title} (${s.words} words) ===\n${s.text}`).join('\n\n')}`;
}

// deps: complete(opts) → text (Claude), now() → Date
// → { result: 'learned', blueprint: { text, sources, learned_at } } | { result: 'not_enough', reason }
export async function learnBlueprint({ client, posts, ownTitles = [] }, deps) {
  const samples = pickSamplePosts(posts, ownTitles);
  if (samples.length < MIN_SAMPLES) {
    return { result: 'not_enough', reason: 'Only ' + samples.length + ' article' + (samples.length === 1 ? '' : 's') + ' on the blog that the suite did not write and that ' + (samples.length === 1 ? 'is' : 'are') + ' long enough to learn from (needs ' + MIN_SAMPLES + ').' };
  }
  const raw = await deps.complete({
    system: BLUEPRINT_SYSTEM,
    messages: [{ role: 'user', content: buildBlueprintPrompt(client, samples) }],
    max_tokens: 1200,
    temperature: 0.2
  });
  const text = String(raw || '').trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim().slice(0, MAX_BLUEPRINT_CHARS);
  if (text.length < 200 || !/STRUCTURE/i.test(text)) throw new Error('The blueprint came back empty or in the wrong shape.');
  return {
    result: 'learned',
    blueprint: {
      text,
      sources: samples.map(s => ({ title: s.title, url: s.url })),
      learned_at: (deps.now ? deps.now() : new Date()).toISOString()
    }
  };
}

// An edited blueprint is the team's own wording: keep it unless forced.
export const blueprintIsEdited = profile => !!profile?.article_blueprint?.edited_at;
