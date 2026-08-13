// Parse Claude's article output into labelled sections so each piece
// can be displayed and copied separately. The model emits sections in
// roughly this order:
//   1. HTML/markdown article body
//   2. **Meta Title:** ...
//   3. **Meta Description:** ...
//   4. **AEO Summary Block:** ... (sometimes inline near the H1 instead)
//   5. **FAQ Schema (JSON-LD):** ```json ... ```
//   6. QA JSON block ```json { "keyword_integration": ... } ```

export function parseOutputSections(raw) {
  if (!raw) return null;

  const metaTitleMatch = raw.match(/\*?\*?Meta Title\*?\*?:?\s*(.+)/i);
  const metaDescMatch  = raw.match(/\*?\*?Meta Description\*?\*?:?\s*(.+)/i);
  const aeoMatch       = raw.match(/\*?\*?AEO Summary Block\*?\*?:?\s*([\s\S]*?)(?=\n\*?\*?(?:FAQ|Meta|```)|$)/i);

  const jsonBlocks = [];
  const jsonRe = /```json\s*([\s\S]*?)```/gi;
  let m;
  while ((m = jsonRe.exec(raw)) !== null) jsonBlocks.push(m[1].trim());

  const qaBlock = jsonBlocks.length > 0 ? jsonBlocks[jsonBlocks.length - 1] : null;
  const faqBlock = jsonBlocks.length > 1 ? jsonBlocks[jsonBlocks.length - 2] : null;

  // Article body sits between the Meta Title/Description/AEO Summary
  // header lines and the first ```json fence. Earlier code took
  // `raw.slice(0, firstMatch)` which broke when the output started
  // with **Meta Title:** (firstMatch === 0 → falls back to the whole
  // raw string, leaking the QA JSON into the copy-body button).
  let body = raw;
  const jsonStart = raw.search(/```json/i);
  if (jsonStart >= 0) body = raw.slice(0, jsonStart);
  // Strip leading Meta Title / Meta Description / AEO Summary header
  // lines so the "Article Body" copy field is just the H1 + prose.
  body = body
    .replace(/^\s*\*?\*?Meta Title\*?\*?:?[^\n]*\n+/im, '')
    .replace(/^\s*\*?\*?Meta Description\*?\*?:?[^\n]*\n+/im, '')
    .replace(/^\s*\*?\*?AEO Summary Block\*?\*?:?[\s\S]*?(?=\n#|\n\n|$)/im, '')
    .trim();

  return {
    body,
    metaTitle:  metaTitleMatch ? metaTitleMatch[1].trim().replace(/\*+/g, '') : null,
    metaDesc:   metaDescMatch  ? metaDescMatch[1].trim().replace(/\*+/g, '')  : null,
    aeoSummary: aeoMatch ? aeoMatch[1].trim() : null,
    faqSchema:  faqBlock,
    qaBlock
  };
}

// Markdown → HTML conversion for the article body. Used by:
//   - The "Copy as HTML" button in AutoWrite/ContentEngine (paste-into-CMS)
//   - The .docx export (so Word preserves headings/lists)
//   - The WordPress push (so REST posts get clean HTML)
//
// Handles the subset Claude actually emits today: ATX headings, bold/italic,
// unordered + ordered lists, fenced code, inline code, paragraphs, AND
// GFM-style tables (the comparison tables it loves to put in articles).
// Tables were the missing piece — without them the CMS sees raw pipes.
//
// If the input already starts with HTML tags we trust it and only clean
// up stray markdown emphasis (Claude sometimes mixes both modes).
export function markdownToHtml(md) {
  if (!md) return '';
  const trimmed = md.trim();
  const looksLikeHtml = /^<(?:!DOCTYPE|h[1-6]|p|div|section|article|ul|ol|table)\b/i.test(trimmed);
  if (looksLikeHtml) {
    return trimmed
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
  }

  // 1. Tables first — converted before paragraph wrapping eats the pipes.
  let out = trimmed.replace(
    /(^\|.+\|\s*\n\|[\s\-:|]+\|\s*\n(?:\|.+\|\s*\n?)+)/gm,
    (block) => {
      const lines = block.trim().split('\n');
      const head = lines[0].split('|').slice(1, -1).map(s => s.trim());
      const rows = lines.slice(2).map(l => l.split('|').slice(1, -1).map(s => s.trim()));
      const thead = '<thead><tr>' + head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead>';
      const tbody = '<tbody>' + rows.map(r =>
        '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>'
      ).join('') + '</tbody>';
      return '<table>' + thead + tbody + '</table>';
    }
  );

  // 2. Headings, emphasis, lists, code.
  out = out
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/gm, (m) => '<ul>' + m + '</ul>')
    .replace(/<\/ul>\s*<ul>/g, '')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/```[\s\S]*?```/g, m => '<pre>' + m.slice(3, -3).trim() + '</pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // 3. Paragraph wrapping — only lines that aren't already a block tag.
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<(?:h[1-6]|ul|ol|li|p|table|thead|tbody|tr|th|td|pre|code))(.+)$/gm, '<p>$1</p>')
    .replace(/<p><\/p>/g, '');

  return out;
}

