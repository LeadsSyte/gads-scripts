// Applying AEO optimisations to a client's WordPress page — adding an FAQ
// section, an answer block, key takeaways, a table… or a JSON-LD schema
// block — only after a person has previewed it in the site's design and
// clicked Apply. Nothing that rewrites existing content (heading fixes,
// internal links) is applied here.
//
// Safety rules:
//  - Only pages whose visible content IS the WordPress post content. Pages
//    built in a page builder (Elementor etc.) render from elsewhere; an edit
//    to post_content wouldn't show, or would show twice — those stay manual.
//  - Every insertion is wrapped in markers, so it can't be added twice and
//    can be removed cleanly (Undo).
//  - Apply refuses if the page changed since the preview.
// `wp` is injected (see techFix.js).

import { resolveWpObject } from './techFix.js';
import { learnHouseStyle, applyHouseStyle } from '../../../src/modules/cms/houseStyle.js';

const TOP_HINT = /answer|summary|takeaway|tl;?dr|overview|definition|at a glance|intro/i;
const TOP_WHERE = /after (the )?h1|top of|beginning|start of|above the (first|intro)|before the (first|intro)|right after the (title|heading)/i;
const END_WHERE = /end of|bottom|before the (conclusion|footer)|after the (main )?content|below the/i;

export function fixKey(url, optKey) {
  let h = 5381;
  for (const ch of String(url) + '|' + String(optKey)) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

const stripFences = s => String(s || '').replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();

// What to insert and where, or why it can't be applied automatically.
export function planInsertion(opt) {
  const code = stripFences(opt.implementation || opt.code || '');
  if (!code) return { ok: false, reason: 'The suggestion has no content to add.' };
  if (/\[(?:[A-Z][A-Z _-]{2,}|insert[^\]]*|your[^\]]*)\]|example\.com|lorem ipsum/i.test(code)) {
    return { ok: false, reason: 'It still contains placeholder text — fix it before adding it to the page.' };
  }
  if (opt.type === 'structure' || /^replace|replace (the )?existing|rename|change the (heading|h[1-6])/i.test(opt.where || '')) {
    return { ok: false, reason: 'This changes content already on the page (headings, links, existing sections) — apply it by hand or with a Grok Bot.' };
  }

  if (opt.type === 'schema') {
    const blocks = [...code.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1].trim());
    const jsons = blocks.length ? blocks : [code];
    const valid = [];
    for (const j of jsons) {
      try {
        const parsed = JSON.parse(j);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        if (!items.every(i => i && (i['@context'] || i['@graph']) && (i['@type'] || i['@graph']))) return { ok: false, reason: 'The schema is missing @context or @type.' };
        valid.push(JSON.stringify(parsed));
      } catch {
        return { ok: false, reason: 'The schema isn\'t valid JSON — it would be ignored by Google.' };
      }
    }
    return { ok: true, position: 'end', html: valid.map(v => '<script type="application/ld+json">' + v + '</script>').join('\n') };
  }

  // Content: keep any valid JSON-LD that came with it; drop other scripts and styles.
  let html = code.replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').trim();
  for (const m of html.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { JSON.parse(m[1]); } catch { return { ok: false, reason: 'The schema inside this section isn\'t valid JSON.' }; }
  }
  if (html.length < 40) return { ok: false, reason: 'Too little content to add.' };
  const where = String(opt.where || '');
  const position = TOP_WHERE.test(where) ? 'top' : END_WHERE.test(where) ? 'end' : TOP_HINT.test(opt.name || '') ? 'top' : 'end';
  return { ok: true, position, html };
}

// Is what visitors see on this URL the post content (so an edit shows up)?
// Checked by finding several sentences of the post's own text in the page.
export function contentIsRendered(renderedContent, liveHtml) {
  const text = s => String(s || '')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '-').replace(/\s+/g, ' ').trim();
  const post = text(renderedContent);
  if (post.length < 200) return false;
  const live = text(liveHtml);
  const sentences = post.split(/(?<=[.!?])\s+/).filter(s => s.length >= 40);
  const sample = [sentences[0], sentences[Math.floor(sentences.length / 2)], sentences[sentences.length - 1]].filter(Boolean);
  const found = sample.filter(s => live.includes(s.slice(0, 80))).length;
  return sample.length > 0 && found >= Math.min(2, sample.length);
}

export function wrapInsertion(key, html, raw) {
  const inner = '<!-- syte-aeo:' + key + ' -->\n' + html + '\n<!-- /syte-aeo:' + key + ' -->';
  // Block-editor posts: a Custom HTML block keeps the editor happy.
  return /<!--\s*wp:/.test(raw || '') ? '<!-- wp:html -->\n' + inner + '\n<!-- /wp:html -->' : inner;
}

export function insertInto(content, block, position) {
  const c = String(content || '');
  return position === 'top' ? block + '\n\n' + c : c.replace(/\s*$/, '') + '\n\n' + block;
}

export function removeInsertion(raw, key) {
  const k = key.replace(/[^a-z0-9]/gi, '');
  const re = new RegExp('\\s*(?:<!-- wp:html -->\\s*)?<!-- syte-aeo:' + k + ' -->[\\s\\S]*?<!-- /syte-aeo:' + k + ' -->(?:\\s*<!-- /wp:html -->)?\\s*', 'g');
  return String(raw || '').replace(re, '\n\n').replace(/^\s+|\s+$/g, '');
}

export const hasInsertion = (raw, key) => String(raw || '').includes('<!-- syte-aeo:' + key + ' -->');

function simpleHash(s) {
  let h = 5381;
  for (const ch of String(s || '')) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h.toString(36) + ':' + String(s || '').length;
}

// The client's own markup, from their recent posts (see cms/houseStyle.js):
// an added section then carries the same heading/paragraph classes as the
// rest of the page, so the theme styles it alike. Chris's "clients' styling
// doesn't pick up" request, for AEO sections. Best-effort; {} when unknown.
export async function houseStyleFor(wp, type = 'posts') {
  try {
    const recent = await wp('wp/v2/' + type + '?status=publish&per_page=5&_fields=content');
    return learnHouseStyle((Array.isArray(recent) ? recent : []).map(p => p?.content?.rendered || ''));
  } catch { return {}; }
}

// Dry run. { applicable, reason?, target, position, html, key, rawHash, renderedPreview, house_style }
export async function planAeoFix({ url, opt, optKey }, wp, fetchLive) {
  const ins = planInsertion(opt);
  if (!ins.ok) return { applicable: false, reason: ins.reason };
  const obj = await resolveWpObject(wp, url);
  if (!obj) return { applicable: false, reason: 'Could not match this URL to a WordPress page or post (the homepage is usually built in the theme or a page builder).' };
  const full = await wp('wp/v2/' + obj.type + '/' + obj.id + '?context=edit&_fields=content');
  const raw = full?.content?.raw ?? '';
  const rendered = full?.content?.rendered ?? '';
  const key = fixKey(url, optKey);
  if (hasInsertion(raw, key)) return { applicable: false, reason: 'Already added to this page.' };
  const live = await fetchLive(url);
  if (!contentIsRendered(rendered, live)) {
    return { applicable: false, reason: 'This page\'s visible content comes from a page builder, not the WordPress editor — adding it through the connection wouldn\'t show. Apply it in the builder (or with a Grok Bot).' };
  }
  const style = await houseStyleFor(wp, obj.type);
  const html = applyHouseStyle(ins.html, style);
  return {
    applicable: true, target: { type: obj.type, id: obj.id }, position: ins.position, html, key,
    rawHash: simpleHash(raw),
    house_style: Object.keys(style).length ? style : null,
    // For the in-theme preview: the page's rendered content with the addition in place.
    renderedPreview: insertInto(rendered, html, ins.position)
  };
}

export async function applyAeoFix(plan, wp) {
  const path = 'wp/v2/' + plan.target.type + '/' + plan.target.id;
  const cur = await wp(path + '?context=edit&_fields=content');
  const raw = cur?.content?.raw ?? '';
  if (simpleHash(raw) !== plan.rawHash) return { ok: false, changed: true, reason: 'The page was edited since the preview — preview again before applying.' };
  const next = insertInto(raw, wrapInsertion(plan.key, plan.html, raw), plan.position);
  await wp(path, { content: next });
  const back = await wp(path + '?context=edit&_fields=content');
  return { ok: hasInsertion(back?.content?.raw, plan.key), originalHash: plan.rawHash };
}

export async function undoAeoFix(plan, wp) {
  const path = 'wp/v2/' + plan.target.type + '/' + plan.target.id;
  const cur = await wp(path + '?context=edit&_fields=content');
  const raw = cur?.content?.raw ?? '';
  if (!hasInsertion(raw, plan.key)) return { ok: true, note: 'It was not on the page any more.' };
  await wp(path, { content: removeInsertion(raw, plan.key) });
  const back = await wp(path + '?context=edit&_fields=content');
  return { ok: !hasInsertion(back?.content?.raw, plan.key) };
}

// Visible on the live page? (First words of the added text, or the schema type.)
export function aeoLiveCheck(liveHtml, plan) {
  const page = String(liveHtml || '');
  if (!page) return { status: 'pending', detail: 'Could not load the live page to check yet.' };
  const text = plan.html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const needle = text ? text.slice(0, 50) : (plan.html.match(/"@type"\s*:\s*"([^"]+)"/) || [])[0];
  const flat = page.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const seen = text ? flat.includes(needle) : !!needle && page.replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''));
  return seen
    ? { status: 'verified', detail: 'It\'s live on the page.' }
    : { status: 'pending', detail: 'Saved in WordPress; not visible on the live page yet (page cache). Re-check later.' };
}
