// A look at a post right after it went live — the moment a layout problem
// or a leftover label would show. Pure check + a small fetch; the result
// goes in the "went live" email so the team only opens the ones flagged.

const LEFTOVERS = [
  [/\bmeta\s*title\s*:/i, 'The words "Meta Title:" are showing on the page.'],
  [/\bmeta\s*description\s*:/i, 'The words "Meta Description:" are showing on the page.'],
  [/\baeo\s*summary(\s*block)?\s*:/i, 'The label "AEO Summary" is showing on the page.'],
  [/\bprimary\s*keyword\s*:/i, 'The words "Primary keyword:" are showing on the page.'],
  [/\bword\s*count\s*:/i, 'A word count is showing on the page.'],
  [/```/, 'Code marks (```) are showing on the page.'],
  [/(^|\s)#{2,4}\s+\S/m, 'Headings are showing as "##" text, not as headings.'],
  [/\*\*[^*\n]{3,80}\*\*/, 'Bold text is showing as **stars**.']
];

const textOf = html => String(html || '')
  .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#8217;|&rsquo;|&#039;|&#39;/g, "'").replace(/&#8211;|&ndash;/g, '-').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ')
  .replace(/[ \t]+/g, ' ');

const plain = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// { ok, problems: [string] }
export function checkLivePost({ status, html, title }) {
  if (!status || status >= 400) return { ok: false, problems: ['The live page did not open (' + (status ? 'error ' + status : 'no answer') + ').'] };
  const text = textOf(html);
  const problems = [];
  if (plain(text).length < 600) problems.push('The page has very little text on it — the article may not be showing.');
  const want = plain(title).split(' ').slice(0, 6).join(' ');
  if (want && !plain(text).includes(want)) problems.push('The article\'s title is not on the page.');
  const h1s = [...String(html || '').matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => plain(m[1].replace(/<[^>]+>/g, ' ')));
  if (want && h1s.filter(h => h.includes(want)).length > 1) problems.push('The title is showing twice.');
  for (const [re, msg] of LEFTOVERS) if (re.test(text)) problems.push(msg);
  return { ok: problems.length === 0, problems };
}

export async function fetchLivePost(url, doFetch = fetch) {
  try {
    const r = await doFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SyteSEOSuite/1.0)', 'Cache-Control': 'no-cache' },
      redirect: 'follow', signal: AbortSignal.timeout(15000)
    });
    return { status: r.status, html: r.ok ? (await r.text()).slice(0, 1500000) : '' };
  } catch {
    return { status: 0, html: '' };
  }
}

export async function lookAtLivePost(url, title, doFetch) {
  if (!url) return { ok: false, problems: ['No live address was returned, so the page could not be checked.'] };
  return checkLivePost({ ...(await fetchLivePost(url, doFetch)), title });
}
