// Pure parsing helpers for CMS pushes. No browser APIs, no imports —
// keeps these testable under plain node (test/cmsParse.test.mjs).

// Parse the raw Claude output into body vs metadata sections so we only
// push clean article HTML to the CMS, not the meta/schema/QA blocks.
// Also extracts the leading H1: WordPress/Shopify themes render the post
// title themselves, so leaving the H1 in the body shows a double title.
export function parseArticleBody(raw, { stripH1 = true } = {}) {
  if (!raw) return { body: '', metaTitle: '', metaDesc: '', articleTitle: '' };

  let text = raw;

  // Remove JSON blocks (JSON-LD schema and the internal QA scoring block)
  // FIRST, and tolerate a missing closing fence. These usually sit at the
  // very end of the article, so the trailing-fence trim below would leave
  // them unterminated and unmatchable — which is how a quality score
  // ("overall": 91, "suggestions": [...]) reached a client's draft.
  text = text.replace(/```(?:json)?\s*\{[\s\S]*?(?:```|$)/gi, '');

  // Strip code fences: ```html ... ``` or ``` ... ```
  text = text.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  // If the whole thing is wrapped in a single code fence, strip it.
  if (/^```/.test(text)) {
    text = text.replace(/^```(?:html)?\s*\n/i, '');
    const lastFence = text.lastIndexOf('```');
    if (lastFence > 0) text = text.slice(0, lastFence);
  }

  // Some prompt versions mark sections with HTML comments (<!-- META TITLE -->).
  // They're invisible in a browser but they pushed the metadata off index 0,
  // which the cut below mistook for trailing metadata — keeping only the
  // comment and dropping the entire article.
  text = text.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s+/, '');

  const metaTitleMatch = text.match(/\*?\*?Meta Title\*?\*?:?\s*(.+)/i);
  const metaDescMatch  = text.match(/\*?\*?Meta Description\*?\*?:?\s*(.+)/i);

  // Where the metadata sits varies by prompt. Older output puts it AFTER
  // the article, so cutting there works. Newer output puts it at the TOP —
  // cutting there would keep only what precedes it, and not cutting at all
  // is how "Meta Title:" once ended up as a visible paragraph on a client's
  // blog. So: cut only when it genuinely trails (past the first 40% of the
  // document), and strip the lines wherever they appear.
  const bodyEnd = text.search(/\*?\*?Meta Title\*?\*?:|```json/i);
  let body = bodyEnd > text.length * 0.4 ? text.slice(0, bodyEnd) : text;

  body = body
    .replace(/```json[\s\S]*?```/gi, '')
    .replace(/^[ \t]*\*{0,2}Meta (?:Title|Description)\*{0,2}[ \t]*:.*$/gim, '')
    // The writer's own length check under each meta line: "*(52 chars — within 50–58 ✅)*"
    .replace(/^[ \t]*\*?\(\s*\d+\s*char(?:acter)?s?\b[^)\n]*\)\*?[ \t]*$/gim, '');

  // The generator opens with a direct-answer paragraph (what AI engines and
  // featured snippets quote) and labels it "**AEO Summary Block:**" for the
  // writer's benefit. The paragraph belongs in the article; the label never
  // does — it was in ~85% of articles and on 8 of 9 pushed drafts, and was
  // being deleted by hand before every post went live. Strip only the label,
  // only at the start of a line or as a leading bold tag, so a sentence that
  // merely mentions the phrase is left alone.
  body = body
    // (optionally inside a "> " blockquote, which keeps its quote styling)
    .replace(/^([ \t]*(?:>[ \t]*)?)\*{0,2}(?:AEO Summary(?: Block)?|Answer Block)\*{0,2}[ \t]*:[ \t]*\*{0,2}[ \t]*/gim, '$1')
    .replace(/^[ \t]*#{1,6}[ \t]*(?:AEO Summary(?: Block)?|Answer Block)[ \t]*:?[ \t]*$/gim, '')
    .replace(/<(strong|b)>\s*(?:AEO Summary(?: Block)?|Answer Block)\s*:?\s*<\/\1>\s*:?\s*/gi, '');

  // Strip any remaining code fences inside the body.
  body = body.replace(/```(?:html)?\s*\n?/gi, '').replace(/\n?```/g, '');

  // Metadata usually sits above a --- rule; drop the orphaned separator so
  // the article's own H1 is genuinely first and gets recognised as the title.
  body = body.replace(/^(?:\s*(?:-{3,}|\*{3,}|_{3,})\s*)+/, '').trim();

  // Pull the leading H1 out of the body (markdown `# ...` or `<h1>...</h1>`)
  // and hand it back separately as the post title.
  let articleTitle = '';
  const mdH1 = body.match(/^\s*#\s+(.+?)\s*$/m);
  const htmlH1 = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  // Only treat it as THE title if it appears before any other content of
  // its kind (i.e. it's the first heading in the document).
  if (mdH1 && body.trimStart().startsWith('#')) {
    articleTitle = mdH1[1].replace(/\*+/g, '').trim();
    if (stripH1) body = body.replace(mdH1[0], '').trim();
  } else if (htmlH1 && /^\s*<h1/i.test(body)) {
    articleTitle = htmlH1[1].replace(/<[^>]+>/g, '').trim();
    if (stripH1) body = body.replace(htmlH1[0], '').trim();
  }

  return {
    body,
    articleTitle,
    metaTitle: metaTitleMatch ? metaTitleMatch[1].replace(/\*+/g, '').trim() : '',
    metaDesc:  metaDescMatch  ? metaDescMatch[1].replace(/\*+/g, '').trim() : '',
  };
}

// Approximation of WordPress's sanitize_title(): what slug a post titled
// `title` will get. Used to look up an existing draft before creating a
// new one, so re-pushing the same article updates instead of duplicating.
export function slugifyTitle(title) {
  return (title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')  // strip diacritics
    .replace(/&[a-z]+;/g, '')          // strip HTML entities
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
}
