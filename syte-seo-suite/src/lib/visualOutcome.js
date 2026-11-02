// What a screenshot check may conclude (Nov 2026).
//
// The visual verifier marked anything "not visible" as FAILED, including
// changes a screenshot can never show: alt text, meta titles and descriptions,
// schema, canonical and robots tags. Those failures then sat in the Monday
// email as if the work had not been done ("Alt text attributes are not
// visually visible on a webpage screenshot… · Confidence: high"). A screenshot
// can only confirm a visible change; for everything else it is inconclusive,
// and a low-confidence "not visible" is inconclusive too. Pure.

const NOT_IN_A_SCREENSHOT = new Set([
  'alt', 'alt_text', 'image_alt', 'img_alt', 'alt_tags',
  'meta', 'meta_title', 'meta_description', 'title', 'title_tag', 'description', 'meta_tags',
  'schema', 'structured_data', 'json_ld', 'jsonld', 'rich_snippets',
  'canonical', 'robots', 'noindex', 'meta_robots', 'hreflang', 'og', 'open_graph', 'og_tags',
  'lazy_load', 'image_optimisation', 'image_optimization', 'image_compression', 'internal_links'
]);

const norm = t => String(t || '').toLowerCase().replace(/[\s-]/g, '_');

// True when the change lives in the page code, not in what a visitor sees.
export function invisibleInScreenshot(impl) {
  if (NOT_IN_A_SCREENSHOT.has(norm(impl?.change_type))) return true;
  const t = String(impl?.title || '').toLowerCase();
  return /\balt[\s-]?(text|tag|attribute)s?\b|meta (title|description)|\bschema\b|structured data|json-?ld|canonical|\bnoindex\b|\brobots\b|hreflang|open graph|\bog:/.test(t);
}

// parsed: the vision model's { visible, confidence, evidence }.
// → { status: 'verified' | 'failed' | 'inconclusive', detail }
export function visualOutcome(impl, parsed) {
  const evidence = String(parsed?.evidence || '').trim();
  const conf = String(parsed?.confidence || '?');
  const tail = ' · Confidence: ' + conf + ' · (Visual verification via screenshot)';
  if (parsed?.visible === true) return { status: 'verified', detail: evidence + tail };
  if (invisibleInScreenshot(impl)) {
    return { status: 'inconclusive', detail: 'A screenshot cannot show this kind of change (it lives in the page code). Check the page source or verify manually.' + (evidence ? ' Screenshot note: ' + evidence : '') };
  }
  if (conf.toLowerCase() === 'low') {
    return { status: 'inconclusive', detail: 'The screenshot check was not sure (low confidence). ' + evidence + tail };
  }
  return { status: 'failed', detail: evidence + tail };
}
