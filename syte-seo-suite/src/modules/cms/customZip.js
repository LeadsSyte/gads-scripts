import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// Generate a downloadable change package for Custom Site clients.
export async function buildAndDownloadZip(client, items) {
  const zip = new JSZip();

  const schemas = [];
  const metaChanges = [];
  const snippets = [];
  const guideLines = [];

  guideLines.push(`Syte SEO Suite — Change Package for ${client.name}`);
  guideLines.push('Generated: ' + new Date().toISOString());
  guideLines.push('');
  guideLines.push('This package contains the changes to apply manually to your site.');
  guideLines.push('Review every file before publishing. Nothing here is auto-applied.');
  guideLines.push('');

  for (const item of items) {
    const p = item.payload || {};
    if (p.schema || p.code?.includes('application/ld+json')) {
      schemas.push({
        page_url: item.page_url,
        type: item.change_type,
        json_ld: p.schema || p.code
      });
    }
    if (p.meta_title || p.meta_description) {
      metaChanges.push([
        'URL: ' + item.page_url,
        'Meta Title: ' + (p.meta_title || ''),
        'Meta Description: ' + (p.meta_description || ''),
        ''
      ].join('\n'));
    }
    if (p.html || p.fix || (p.code && !p.code.includes('application/ld+json'))) {
      snippets.push(
        '<!-- ' + item.change_type + ' — ' + item.page_url + ' -->\n' +
        (p.html || p.fix || p.code) + '\n'
      );
    }
    guideLines.push('- ' + item.page_title + ' (' + item.change_type + ')');
    guideLines.push('  URL: ' + item.page_url);
    if (p.reason) guideLines.push('  Why: ' + p.reason);
    if (p.placement) guideLines.push('  Placement: ' + p.placement);
    guideLines.push('');
  }

  zip.file('schema.json', JSON.stringify(schemas, null, 2));
  zip.file('meta-changes.txt', metaChanges.join('\n'));
  zip.file('content-snippets.html', snippets.join('\n'));
  zip.file('implementation-guide.txt', guideLines.join('\n'));

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, 'syte-changes-' + (client.name || 'client').replace(/\s+/g, '-').toLowerCase() + '.zip');
}
