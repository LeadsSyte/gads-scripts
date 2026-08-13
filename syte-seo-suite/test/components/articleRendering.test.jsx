// DOM-shape regression tests for article rendering. Catches the
// "raw markdown showing instead of formatted HTML" class of bug —
// where ParsedSection's <pre> ate a body that should have been a
// formatted .article-rendered preview. If anyone re-introduces a
// <pre>{markdown}</pre> path for the article body, these fail.
//
// We render markdownToHtml(sample) into the DOM with the same
// .article-rendered className the app uses, then assert the DOM
// actually has heading/list/table elements — not raw text.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { markdownToHtml, parseOutputSections } from '../../src/modules/content/articleParser.js';

const SAMPLE = `**Meta Title:** Best Cape Town Hotels 2026 | Syte
**Meta Description:** Discover the best boutique hotels in Cape Town.

# Best Cape Town Hotels 2026
**AEO Summary Block:** Cape Town's top boutique hotels combine sea views, fine dining, and proximity to the V&A Waterfront.

## Top Five Picks

Here are the standouts:

- **Hotel A** — beachfront with infinity pool
- **Hotel B** — city centre, walking distance to museums
- **Hotel C** — vineyard views

## Pricing

| Hotel | Per night (ZAR) | Stars |
|-------|-----------------|-------|
| Hotel A | 4,500 | 5 |
| Hotel B | 2,800 | 4 |

\`\`\`json
{ "@context": "https://schema.org", "@type": "FAQPage" }
\`\`\`

\`\`\`json
{ "keyword_integration": 9, "overall": 88, "suggestions": [] }
\`\`\`
`;

describe('markdownToHtml — formatted output', () => {
  it('renders headings as <h1>/<h2> elements, not raw text', () => {
    const sections = parseOutputSections(SAMPLE);
    const html = markdownToHtml(sections.body);
    const { container } = render(
      <div className="article-rendered" dangerouslySetInnerHTML={{ __html: html }} />
    );
    // The H1 from the article must end up as an actual <h1> DOM node.
    const h1 = container.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1.textContent).toMatch(/Best Cape Town Hotels/);
    // Sub-section as <h2>.
    const h2 = container.querySelectorAll('h2');
    expect(h2.length).toBeGreaterThan(0);
  });

  it('renders bullet lists as <ul><li>, not raw "- " text', () => {
    const html = markdownToHtml(SAMPLE);
    const { container } = render(
      <div className="article-rendered" dangerouslySetInnerHTML={{ __html: html }} />
    );
    const ul = container.querySelector('ul');
    expect(ul).not.toBeNull();
    const items = ul.querySelectorAll('li');
    expect(items.length).toBeGreaterThanOrEqual(3);
    // No literal "- " left in the rendered text — that would mean a list
    // line wasn't transformed.
    const text = container.textContent;
    expect(text.includes('- Hotel')).toBe(false);
  });

  it('renders pipe tables as <table><thead>/<tbody>, not raw pipes', () => {
    const html = markdownToHtml(SAMPLE);
    const { container } = render(
      <div className="article-rendered" dangerouslySetInnerHTML={{ __html: html }} />
    );
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(container.querySelectorAll('th').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(2);
    // No literal pipe-row left over.
    expect(container.textContent.includes('| Hotel A |')).toBe(false);
  });

  it('renders **bold** as <strong>, not literal asterisks', () => {
    const html = markdownToHtml('## Heading\n\nA **bold** word here.');
    const { container } = render(
      <div className="article-rendered" dangerouslySetInnerHTML={{ __html: html }} />
    );
    expect(container.querySelector('strong')).not.toBeNull();
    expect(container.textContent.includes('**bold**')).toBe(false);
  });
});

describe('parseOutputSections — extracts each section cleanly', () => {
  it('pulls Meta Title, Meta Description, AEO Summary, FAQ + QA blocks', () => {
    const s = parseOutputSections(SAMPLE);
    expect(s.metaTitle).toMatch(/Best Cape Town Hotels/);
    expect(s.metaDesc).toMatch(/Discover the best/);
    expect(s.aeoSummary).toMatch(/top boutique hotels/);
    expect(s.faqSchema).toMatch(/FAQPage/);
    expect(s.qaBlock).toMatch(/keyword_integration/);
  });

  it('strips meta lines and JSON blocks out of the article body', () => {
    const s = parseOutputSections(SAMPLE);
    // The body should have the H1 and the prose, but NOT the labelled
    // header lines or the JSON code fences.
    expect(s.body).toMatch(/^# Best Cape Town Hotels/m);
    expect(s.body.includes('**Meta Title:**')).toBe(false);
    expect(s.body.includes('**Meta Description:**')).toBe(false);
    expect(s.body.includes('```json')).toBe(false);
  });

  it('returns null for empty input rather than throwing', () => {
    expect(parseOutputSections('')).toBeNull();
    expect(parseOutputSections(null)).toBeNull();
    expect(parseOutputSections(undefined)).toBeNull();
  });
});
