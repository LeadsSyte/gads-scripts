// House style: make pushed articles carry the same markup the client's team
// uses in their own posts, so the theme styles them the same way.
//
// Found on Allergy Facts: the team picks a colour for every heading in the
// block editor, which stores it as classes on the tag
// (<h2 class="wp-block-heading has-black-color has-text-color">). Our plain
// <h2> fell back to the theme default and came out blue next to their black
// headings. Chris's "clients' styling doesn't pick up" concern, precisely.
//
// learnHouseStyle reads a few of the client's published posts and records,
// per tag, the class list most of them use. applyHouseStyle adds those
// classes to our tags that have none. Pure; used by the WordPress and
// Shopify push and by the in-theme draft preview.

export const STYLED_TAGS = ['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'blockquote', 'table', 'figure'];

// Classes that belong to one specific block instance (generated per post,
// e.g. wp-elements-12 referencing an inline <style>) or to a unique id —
// copying them would point at CSS that doesn't exist for our article.
const INSTANCE_CLASS = /^(wp-elements-[\w-]+|wp-container-[\w-]+|wp-block-[\w-]*-is-layout-[\w-]+|is-layout-[\w-]+|has-link-color|[\w-]*\d{3,}[\w-]*)$/;

function classesOf(tagHtml) {
  const m = tagHtml.match(/\bclass\s*=\s*"([^"]*)"|\bclass\s*=\s*'([^']*)'/i);
  const raw = m ? (m[1] ?? m[2]) : '';
  return raw.split(/\s+/).filter(c => c && !INSTANCE_CLASS.test(c));
}

// posts: array of rendered HTML strings from the client's own published posts.
// Returns { h2: 'wp-block-heading has-black-color has-text-color', ... } —
// only tags where most of the classed occurrences agree.
export function learnHouseStyle(posts) {
  const style = {};
  for (const tag of STYLED_TAGS) {
    const counts = new Map();
    let total = 0;
    for (const html of posts || []) {
      for (const m of String(html || '').matchAll(new RegExp('<' + tag + '\\b[^>]*>', 'gi'))) {
        const cls = classesOf(m[0]);
        total++;
        if (!cls.length) continue;
        const key = cls.join(' ');
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    if (!counts.size) continue;
    const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    // Only adopt a style the team uses for most of their tags of this kind.
    if (n >= 2 && n / total >= 0.5) style[tag] = best;
  }
  return style;
}

// Adds the learned classes to tags in our HTML that carry no class yet.
// Never touches a tag that already has one.
export function applyHouseStyle(html, style) {
  if (!style || !Object.keys(style).length) return html;
  let out = String(html || '');
  for (const [tag, cls] of Object.entries(style)) {
    if (!STYLED_TAGS.includes(tag) || !cls) continue;
    const safe = cls.replace(/[^\w\s-]/g, '');
    out = out.replace(new RegExp('<' + tag + '\\b(?![^>]*\\bclass\\s*=)([^>]*)>', 'gi'),
      (_m, attrs) => '<' + tag + ' class="' + safe + '"' + attrs + '>');
  }
  return out;
}
