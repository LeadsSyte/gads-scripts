// In-theme preview: show an article inside the client's real site design
// without logging into their CMS.
//
// Drafts are private — the CMS only shows them to a logged-in user, and our
// API connection can read a draft but can't open the preview page. So we
// rebuild it: take one of the client's own PUBLISHED posts (public), and
// swap its article body, title and hero image for ours. The header, fonts,
// colours, sidebar and layout are the client's live ones. Used by
// netlify/functions/draft-preview.js; pure so it is node-testable.
//
// It's a close copy, not the exact page: anything a theme or page builder
// changes only at render time for a specific post can differ.

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const BANNER = (note) =>
  '<div style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#111;color:#fff;'
  + 'font:13px/1.4 Arial,sans-serif;padding:8px 14px;text-align:center;opacity:.92">'
  + 'Syte draft preview — rebuilt in this site\'s design, not the live page. ' + escapeHtml(note || '') + '</div>';

// pageHtml:        the public HTML of one of the client's published posts
// templateContent: that post's article body as the CMS renders it
// templateTitle:   that post's title as rendered (entities as in the HTML)
// draftContent / draftTitle: ours
// templateImage / draftImage: hero image URLs to swap (optional)
// pageUrl:         the template post URL (relative links resolve against it)
export function buildThemePreview({ pageHtml, templateContent, templateTitle, draftContent, draftTitle,
  templateImage = '', draftImage = '', pageUrl = '', note = '' }) {
  let html = String(pageHtml || '');
  const body = String(templateContent || '').trim();
  if (!html || body.length < 40 || !html.includes(body)) {
    return { ok: false, reason: 'Could not find the article body inside the template page' };
  }
  html = html.split(body).join(String(draftContent || ''));

  const oldTitle = String(templateTitle || '').trim();
  let titleSwaps = 0;
  if (oldTitle.length >= 8) {
    titleSwaps = html.split(oldTitle).length - 1;
    html = html.split(oldTitle).join(escapeHtml(draftTitle));
  }

  let imageSwaps = 0;
  if (templateImage && draftImage && templateImage !== draftImage) {
    // WordPress also serves resized copies (name-300x200.jpg); swap those too
    // by matching the file stem.
    const stem = templateImage.replace(/\.(jpe?g|png|webp|gif)$/i, '');
    const re = new RegExp(stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(-\\d+x\\d+)?\\.(jpe?g|png|webp|gif)', 'gi');
    html = html.replace(re, () => { imageSwaps++; return draftImage; });
  }

  // Resolve the template's relative URLs against the client's site, keep
  // search engines out, and label the page so nobody mistakes it for live.
  const head = '<base href="' + escapeHtml(pageUrl) + '"><meta name="robots" content="noindex,nofollow">';
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + head) : head + html;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, BANNER(note) + '</body>') : html + BANNER(note);

  return { ok: true, html, titleSwaps, imageSwaps };
}

// Pick the first template whose body is actually present in its page HTML.
// candidates: [{ link, content, title, image }], fetchPage(url) → html
export async function pickTemplate(candidates, fetchPage) {
  for (const c of candidates || []) {
    const body = String(c.content || '').trim();
    if (!c.link || body.length < 40) continue;
    try {
      const html = await fetchPage(c.link);
      if (html && html.includes(body)) return { ...c, pageHtml: html };
    } catch { /* try the next one */ }
  }
  return null;
}
