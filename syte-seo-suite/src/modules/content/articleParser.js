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

  // Article body is everything before the first **Meta Title or first ```json fence.
  const bodyEnd = raw.search(/\*?\*?Meta Title\*?\*?:|```json/i);
  const body = bodyEnd > 0 ? raw.slice(0, bodyEnd).trim() : raw;

  return {
    body,
    metaTitle:  metaTitleMatch ? metaTitleMatch[1].trim().replace(/\*+/g, '') : null,
    metaDesc:   metaDescMatch  ? metaDescMatch[1].trim().replace(/\*+/g, '')  : null,
    aeoSummary: aeoMatch ? aeoMatch[1].trim() : null,
    faqSchema:  faqBlock,
    qaBlock
  };
}
