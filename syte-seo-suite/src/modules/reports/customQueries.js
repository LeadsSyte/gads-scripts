// Custom AEO queries: the team's own list, uploaded or pasted on the client.
// They run exactly as written every month (aeoRunner.customProbesFor).
//
// parseQueryText is pure. readQueryFile reads .txt / .md / .csv in the
// browser, and .docx through jszip (already a dependency) by pulling the
// paragraphs out of word/document.xml.

const HEADER = /^(quer(?:y|ies)|prompts?|questions?|keywords?|search terms?)$/i;

function csvFirstCells(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^\s*"((?:[^"]|"")*)"/);
    const cell = m ? m[1].replace(/""/g, '"') : line.split(',')[0];
    out.push(cell);
  }
  return out;
}

// One query per line (bullets / numbering / quotes stripped). For a CSV the
// first column is the query; a header row is skipped.
export function parseQueryText(text, filename = '') {
  const lines = /\.csv$/i.test(filename) ? csvFirstCells(text) : String(text || '').split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (const raw of lines) {
    const q = String(raw || '')
      .replace(/^\s*(?:[-*•▪◦]|\d+[.)])\s+/, '')
      .replace(/^"(.*)"$/, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (q.length < 3 || HEADER.test(q)) continue;
    const k = q.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

export function docxXmlToText(xml) {
  return String(xml || '')
    .split(/<\/w:p>/)
    .map(p => (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''))
    .map(s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
    .join('\n');
}

// File -> string[] of queries. Throws a readable error for unsupported files.
export async function readQueryFile(file) {
  const name = file?.name || '';
  if (/\.docx$/i.test(name)) {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const xml = await zip.file('word/document.xml')?.async('string');
    if (!xml) throw new Error(`"${name}" doesn't look like a Word document.`);
    return parseQueryText(docxXmlToText(xml), name);
  }
  if (/\.(txt|md|markdown|csv)$/i.test(name) || /^text\//.test(file?.type || '')) {
    return parseQueryText(await file.text(), name);
  }
  throw new Error(`"${name}": upload a .docx, .txt or .csv file (one query per line), or paste the queries.`);
}
