// A look at a live page the way a person would see it: a screenshot from
// Google's PageSpeed Insights (which loads the page in a real browser), judged
// by an AI with vision. Catches what the text checks can't — a stretched
// image, a heading in the wrong style, overlapping or broken layout.
//
//   PAGESPEED_API_KEY  — free Google API key (PageSpeed Insights API)
//
// A screenshot takes ~30 s, so this only runs in background functions.
// Everything outside is injected for tests: { fetch, complete, key }.

const PSI = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export const visualCheckAvailable = (env = process.env) => !!String(env.PAGESPEED_API_KEY || '').trim();

const parseDataUrl = d => { const m = String(d || '').match(/^data:(image\/[a-z+]+);base64,(.+)$/); return m ? { media_type: m[1], data: m[2] } : null; };

// → { ok, top, full, width, height } (top = what's visible without scrolling,
// full = the whole page) or { ok: false, error }.
export async function takeScreenshot(url, { key = process.env.PAGESPEED_API_KEY, fetch: doFetch = fetch } = {}) {
  if (!key) return { ok: false, error: 'PAGESPEED_API_KEY is not set' };
  try {
    const r = await doFetch(PSI + '?url=' + encodeURIComponent(url) + '&category=PERFORMANCE&strategy=DESKTOP&key=' + encodeURIComponent(String(key).trim()), { signal: AbortSignal.timeout(90000) });
    const j = await r.json();
    if (j.error) return { ok: false, error: 'PageSpeed ' + r.status + ': ' + String(j.error.message || '').split(String(key)).join('…').slice(0, 200) };
    const top = parseDataUrl(j.lighthouseResult?.audits?.['final-screenshot']?.details?.data);
    const fullShot = j.lighthouseResult?.fullPageScreenshot?.screenshot;
    const full = parseDataUrl(fullShot?.data);
    if (!top && !full) return { ok: false, error: 'PageSpeed returned no screenshot (the page may block Google\'s test browser).' };
    return { ok: true, top, full, width: fullShot?.width || null, height: fullShot?.height || null };
  } catch (e) {
    return { ok: false, error: 'Screenshot failed: ' + String(e.message || e).split(String(key)).join('…').slice(0, 200) };
  }
}

export const VISUAL_SYSTEM = `You check how a web page LOOKS, for an SEO agency that has just changed it. You are shown screenshots taken by a real browser. Decide whether a visitor would see something visibly broken or out of place.

Return JSON only: {"looks_right": true | false, "problems": ["one short plain sentence each, saying what and where"], "summary": "one short sentence"}

FLAG (looks_right false) only clear visual problems a visitor would notice:
- a broken, missing, stretched or squashed image; a huge image pushing the content down
- text overlapping other text or images; text cut off or running outside its box
- a heading or section whose style obviously doesn't match the rest of the page (different font, size or colour that looks pasted in)
- raw code, markdown symbols (##, **) or labels like "Meta Title:" showing as text
- a large empty gap where content should be; an error message; a blank or half-loaded page
- for a NEW ARTICLE compared with a reference article from the same site: a clearly different layout (no header/footer, no sidebar when the reference has one, title missing or shown twice)

DO NOT flag: cookie banners, chat widgets, pop-ups or newsletter prompts; the site's own design choices; small spacing differences; things you cannot see clearly because the full-page image is zoomed out; anything you are only guessing. When unsure, looks_right is true and the doubt goes in the summary.`;

const img = (shot, label) => shot ? [{ type: 'text', text: label }, { type: 'image', source: { type: 'base64', media_type: shot.media_type, data: shot.data } }] : [];

export function normalizeVisual(raw) {
  const problems = Array.isArray(raw?.problems) ? raw.problems.map(p => String(p).slice(0, 240)).filter(Boolean).slice(0, 6) : [];
  const ok = raw?.looks_right === true && problems.length === 0;
  return { ok, problems: ok ? [] : (problems.length ? problems : ['The check could not confirm the page looks right.']), summary: String(raw?.summary || '').slice(0, 240) };
}

function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// what: plain description of the change ("A new article was published…").
// reference: optional screenshot of an existing page of the same kind.
// → { status: 'ok' | 'problems' | 'unchecked', problems, summary, checked_at }
export async function judgePage({ url, what, shot, reference = null, referenceUrl = '' }, { complete }) {
  const content = [
    { type: 'text', text: 'PAGE: ' + url + '\nWHAT CHANGED: ' + what },
    ...img(shot.top, 'The page as it opens (top of the page, full size):'),
    ...img(shot.full, 'The whole page, top to bottom (zoomed out — use it for layout, not for reading small text):'),
    ...(reference ? img(reference.top, 'REFERENCE — an existing page of the same kind on this site (' + referenceUrl + '), as it opens. The page above should look like it belongs to the same site:') : []),
    { type: 'text', text: 'Does the page look right? JSON only.' }
  ];
  const text = await complete({ system: VISUAL_SYSTEM, messages: [{ role: 'user', content }], max_tokens: 500, temperature: 0 });
  return normalizeVisual(parseJson(text));
}

// One call for the callers: screenshot(s) + judgement. Never throws.
export async function visualCheck({ url, what, referenceUrl = '' }, deps = {}) {
  const at = new Date().toISOString();
  if (!url) return { status: 'unchecked', problems: [], summary: 'No live address to look at.', checked_at: at };
  const opts = { key: deps.key ?? process.env.PAGESPEED_API_KEY, fetch: deps.fetch };
  if (!opts.key) return { status: 'unchecked', problems: [], summary: 'The visual check is not set up (PAGESPEED_API_KEY).', checked_at: at };
  try {
    const [shot, ref] = await Promise.all([takeScreenshot(url, opts), referenceUrl ? takeScreenshot(referenceUrl, opts) : null]);
    if (!shot.ok) return { status: 'unchecked', problems: [], summary: shot.error, checked_at: at };
    const v = await judgePage({ url, what, shot, reference: ref?.ok ? ref : null, referenceUrl }, { complete: deps.complete });
    return { status: v.ok ? 'ok' : 'problems', problems: v.problems, summary: v.summary, checked_at: at, compared_with: ref?.ok ? referenceUrl : null };
  } catch (e) {
    return { status: 'unchecked', problems: [], summary: 'The visual check could not run: ' + String(e.message || e).slice(0, 160), checked_at: at };
  }
}
