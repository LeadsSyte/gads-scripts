import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export async function buildCustomPackage(client, items) {
  const zip = new JSZip();

  const schemas = items.filter((i) =>
    ['schema', 'faq'].includes(i.change_type) || i.payload?.jsonld
  );
  const metas = items.filter((i) => i.change_type === 'meta');
  const contents = items.filter(
    (i) => !schemas.includes(i) && !metas.includes(i)
  );

  // schema.json
  const schemaBlob = schemas.map((s) => ({
    url: s.page_url,
    title: s.page_title,
    jsonld: s.payload?.jsonld || s.payload?.code || null,
    faq: s.payload?.faq || null,
  }));
  zip.file('schema.json', JSON.stringify(schemaBlob, null, 2));

  // meta-changes.txt
  const metaTxt = metas
    .map(
      (m) =>
        `URL: ${m.page_url}\nTitle: ${m.payload?.meta_title || ''}\nDescription: ${m.payload?.meta_description || ''}\n`
    )
    .join('\n---\n');
  zip.file('meta-changes.txt', metaTxt);

  // content-snippets.html
  const contentHtml = contents
    .map(
      (c) =>
        `<!-- ${c.page_url} — ${c.page_title} -->\n<div>${
          c.payload?.code || c.payload?.fix_code || JSON.stringify(c.payload)
        }</div>`
    )
    .join('\n\n');
  zip.file('content-snippets.html', `<!doctype html><html><body>\n${contentHtml}\n</body></html>`);

  // implementation-guide.txt
  const guide = `Syte SEO Suite — Implementation Guide for ${client.name}
Generated: ${new Date().toISOString()}

This package contains ${items.length} changes ready for manual implementation on your custom site.

FILES:
- schema.json         : Structured data (JSON-LD) to paste into <head> of each listed URL.
- meta-changes.txt    : Meta title and description updates per URL.
- content-snippets.html : HTML blocks (FAQs, key takeaways, answer blocks) to paste inline.

HOW TO APPLY:
1. For each URL in meta-changes.txt, update the page's <title> and <meta name="description">.
2. For each entry in schema.json, paste the "jsonld" block inside a <script type="application/ld+json"> tag in the page <head>.
3. For each snippet in content-snippets.html, paste the HTML into the appropriate spot in the page body.
4. Re-deploy your site.
`;
  zip.file('implementation-guide.txt', guide);

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `${client.name.replace(/\s+/g, '-').toLowerCase()}-seo-package.zip`);
}
