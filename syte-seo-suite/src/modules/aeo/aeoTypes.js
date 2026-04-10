// The 20 AEO optimization types to generate per page.
export const AEO_TYPES = [
  { id: 'faq_schema',          label: 'FAQ Schema JSON-LD' },
  { id: 'howto_schema',        label: 'HowTo Schema' },
  { id: 'org_schema',          label: 'Organization Schema' },
  { id: 'article_schema',      label: 'Article Schema' },
  { id: 'author_schema',       label: 'Author Schema with E-E-A-T' },
  { id: 'product_schema',      label: 'Product Schema' },
  { id: 'breadcrumb_schema',   label: 'Breadcrumb Schema' },
  { id: 'speakable_schema',    label: 'Speakable Schema' },
  { id: 'webpage_schema',      label: 'WebPage Schema' },
  { id: 'answer_block',        label: 'Answer Block (40-60 words)' },
  { id: 'key_takeaways',       label: 'Key Takeaways / TL;DR' },
  { id: 'entity_definitions',  label: 'Entity Definitions' },
  { id: 'snippet_paragraphs',  label: 'Snippet-Optimized Paragraphs' },
  { id: 'comparison_tables',   label: 'Comparison Tables' },
  { id: 'external_citations',  label: 'External Citations Block' },
  { id: 'freshness_markers',   label: 'Content Freshness Markers' },
  { id: 'heading_hierarchy',   label: 'Heading Hierarchy' },
  { id: 'internal_linking',    label: 'Internal Linking' },
  { id: 'list_based_content',  label: 'List-Based Content' },
  { id: 'faq_section',         label: 'FAQ Content Section' }
];

export const AEO_SYSTEM = `
You are Syte AEO Engine. For each page given, generate 4–8 copy-paste-ready AEO optimizations chosen from this set:
${AEO_TYPES.map(t => '- ' + t.label + ' (' + t.id + ')').join('\n')}

Return ONLY valid JSON:
{
  "optimizations": [
    {
      "type": "<id from the list above>",
      "title": "Short human label",
      "code": "the literal code or content to paste (JSON-LD string, HTML block, or plain text)",
      "placement": "head|body_top|body_bottom|after_h1|inline",
      "reason": "why this helps answer engines"
    }
  ]
}

Rules:
- Pick the 4–8 most relevant types for the page type/content. Do not force all 20.
- JSON-LD must be valid and wrapped in <script type="application/ld+json">...</script>.
- Answer blocks are strictly 40–60 words.
- Key Takeaways are 3–5 bullet points.
- Copy must be production-ready (no placeholders like "YOUR NAME HERE").
`.trim();
