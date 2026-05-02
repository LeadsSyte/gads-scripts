// Shared helpers for parsing and rendering generated article output.
// Used by both ContentEngine (live generation view) and AutoWrite
// (Articles Written pipeline expansion) so both surfaces format
// articles the same way.

// Convert a pipe-table markdown block (header row, separator row, body rows)
// into an HTML <table>. Returns null if the block isn't a valid table.
function pipeTableToHtml(block) {
  const lines = block.split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;
  if (!/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[1])) return null;
  const split = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  const headers = split(lines[0]);
  const rows = lines.slice(2).map(split);
  const thead = '<thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead>';
  const tbody = '<tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody>';
  return '<table>' + thead + tbody + '</table>';
}

export function markdownToHtml(md) {
  if (!md) return '';
  // Pull pipe tables out first so the line-by-line replacements below
  // don't shred them. Leave a placeholder we can swap back in.
  const tables = [];
  let work = md.replace(/(?:^|\n)((?:\|[^\n]*\|\s*\n)+)/g, (full, block) => {
    const html = pipeTableToHtml(block);
    if (!html) return full;
    tables.push(html);
    return '\n\n@@TABLE_' + (tables.length - 1) + '@@\n\n';
  });

  let html = work
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/gm, (match) => '<ul>' + match + '</ul>')
    .replace(/<\/ul>\s*<ul>/g, '')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/```[\s\S]*?```/g, m => '<pre>' + m.slice(3, -3).trim() + '</pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hluop])(.+)$/gm, '<p>$1</p>')
    .replace(/<p><\/p>/g, '');

  // Restore tables.
  html = html.replace(/<p>@@TABLE_(\d+)@@<\/p>/g, (_, i) => tables[Number(i)] || '');
  html = html.replace(/@@TABLE_(\d+)@@/g, (_, i) => tables[Number(i)] || '');
  return html;
}

// Parse Claude's article output into labelled sections. Claude's output
// order varies — Meta Title sometimes leads, sometimes the body does — so
// we strip out the labelled sections and treat whatever remains as the
// article body.
export function parseOutputSections(raw) {
  if (!raw) return null;

  const metaTitleMatch = raw.match(/\*{0,2}Meta Title\*{0,2}:?\s*([^\n]+)/i);
  const metaDescMatch  = raw.match(/\*{0,2}Meta Description\*{0,2}:?\s*([^\n]+)/i);
  const aeoMatch = raw.match(
    /\*{0,2}AEO Summary Block\*{0,2}:?\s*([\s\S]*?)(?=\n\s*\n|\n\s*#{1,6}\s|\n\s*\*{0,2}(?:Meta Title|Meta Description|FAQ|QA)|\n\s*```|$)/i
  );

  const jsonBlocks = [];
  const jsonRe = /```json\s*([\s\S]*?)```/gi;
  let m;
  while ((m = jsonRe.exec(raw)) !== null) jsonBlocks.push(m[1].trim());

  const qaBlock = jsonBlocks.length > 0 ? jsonBlocks[jsonBlocks.length - 1] : null;
  const faqBlock = jsonBlocks.length > 1 ? jsonBlocks[jsonBlocks.length - 2] : null;

  let body = raw;
  if (metaTitleMatch) body = body.replace(metaTitleMatch[0], '');
  if (metaDescMatch)  body = body.replace(metaDescMatch[0], '');
  if (aeoMatch)       body = body.replace(aeoMatch[0], '');
  body = body.replace(/```json[\s\S]*?```/gi, '').trim();
  body = body.replace(/\n{3,}/g, '\n\n').trim();

  return {
    body,
    metaTitle: metaTitleMatch ? metaTitleMatch[1].trim().replace(/\*+/g, '') : null,
    metaDesc:  metaDescMatch  ? metaDescMatch[1].trim().replace(/\*+/g, '') : null,
    aeoSummary: aeoMatch ? aeoMatch[1].trim() : null,
    faqSchema: faqBlock,
    qaBlock
  };
}

// Copy markdown to clipboard as both rich HTML and plain text so paste
// into Google Docs / Word / WordPress visual editor preserves formatting.
export async function copyArticleFormatted(markdown) {
  const html = markdownToHtml(markdown);
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([markdown], { type: 'text/plain' })
      });
      await navigator.clipboard.write([item]);
      return true;
    }
    await navigator.clipboard.writeText(markdown);
    return true;
  } catch {
    try { await navigator.clipboard.writeText(markdown); return true; } catch { return false; }
  }
}
