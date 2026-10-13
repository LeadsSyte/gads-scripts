// Per-client CSS (Chris: "upload each client's styling — fonts, H1… up to a
// full CSS file — and have the tool use it before it outputs or publishes").
//
// A client's stylesheet is uploaded on the CMS page. scopeClientCss keeps only
// what styles article content (headings, paragraphs, lists, tables, links,
// images, fonts, the client's own content classes) and confines every rule to
// our content wrapper, so nothing on the rest of the site can change:
//
//   h2 { color: #111 }            →  .syte-content h2 { color: #111 }
//   body { font-family: Lato }    →  .syte-content { font-family: Lato }
//   .site-header nav a { … }      →  (dropped: not article content)
//
// The result (small, ≤ MAX_BYTES) is stored in the publishing profile as
// client_css and sent with every article and AEO section the suite publishes:
// withClientCss wraps the HTML in <div class="syte-content"> with one
// <style data-syte="client-css"> before it. Pure — browser push, server push,
// AEO additions and the in-theme preview all use it.

export const SCOPE = '.syte-content';
export const MAX_BYTES = 20000;

// Tags our articles and AEO sections are made of.
const CONTENT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'blockquote', 'figure', 'figcaption', 'img', 'strong', 'b', 'em', 'i', 'hr', 'code', 'pre', 'dl', 'dt', 'dd', 'span', 'small', 'sup', 'sub', 'mark', 'details', 'summary']);
// Parts of a page that are never article content.
const LAYOUT = /(^|[\s>+~])(header|nav|footer|aside|form|input|button|select|textarea|iframe|video|svg)\b|[.#][\w-]*(header|navbar|nav-|menu|footer|sidebar|widget|banner|modal|popup|cookie|cart|checkout|search|logo|breadcrumb|slider|carousel)[\w-]*/i;
const ROOTISH = /^(html|body|:root|\*)$/i;
// The theme's article-area wrappers (WordPress, Shopify and common themes).
const CONTAINER_PREFIX = /^(((article|main)|\.(entry-content|post-content|entry|single-post|post-body|article-content|article__content|article-body|blog-content|blog-post|rte|wp-block-post-content|content-area|site-content|prose|elementor-widget-theme-post-content))(\.[\w-]+)*\s*>?\s+)+/i;
const FONT_IMPORT = /^@import\s+(url\()?\s*["']?https:\/\/(fonts\.googleapis\.com|fonts\.bunny\.net|use\.typekit\.net|fast\.fonts\.net)[^;]*;$/i;

const stripComments = s => String(s || '').replace(/\/\*[\s\S]*?\*\//g, '');

// Split CSS into top-level items: { kind: 'at-statement' | 'block', prelude, body }.
function topLevel(css) {
  const out = []; let i = 0; const n = css.length;
  while (i < n) {
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) break;
    let j = i, depth = 0, quote = '';
    // read the prelude up to '{' or ';'
    while (j < n) {
      const c = css[j];
      if (quote) { if (c === quote && css[j - 1] !== '\\') quote = ''; j++; continue; }
      if (c === '"' || c === "'") { quote = c; j++; continue; }
      if (c === '(') depth++; else if (c === ')') depth--;
      else if (depth <= 0 && (c === '{' || c === ';')) break;
      j++;
    }
    const prelude = css.slice(i, j).trim();
    if (j >= n) break;
    if (css[j] === ';') { out.push({ kind: 'at-statement', prelude: prelude + ';' }); i = j + 1; continue; }
    // block: find the matching '}'
    let k = j + 1, d = 1; quote = '';
    while (k < n && d > 0) {
      const c = css[k];
      if (quote) { if (c === quote && css[k - 1] !== '\\') quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '{') d++;
      else if (c === '}') d--;
      k++;
    }
    out.push({ kind: 'block', prelude, body: css.slice(j + 1, k - 1) });
    i = k;
  }
  return out;
}

// Split a selector list on top-level commas (not inside :is(), [attr="a,b"]).
function splitSelectors(list) {
  const out = []; let cur = '', depth = 0, quote = '';
  for (const c of list) {
    if (quote) { cur += c; if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// The subject (right-most compound) of a selector, without pseudo parts.
function subjectOf(sel) {
  const parts = sel.split(/\s*[\s>+~]\s*/).filter(Boolean);
  return (parts[parts.length - 1] || '').replace(/::?[\w-]+(\([^)]*\))?/g, '');
}

// One selector → the scoped selector, or null to drop it.
export function scopeSelector(sel, scope = SCOPE) {
  const s = String(sel || '').trim();
  if (!s || s.includes('#') || LAYOUT.test(s)) return null;
  if (ROOTISH.test(s)) return scope;
  // "body .entry-content h2" → ".syte-content h2": drop the page-level prefix and
  // the theme's article-area wrapper — on the live site our content sits inside it.
  const rest = s.replace(/^(html|body|:root)(\.[\w-]+)*\s+/i, '').replace(CONTAINER_PREFIX, '');
  if (ROOTISH.test(rest) || CONTAINER_PREFIX.test(rest + ' ')) return scope;
  const subject = subjectOf(rest);
  const tag = (subject.match(/^[a-z][a-z0-9]*/i) || [''])[0].toLowerCase();
  const isContentTag = tag && CONTENT_TAGS.has(tag);
  const isClassOnly = !tag && /^(\.[\w-]+|\[[^\]]+\])+$/.test(subject);
  if (!isContentTag && !isClassOnly) return null;
  return scope + ' ' + rest;
}

// Declarations that could pull content out of the article flow are dropped.
function cleanDeclarations(body) {
  return body.split(';').map(d => d.trim()).filter(d => d && /:/.test(d) && !/^position\s*:\s*(fixed|sticky)/i.test(d)).join('; ');
}

function scopeBlocks(items, scope, stats) {
  const out = [];
  for (const it of items) {
    if (it.kind === 'at-statement') {
      if (FONT_IMPORT.test(it.prelude.replace(/\s+/g, ' '))) { out.push(it.prelude); stats.kept++; } else stats.dropped++;
      continue;
    }
    const p = it.prelude;
    if (/^@font-face/i.test(p)) { out.push('@font-face{' + cleanDeclarations(it.body) + '}'); stats.kept++; continue; }
    if (/^@(media|supports|container)\b/i.test(p)) {
      const inner = scopeBlocks(topLevel(it.body), scope, stats);
      if (inner.length) out.push(p + '{' + inner.join('') + '}');
      continue;
    }
    if (/^@/.test(p)) { stats.dropped++; continue; } // keyframes, page, layer, …
    const sels = [...new Set(splitSelectors(p).map(s => scopeSelector(s, scope)).filter(Boolean))];
    const decl = cleanDeclarations(it.body);
    if (!sels.length || !decl) { stats.dropped++; continue; }
    out.push(sels.join(', ') + '{' + decl + '}');
    stats.kept++;
  }
  return out;
}

// → { css, kept, dropped, truncated, bytes }
export function scopeClientCss(rawCss, { scope = SCOPE, maxBytes = MAX_BYTES } = {}) {
  const stats = { kept: 0, dropped: 0 };
  const rules = scopeBlocks(topLevel(stripComments(rawCss)), scope, stats);
  // @import must come first; keep the order otherwise. Stop at the size limit.
  rules.sort((a, b) => (/^@import/i.test(b) ? 1 : 0) - (/^@import/i.test(a) ? 1 : 0));
  let css = '', truncated = false;
  for (const r of rules) {
    if (css.length + r.length + 1 > maxBytes) { truncated = true; break; }
    css += r + '\n';
  }
  // Never let the stored CSS close the <style> tag it lives in.
  css = css.replace(/<\/?style/gi, '');
  return { css: css.trim(), kept: stats.kept, dropped: stats.dropped, truncated, bytes: css.trim().length };
}

const STYLE_RE = /<style data-syte="client-css">[\s\S]*?<\/style>\s*/g;

// Wrap content in the scope with the client's CSS before it. Idempotent:
// content that already carries it is re-wrapped once, never doubled.
export function withClientCss(html, clientCss) {
  const css = String(clientCss || '').trim();
  const body = String(html || '').replace(STYLE_RE, '').replace(/^<div class="syte-content">([\s\S]*)<\/div>\s*$/, '$1');
  if (!css) return body;
  return '<style data-syte="client-css">' + css.replace(/<\/?style/gi, '') + '</style>\n<div class="syte-content">' + body + '</div>';
}

