import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  convertInchesToTwip,
} from 'docx';

/**
 * Convert a markdown-style article to a .docx buffer.
 */
export async function articleToDocx(article, clientName) {
  const children = parseArticleToDocxElements(article.content || article);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22 }, // 11pt
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          run: { size: 32, bold: true, font: 'Calibri', color: '1a1a1a' },
          paragraph: { spacing: { before: 240, after: 240 } },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          run: { size: 28, bold: true, font: 'Calibri', color: '2a2a2a' },
          paragraph: { spacing: { before: 180, after: 180 } },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          run: { size: 24, bold: true, font: 'Calibri', color: '333333' },
          paragraph: { spacing: { before: 120, after: 120 } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 }, // Letter
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

/**
 * Parse markdown content into docx elements.
 */
function parseArticleToDocxElements(content) {
  const lines = content.split('\n');
  const elements = [];
  let inCodeBlock = false;
  let codeLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle code blocks (JSON-LD schema, etc.)
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End code block — render as monospace paragraph
        elements.push(
          new Paragraph({
            spacing: { before: 100, after: 100 },
            border: {
              top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
              left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
              right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            },
            children: [
              new TextRun({
                text: codeLines.join('\n'),
                font: 'Courier New',
                size: 18, // 9pt
              }),
            ],
          })
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Headings
    if (trimmed.startsWith('# ')) {
      elements.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: parseInlineFormatting(trimmed.slice(2)),
        })
      );
      continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: parseInlineFormatting(trimmed.slice(3)),
        })
      );
      continue;
    }
    if (trimmed.startsWith('### ')) {
      elements.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: parseInlineFormatting(trimmed.slice(4)),
        })
      );
      continue;
    }

    // Meta info block (Meta Title:, Meta Description:, URL Slug:)
    if (/^(Meta Title|Meta Description|URL Slug):/i.test(trimmed)) {
      const colonIdx = trimmed.indexOf(':');
      const label = trimmed.slice(0, colonIdx + 1);
      const value = trimmed.slice(colonIdx + 1).trim();
      elements.push(
        new Paragraph({
          spacing: { before: 40, after: 40 },
          children: [
            new TextRun({ text: label + ' ', bold: true, size: 20, color: '666666' }),
            new TextRun({ text: value, size: 20, color: '333333' }),
          ],
        })
      );
      continue;
    }

    // Bullet lists
    if (/^[-*]\s/.test(trimmed)) {
      const text = trimmed.replace(/^[-*]\s+/, '');
      elements.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInlineFormatting(text),
        })
      );
      continue;
    }

    // Numbered lists
    if (/^\d+\.\s/.test(trimmed)) {
      const text = trimmed.replace(/^\d+\.\s+/, '');
      elements.push(
        new Paragraph({
          numbering: { reference: 'default-numbering', level: 0 },
          spacing: { before: 40, after: 40 },
          children: parseInlineFormatting(text),
        })
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      new Paragraph({
        spacing: { before: 60, after: 60 },
        children: parseInlineFormatting(trimmed),
      })
    );
  }

  // If we ended inside a code block, flush it
  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: codeLines.join('\n'),
            font: 'Courier New',
            size: 18,
          }),
        ],
      })
    );
  }

  return elements;
}

/**
 * Parse inline markdown formatting (**bold**, *italic*, [links]) into TextRun array.
 */
function parseInlineFormatting(text) {
  const runs = [];
  // Regex to match **bold**, *italic*, and plain text
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      // Bold
      runs.push(new TextRun({ text: match[2], bold: true }));
    } else if (match[3]) {
      // Italic
      runs.push(new TextRun({ text: match[3], italics: true }));
    } else if (match[4]) {
      // Plain text — also handle [link](url) by stripping to just the text
      const plain = match[4].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      runs.push(new TextRun({ text: plain }));
    }
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text }));
  }

  return runs;
}
